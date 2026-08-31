using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SQLite;
using System.IO;
using System.Threading;

namespace VerduraIdealposBridge.Orders
{
    /// <summary>
    /// The bridge's own local state — entirely separate from Idealpos's
    /// database. SQLite via System.Data.SQLite (Idealpos's own bundled
    /// copy — see lib/PUT_DLLS_HERE.txt). ExternalOrderId is the primary
    /// key: this is what makes a duplicate Verdura HTTP request a no-op
    /// instead of a second Idealpos order (Section 7 of the request this
    /// project implements — idempotency).
    ///
    /// A single process-wide lock serializes all writes. SQLite itself
    /// handles concurrent readers fine, but the bridge's own
    /// check-then-insert idempotency logic (OrderService) needs the whole
    /// sequence atomic from the bridge's point of view, and order volume in
    /// a single restaurant never remotely approaches a point where this
    /// matters for throughput.
    /// </summary>
    public class OrderStateStore
    {
        private readonly string _connectionString;
        private readonly object _writeLock = new object();

        public OrderStateStore(string sqliteFilePath)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(sqliteFilePath) ?? ".");
            if (!File.Exists(sqliteFilePath))
            {
                SQLiteConnection.CreateFile(sqliteFilePath);
            }
            _connectionString = "Data Source=" + sqliteFilePath + ";Version=3;";
            EnsureSchema();
        }

        private void EnsureSchema()
        {
            using (var conn = Open())
            using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = @"
CREATE TABLE IF NOT EXISTS Orders (
    ExternalOrderId TEXT PRIMARY KEY,
    RequestedTable TEXT NOT NULL,
    ItemsJson TEXT NOT NULL,
    Notes TEXT NULL,
    SubmittedAtUtc TEXT NOT NULL,
    Status TEXT NOT NULL,
    StrategyUsed TEXT NULL,
    IdealposWebReference TEXT NULL,
    OriginGuid TEXT NULL,
    WebPendingOrderId INTEGER NULL,
    PendingSalesId INTEGER NULL,
    PendingSalesCode TEXT NULL,
    TableMatchesRequest INTEGER NULL,
    LastError TEXT NULL,
    LastObservedAtUtc TEXT NOT NULL,
    TableOccupiedWarning INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS IX_Orders_Status ON Orders(Status);
CREATE INDEX IF NOT EXISTS IX_Orders_IdealposWebReference ON Orders(IdealposWebReference);
";
                cmd.ExecuteNonQuery();
            }
        }

        private SQLiteConnection Open()
        {
            var conn = new SQLiteConnection(_connectionString);
            conn.Open();
            return conn;
        }

        /// <summary>Returns null if no record exists yet for this externalOrderId.</summary>
        public OrderRecord Find(string externalOrderId)
        {
            using (var conn = Open())
            using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = "SELECT * FROM Orders WHERE ExternalOrderId = @id";
                cmd.Parameters.AddWithValue("@id", externalOrderId);
                using (var reader = cmd.ExecuteReader())
                {
                    if (!reader.Read()) return null;
                    return ReadRecord(reader);
                }
            }
        }

        public bool Exists(string externalOrderId)
        {
            using (var conn = Open())
            using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = "SELECT 1 FROM Orders WHERE ExternalOrderId = @id";
                cmd.Parameters.AddWithValue("@id", externalOrderId);
                return cmd.ExecuteScalar() != null;
            }
        }

        /// <summary>Inserts a brand-new order record. Throws SQLiteException
        /// (primary key violation) if externalOrderId already exists —
        /// callers must check Exists()/Find() first, per OrderService's
        /// idempotency flow; this is a deliberate belt-and-braces guard
        /// against a race, not the primary mechanism.</summary>
        public void Insert(OrderRecord record)
        {
            lock (_writeLock)
            {
                using (var conn = Open())
                using (var cmd = conn.CreateCommand())
                {
                    cmd.CommandText = @"
INSERT INTO Orders
(ExternalOrderId, RequestedTable, ItemsJson, Notes, SubmittedAtUtc, Status, StrategyUsed,
 IdealposWebReference, OriginGuid, WebPendingOrderId, PendingSalesId, PendingSalesCode,
 TableMatchesRequest, LastError, LastObservedAtUtc, TableOccupiedWarning)
VALUES
(@ExternalOrderId, @RequestedTable, @ItemsJson, @Notes, @SubmittedAtUtc, @Status, @StrategyUsed,
 @IdealposWebReference, @OriginGuid, @WebPendingOrderId, @PendingSalesId, @PendingSalesCode,
 @TableMatchesRequest, @LastError, @LastObservedAtUtc, @TableOccupiedWarning)";
                    BindParameters(cmd, record);
                    cmd.ExecuteNonQuery();
                }
            }
        }

        public void Update(OrderRecord record)
        {
            lock (_writeLock)
            {
                using (var conn = Open())
                using (var cmd = conn.CreateCommand())
                {
                    cmd.CommandText = @"
UPDATE Orders SET
    RequestedTable = @RequestedTable,
    ItemsJson = @ItemsJson,
    Notes = @Notes,
    Status = @Status,
    StrategyUsed = @StrategyUsed,
    IdealposWebReference = @IdealposWebReference,
    OriginGuid = @OriginGuid,
    WebPendingOrderId = @WebPendingOrderId,
    PendingSalesId = @PendingSalesId,
    PendingSalesCode = @PendingSalesCode,
    TableMatchesRequest = @TableMatchesRequest,
    LastError = @LastError,
    LastObservedAtUtc = @LastObservedAtUtc,
    TableOccupiedWarning = @TableOccupiedWarning
WHERE ExternalOrderId = @ExternalOrderId";
                    BindParameters(cmd, record);
                    cmd.ExecuteNonQuery();
                }
            }
        }

        /// <summary>Orders in a non-terminal state, for the background
        /// watcher to keep polling. Filtered by a SQL literal, not
        /// OrderStatusExtensions.IsTerminal() (real query-level filtering
        /// matters here, not an in-process one) — this list MUST be kept in
        /// sync with that method's terminal-status set by hand. Missing
        /// 'uncertain' here was found during the 2026-08-19 preflight
        /// review: without it, an Uncertain order would keep being
        /// re-observed by the watcher every poll tick forever, even though
        /// Uncertain is meant to be a terminal, operator-resolved state.</summary>
        public List<OrderRecord> FindActive()
        {
            var result = new List<OrderRecord>();
            using (var conn = Open())
            using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = "SELECT * FROM Orders WHERE Status NOT IN ('closed','rejected','failed','uncertain')";
                using (var reader = cmd.ExecuteReader())
                {
                    while (reader.Read()) result.Add(ReadRecord(reader));
                }
            }
            return result;
        }

        private static void BindParameters(SQLiteCommand cmd, OrderRecord r)
        {
            cmd.Parameters.AddWithValue("@ExternalOrderId", r.ExternalOrderId);
            cmd.Parameters.AddWithValue("@RequestedTable", r.RequestedTable);
            cmd.Parameters.AddWithValue("@ItemsJson", r.ItemsJson);
            cmd.Parameters.AddWithValue("@Notes", (object)r.Notes ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@SubmittedAtUtc", r.SubmittedAtUtc.ToString("o"));
            cmd.Parameters.AddWithValue("@Status", r.Status.ToWireString());
            cmd.Parameters.AddWithValue("@StrategyUsed", (object)r.StrategyUsed ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@IdealposWebReference", (object)r.IdealposWebReference ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@OriginGuid", (object)r.OriginGuid ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@WebPendingOrderId", (object)r.WebPendingOrderId ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@PendingSalesId", (object)r.PendingSalesId ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@PendingSalesCode", (object)r.PendingSalesCode ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@TableMatchesRequest", r.TableMatchesRequest.HasValue ? (object)(r.TableMatchesRequest.Value ? 1 : 0) : DBNull.Value);
            cmd.Parameters.AddWithValue("@LastError", (object)r.LastError ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@LastObservedAtUtc", r.LastObservedAtUtc.ToString("o"));
            cmd.Parameters.AddWithValue("@TableOccupiedWarning", r.TableOccupiedWarning ? 1 : 0);
        }

        private static OrderRecord ReadRecord(IDataRecord reader)
        {
            OrderStatus status;
            Enum.TryParse(ToPascal(reader["Status"].ToString()), true, out status);
            return new OrderRecord
            {
                ExternalOrderId = (string)reader["ExternalOrderId"],
                RequestedTable = (string)reader["RequestedTable"],
                ItemsJson = (string)reader["ItemsJson"],
                Notes = reader["Notes"] as string,
                SubmittedAtUtc = DateTime.Parse((string)reader["SubmittedAtUtc"]).ToUniversalTime(),
                Status = status,
                StrategyUsed = reader["StrategyUsed"] as string,
                IdealposWebReference = reader["IdealposWebReference"] as string,
                OriginGuid = reader["OriginGuid"] as string,
                WebPendingOrderId = reader["WebPendingOrderId"] == DBNull.Value ? (int?)null : Convert.ToInt32(reader["WebPendingOrderId"]),
                PendingSalesId = reader["PendingSalesId"] == DBNull.Value ? (int?)null : Convert.ToInt32(reader["PendingSalesId"]),
                PendingSalesCode = reader["PendingSalesCode"] as string,
                TableMatchesRequest = reader["TableMatchesRequest"] == DBNull.Value ? (bool?)null : Convert.ToInt32(reader["TableMatchesRequest"]) != 0,
                LastError = reader["LastError"] as string,
                LastObservedAtUtc = DateTime.Parse((string)reader["LastObservedAtUtc"]).ToUniversalTime(),
                TableOccupiedWarning = Convert.ToInt32(reader["TableOccupiedWarning"]) != 0,
            };
        }

        /// <summary>Status is stored using ToWireString()'s snake_case form
        /// (e.g. "assigned_to_table"); Enum.Parse needs PascalCase, so this
        /// undoes the underscore split rather than maintaining a second
        /// lookup table.</summary>
        private static string ToPascal(string snake)
        {
            var parts = snake.Split('_');
            var sb = new System.Text.StringBuilder();
            foreach (var p in parts)
            {
                if (p.Length == 0) continue;
                sb.Append(char.ToUpperInvariant(p[0])).Append(p.Substring(1));
            }
            return sb.ToString();
        }
    }
}
