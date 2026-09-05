namespace VerduraIdealposTracer.Core.Terminal;

/// <summary>
/// The native screens a driver must be able to tell apart before it may act.
/// <see cref="Unknown"/> is not a fallback — it is an abort condition
/// (directive §7B, §29).
/// </summary>
public enum TerminalScreen
{
    /// <summary>The native sale-entry screen (VB6 <c>frmSale</c>, window title "POS Screen").</summary>
    SaleEntry,

    /// <summary>The native Table Map (VB6 <c>frmTables</c>) — also the send boundary.</summary>
    TableMap,

    /// <summary>The native Table Details screen (VB6 <c>frmTableDetails</c>).</summary>
    TableDetails,

    /// <summary>A modal/prompt is blocking. Never dismissed automatically.</summary>
    Modal,

    /// <summary>Anything else. The driver must stop rather than guess.</summary>
    Unknown,
}

/// <summary>What one plan step does. Each kind maps to exactly one native operation.</summary>
public enum NativeStepKind
{
    /// <summary>Bind and verify the IPS.exe process/session/window. Read-only.</summary>
    BindTerminal,

    /// <summary>Assert the visible screen is the expected one. Read-only; aborts on mismatch.</summary>
    RequireScreen,

    /// <summary>Open an existing table's sale for a later round (Table Map → Table N → Details → POS).</summary>
    ReopenExistingTable,

    /// <summary>Enter ONE native PLU. Carries a native code and never a table code.</summary>
    EnterPlu,

    /// <summary>Apply the quantity for the PLU entered by the preceding step.</summary>
    SetQuantity,

    /// <summary>Read back the staged lines and compare them with the round's items. Read-only.</summary>
    VerifyStagedLines,

    /// <summary>Read back the price IdealPOS resolved. Read-only; never writes a price.</summary>
    ObserveNativePrice,

    /// <summary>Navigate to the Table Map. This is the step immediately before the send.</summary>
    OpenTableMap,

    /// <summary>Select the destination table. THIS IS THE IRREVERSIBLE SEND.</summary>
    SelectTableCommit,

    /// <summary>Prove the native delta after the send. Read-only.</summary>
    VerifyNativeDelta,
}

/// <summary>
/// One ordered step of a native round.
///
/// The two payload fields are deliberately separate and mutually exclusive
/// by construction: <see cref="NativeCode"/> is only ever set on
/// <see cref="NativeStepKind.EnterPlu"/>, and <see cref="TableCode"/> is only
/// ever set on table steps. <see cref="NativeRoundPlan.Validate"/> enforces
/// this, which is what makes the old
/// <c>SetText(pluHandle, request.TableCode)</c> defect unrepresentable rather
/// than merely absent.
/// </summary>
public sealed record NativeRoundStep
{
    public required NativeStepKind Kind { get; init; }
    public required string Description { get; init; }

    /// <summary>Native PLU/stock code. Set ONLY on <see cref="NativeStepKind.EnterPlu"/>.</summary>
    public string? NativeCode { get; init; }

    /// <summary>Quantity. Set ONLY on <see cref="NativeStepKind.SetQuantity"/>.</summary>
    public int? Quantity { get; init; }

    /// <summary>Table code. Set ONLY on table steps, never on an item step.</summary>
    public string? TableCode { get; init; }

    /// <summary>Expected screen. Set ONLY on <see cref="NativeStepKind.RequireScreen"/>.</summary>
    public TerminalScreen? Screen { get; init; }

    /// <summary>
    /// Whether performing this step crosses the irreversible native send
    /// boundary. Exactly one step in a well-formed plan sets this.
    /// </summary>
    public bool IsSendBoundary => Kind == NativeStepKind.SelectTableCommit;
}

/// <summary>
/// Expands a <see cref="TerminalRoundRequest"/> into the ordered native
/// steps proved by the 2026-09-05 Table 5 experiment.
///
/// Round 1: sale-entry screen → enter each PLU/qty → verify staged →
/// TABLE MAP → select Table N (the commit).
///
/// Round 2: TABLE MAP → existing Table N → Details → POS → enter ONLY the new
/// items → verify staged → TABLE MAP → same Table N.
///
/// There is no "Save" step, because the native workflow has no Save button:
/// selecting the destination table on the Table Map IS the send.
/// </summary>
public static class NativeRoundPlan
{
    /// <summary>Builds the ordered plan. Pure; touches nothing.</summary>
    public static IReadOnlyList<NativeRoundStep> Build(TerminalRoundRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);

        var steps = new List<NativeRoundStep>
        {
            new()
            {
                Kind = NativeStepKind.BindTerminal,
                Description = "bind the native IPS.exe terminal (process, session, window) and verify it",
            },
        };

        if (request.RoundKind == TerminalRoundKind.SecondRound)
        {
            // A later round starts from the Table Map, reopens the existing
            // table, and enters the POS screen through Details.
            steps.Add(new NativeRoundStep
            {
                Kind = NativeStepKind.RequireScreen,
                Screen = TerminalScreen.TableMap,
                Description = "require the Table Map before reopening an existing table",
            });
            steps.Add(new NativeRoundStep
            {
                Kind = NativeStepKind.ReopenExistingTable,
                TableCode = request.TableCode,
                Description = $"reopen the existing native sale for Table {request.TableCode} via Details → POS, retaining prior lines",
            });
        }

        steps.Add(new NativeRoundStep
        {
            Kind = NativeStepKind.RequireScreen,
            Screen = TerminalScreen.SaleEntry,
            Description = "require the native sale-entry screen before entering any item",
        });

        // The round's items drive the plan. One EnterPlu + one SetQuantity
        // per line, in request order.
        foreach (var item in request.Items)
        {
            steps.Add(new NativeRoundStep
            {
                Kind = NativeStepKind.EnterPlu,
                NativeCode = item.NativeCode,
                Description = $"enter native PLU {item.NativeCode}",
            });
            steps.Add(new NativeRoundStep
            {
                Kind = NativeStepKind.SetQuantity,
                Quantity = item.Quantity,
                Description = $"apply quantity {item.Quantity} to PLU {item.NativeCode}",
            });
        }

        steps.Add(new NativeRoundStep
        {
            Kind = NativeStepKind.VerifyStagedLines,
            Description = "read back the staged lines and require them to equal this round's items exactly",
        });
        steps.Add(new NativeRoundStep
        {
            Kind = NativeStepKind.ObserveNativePrice,
            Description = "observe the price IdealPOS resolved (read-only; IdealPOS is the pricing authority)",
        });
        steps.Add(new NativeRoundStep
        {
            Kind = NativeStepKind.OpenTableMap,
            Description = "navigate to TABLE MAP (the step immediately before the send)",
        });
        steps.Add(new NativeRoundStep
        {
            Kind = NativeStepKind.SelectTableCommit,
            TableCode = request.TableCode,
            Description = $"select Table {request.TableCode} on the Table Map — THIS IS THE IRREVERSIBLE SEND",
        });
        steps.Add(new NativeRoundStep
        {
            Kind = NativeStepKind.VerifyNativeDelta,
            Description = "prove the native delta against the pre-send snapshot (never UI completion alone)",
        });

        return steps;
    }

    /// <summary>
    /// Structural invariants of a plan. Returns every violation; an empty
    /// list means the plan is well-formed.
    ///
    /// These are the audit's D1/D2/D3 defects expressed as assertions:
    /// a table code may never ride on an item step, an item step may never
    /// carry a table code, every requested item must appear, and there must
    /// be exactly one send boundary and it must be the table selection.
    /// </summary>
    public static IReadOnlyList<string> Validate(TerminalRoundRequest request, IReadOnlyList<NativeRoundStep> steps)
    {
        var errors = new List<string>();

        foreach (var step in steps)
        {
            switch (step.Kind)
            {
                case NativeStepKind.EnterPlu:
                    if (string.IsNullOrWhiteSpace(step.NativeCode))
                        errors.Add("an EnterPlu step carries no native code");
                    if (step.TableCode is not null)
                        errors.Add($"an EnterPlu step carries a table code ('{step.TableCode}') — table and PLU are distinct operations");
                    break;

                case NativeStepKind.SetQuantity:
                    if (step.Quantity is null or <= 0)
                        errors.Add("a SetQuantity step carries no positive quantity");
                    if (step.TableCode is not null)
                        errors.Add("a SetQuantity step carries a table code");
                    break;

                case NativeStepKind.SelectTableCommit:
                case NativeStepKind.ReopenExistingTable:
                    if (string.IsNullOrWhiteSpace(step.TableCode))
                        errors.Add($"a {step.Kind} step carries no table code");
                    if (step.NativeCode is not null)
                        errors.Add($"a {step.Kind} step carries a native PLU code — table and PLU are distinct operations");
                    break;
            }
        }

        // Every requested item must be represented, with its quantity.
        var planned = steps
            .Where(s => s.Kind == NativeStepKind.EnterPlu)
            .Select(s => s.NativeCode!.Trim())
            .ToList();

        foreach (var item in request.Items)
        {
            if (!planned.Contains(item.NativeCode.Trim(), StringComparer.OrdinalIgnoreCase))
                errors.Add($"requested item '{item.NativeCode}' does not appear in the plan");
        }

        if (planned.Count != request.Items.Count)
            errors.Add($"plan enters {planned.Count} PLU(s) but the round requested {request.Items.Count}");

        var boundaries = steps.Count(s => s.IsSendBoundary);
        if (boundaries != 1)
            errors.Add($"a plan must have exactly one send boundary, found {boundaries}");

        // The send must be the last mutating step: nothing that changes the
        // sale may follow the commit.
        var commitIndex = steps.ToList().FindIndex(s => s.IsSendBoundary);
        if (commitIndex >= 0)
        {
            var mutatingAfterCommit = steps
                .Skip(commitIndex + 1)
                .Any(s => s.Kind is NativeStepKind.EnterPlu or NativeStepKind.SetQuantity
                    or NativeStepKind.ReopenExistingTable or NativeStepKind.SelectTableCommit);
            if (mutatingAfterCommit)
                errors.Add("a mutating step follows the send boundary");
        }

        return errors;
    }

    /// <summary>Human-readable rendering, for dry-run output and fail-closed diagnostics.</summary>
    public static IReadOnlyList<string> Describe(IReadOnlyList<NativeRoundStep> steps) =>
        steps.Select((s, i) => $"{i + 1}. [{s.Kind}] {s.Description}").ToList();
}
