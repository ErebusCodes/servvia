using System;
using System.Collections.Generic;
using System.Data.SqlClient;

namespace VerduraIdealposBridge.Idealpos
{
    /// <summary>
    /// Read-only access to POSServer.dbo.PendingSales — the native TABLE-SALE
    /// store, a different database from the IPSTransaction one every other
    /// query in this bridge targets (DL-112 §A4b).
    ///
    /// SELECT only, like IdealposReadRepository. Nothing in this class writes,
    /// and nothing in this class may ever write: converting a web order onto a
    /// table is a native operation whose semantics are still unknown (DL-111
    /// Q7/Q8), and the duplicate-KOT question that gates it is not settled.
    /// Reaching into POSServer with an UPDATE to fake a table assignment would
    /// bypass every native guard at once.
    ///
    /// This repository is OPTIONAL. When Bridge:PosServerConnection is not
    /// configured the bridge runs exactly as before, and cross-store
    /// reconciliation reports itself as disabled rather than silently
    /// returning "no table found" — which would be indistinguishable from a
    /// real negative result.
    /// </summary>
    public class PosServerReadRepository
    {
        private readonly string _connectionString;

        public PosServerReadRepository(string connectionString)
        {
            _connectionString = connectionString;
        }

        public bool CanConnect(out string detail)
        {
            try
            {
                using (var conn = new SqlConnection(_connectionString))
                {
                    conn.Open();
                    using (var cmd = new SqlCommand("select 1", conn))
                    {
                        cmd.ExecuteScalar();
                    }
                }
                detail = "ok";
                return true;
            }
            catch (Exception ex)
            {
                detail = ex.Message;
                return false;
            }
        }

        /// <summary>
        /// Open table sales, as reconciliation candidates.
        ///
        /// Deliberately returns every open row rather than filtering by table
        /// code in SQL: Reconciliation.SelectTableSale needs to see duplicates
        /// to be able to refuse an ambiguous match, and a SQL "top 1" would
        /// hide exactly the case that must not be guessed at.
        ///
        /// This store is small by nature — it holds open table sales, not
        /// history (3 rows when measured on the live venue mid-service).
        /// </summary>
        public List<PosServerPendingSaleRow> GetOpenTableSales()
        {
            var result = new List<PosServerPendingSaleRow>();
            using (var conn = new SqlConnection(_connectionString))
            using (var cmd = new SqlCommand(
                "select ID, Code, Map, POS from dbo.PendingSales order by ID desc", conn))
            {
                conn.Open();
                using (var reader = cmd.ExecuteReader())
                {
                    while (reader.Read())
                    {
                        result.Add(new PosServerPendingSaleRow
                        {
                            Id = reader.GetInt32(0),
                            Code = reader.IsDBNull(1) ? null : reader.GetString(1),
                            Map = reader.IsDBNull(2) ? 0 : Convert.ToInt32(reader.GetValue(2)),
                            Pos = reader.IsDBNull(3) ? 0 : Convert.ToInt32(reader.GetValue(3)),
                        });
                    }
                }
            }
            return result;
        }

        /// <summary>
        /// Is this table's sale still open? Resolved by CODE, never by a
        /// previously captured ID.
        ///
        /// POSServer regenerates these IDs during ordinary operation: its
        /// TABLEDATA handler services a table update by deleting the row and
        /// its lines and inserting a fresh one, and SYSDATA calls ClearAll()
        /// over the whole collection before reloading. A GetById() written
        /// against a stored ID would therefore return null the first time
        /// staff so much as edited the table — and the caller would read that
        /// as the table having closed and the order having been paid. That is
        /// why no GetById exists on this class.
        /// </summary>
        public bool TableSaleIsOpen(string tableCode)
        {
            if (string.IsNullOrWhiteSpace(tableCode)) return false;
            using (var conn = new SqlConnection(_connectionString))
            using (var cmd = new SqlCommand(
                "select count(*) from dbo.PendingSales where ltrim(rtrim(Code)) = @code and POS = 1", conn))
            {
                cmd.Parameters.AddWithValue("@code", tableCode.Trim());
                conn.Open();
                return Convert.ToInt32(cmd.ExecuteScalar()) > 0;
            }
        }
    }
}
