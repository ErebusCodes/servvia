using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.Linq;

namespace VerduraIdealposBridge.Idealpos
{
    public class WebPendingOrderRow
    {
        public int Id;
        public bool Processed;
        public DateTime DateRetrieved;
        public DateTime? DateProcessed;
        public string WebReference;
        public Guid Origin;
    }

    public class PendingSaleRow
    {
        public int Id;
        public string Code;
        public int? Status;
        public int? OrderState;
        public bool? SentOnline;
        public string Reference;
        public DateTime Date;
        public DateTime? OrderDate;
    }

    public class PendingSaleLineRow
    {
        public int Line;
        public string Col1;
        public string Col2;
        public int Person;
        public int SeatNumber;
    }

    /// <summary>
    /// All read-only. Every query here targets a table this investigation's
    /// static analysis of IPS.Data.SQL.dll's embedded DDL confirmed exists,
    /// with the exact confirmed column list ÔÇö see the technical report,
    /// Sections D/F/K. This class never writes to WebPendingOrder,
    /// PendingSales, or PendingSaleLines; order creation goes exclusively
    /// through IdealposOrderSubmitter -> LocalDataHelper.InsertOrders().
    /// </summary>
    public class IdealposReadRepository
    {
        private readonly string _connectionString;

        public IdealposReadRepository(string connectionString)
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
                detail = ex.GetType().Name + ": " + ex.Message;
                return false;
            }
        }

        /// <summary>
        /// dbo.TableMapSetups ÔÇö the floor-plan table objects. Confirmed
        /// column set, Section F of the investigation report.
        /// "LikelyOccupied" is an explicit heuristic ÔÇö see TableDto.
        /// </summary>
        public List<TableDto> GetTables()
        {
            var result = new List<TableDto>();
            using (var conn = new SqlConnection(_connectionString))
            using (var cmd = new SqlCommand(
                "select Code, Type, [Index], Caption, Seats, Status, Amount, GuestsSaved " +
                "from dbo.TableMapSetups order by Code, [Index]", conn))
            {
                conn.Open();
                using (var reader = cmd.ExecuteReader())
                {
                    while (reader.Read())
                    {
                        decimal amount = reader.GetDecimal(6);
                        int status = reader.GetInt32(5);
                        int code = reader.GetInt32(0);
                        int index = reader.GetInt32(2);
                        string caption = reader.GetString(3).Trim();
                        result.Add(new TableDto
                        {
                            Code = code,
                            Type = reader.GetInt32(1),
                            Index = index,
                            Table = ResolveTableIdentifier(caption, code, index),
                            Seats = reader.GetInt32(4),
                            Status = status,
                            Amount = amount,
                            GuestsSaved = reader.GetInt32(7),
                            TableMap = code,
                            LikelyOccupied = amount > 0m || status != 0,
                        });
                    }
                }
            }
            return result;
        }

        public TableDto FindTableByCaption(string table)
        {
            return GetTables().FirstOrDefault(t =>
                string.Equals(t.Table, table, StringComparison.OrdinalIgnoreCase));
        }

        /// <summary>
        /// Confirmed live against a real installation (2026-08-26): some
        /// venues leave TableMapSetups.Caption (and .Name) blank for every
        /// real table ÔÇö Verdura cannot match/select a table by an empty
        /// string, and every row would collapse to the same "" identifier,
        /// making tables indistinguishable. Falls back to "{Code}-{Index}"
        /// ÔÇö TableMapSetups' own composite key components, confirmed unique
        /// per row by the table's schema design ÔÇö only when Caption is
        /// genuinely blank, so venues that DO populate Caption are
        /// unaffected. Never guesses a value; Code and Index are read
        /// directly off the same row, not derived or inferred.
        /// </summary>
        internal static string ResolveTableIdentifier(string caption, int code, int index)
        {
            return string.IsNullOrWhiteSpace(caption) ? code + "-" + index : caption;
        }

        /// <summary>
        /// Real DUNEDIN StockItems (2026-08-26) includes a literal placeholder
        /// row ÔÇö Code="Deleted", Description="Deleted Deleted Deleted Stock
        /// Items" ÔÇö IdealPOS's own internal marker, not a real menu item.
        /// A real product Code is always a plain non-negative integer here;
        /// anything else is skipped rather than surfaced as orderable.
        /// </summary>
        internal static bool IsRealProductCode(string code)
        {
            int parsed;
            return !string.IsNullOrWhiteSpace(code) && int.TryParse(code, out parsed) && parsed >= 0;
        }

        /// <summary>
        /// Products via direct read-only SQL against dbo.StockItems, NOT
        /// Idealpos's own LocalDataHelper.GetIpsStockItemsDic() as originally
        /// written. Confirmed live against DUNEDIN (2026-08-26): that vendor
        /// method returned an empty dictionary for a real installation with
        /// 826 real active StockItems rows, while SqlConnected/AssembliesLoaded
        /// both reported healthy ÔÇö i.e. it did not error, it filtered
        /// everything out. Direct read-only evidence: EVERY row has
        /// SentOnline=0 AND Availability=0 (confirmed via
        /// "SELECT SentOnline, COUNT(*) ... GROUP BY SentOnline" ÔÇö all 826
        /// active rows in the SentOnline=0 bucket, same for Availability).
        /// GetIpsStockItemsDic() almost certainly filters on one or both of
        /// these online/web-visibility flags, which is an Idealpos-side
        /// per-product setting this venue has simply never used (no prior
        /// online-ordering integration) ÔÇö not something this bridge may set
        /// itself (that would be a live IdealPOS catalog mutation, out of
        /// bounds by this project's own non-negotiable rule). This is
        /// load-bearing, not cosmetic: OrderService.SubmitOrder() builds its
        /// validProductCodes set directly from this method's output, so an
        /// empty result here meant EVERY order line would fail validation
        /// ("productCode ... does not exist") regardless of how correct the
        /// PLU actually was.
        ///
        /// Price is deliberately NOT sourced here (StockItems has no Price/
        /// Price1-shaped column in this schema ÔÇö the vendor method must join
        /// a separate pricing table internally). Confirmed unnecessary for
        /// correctness: IdealposOrderSubmitter.BuildItems() leaves
        /// StockItem.PricingMode at its default (Inherit) specifically so
        /// Idealpos prices each line itself ÔÇö ProductDto.Price/Available
        /// exist only for the /api/products discovery response, never for
        /// order submission.
        /// </summary>
        public List<ProductDto> GetProducts()
        {
            var result = new List<ProductDto>();
            using (var conn = new SqlConnection(_connectionString))
            using (var cmd = new SqlCommand(
                "select Code, Description, DepartmentCode " +
                "from dbo.StockItems where Discontinue = 0 order by Code", conn))
            {
                conn.Open();
                using (var reader = cmd.ExecuteReader())
                {
                    while (reader.Read())
                    {
                        string code = reader.GetString(0).Trim();
                        if (!IsRealProductCode(code)) continue;

                        result.Add(new ProductDto
                        {
                            Id = code,
                            Code = code,
                            Description = reader.IsDBNull(1) ? "" : reader.GetString(1).Trim(),
                            Available = true, // see ProductDto.Available for why
                            Price = 0m, // deliberately not sourced ÔÇö see method doc comment
                            // dbo.StockItems.DepartmentCode is smallint (Int16)
                            // in this schema, not int ÔÇö confirmed via
                            // INFORMATION_SCHEMA.COLUMNS after GetInt32() threw
                            // "Specified cast is not valid" against the real
                            // live database.
                            DepartmentCode = reader.IsDBNull(2) ? 0 : reader.GetInt16(2),
                        });
                    }
                }
            }
            return result;
        }

        public bool ProductExists(string code)
        {
            using (var conn = new SqlConnection(_connectionString))
            using (var cmd = new SqlCommand(
                "select count(*) from dbo.StockItems where Discontinue = 0 and Code = @code", conn))
            {
                cmd.Parameters.AddWithValue("@code", code);
                conn.Open();
                return (int)cmd.ExecuteScalar() > 0;
            }
        }

        public WebPendingOrderRow GetWebPendingOrderByReference(string webReference)
        {
            using (var conn = new SqlConnection(_connectionString))
            using (var cmd = new SqlCommand(
                "select ID, Processed, DateRetrieved, DateProcessed, WebReference, Origin " +
                "from dbo.WebPendingOrder where WebReference = @ref order by ID desc", conn))
            {
                cmd.Parameters.AddWithValue("@ref", webReference);
                conn.Open();
                using (var reader = cmd.ExecuteReader())
                {
                    if (!reader.Read()) return null;
                    return new WebPendingOrderRow
                    {
                        Id = reader.GetInt32(0),
                        Processed = reader.GetBoolean(1),
                        DateRetrieved = reader.GetDateTime(2),
                        DateProcessed = reader.IsDBNull(3) ? (DateTime?)null : reader.GetDateTime(3),
                        WebReference = reader.GetString(4),
                        Origin = reader.GetGuid(5),
                    };
                }
            }
        }

        public PendingSaleRow GetPendingSaleByReference(string webReference)
        {
            using (var conn = new SqlConnection(_connectionString))
            using (var cmd = new SqlCommand(
                "select ID, Code, Status, OrderState, SentOnline, Reference, Date, OrderDate " +
                "from dbo.PendingSales where Reference = @ref order by ID desc", conn))
            {
                cmd.Parameters.AddWithValue("@ref", webReference);
                conn.Open();
                using (var reader = cmd.ExecuteReader())
                {
                    if (!reader.Read()) return null;
                    return ReadPendingSaleRow(reader);
                }
            }
        }

        public PendingSaleRow GetPendingSaleById(int id)
        {
            using (var conn = new SqlConnection(_connectionString))
            using (var cmd = new SqlCommand(
                "select ID, Code, Status, OrderState, SentOnline, Reference, Date, OrderDate " +
                "from dbo.PendingSales where ID = @id", conn))
            {
                cmd.Parameters.AddWithValue("@id", id);
                conn.Open();
                using (var reader = cmd.ExecuteReader())
                {
                    if (!reader.Read()) return null;
                    return ReadPendingSaleRow(reader);
                }
            }
        }

        /// <summary>Unfiltered-by-reference fallback, same rationale as in
        /// VerduraIdealposHarness's watch command: it is not confirmed that
        /// native Idealpos actually copies WebOrder.OrderReference into
        /// PendingSales.Reference.</summary>
        public List<PendingSaleRow> GetRecentPendingSales(DateTime sinceUtc, int top)
        {
            var result = new List<PendingSaleRow>();
            using (var conn = new SqlConnection(_connectionString))
            using (var cmd = new SqlCommand(
                "select top (@top) ID, Code, Status, OrderState, SentOnline, Reference, Date, OrderDate " +
                "from dbo.PendingSales where Date >= @since order by ID desc", conn))
            {
                cmd.Parameters.AddWithValue("@top", top);
                cmd.Parameters.AddWithValue("@since", sinceUtc);
                conn.Open();
                using (var reader = cmd.ExecuteReader())
                {
                    while (reader.Read()) result.Add(ReadPendingSaleRow(reader));
                }
            }
            return result;
        }

        public List<PendingSaleLineRow> GetPendingSaleLines(int pendingSaleId)
        {
            var result = new List<PendingSaleLineRow>();
            using (var conn = new SqlConnection(_connectionString))
            using (var cmd = new SqlCommand(
                "select Line, Col1, Col2, Person, SeatNumber from dbo.PendingSaleLines " +
                "where PendingSaleID = @id order by Line", conn))
            {
                cmd.Parameters.AddWithValue("@id", pendingSaleId);
                conn.Open();
                using (var reader = cmd.ExecuteReader())
                {
                    while (reader.Read())
                    {
                        result.Add(new PendingSaleLineRow
                        {
                            Line = reader.GetInt16(0),
                            Col1 = reader.GetString(1),
                            Col2 = reader.GetString(2),
                            Person = reader.GetInt32(3),
                            SeatNumber = reader.GetInt32(4),
                        });
                    }
                }
            }
            return result;
        }

        private static PendingSaleRow ReadPendingSaleRow(SqlDataReader reader)
        {
            return new PendingSaleRow
            {
                Id = reader.GetInt32(0),
                Code = reader.IsDBNull(1) ? "" : reader.GetString(1).Trim(),
                Status = reader.IsDBNull(2) ? (int?)null : reader.GetInt32(2),
                OrderState = reader.IsDBNull(3) ? (int?)null : reader.GetInt32(3),
                SentOnline = reader.IsDBNull(4) ? (bool?)null : reader.GetBoolean(4),
                Reference = reader.IsDBNull(5) ? "" : reader.GetString(5),
                Date = reader.GetDateTime(6),
                OrderDate = reader.IsDBNull(7) ? (DateTime?)null : reader.GetDateTime(7),
            };
        }
    }
}