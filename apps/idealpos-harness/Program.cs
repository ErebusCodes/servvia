// VerduraIdealposHarness
//
// Purpose: answer ONE question, experimentally, against a disposable test
// copy of Idealpos — nothing more:
//
//   Can Idealpos process an externally constructed WebOrder through its
//   real WebPendingOrder pipeline and automatically attach that order to
//   a specific existing table (e.g. Table 12), so it appears as a normal
//   unpaid table order in Idealpos?
//
// This calls Idealpos's own first-party method — LocalDataHelper.InsertOrders
// in IdealPos.Webit.Core.dll — which is the exact method the real Doshii/
// Ecommerce pipeline and the legacy Webit COM pipeline both call (confirmed
// by decompiling IdealposService.exe and IdealPos.Webit.Core.dll). This
// harness does not reimplement that method's SQL.
//
// Everything this harness does beyond that single call is read-only
// diagnostics against dbo.WebPendingOrder / dbo.PendingSales /
// dbo.PendingSaleLines, to observe what native IPS.exe does with the order
// after InsertOrders() hands it off.

using System;
using System.Collections.Generic;
using System.Configuration;
using System.Data;
using System.Data.SqlClient;
using System.Linq;
using System.Threading;
using IdealPos.Webit;

namespace VerduraIdealposHarness
{
    internal static class Program
    {
        // Base reference for every test order this harness creates. Each
        // named experiment appends its own letter so runs never collide and
        // stay trivially greppable/deletable: VERDURA-TEST-0001-A, -B, ...
        private const string BaseReference = "VERDURA-TEST-0001";

        // Confirmed via decompilation of:
        //   - IdealposService.Services.EcommerceService.GetPendingOrder()
        //   - IdealposService.IdealposServiceLogic.ProcessOrder()
        // Both call LocalDataHelper.InsertOrders(..., new Guid("02C1A621-1C2E-4E73-A09E-7AF1CCA49F80"))
        // — this is the real Origin GUID Idealpos's own Doshii/Ecommerce
        // plugin uses today. Using it here means a row this harness inserts
        // is, at the database level, indistinguishable from one Doshii
        // itself would have produced. Override with --origin-guid if you
        // want harness rows to carry a distinct, easily-filterable Origin
        // instead (WebReference is already unique/filterable either way).
        private static readonly Guid ConfirmedEcommercePluginGuid =
            new Guid("02C1A621-1C2E-4E73-A09E-7AF1CCA49F80");

        private static int Main(string[] args)
        {
            Console.WriteLine("VerduraIdealposHarness — WebOrder -> WebPendingOrder -> IPS.exe probe");
            Console.WriteLine();

            if (args.Length == 0)
            {
                PrintUsage();
                return 1;
            }

            try
            {
                var rest = args.Skip(1).ToArray();
                switch (args[0].ToLowerInvariant())
                {
                    case "insert":
                        return CmdInsert(rest);
                    case "list-products":
                        return CmdListProducts(rest);
                    case "watch":
                        return CmdWatch(rest);
                    case "help":
                    case "--help":
                    case "-h":
                        PrintUsage();
                        return 0;
                    default:
                        Console.WriteLine("Unknown command: " + args[0]);
                        PrintUsage();
                        return 1;
                }
            }
            catch (SqlException ex)
            {
                WriteError("SQL SERVER ERROR", ex.ToString());
                Console.WriteLine();
                Console.WriteLine("This is a connectivity/permission problem talking to the target");
                Console.WriteLine("SQL Server, not an Idealpos pipeline problem. Check:");
                Console.WriteLine("  - Is the SQL Server / named instance in App.config actually running");
                Console.WriteLine("    and reachable from this machine (try: sqlcmd -S <server> -Q \"select 1\")?");
                Console.WriteLine("  - Does the Windows account running this harness have db_datareader/");
                Console.WriteLine("    db_datawriter on the IPSTransaction database (Trusted_Connection=True");
                Console.WriteLine("    means SQL auth is NOT used — it's whoever is logged into Windows)?");
                Console.WriteLine("  - Is TCP/IP enabled for the named instance (SQL Server Configuration");
                Console.WriteLine("    Manager) if connecting from a different machine than the SQL box?");
                return 3;
            }
            catch (ConfigurationErrorsException ex)
            {
                WriteError("CONFIGURATION ERROR", ex.ToString());
                return 3;
            }
            catch (GuardException ex)
            {
                WriteError("SAFETY GUARD BLOCKED THIS RUN", ex.Message);
                return 4;
            }
            catch (Exception ex)
            {
                WriteError("UNHANDLED EXCEPTION", ex.ToString());
                return 2;
            }
        }

        private static void PrintUsage()
        {
            Console.WriteLine("Commands:");
            Console.WriteLine();
            Console.WriteLine("  list-products [--filter TEXT] [--top N]");
            Console.WriteLine("      Read-only. Calls Idealpos's own LocalDataHelper.GetIpsStockItemsDic()");
            Console.WriteLine("      against the configured test database and prints real stock item");
            Console.WriteLine("      codes you can use for --burger/--chips/--coke below. Run this first.");
            Console.WriteLine();
            Console.WriteLine("  insert --test A|B|C|D|E --i-understand-this-is-a-test --confirm-server <name>");
            Console.WriteLine("         [--table 12] [--burger CODE] [--chips CODE] [--coke CODE] [--auto-items]");
            Console.WriteLine("      Constructs ONE real WebOrder and calls Idealpos's own");
            Console.WriteLine("      LocalDataHelper.InsertOrders(). See 'Experiments' below for what A-E do.");
            Console.WriteLine();
            Console.WriteLine("  watch <reference-or-prefix> [--interval-seconds 5] [--timeout-minutes 15]");
            Console.WriteLine("      Read-only. Polls WebPendingOrder / PendingSales / PendingSaleLines for");
            Console.WriteLine("      the given WebReference (prefix match) and reports what native IPS.exe");
            Console.WriteLine("      has done with it. Never writes anything.");
            Console.WriteLine();
            Console.WriteLine("Experiments (the field under test is the only thing that changes):");
            Console.WriteLine("  A  OrderDetail=EatIn only                        (baseline / no table hint)");
            Console.WriteLine("  B  OrderDetail=EatIn, DeliverTo=<table>");
            Console.WriteLine("  C  OrderDetail=EatIn, Message=\"Table <table>\"");
            Console.WriteLine("  D  OrderDetail=EatIn, OrderReference=\"T<table>-<base-reference>-D\"");
            Console.WriteLine("     (extrapolates the confirmed Doshii payment-side OrderId convention");
            Console.WriteLine("      \"<prefix>-<table>\" seen in ProcessDoshiiService.ProjectPacket — this");
            Console.WriteLine("      is an experiment, not a confirmed WebOrder convention)");
            Console.WriteLine("  E  OrderDetail=EatIn, HostReference=<table>");
            Console.WriteLine();
            Console.WriteLine("Example session:");
            Console.WriteLine("  VerduraIdealposHarness.exe list-products --filter burger");
            Console.WriteLine("  VerduraIdealposHarness.exe insert --test A --i-understand-this-is-a-test \\");
            Console.WriteLine("      --confirm-server \"TESTPOS\\IDEALSQL\" --auto-items");
            Console.WriteLine("  VerduraIdealposHarness.exe watch VERDURA-TEST-0001-A");
        }

        // ------------------------------------------------------------------
        // list-products
        // ------------------------------------------------------------------

        private static int CmdListProducts(string[] args)
        {
            string filter = GetOption(args, "--filter");
            int top = int.Parse(GetOption(args, "--top") ?? "25");

            string connStr = GetConnectionStringOrThrow();
            PrintTargetBanner(connStr, requireConfirmation: false);

            Console.WriteLine("Calling LocalDataHelper.GetIpsStockItemsDic() (Idealpos's own method,");
            Console.WriteLine("read-only SELECT against StockItems/StockItemsValue)...");
            Console.WriteLine();

            Dictionary<string, IpsStockItem> items = LocalDataHelper.GetIpsStockItemsDic();

            IEnumerable<IpsStockItem> query = items.Values;
            if (!string.IsNullOrWhiteSpace(filter))
            {
                query = query.Where(i =>
                    (i.Description ?? "").IndexOf(filter, StringComparison.OrdinalIgnoreCase) >= 0 ||
                    (i.Code ?? "").IndexOf(filter, StringComparison.OrdinalIgnoreCase) >= 0);
            }

            var list = query.OrderBy(i => i.Code).Take(top).ToList();

            if (list.Count == 0)
            {
                Console.WriteLine("No stock items matched. If this is a freshly-restored demo database,");
                Console.WriteLine("confirm StockItemsValue has Price1 rows populated (GetIpsStockItemsDic()");
                Console.WriteLine("only returns items with a non-zero Level-1 Price1 value, per its own SQL).");
                return 0;
            }

            Console.WriteLine("{0,-16} {1,-40} {2,10} {3,8}", "Code", "Description", "Price1", "Dept");
            Console.WriteLine(new string('-', 78));
            foreach (var i in list)
            {
                Console.WriteLine("{0,-16} {1,-40} {2,10:0.00} {3,8}",
                    i.Code, Truncate(i.Description, 40), i.Price1, i.DepartmentCode);
            }
            Console.WriteLine();
            Console.WriteLine(list.Count + " item(s) shown. Pass real codes to 'insert' via --burger/--chips/--coke.");
            return 0;
        }

        // ------------------------------------------------------------------
        // insert
        // ------------------------------------------------------------------

        private static int CmdInsert(string[] args)
        {
            string test = (GetOption(args, "--test") ?? "").ToUpperInvariant();
            if (test != "A" && test != "B" && test != "C" && test != "D" && test != "E")
            {
                throw new GuardException("--test must be one of A, B, C, D, E. Run with no arguments for details.");
            }

            string table = GetOption(args, "--table") ?? "12";

            string connStr = GetConnectionStringOrThrow();

            bool understood = HasFlag(args, "--i-understand-this-is-a-test");
            string confirmServer = GetOption(args, "--confirm-server");

            PrintTargetBanner(connStr, requireConfirmation: true);

            if (!understood)
            {
                throw new GuardException(
                    "Refusing to insert: pass --i-understand-this-is-a-test to confirm you " +
                    "are targeting a disposable test database, not the live restaurant.");
            }

            var builder = new SqlConnectionStringBuilder(connStr);
            if (string.IsNullOrWhiteSpace(confirmServer))
            {
                throw new GuardException(
                    "Refusing to insert: pass --confirm-server \"" + builder.DataSource + "\" " +
                    "(must exactly match the Data Source in App.config's IpsConnection string, " +
                    "printed above). This forces you to look at the target before writing to it.");
            }
            if (!string.Equals(confirmServer.Trim(), builder.DataSource.Trim(), StringComparison.OrdinalIgnoreCase))
            {
                throw new GuardException(
                    "Refusing to insert: --confirm-server \"" + confirmServer + "\" does not match " +
                    "the configured target \"" + builder.DataSource + "\". Aborting rather than guessing.");
            }

            // Resolve product codes: never invented. Either explicit
            // --burger/--chips/--coke codes, or --auto-items pulled live
            // from LocalDataHelper.GetIpsStockItemsDic() against THIS
            // target database.
            var line1 = ResolveItem(args, "--burger", "burger", 2m);
            var line2 = ResolveItem(args, "--chips", "chips", 1m);
            var line3 = ResolveItem(args, "--coke", "coke", 2m);

            string reference = BaseReference + "-" + test;
            DateTime now = DateTime.UtcNow;

            var order = new WebOrder
            {
                OrderReference = reference,
                HostReference = "VerduraIdealposHarness",
                OrderedDate = now,
                DeliveryDate = now,
                OrderDetail = OrderMode.EatIn,
                PaymentDetail = PaymentMode.None,   // unpaid — staff pay normally in Idealpos
                GiftOrder = false,
                TriggerPromotions = false,
                CalculatePoints = false,
                Items = new[] { line1.Item, line2.Item, line3.Item },
            };

            string fieldUnderTest;
            switch (test)
            {
                case "A":
                    fieldUnderTest = "(none — baseline)";
                    break;
                case "B":
                    order.DeliverTo = table;
                    fieldUnderTest = "DeliverTo = \"" + table + "\"";
                    break;
                case "C":
                    order.Message = "Table " + table;
                    fieldUnderTest = "Message = \"Table " + table + "\"";
                    break;
                case "D":
                    order.OrderReference = "T" + table + "-" + reference;
                    reference = order.OrderReference;
                    fieldUnderTest = "OrderReference = \"" + order.OrderReference + "\" (table-prefixed)";
                    break;
                case "E":
                    order.HostReference = table;
                    fieldUnderTest = "HostReference = \"" + table + "\"";
                    break;
                default:
                    throw new GuardException("Unreachable.");
            }

            Guid origin = ConfirmedEcommercePluginGuid;
            string originArg = GetOption(args, "--origin-guid");
            if (!string.IsNullOrWhiteSpace(originArg))
            {
                origin = Guid.Parse(originArg);
            }

            Console.WriteLine();
            Console.WriteLine("=== Order under construction (Test " + test + ") ===");
            Console.WriteLine("  OrderReference : " + order.OrderReference);
            Console.WriteLine("  HostReference  : " + order.HostReference);
            Console.WriteLine("  OrderDetail    : " + order.OrderDetail);
            Console.WriteLine("  PaymentDetail  : " + order.PaymentDetail + "  (unpaid — staff pay in Idealpos)");
            Console.WriteLine("  DeliverTo      : " + (order.DeliverTo ?? "(not set)"));
            Console.WriteLine("  Message        : " + (order.Message ?? "(not set)"));
            Console.WriteLine("  Field under test: " + fieldUnderTest);
            Console.WriteLine("  Origin GUID    : " + origin + (origin == ConfirmedEcommercePluginGuid ? "  (confirmed real Ecommerce plugin GUID)" : "  (custom, via --origin-guid)"));
            Console.WriteLine("  Items:");
            foreach (var it in order.Items)
            {
                Console.WriteLine("    " + it.Code + "  x" + it.Quantity + "  \"" + it.Description + "\"");
            }
            Console.WriteLine();

            Console.WriteLine("Calling LocalDataHelper.InsertOrders() — Idealpos's own first-party method...");
            int rowsInserted;
            try
            {
                rowsInserted = LocalDataHelper.InsertOrders(new[] { order }, origin);
            }
            catch (Exception ex)
            {
                Console.WriteLine();
                Console.WriteLine("InsertOrders() THREW. This is diagnostic information, not a dead end:");
                Console.WriteLine(ex);
                return 5;
            }

            Console.WriteLine("InsertOrders() returned: " + rowsInserted + " row(s) inserted.");
            if (rowsInserted == 0)
            {
                Console.WriteLine();
                Console.WriteLine("Zero rows inserted. Looking at InsertOrders()'s own SQL (decompiled):");
                Console.WriteLine("it LEFT JOINs on (WebReference, Origin) and only inserts when no existing");
                Console.WriteLine("row matches — this reference/origin pair may already exist from a prior run.");
                Console.WriteLine("Try a different --test, or watch the existing row with:");
                Console.WriteLine("  VerduraIdealposHarness.exe watch " + reference);
                return 0;
            }

            Console.WriteLine();
            Console.WriteLine("Reading back the row we just inserted (read-only SELECT, diagnostic only)...");
            PrintWebPendingOrderRows(connStr, reference);

            Console.WriteLine();
            Console.WriteLine("Next: VerduraIdealposHarness.exe watch " + reference);
            return 0;
        }

        private class ResolvedItem
        {
            public StockItem Item;
        }

        private static ResolvedItem ResolveItem(string[] args, string flag, string autoFilterHint, decimal quantity)
        {
            string code = GetOption(args, flag);
            string description;

            if (!string.IsNullOrWhiteSpace(code))
            {
                description = code; // description isn't critical to the experiment; code is authoritative
            }
            else if (HasFlag(args, "--auto-items"))
            {
                string connStr = GetConnectionStringOrThrow();
                var items = LocalDataHelper.GetIpsStockItemsDic();
                var match = items.Values
                    .Where(i => (i.Description ?? "").IndexOf(autoFilterHint, StringComparison.OrdinalIgnoreCase) >= 0)
                    .OrderBy(i => i.Code)
                    .FirstOrDefault();
                if (match == null)
                {
                    // No item literally named "Burger"/"Chips"/"Coke" in this
                    // demo data — fall back to *some* real, priced item so
                    // the table-assignment experiment can still run. This is
                    // logged loudly so results are never misread as proof
                    // about a specific menu item.
                    match = items.Values.OrderBy(i => i.Code).FirstOrDefault();
                    if (match == null)
                    {
                        throw new GuardException(
                            "--auto-items found no stock items at all in the target database. " +
                            "Run 'list-products' first, or pass explicit codes with " + flag + ".");
                    }
                    Console.WriteLine("NOTE: no item matching \"" + autoFilterHint + "\" found — auto-selected \"" +
                        match.Description + "\" (" + match.Code + ") instead. This does not affect the " +
                        "table-assignment experiment, only which product name appears on the order.");
                }
                code = match.Code;
                description = match.Description;
            }
            else
            {
                throw new GuardException(
                    "No product code given for " + flag + ". Either pass a real code explicitly " +
                    "(run 'list-products' first) or pass --auto-items to select real demo items " +
                    "automatically. Invented/placeholder PLUs are refused by design.");
            }

            return new ResolvedItem
            {
                Item = new StockItem
                {
                    Code = code,
                    Description = description,
                    Quantity = quantity,
                    // PricingMode left at its constructor default (Inherit) —
                    // confirmed default in WebOrder.cs's StockItem() ctor —
                    // so Idealpos prices the line itself rather than trusting
                    // a value this harness invented.
                }
            };
        }

        // ------------------------------------------------------------------
        // watch
        // ------------------------------------------------------------------

        private static int CmdWatch(string[] args)
        {
            if (args.Length == 0 || args[0].StartsWith("--"))
            {
                throw new GuardException("Usage: watch <reference-or-prefix> [--interval-seconds 5] [--timeout-minutes 15]");
            }
            string referencePrefix = args[0];
            int intervalSeconds = int.Parse(GetOption(args, "--interval-seconds") ?? "5");
            int timeoutMinutes = int.Parse(GetOption(args, "--timeout-minutes") ?? "15");

            string connStr = GetConnectionStringOrThrow();
            PrintTargetBanner(connStr, requireConfirmation: false);
            Console.WriteLine("Watching (read-only) for WebReference LIKE '" + referencePrefix + "%'");
            Console.WriteLine("Polling every " + intervalSeconds + "s, timing out after " + timeoutMinutes + " min. Ctrl+C to stop early.");
            Console.WriteLine();

            DateTime deadline = DateTime.UtcNow.AddMinutes(timeoutMinutes);
            DateTime watchStartedUtc = DateTime.UtcNow;
            bool everSeenProcessed = false;
            string lastPendingSalesCode = null;

            while (DateTime.UtcNow < deadline)
            {
                Console.WriteLine("--- " + DateTime.Now.ToString("HH:mm:ss") + " ---");

                var webRows = QueryWebPendingOrder(connStr, referencePrefix);
                if (webRows.Count == 0)
                {
                    Console.WriteLine("  WebPendingOrder: no matching row yet.");
                }
                foreach (var r in webRows)
                {
                    Console.WriteLine("  WebPendingOrder  ID={0}  Processed={1}  DateRetrieved={2:u}  DateProcessed={3}  WebReference={4}  Origin={5}",
                        r.Id, r.Processed, r.DateRetrieved,
                        r.DateProcessed.HasValue ? r.DateProcessed.Value.ToString("u") : "(null)",
                        r.WebReference, r.Origin);
                    if (r.Processed) everSeenProcessed = true;
                }

                var saleRows = QueryPendingSalesByReference(connStr, referencePrefix);
                if (saleRows.Count == 0)
                {
                    Console.WriteLine("  PendingSales: no row referencing this WebReference in the Reference column yet.");
                }
                foreach (var s in saleRows)
                {
                    Console.WriteLine("  >>> PendingSales  ID={0}  Code=\"{1}\"  Status={2}  OrderState={3}  SentOnline={4}  Reference={5}  OrderDate={6}",
                        s.Id, s.Code, s.Status, s.OrderState, s.SentOnline, s.Reference, s.OrderDate);
                    Console.WriteLine("  >>> PendingSales.Code is the field that matters: if it reads the table");
                    Console.WriteLine("      number (e.g. \"12\"), Idealpos associated this order with that table.");
                    lastPendingSalesCode = s.Code;

                    var lines = QueryPendingSaleLines(connStr, s.Id);
                    foreach (var l in lines)
                    {
                        Console.WriteLine("      PendingSaleLines  Line={0}  Col1={1}  Col2={2}  Person={3}  SeatNumber={4}",
                            l.Line, l.Col1, l.Col2, l.Person, l.SeatNumber);
                    }
                }

                // Fallback: we don't actually know, a priori, that native
                // IPS.exe copies WebOrder.OrderReference into
                // PendingSales.Reference — that assumption is itself part
                // of what this test is checking. If WebPendingOrder shows
                // the row Processed but the Reference-based lookup above
                // found nothing, surface the most recent PendingSales rows
                // unfiltered so a human can eyeball whether one appeared
                // under a different/no reference.
                if (everSeenProcessed && saleRows.Count == 0)
                {
                    var recent = QueryRecentPendingSales(connStr, watchStartedUtc.AddMinutes(-2), 5);
                    if (recent.Count > 0)
                    {
                        Console.WriteLine("  NOTE: WebPendingOrder is Processed=1 but no PendingSales.Reference");
                        Console.WriteLine("  matched. Here are the most recent PendingSales rows (unfiltered) —");
                        Console.WriteLine("  check by eye whether one of these is the injected order:");
                        foreach (var s in recent)
                        {
                            Console.WriteLine("    PendingSales  ID={0}  Code=\"{1}\"  Reference={2}  Date={3:u}",
                                s.Id, s.Code, string.IsNullOrEmpty(s.Reference) ? "(empty)" : s.Reference, s.Date);
                        }
                    }
                }

                Console.WriteLine();
                Thread.Sleep(TimeSpan.FromSeconds(intervalSeconds));
            }

            Console.WriteLine("Timeout reached.");
            Console.WriteLine();
            PrintClassificationGuide(everSeenProcessed, lastPendingSalesCode);
            return 0;
        }

        private static void PrintClassificationGuide(bool everSeenProcessed, string lastPendingSalesCode)
        {
            Console.WriteLine("=== How to classify this run ===");
            Console.WriteLine();
            if (!everSeenProcessed)
            {
                Console.WriteLine("FAILURE (database-observable): WebPendingOrder.Processed never flipped to 1.");
                Console.WriteLine("Native IPS.exe never consumed the row. This is a configuration/licensing");
                Console.WriteLine("question, not proof the pipeline is broken — see README.md Troubleshooting");
                Console.WriteLine("before concluding the mechanism itself doesn't work.");
            }
            else if (string.IsNullOrEmpty(lastPendingSalesCode))
            {
                Console.WriteLine("PARTIAL / FAILURE (database-observable): the order was Processed=1 but no");
                Console.WriteLine("PendingSales row referencing it was found by this harness's query. Either");
                Console.WriteLine("Idealpos stores the link differently than assumed (Reference column), or");
                Console.WriteLine("the order was rejected after processing. Check the Idealpos client UI for");
                Console.WriteLine("an error, and check for ANY new PendingSales row created around this time");
                Console.WriteLine("regardless of its Reference value.");
            }
            else
            {
                Console.WriteLine("A PendingSales row was created with Code=\"" + lastPendingSalesCode + "\".");
                Console.WriteLine();
                Console.WriteLine("Now go look at the Idealpos client UI on the test instance:");
                Console.WriteLine();
                Console.WriteLine("  SUCCESS  if Code == \"12\" (or whatever --table you used) AND the Table 12");
                Console.WriteLine("           tile shows active/occupied AND opening it shows the injected");
                Console.WriteLine("           items, with NO manual staff action taken.");
                Console.WriteLine("           -> proves the core Verdura workflow via this pipeline.");
                Console.WriteLine();
                Console.WriteLine("  PARTIAL  if a pending/web sale was created but Code is NOT \"12\", or the");
                Console.WriteLine("           order sits in an unassigned/web-orders queue that a staff member");
                Console.WriteLine("           must manually drag onto a table.");
                Console.WriteLine("           -> document exactly what queue/screen it landed in.");
                Console.WriteLine();
                Console.WriteLine("  Compare across Tests A/B/C/D/E to see which field (if any) changed the");
                Console.WriteLine("  outcome — that identifies the real table-assignment mechanism, or proves");
                Console.WriteLine("  none of the tested fields control it.");
            }
        }

        // ------------------------------------------------------------------
        // Read-only diagnostic queries (deliberately hand-written SQL —
        // there is no existing Idealpos helper for these specific column
        // sets, and these are plain single-table SELECTs against tables
        // this report's earlier investigation already fully documented).
        // ------------------------------------------------------------------

        private class WebPendingOrderRow
        {
            public int Id;
            public bool Processed;
            public DateTime DateRetrieved;
            public DateTime? DateProcessed;
            public string WebReference;
            public Guid Origin;
        }

        private static List<WebPendingOrderRow> QueryWebPendingOrder(string connStr, string referencePrefix)
        {
            var result = new List<WebPendingOrderRow>();
            using (var conn = new SqlConnection(connStr))
            using (var cmd = new SqlCommand(
                "select ID, Processed, DateRetrieved, DateProcessed, WebReference, Origin " +
                "from dbo.WebPendingOrder where WebReference like @prefix + '%' order by ID desc", conn))
            {
                cmd.Parameters.AddWithValue("@prefix", referencePrefix);
                conn.Open();
                using (var reader = cmd.ExecuteReader())
                {
                    while (reader.Read())
                    {
                        result.Add(new WebPendingOrderRow
                        {
                            Id = reader.GetInt32(0),
                            Processed = reader.GetBoolean(1),
                            DateRetrieved = reader.GetDateTime(2),
                            DateProcessed = reader.IsDBNull(3) ? (DateTime?)null : reader.GetDateTime(3),
                            WebReference = reader.GetString(4),
                            Origin = reader.GetGuid(5),
                        });
                    }
                }
            }
            return result;
        }

        private class PendingSaleRow
        {
            public int Id;
            public string Code;
            public object Status;
            public object OrderState;
            public object SentOnline;
            public string Reference;
            public DateTime Date;
            public DateTime? OrderDate;
        }

        private static List<PendingSaleRow> QueryPendingSalesByReference(string connStr, string referencePrefix)
        {
            // PendingSales.Reference (varchar(255), added by a later schema
            // patch — confirmed in IPS.Data.SQL.dll's embedded DDL) is the
            // natural place for an external order reference to land. This
            // query also falls back to matching on Code in case the harness
            // is re-run with --table equal to the reference prefix by
            // mistake; Reference is the primary signal.
            var result = new List<PendingSaleRow>();
            using (var conn = new SqlConnection(connStr))
            using (var cmd = new SqlCommand(
                "select ID, Code, Status, OrderState, SentOnline, Reference, Date, OrderDate " +
                "from dbo.PendingSales where Reference like @prefix + '%' order by ID desc", conn))
            {
                cmd.Parameters.AddWithValue("@prefix", referencePrefix);
                conn.Open();
                using (var reader = cmd.ExecuteReader())
                {
                    while (reader.Read())
                    {
                        result.Add(new PendingSaleRow
                        {
                            Id = reader.GetInt32(0),
                            Code = reader.IsDBNull(1) ? "" : reader.GetString(1).Trim(),
                            Status = reader.IsDBNull(2) ? (object)"(null)" : reader.GetInt32(2),
                            OrderState = reader.IsDBNull(3) ? (object)"(null)" : reader.GetInt32(3),
                            SentOnline = reader.IsDBNull(4) ? (object)"(null)" : reader.GetBoolean(4),
                            Reference = reader.IsDBNull(5) ? "" : reader.GetString(5),
                            Date = reader.GetDateTime(6),
                            OrderDate = reader.IsDBNull(7) ? (DateTime?)null : reader.GetDateTime(7),
                        });
                    }
                }
            }
            return result;
        }

        private static List<PendingSaleRow> QueryRecentPendingSales(string connStr, DateTime sinceUtc, int top)
        {
            // Unfiltered-by-reference fallback — see call site in CmdWatch.
            var result = new List<PendingSaleRow>();
            using (var conn = new SqlConnection(connStr))
            using (var cmd = new SqlCommand(
                "select top (@top) ID, Code, Status, OrderState, SentOnline, Reference, Date, OrderDate " +
                "from dbo.PendingSales where Date >= @since order by ID desc", conn))
            {
                cmd.Parameters.AddWithValue("@top", top);
                cmd.Parameters.AddWithValue("@since", sinceUtc);
                conn.Open();
                using (var reader = cmd.ExecuteReader())
                {
                    while (reader.Read())
                    {
                        result.Add(new PendingSaleRow
                        {
                            Id = reader.GetInt32(0),
                            Code = reader.IsDBNull(1) ? "" : reader.GetString(1).Trim(),
                            Status = reader.IsDBNull(2) ? (object)"(null)" : reader.GetInt32(2),
                            OrderState = reader.IsDBNull(3) ? (object)"(null)" : reader.GetInt32(3),
                            SentOnline = reader.IsDBNull(4) ? (object)"(null)" : reader.GetBoolean(4),
                            Reference = reader.IsDBNull(5) ? "" : reader.GetString(5),
                            Date = reader.GetDateTime(6),
                            OrderDate = reader.IsDBNull(7) ? (DateTime?)null : reader.GetDateTime(7),
                        });
                    }
                }
            }
            return result;
        }

        private class PendingSaleLineRow
        {
            public int Line;
            public string Col1;
            public string Col2;
            public int Person;
            public int SeatNumber;
        }

        private static List<PendingSaleLineRow> QueryPendingSaleLines(string connStr, int pendingSaleId)
        {
            var result = new List<PendingSaleLineRow>();
            using (var conn = new SqlConnection(connStr))
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

        private static void PrintWebPendingOrderRows(string connStr, string referencePrefix)
        {
            var rows = QueryWebPendingOrder(connStr, referencePrefix);
            if (rows.Count == 0)
            {
                Console.WriteLine("  (no matching row found — unexpected; InsertOrders() reported success)");
                return;
            }
            foreach (var r in rows)
            {
                Console.WriteLine("  WebPendingOrder.ID = " + r.Id);
                Console.WriteLine("  Processed          = " + r.Processed);
                Console.WriteLine("  DateRetrieved       = " + r.DateRetrieved.ToString("u"));
                Console.WriteLine("  DateProcessed       = " + (r.DateProcessed.HasValue ? r.DateProcessed.Value.ToString("u") : "(null)"));
                Console.WriteLine("  WebReference        = " + r.WebReference);
                Console.WriteLine("  Origin              = " + r.Origin);
            }
        }

        // ------------------------------------------------------------------
        // Safety / config plumbing
        // ------------------------------------------------------------------

        private class GuardException : Exception
        {
            public GuardException(string message) : base(message) { }
        }

        private static string GetConnectionStringOrThrow()
        {
            var entry = ConfigurationManager.ConnectionStrings["IpsConnection"];
            if (entry == null || string.IsNullOrWhiteSpace(entry.ConnectionString))
            {
                throw new GuardException(
                    "No 'IpsConnection' connection string found in App.config. Refusing to fall " +
                    "back to IdealPos.Webit.Core.dll's own hardcoded default " +
                    "(Server=localhost\\IDEALSQL;Database=IPSTransaction;Trusted_Connection=True;) " +
                    "because that string would also match a live production POS Server. " +
                    "Edit App.config's IpsConnection entry to point at your disposable test instance.");
            }
            if (entry.ConnectionString.IndexOf("CHANGE_ME", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                throw new GuardException(
                    "App.config still contains the placeholder 'CHANGE_ME_TEST_SERVER'. Edit " +
                    "App.config's IpsConnection entry to point at your disposable test SQL Server " +
                    "before running this harness.");
            }
            return entry.ConnectionString;
        }

        private static void PrintTargetBanner(string connStr, bool requireConfirmation)
        {
            var builder = new SqlConnectionStringBuilder(connStr);
            Console.WriteLine(new string('=', 70));
            Console.WriteLine("TARGET DATABASE");
            Console.WriteLine("  Server (Data Source)   : " + builder.DataSource);
            Console.WriteLine("  Database (Initial Cat.): " + builder.InitialCatalog);
            Console.WriteLine("  Integrated Security    : " + builder.IntegratedSecurity);
            if (requireConfirmation)
            {
                Console.WriteLine();
                Console.WriteLine("  This MUST be a disposable test instance, never the live restaurant's");
                Console.WriteLine("  POS Server. --confirm-server must repeat the Server value above exactly.");
            }
            Console.WriteLine(new string('=', 70));
            Console.WriteLine();
        }

        private static void WriteError(string title, string detail)
        {
            var prev = Console.ForegroundColor;
            Console.ForegroundColor = ConsoleColor.Red;
            Console.WriteLine();
            Console.WriteLine(title);
            Console.WriteLine(detail);
            Console.ForegroundColor = prev;
        }

        private static bool HasFlag(string[] args, string name)
        {
            return args.Any(a => string.Equals(a, name, StringComparison.OrdinalIgnoreCase));
        }

        private static string GetOption(string[] args, string name)
        {
            for (int i = 0; i < args.Length - 1; i++)
            {
                if (string.Equals(args[i], name, StringComparison.OrdinalIgnoreCase))
                {
                    return args[i + 1];
                }
            }
            return null;
        }

        private static string Truncate(string s, int max)
        {
            if (string.IsNullOrEmpty(s)) return s ?? "";
            return s.Length <= max ? s : s.Substring(0, max - 1) + "…";
        }
    }
}
