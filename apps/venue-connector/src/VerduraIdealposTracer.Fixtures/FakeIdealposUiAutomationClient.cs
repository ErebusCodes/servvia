using VerduraIdealposTracer.Core.Automation;
using VerduraIdealposTracer.Core.Discovery;
using VerduraIdealposTracer.Core.Terminal;

namespace VerduraIdealposTracer.Fixtures;

/// <summary>
/// A clearly-labelled, in-memory test double for
/// <see cref="IIdealposUiAutomationClient"/>. This is NOT a real Idealpos
/// installation and running against it produces NO
/// REAL_WINDOWS_CONNECTOR or REAL_IDEALPOS_UI_DISCOVERY evidence — only
/// UNIT_OR_MOCK / dry-run evidence for the platform-agnostic parts of this
/// story's state machine (see Story 9-2's Dev Agent Record for the exact
/// evidence-tier boundary this fixture sits on).
/// </summary>
public enum FakeScenario
{
    HappyPath,
    IdealposNotRunning,
    WrongVersionProfile,
    InsufficientPermissions,
    SessionLocked,
    UnexpectedModalDialog,
    IdealposBusy,
    ControlNotFoundDuringProfileMatch,
    ControlAmbiguousDuringProfileMatch,
    UiChangedBeforeNavigation,
    NavigationTimeout,
    NavigationThrowsUnexpectedError,
    NavigationCompletesButUnverifiable,
    OperatorCancelsDuringNavigation,
}

/// <summary>
/// Terminal-round behaviour of the fake, orthogonal to the discovery
/// <see cref="FakeScenario"/>. The fake models the NATIVE effect of a
/// successful round in its own <see cref="FakeTerminalTableState"/> — it
/// still reports <c>Mutated = false</c> because there is no real IPS to
/// mutate; the state store is the fake's stand-in for POSServer, read back
/// by <see cref="FakePosServerConfirmationClient"/>.
/// </summary>
public enum FakeTerminalScenario
{
    Success,
    ModalBlocks,
    ControlNotFound,
    UnexpectedScreen,
    PluMismatch,
    SendNotReached,
    Timeout,
}

public sealed class FakeIdealposUiAutomationClient(
    FakeScenario scenario,
    FakeTerminalScenario terminalScenario = FakeTerminalScenario.Success,
    FakeTerminalTableState? tableState = null) : IIdealposUiAutomationClient
{
    /// <summary>Mutable so a test can flip a FAILED_BEFORE_SEND retry to a subsequent success.</summary>
    public FakeTerminalScenario TerminalScenario { get; set; } = terminalScenario;

    /// <summary>The fake stand-in for native POSServer state, shared with a confirmation fixture.</summary>
    public FakeTerminalTableState TableState { get; } = tableState ?? new FakeTerminalTableState();

    /// <summary>How many times the native round path actually executed — asserted by idempotency tests.</summary>
    public int SaveToTableExecuteCount { get; private set; }

    /// <summary>Fake native prices, observed back FROM the fake POS. Never an input to a round.</summary>
    public Dictionary<string, decimal> NativeUnitPrices { get; } = new(StringComparer.OrdinalIgnoreCase)
    {
        ["708"] = 23.00m,
    };

    public Task<IdealposProcessSnapshot?> DetectIdealposProcessAsync(CancellationToken cancellationToken)
    {
        if (scenario == FakeScenario.IdealposNotRunning) return Task.FromResult<IdealposProcessSnapshot?>(null);
        if (scenario == FakeScenario.InsufficientPermissions)
            throw new UnauthorizedAccessException("Fixture: simulated insufficient Windows permissions to enumerate processes.");

        return Task.FromResult<IdealposProcessSnapshot?>(
            new IdealposProcessSnapshot("IPSClient", 4242, "Idealpos - Table Selection", IsInteractiveSession: true));
    }

    public Task<IdealposUiProfileMatchResult> MatchUiProfileAsync(
        IdealposProcessSnapshot process, IdealposVerifiedProfile expectedProfile, CancellationToken cancellationToken)
    {
        if (scenario == FakeScenario.ControlNotFoundDuringProfileMatch)
            throw new IdealposControlNotFoundException("fixture: expected main-window title control");
        if (scenario == FakeScenario.ControlAmbiguousDuringProfileMatch)
            throw new IdealposControlAmbiguousException("fixture: table-selection grid", matchCount: 3);
        if (scenario == FakeScenario.WrongVersionProfile)
            return Task.FromResult(new IdealposUiProfileMatchResult(false, "unexpected-build-1.2.3", "process name did not match expected profile"));

        return Task.FromResult(new IdealposUiProfileMatchResult(true, expectedProfile.ProfileVersion, null));
    }

    public Task<IdealposUiState> ReadCurrentUiStateAsync(CancellationToken cancellationToken)
    {
        return scenario switch
        {
            FakeScenario.SessionLocked => Task.FromResult(new IdealposUiState(false, true, false, "Locked")),
            FakeScenario.UnexpectedModalDialog => Task.FromResult(new IdealposUiState(true, false, false, "Idealpos")),
            FakeScenario.IdealposBusy => Task.FromResult(new IdealposUiState(false, false, true, "Idealpos - Processing")),
            _ => Task.FromResult(new IdealposUiState(false, false, false, "Idealpos - Table Selection")),
        };
    }

    public async Task<HarmlessNavigationResult> PerformHarmlessNavigationAsync(CancellationToken cancellationToken)
    {
        switch (scenario)
        {
            case FakeScenario.UiChangedBeforeNavigation:
                return new HarmlessNavigationResult(Completed: false, Verified: false, "UI state changed since profile match — navigation aborted.");
            case FakeScenario.NavigationTimeout:
                await Task.Delay(Timeout.Infinite, cancellationToken); // caller supplies an already-short-timeout token in the test
                throw new OperationCanceledException();
            case FakeScenario.NavigationThrowsUnexpectedError:
                throw new InvalidOperationException("Fixture: simulated unexpected automation error mid-navigation.");
            case FakeScenario.NavigationCompletesButUnverifiable:
                return new HarmlessNavigationResult(Completed: true, Verified: false, "Navigation ran but the expected confirming control could not be re-read.");
            case FakeScenario.OperatorCancelsDuringNavigation:
                cancellationToken.ThrowIfCancellationRequested();
                await Task.Delay(50, cancellationToken);
                throw new OperationCanceledException();
            default:
                return new HarmlessNavigationResult(Completed: true, Verified: true, "Re-read the main window title bar without mutating any order/table state.");
        }
    }

    public Task<TerminalSaveToTableResult> AttemptSaveToTableAsync(TerminalRoundRequest request, CancellationToken cancellationToken)
    {
        SaveToTableExecuteCount++;
        var plan = BuildActionPlan(request);

        switch (TerminalScenario)
        {
            case FakeTerminalScenario.ModalBlocks:
                return Result(TerminalSaveToTableResult.FailClosed(
                    TerminalExecutionOutcome.ModalDetected, request.RoundId, request.TableCode,
                    "fixture: a modal dialog is blocking the sale screen", plan));
            case FakeTerminalScenario.ControlNotFound:
                return Result(TerminalSaveToTableResult.FailClosed(
                    TerminalExecutionOutcome.ControlNotFound, request.RoundId, request.TableCode,
                    "fixture: a required sale-screen control was not found", plan));
            case FakeTerminalScenario.UnexpectedScreen:
                return Result(TerminalSaveToTableResult.FailClosed(
                    TerminalExecutionOutcome.UnexpectedScreen, request.RoundId, request.TableCode,
                    "fixture: the visible screen is not the expected native sale/table screen", plan));
            case FakeTerminalScenario.PluMismatch:
                return Result(TerminalSaveToTableResult.FailClosed(
                    TerminalExecutionOutcome.PluResolutionMismatch, request.RoundId, request.TableCode,
                    "fixture: the entered PLU did not resolve to the expected native item", plan));
            case FakeTerminalScenario.SendNotReached:
                return Result(new TerminalSaveToTableResult
                {
                    Outcome = TerminalExecutionOutcome.SendNotReached,
                    RoundId = request.RoundId,
                    TableCode = request.TableCode,
                    SendBoundaryCrossed = false,
                    Mutated = false,
                    ActionPlan = plan,
                    FailClosedReason = "fixture: could not reach the Save-to-Table/Send action",
                });
            case FakeTerminalScenario.Timeout:
                return Result(new TerminalSaveToTableResult
                {
                    Outcome = TerminalExecutionOutcome.Timeout,
                    RoundId = request.RoundId,
                    TableCode = request.TableCode,
                    SendBoundaryCrossed = false,
                    Mutated = false,
                    ActionPlan = plan,
                    FailClosedReason = "fixture: timed out driving the sale screen",
                });
        }

        // Success path.
        if (request.RoundKind == TerminalRoundKind.SecondRound && !TableState.HasTable(request.TableCode))
        {
            return Result(TerminalSaveToTableResult.FailClosed(
                TerminalExecutionOutcome.UnexpectedScreen, request.RoundId, request.TableCode,
                "fixture: a second round asked to reopen a table with no existing native sale", plan));
        }

        // Model the native effect: append only the round's items (never a
        // replay), retaining any prior lines. This is the fake's POSServer.
        TableState.AppendRound(request.TableCode, request.Items);

        var observed = request.Items
            .Select(i => new ObservedTerminalLine(
                i.NativeCode, i.Quantity,
                NativeUnitPrices.TryGetValue(i.NativeCode.Trim(), out var p) ? p : (decimal?)null))
            .ToList();

        return Result(new TerminalSaveToTableResult
        {
            Outcome = TerminalExecutionOutcome.Success,
            RoundId = request.RoundId,
            TableCode = request.TableCode,
            SendBoundaryCrossed = true,
            Mutated = false, // no REAL IPS mutation — this is the fixture's own state
            ActionPlan = plan,
            ObservedLines = observed,
        });
    }

    private static Task<TerminalSaveToTableResult> Result(TerminalSaveToTableResult r) => Task.FromResult(r);

    private static IReadOnlyList<string> BuildActionPlan(TerminalRoundRequest request) => TerminalActionPlan.Build(request);

    public Task<IdealposControlTreeSnapshot> CaptureControlTreeAsync(ControlTreeCaptureOptions options, CancellationToken cancellationToken)
    {
        if (scenario == FakeScenario.IdealposNotRunning)
        {
            return Task.FromResult(new IdealposControlTreeSnapshot
            {
                CapturedAtUtc = DateTimeOffset.UtcNow,
                Root = null,
                NodeCount = 0,
                Diagnostics = new[] { "fixture: IPS not running" },
            });
        }

        static ControlNodeSnapshot Node(string type, string? id, string? name, string? cls, int depth, params ControlNodeSnapshot[] kids) => new()
        {
            ControlType = type,
            AutomationId = id,
            Name = ControlTreeSanitizer.Sanitize(name), // sanitized exactly as the real capture does
            ClassName = cls,
            IsEnabled = true,
            IsOffscreen = false,
            Depth = depth,
            Children = kids,
        };

        var root = Node("Window", null, "Idealpos - Table Selection", "ThunderRT6FormDC", 0,
            Node("Pane", "tableMap", "Table Map", "ThunderRT6UserControlDC", 1,
                Node("Button", "table_5", "Table 5", "ThunderRT6CommandButton", 2),
                Node("Button", "table_6", "Table 6", "ThunderRT6CommandButton", 2)),
            Node("Edit", "pluEntry", "PLU", "ThunderRT6TextBox", 1),
            Node("Button", "saveToTable", "Save to Table", "ThunderRT6CommandButton", 1),
            Node("Menu", "mainMenu", "Menu", "ThunderRT6MDIForm", 1,
                Node("MenuItem", "menu_functions", "Functions", null, 2),
                // Seed a sensitive value to prove the capture redacts it.
                Node("MenuItem", "menu_clerk", "Clerk 1234567890123456 Loyalty", null, 2)));

        var menus = new List<string>();
        CollectMenuItems(root, menus);

        return Task.FromResult(new IdealposControlTreeSnapshot
        {
            CapturedAtUtc = DateTimeOffset.UtcNow,
            ProcessName = "IPS",
            ProcessId = 4242,
            RootWindowTitle = ControlTreeSanitizer.Sanitize("Idealpos - Table Selection"),
            NodeCount = CountNodes(root),
            Truncated = false,
            Root = root,
            MenuItems = menus,
            Diagnostics = new[] { "UNIT_OR_MOCK fixture control tree — never real Windows/Idealpos evidence" },
        });
    }

    private static int CountNodes(ControlNodeSnapshot node) => 1 + node.Children.Sum(CountNodes);

    private static void CollectMenuItems(ControlNodeSnapshot node, List<string> into)
    {
        if (node.ControlType == "MenuItem" && !string.IsNullOrWhiteSpace(node.Name)) into.Add(node.Name!);
        foreach (var c in node.Children) CollectMenuItems(c, into);
    }
}
