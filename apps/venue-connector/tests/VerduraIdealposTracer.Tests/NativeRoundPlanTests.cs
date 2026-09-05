using VerduraIdealposTracer.Core.Terminal;
using Xunit;

namespace VerduraIdealposTracer.Tests;

/// <summary>
/// Regression tests for the two defects that made the previous driver unable
/// to produce a native round at all (Phase 1 audit D1 and D2):
///
///   D1 — the TABLE code was written into the PLU field.
///   D2 — <c>request.Items</c> was never read, so no item was ever entered.
///
/// Both are now structural: the plan is BUILT from the items, and
/// <see cref="NativeRoundPlan.Validate"/> rejects any plan that puts a table
/// code on an item step or omits a requested item.
/// </summary>
public sealed class NativeRoundPlanTests
{
    private static TerminalRoundRequest Round(
        TerminalRoundKind kind = TerminalRoundKind.FirstRound,
        params TerminalRoundItem[] items) => new()
    {
        ExternalOrderId = "ORD-9001",
        RoundId = "round-1",
        RoundKind = kind,
        OrderReference = "REF-9001",
        TableCode = "5",
        Items = items.Length > 0 ? items : new[] { new TerminalRoundItem("23", 1) },
    };

    [Fact]
    public void Plan_EntersEveryRequestedItem_WithItsQuantity()
    {
        var request = Round(TerminalRoundKind.FirstRound,
            new TerminalRoundItem("23", 1),
            new TerminalRoundItem("511", 2));

        var steps = NativeRoundPlan.Build(request);

        var plus = steps.Where(s => s.Kind == NativeStepKind.EnterPlu).Select(s => s.NativeCode).ToList();
        var qtys = steps.Where(s => s.Kind == NativeStepKind.SetQuantity).Select(s => s.Quantity).ToList();

        Assert.Equal(new[] { "23", "511" }, plus);
        Assert.Equal(new int?[] { 1, 2 }, qtys);
        Assert.Empty(NativeRoundPlan.Validate(request, steps));
    }

    /// <summary>
    /// The exact D1 defect: no step that enters an item may carry the table
    /// code, and no table step may carry a PLU.
    /// </summary>
    [Fact]
    public void Plan_NeverPutsTheTableCodeOnAnItemStep()
    {
        var request = Round();
        var steps = NativeRoundPlan.Build(request);

        Assert.All(steps.Where(s => s.Kind is NativeStepKind.EnterPlu or NativeStepKind.SetQuantity),
            s => Assert.Null(s.TableCode));
        Assert.All(steps.Where(s => s.Kind is NativeStepKind.SelectTableCommit or NativeStepKind.ReopenExistingTable),
            s => Assert.Null(s.NativeCode));
    }

    /// <summary>
    /// A table code that happens to equal a PLU must still not be entered as
    /// an item. This is the case the old substring/field confusion made
    /// invisible.
    /// </summary>
    [Fact]
    public void Plan_WithTableCodeEqualToAPluValue_KeepsThemOnSeparateSteps()
    {
        var request = Round(TerminalRoundKind.FirstRound, new TerminalRoundItem("5", 1)) with { TableCode = "5" };
        var steps = NativeRoundPlan.Build(request);

        var pluSteps = steps.Where(s => s.Kind == NativeStepKind.EnterPlu).ToList();
        var tableSteps = steps.Where(s => s.Kind == NativeStepKind.SelectTableCommit).ToList();

        Assert.Single(pluSteps);
        Assert.Single(tableSteps);
        Assert.Equal("5", pluSteps[0].NativeCode);
        Assert.Null(pluSteps[0].TableCode);
        Assert.Equal("5", tableSteps[0].TableCode);
        Assert.Null(tableSteps[0].NativeCode);
        Assert.Empty(NativeRoundPlan.Validate(request, steps));
    }

    [Fact]
    public void Validate_RejectsAPlanThatEntersTheTableCodeAsAPlu()
    {
        var request = Round();
        var tampered = new List<NativeRoundStep>(NativeRoundPlan.Build(request))
        {
            new() { Kind = NativeStepKind.EnterPlu, NativeCode = "5", TableCode = "5", Description = "tampered" },
        };

        var errors = NativeRoundPlan.Validate(request, tampered);

        Assert.Contains(errors, e => e.Contains("table and PLU are distinct"));
    }

    [Fact]
    public void Validate_RejectsAPlanThatOmitsARequestedItem()
    {
        var request = Round(TerminalRoundKind.FirstRound,
            new TerminalRoundItem("23", 1),
            new TerminalRoundItem("511", 2));

        var steps = NativeRoundPlan.Build(request)
            .Where(s => s.NativeCode != "511")
            .ToList();

        var errors = NativeRoundPlan.Validate(request, steps);

        Assert.Contains(errors, e => e.Contains("511"));
    }

    /// <summary>There is exactly one irreversible step, and it is the table selection.</summary>
    [Fact]
    public void Plan_HasExactlyOneSendBoundary_AndItIsTheTableSelection()
    {
        var steps = NativeRoundPlan.Build(Round());

        var boundaries = steps.Where(s => s.IsSendBoundary).ToList();

        Assert.Single(boundaries);
        Assert.Equal(NativeStepKind.SelectTableCommit, boundaries[0].Kind);
    }

    [Fact]
    public void Validate_RejectsAMutatingStepAfterTheSendBoundary()
    {
        var request = Round();
        var tampered = new List<NativeRoundStep>(NativeRoundPlan.Build(request))
        {
            new() { Kind = NativeStepKind.EnterPlu, NativeCode = "23", Description = "late item" },
        };

        var errors = NativeRoundPlan.Validate(request, tampered);

        Assert.Contains(errors, e => e.Contains("follows the send boundary"));
    }

    /// <summary>
    /// The native workflow has no Save button — the send is the table-map
    /// selection. A plan that mentions one would be describing a workflow
    /// IdealPOS does not have.
    /// </summary>
    [Fact]
    public void Plan_DoesNotDescribeASaveButton()
    {
        var described = NativeRoundPlan.Describe(NativeRoundPlan.Build(Round()));

        Assert.DoesNotContain(described, s => s.Contains("Save", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(described, s => s.Contains("TABLE MAP", StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// A second round reaches the sale screen through the Table Map and
    /// Details, and still enters only its own items.
    /// </summary>
    [Fact]
    public void SecondRoundPlan_ReopensTheExistingTable_AndEntersOnlyTheNewItems()
    {
        var request = Round(TerminalRoundKind.SecondRound, new TerminalRoundItem("511", 2));
        var steps = NativeRoundPlan.Build(request);

        Assert.Contains(steps, s => s.Kind == NativeStepKind.ReopenExistingTable && s.TableCode == "5");
        Assert.Equal(new[] { "511" }, steps.Where(s => s.Kind == NativeStepKind.EnterPlu).Select(s => s.NativeCode));
        Assert.Empty(NativeRoundPlan.Validate(request, steps));

        // The reopen must come before any item entry.
        var reopenAt = steps.ToList().FindIndex(s => s.Kind == NativeStepKind.ReopenExistingTable);
        var firstItemAt = steps.ToList().FindIndex(s => s.Kind == NativeStepKind.EnterPlu);
        Assert.True(reopenAt < firstItemAt);
    }

    [Fact]
    public void Plan_VerifiesStagedLinesBeforeTheSend()
    {
        var steps = NativeRoundPlan.Build(Round()).ToList();

        var verifyAt = steps.FindIndex(s => s.Kind == NativeStepKind.VerifyStagedLines);
        var commitAt = steps.FindIndex(s => s.IsSendBoundary);

        Assert.True(verifyAt >= 0);
        Assert.True(verifyAt < commitAt);
    }
}
