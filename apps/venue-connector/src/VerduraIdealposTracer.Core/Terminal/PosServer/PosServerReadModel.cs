namespace VerduraIdealposTracer.Core.Terminal.PosServer;

/// <summary>
/// One <c>POSServer.dbo.PendingSales</c> row, exactly as observed — no
/// interpretation, no trimming, nothing dropped.
///
/// <see cref="ObservedRowId"/> is carried deliberately AND is marked
/// observational everywhere it appears. The 2026-09-05 Table 5 run watched one
/// materially unchanged sale move through four IDs (99719 → 99721 → 99723 →
/// 99724) with byte-identical content and a frozen DateModified. It is
/// therefore usable as a join key inside a single consistent read and as
/// evidence in a report, and it is never durable identity. Nothing derived
/// from it reaches <see cref="TableSaleFingerprint"/>.
/// </summary>
public sealed record PosServerPendingSaleRow
{
    /// <summary>PendingSales.ID. OBSERVATIONAL ONLY — regenerated on ordinary edits.</summary>
    public long ObservedRowId { get; init; }

    /// <summary>PendingSales.Code — the bare table number, space-padded. "5" for Table 5.</summary>
    public string? Code { get; init; }

    /// <summary>PendingSales.Map — 1 for a table-map sale, 0 for the web/takeaway partition.</summary>
    public int? Map { get; init; }

    /// <summary>PendingSales.Pos — observed as 1 for the table sale even though the till header reads POS 2.</summary>
    public int? Pos { get; init; }

    public DateTime? DateModified { get; init; }
}

/// <summary>
/// One <c>POSServer.dbo.PendingSaleLines</c> row as observed. Every field is
/// the raw value: <c>Col1</c> arrives space-padded ("              23") and the
/// numeric columns may arrive as text or as numbers depending on the driver, so
/// they are carried as strings and parsed in one place.
/// </summary>
public sealed record PosServerPendingSaleLineRow
{
    /// <summary>PendingSaleLines.Line — the physical line ordinal (smallint).</summary>
    public int? Line { get; init; }

    /// <summary>Col0 — line type. "SI" is a sale item; every line of the sealed Table 5 run was SI.</summary>
    public string? Col0 { get; init; }

    /// <summary>Col1 — the native PLU/stock code, space-padded.</summary>
    public string? Col1 { get; init; }

    /// <summary>Col2 — the native description, space-padded. Evidence only; never matched on.</summary>
    public string? Col2 { get; init; }

    /// <summary>Col3 — quantity. Observed as 1 per row: qty 2 is TWO rows, not Col3=2.</summary>
    public string? Col3 { get; init; }

    /// <summary>Col4 — the native unit price. Read FROM IdealPOS, never supplied to it.</summary>
    public string? Col4 { get; init; }

    /// <summary>
    /// PendingSaleLines.Printed. OBSERVATION ONLY, and specifically NOT proof a
    /// kitchen docket was physically produced: the 2026-09-05 run recorded
    /// Printed=True on every line at creation while IPSPrinterServer.LOG and
    /// Printing.log both recorded ZERO bytes. It is written by the sale path,
    /// not the printer path.
    /// </summary>
    public bool? Printed { get; init; }

    /// <summary>
    /// OrderedTime — the native round-partitioning field. Useful for observing
    /// which lines arrived together; it binds nothing to a Verdura identity.
    /// </summary>
    public DateTime? OrderedTime { get; init; }

    public int? SeatNumber { get; init; }
}

/// <summary>One sale row with the lines that joined to it in a single consistent read.</summary>
public sealed record PosServerSaleWithLines(
    PosServerPendingSaleRow Sale,
    IReadOnlyList<PosServerPendingSaleLineRow> Lines);

/// <summary>
/// One canonicalized native line — everything the round pipeline may observe
/// about a line, which is strictly more than the fingerprint carries.
/// </summary>
public sealed record ObservedNativeLine
{
    public required string NativeCode { get; init; }
    public required int Quantity { get; init; }

    /// <summary>The price IdealPOS resolved. Read back as evidence; Verdura never sends one.</summary>
    public decimal? NativeUnitPrice { get; init; }

    public int? LineOrdinal { get; init; }
    public DateTime? OrderedTime { get; init; }

    /// <summary>Observation only. Never treated as evidence a docket was printed.</summary>
    public bool? PrintedFlag { get; init; }

    public string? Description { get; init; }
}

/// <summary>
/// The full observation of one native table sale — richer than
/// <see cref="TableSaleFingerprint"/>, which deliberately carries only what
/// confirmation is allowed to reason about.
/// </summary>
public sealed record NativeTableSaleObservation
{
    public required string TableCode { get; init; }
    public required int Pos { get; init; }
    public string? Map { get; init; }
    public DateTime? DateModified { get; init; }

    /// <summary>OBSERVATIONAL ONLY — see <see cref="PosServerPendingSaleRow.ObservedRowId"/>.</summary>
    public long ObservedRowId { get; init; }

    public IReadOnlyList<ObservedNativeLine> Lines { get; init; } = Array.Empty<ObservedNativeLine>();

    /// <summary>
    /// Rows whose Col0 was not "SI". Counted and reported rather than silently
    /// dropped, but they do not enter the fingerprint: a discount or text line
    /// changes the sale without changing the PLU/quantity delta this round is
    /// attributed by.
    /// </summary>
    public int NonSaleItemLineCount { get; init; }

    /// <summary>
    /// The fingerprint confirmation is allowed to see. Note what is NOT here:
    /// no row ID, no price, no Printed flag, no OrderedTime. Confirmation
    /// reasons about the natural key and the line multiset only.
    /// </summary>
    public TableSaleFingerprint ToFingerprint() => new()
    {
        TableCode = TableCode,
        Pos = Pos,
        Map = Map,
        Lines = Lines.Select(l => new TerminalLineFingerprint(l.NativeCode, l.Quantity)).ToList(),
    };
}

/// <summary>How a read resolved. Four outcomes, and "unavailable" is not "empty".</summary>
public enum NativeTableReadStatus
{
    /// <summary>Resolved: no native sale exists for this table context. The table is free.</summary>
    NoOpenSale,

    /// <summary>Resolved: exactly one matching sale, canonicalized.</summary>
    Observed,

    /// <summary>
    /// More than one sale matched the table context, or a line could not be
    /// canonicalized. Not a fingerprint, and never silently reduced to one.
    /// </summary>
    Ambiguous,

    /// <summary>
    /// The store could not be read — unreachable, timed out, permission denied.
    /// Deliberately distinct from <see cref="NoOpenSale"/>: reporting an
    /// unreadable database as a free table is how a first round gets sent onto
    /// an occupied one.
    /// </summary>
    Unavailable,
}

/// <summary>The typed result of one read. Carries a reason for every non-Observed status.</summary>
public sealed record NativeTableReadResult
{
    public required NativeTableReadStatus Status { get; init; }
    public NativeTableSaleObservation? Observation { get; init; }
    public string? Reason { get; init; }

    public TableSaleFingerprint? Fingerprint => Observation?.ToFingerprint();

    public static NativeTableReadResult NoSale(string reason) =>
        new() { Status = NativeTableReadStatus.NoOpenSale, Reason = reason };

    public static NativeTableReadResult Ambiguous(string reason) =>
        new() { Status = NativeTableReadStatus.Ambiguous, Reason = reason };

    public static NativeTableReadResult Unavailable(string reason) =>
        new() { Status = NativeTableReadStatus.Unavailable, Reason = reason };

    public static NativeTableReadResult Sale(NativeTableSaleObservation observation) =>
        new() { Status = NativeTableReadStatus.Observed, Observation = observation };
}

/// <summary>
/// Turns raw observed POSServer rows into a canonical observation. Pure — no
/// I/O, no clock, no connection — so every rule below is directly testable and
/// is tested.
///
/// THE EVIDENCE THIS ENCODES (2026-09-05 sealed Table 5 run):
///   * Code is the bare table number ("5"), space-padded, and must be matched
///     as a whole token — "5" is a substring of "15", "25" and "50".
///   * Map = 1 is the table-map partition; Map = 0 is web/takeaway, including
///     Verdura's own WBORD row. Reading across that boundary would let a web
///     ticket confirm a dine-in round.
///   * Pos = 1 on the sale, even though the operating till header reads POS 2.
///   * Col1/Col2 are space-padded; matching logic must trim.
///   * Quantity 2 is TWO qty-1 rows, not Col3=2. Aggregation therefore happens
///     downstream in the evaluator, which already sums by code — this layer
///     preserves the physical rows rather than pre-summing them.
/// </summary>
public static class NativeTableSaleCanonicalizer
{
    /// <summary>The Col0 value denoting a sale-item line. Every line of the sealed run was this.</summary>
    public const string SaleItemLineType = "SI";

    /// <summary>
    /// The Map value OBSERVED on this installation for the table-map partition
    /// on 2026-09-05 (against Map=0 for the web/takeaway rows).
    ///
    /// It is evidence from ONE installation on ONE day, not a law about
    /// IdealPOS. Nothing in the sealed run showed that every native table on
    /// every configured installation is permanently Map=1 — the map is a
    /// configured floor-plan concept and a venue with several maps could
    /// legitimately place tables elsewhere. So this constant is a documented
    /// observation available to callers and test fixtures, and it is
    /// deliberately NOT a fallback inside the reader: the expected map must be
    /// supplied.
    /// </summary>
    public const string ObservedTableMapValueOnThisInstallation = "1";

    /// <summary>
    /// The Pos value OBSERVED on the native table sale on this installation —
    /// 1, even though the operating till header read POS 2. Same status as the
    /// map above: observation, supplied by the caller, never assumed here.
    /// </summary>
    public const int ObservedTableSalePosOnThisInstallation = 1;

    /// <summary>
    /// Selects the sale matching the requested table context and canonicalizes
    /// its lines.
    /// </summary>
    /// <param name="requestedTableCode">The table Verdura asked about, e.g. "5".</param>
    /// <param name="expectedMap">
    /// The map partition to accept, supplied by the caller from configuration
    /// or from an observed native context. There is deliberately NO default:
    /// an unknown map fails closed rather than silently assuming the value one
    /// installation happened to use, and "any map" is never an option because
    /// it would let a Map=0 web ticket answer a dine-in question.
    /// </param>
    /// <param name="expectedPos">The POS/context to accept, likewise supplied rather than assumed.</param>
    /// <param name="candidates">Every sale row read for this table, with its lines.</param>
    public static NativeTableReadResult Canonicalize(
        string requestedTableCode,
        string? expectedMap,
        int? expectedPos,
        IReadOnlyList<PosServerSaleWithLines> candidates)
    {
        if (string.IsNullOrWhiteSpace(requestedTableCode))
        {
            return NativeTableReadResult.Ambiguous("no table code was requested");
        }

        if (string.IsNullOrWhiteSpace(expectedMap))
        {
            return NativeTableReadResult.Ambiguous(
                $"no expected map was supplied for table '{requestedTableCode}'. The map is venue configuration, not a "
                + "constant — refusing to assume the value observed on one installation rather than read a table "
                + "context we were not told.");
        }

        if (expectedPos is null)
        {
            return NativeTableReadResult.Ambiguous(
                $"no expected POS context was supplied for table '{requestedTableCode}'");
        }

        var wantedMap = expectedMap.Trim();
        var wantedPos = expectedPos.Value;

        var matching = (candidates ?? Array.Empty<PosServerSaleWithLines>())
            .Where(c => TableIdentity.SameTable(c.Sale.Code?.Trim(), requestedTableCode))
            .Where(c => c.Sale.Map is not null
                && string.Equals(c.Sale.Map.Value.ToString(), wantedMap, StringComparison.OrdinalIgnoreCase))
            .Where(c => c.Sale.Pos == wantedPos)
            .ToList();

        if (matching.Count == 0)
        {
            return NativeTableReadResult.NoSale(
                $"no POSServer pending sale for table '{requestedTableCode}' at Map={wantedMap}, Pos={wantedPos}");
        }

        if (matching.Count > 1)
        {
            // Two live sales for one table context is a native state nobody can
            // attribute a round to. Picking "the newest" would be a guess, and
            // the surrogate ID that would order them is exactly the value the
            // Table 5 run proved unstable.
            var ids = string.Join(", ", matching.Select(m => m.Sale.ObservedRowId));
            return NativeTableReadResult.Ambiguous(
                $"{matching.Count} POSServer pending sales match table '{requestedTableCode}' at Map={wantedMap}, "
                + $"Pos={wantedPos} (observed row ids: {ids}) — the native state cannot be resolved to one sale");
        }

        var only = matching[0];
        var lines = new List<ObservedNativeLine>();
        var nonSaleItems = 0;

        foreach (var raw in only.Lines ?? Array.Empty<PosServerPendingSaleLineRow>())
        {
            var lineType = raw.Col0?.Trim();
            if (!string.Equals(lineType, SaleItemLineType, StringComparison.OrdinalIgnoreCase))
            {
                // Not a sale item. Counted as evidence, excluded from the
                // fingerprint — it cannot change the PLU/quantity delta.
                nonSaleItems++;
                continue;
            }

            var code = raw.Col1?.Trim();
            if (string.IsNullOrWhiteSpace(code))
            {
                return NativeTableReadResult.Ambiguous(
                    $"line {raw.Line?.ToString() ?? "(no ordinal)"} of table '{requestedTableCode}' has no native code — "
                    + "refusing to canonicalize a sale whose contents cannot be read");
            }

            if (!TryParseQuantity(raw.Col3, out var quantity))
            {
                return NativeTableReadResult.Ambiguous(
                    $"line {raw.Line?.ToString() ?? "(no ordinal)"} of table '{requestedTableCode}' has an unreadable "
                    + $"quantity ('{raw.Col3}') — refusing to guess how many of '{code}' are on the table");
            }

            if (!TryParsePrice(raw.Col4, out var price))
            {
                return NativeTableReadResult.Ambiguous(
                    $"line {raw.Line?.ToString() ?? "(no ordinal)"} of table '{requestedTableCode}' has an unreadable "
                    + $"native price ('{raw.Col4}') — the row cannot be read as written");
            }

            lines.Add(new ObservedNativeLine
            {
                NativeCode = code,
                Quantity = quantity,
                NativeUnitPrice = price,
                LineOrdinal = raw.Line,
                OrderedTime = raw.OrderedTime,
                PrintedFlag = raw.Printed,
                Description = raw.Col2?.Trim(),
            });
        }

        // Deterministic order, so two reads of the same sale produce the same
        // observation regardless of the order the rows physically came back in.
        // Confirmation aggregates by code and does not depend on this; the
        // determinism is for equality, diffing and reporting.
        var canonical = lines
            .OrderBy(l => l.LineOrdinal ?? int.MaxValue)
            .ThenBy(l => l.NativeCode, StringComparer.OrdinalIgnoreCase)
            .ThenBy(l => l.OrderedTime ?? DateTime.MinValue)
            .ThenBy(l => l.Quantity)
            .ToList();

        return NativeTableReadResult.Sale(new NativeTableSaleObservation
        {
            TableCode = only.Sale.Code?.Trim() ?? requestedTableCode.Trim(),
            Pos = only.Sale.Pos ?? wantedPos,
            Map = only.Sale.Map?.ToString(),
            DateModified = only.Sale.DateModified,
            ObservedRowId = only.Sale.ObservedRowId,
            Lines = canonical,
            NonSaleItemLineCount = nonSaleItems,
        });
    }

    /// <summary>
    /// Quantity must be a positive whole number. Decimal text ("1.000") is
    /// accepted when it is exactly integral, because a driver may surface a
    /// numeric column that way; a genuinely fractional quantity is refused
    /// rather than rounded.
    /// </summary>
    private static bool TryParseQuantity(string? raw, out int quantity)
    {
        quantity = 0;
        var text = raw?.Trim();
        if (string.IsNullOrEmpty(text)) return false;
        if (!decimal.TryParse(text, System.Globalization.NumberStyles.Number,
                System.Globalization.CultureInfo.InvariantCulture, out var value)) return false;
        if (value != decimal.Truncate(value)) return false;
        if (value <= 0 || value > int.MaxValue) return false;
        quantity = (int)value;
        return true;
    }

    /// <summary>
    /// A price that is ABSENT is fine — it is observational and confirmation
    /// never uses it. A price that is PRESENT but unreadable is not: it means
    /// the row is not what we think it is, and a row we cannot read is a row we
    /// must not canonicalize.
    /// </summary>
    private static bool TryParsePrice(string? raw, out decimal? price)
    {
        price = null;
        var text = raw?.Trim();
        if (string.IsNullOrEmpty(text)) return true; // absent, not malformed
        if (!decimal.TryParse(text, System.Globalization.NumberStyles.Number,
                System.Globalization.CultureInfo.InvariantCulture, out var value)) return false;
        price = value;
        return true;
    }
}

/// <summary>
/// The native table context a read must be told: which map partition and which
/// POS the table sale lives in.
///
/// This is a supplied value, not a constant, because the sealed 2026-09-05 run
/// proved what Table 5 looked like ON THAT INSTALLATION on that day — Code=5,
/// Map=1, Pos=1 — and proved nothing about every native table on every
/// configured IdealPOS. The map is a floor-plan concept a venue configures, and
/// a venue with several maps could legitimately place tables outside map 1.
///
/// Treating the observation as a domain law is precisely the class of mistake
/// that produced the earlier "POSServer is a replica" over-claim, so the value
/// travels as configuration and an unknown value fails closed.
/// </summary>
public sealed record NativeTableContext
{
    /// <summary>The map partition to read. Required; blank fails closed.</summary>
    public required string? ExpectedMap { get; init; }

    /// <summary>The POS context to read. Required; null fails closed.</summary>
    public required int? ExpectedPos { get; init; }

    /// <summary>
    /// The context OBSERVED on this installation on 2026-09-05. Offered for
    /// tests, fixtures and as a documented starting point for configuring a
    /// venue — never applied implicitly by the reader.
    /// </summary>
    public static NativeTableContext ObservedOnThisInstallation => new()
    {
        ExpectedMap = NativeTableSaleCanonicalizer.ObservedTableMapValueOnThisInstallation,
        ExpectedPos = NativeTableSaleCanonicalizer.ObservedTableSalePosOnThisInstallation,
    };
}
