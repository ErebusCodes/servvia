using VerduraIdealposTracer.Core.Automation;

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

public sealed class FakeIdealposUiAutomationClient(FakeScenario scenario) : IIdealposUiAutomationClient
{
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
}
