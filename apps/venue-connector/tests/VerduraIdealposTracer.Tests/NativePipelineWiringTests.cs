using VerduraIdealposTracer.Core.Discovery;
using VerduraIdealposTracer.Core.Hosting;
using VerduraIdealposTracer.Core.OrderSubmission;
using VerduraIdealposTracer.Core.Persistence;
using VerduraIdealposTracer.Core.Terminal;
using VerduraIdealposTracer.Fixtures;
using Xunit;

namespace VerduraIdealposTracer.Tests;

/// <summary>
/// The native pipeline is wired into the connector's composition root, and is
/// inert.
///
/// Those two claims pull in opposite directions, which is why both are tested
/// together. "Wired" means the object graph is the real one — the same durable
/// store, the same round service, the same lifecycle — so the cutover is a
/// substitution rather than a construction project. "Inert" means nothing on
/// this build can reach the native driver, let alone confirm a round.
///
/// The stand-ins are the crux: they must be incapable of producing an answer,
/// not merely unlikely to. A stand-in that returned "no table found" would be
/// indistinguishable from a real reader observing a free table, and a first
/// round would sail straight past the precondition gate on a fabricated
/// baseline.
/// </summary>
public sealed class NativePipelineWiringTests : IDisposable
{
    private readonly string _tempDir = Directory.CreateTempSubdirectory("native-wiring-").FullName;

    private string NewLogPath() => Path.Combine(_tempDir, $"{Guid.NewGuid()}.ndjson");

    private static TerminalRoundRequest Round1() => new()
    {
        ExternalOrderId = "ORD-WIRE-1",
        RoundId = "round-1",
        RoundKind = TerminalRoundKind.FirstRound,
        OrderReference = "REF-WIRE-1",
        TableCode = "5",
        Items = new[] { new TerminalRoundItem("708", 1) },
    };

    // ─────────────── the graph composes for real ───────────────

    [Fact]
    public void TheProductionGraph_ComposesWithoutAnyTestDouble()
    {
        // Exactly the shape Program.cs registers. If TerminalRoundService ever
        // grows a dependency the connector cannot supply, this stops compiling
        // or throws here — before it is discovered during a cutover.
        var store = new TerminalRoundStateStore(new DurableLocalLog(NewLogPath()));
        var reader = new UnavailableNativeTableStateReader();
        var confirm = new UnavailablePosServerConfirmationClient();
        var ui = new FakeIdealposUiAutomationClient(FakeScenario.HappyPath);

        var service = new TerminalRoundService(ui, store, reader, confirm);

        Assert.NotNull(service);
    }

    // ─────────────── the stand-ins refuse, they do not answer ───────────────

    [Fact]
    public async Task TheStandInReader_RefusesRatherThanReportingAFreeTable()
    {
        // "No sale on this table" and "I cannot look" must never be the same
        // value: the first one licenses a first round, the second one must not.
        var reader = new UnavailableNativeTableStateReader();

        var ex = await Assert.ThrowsAsync<NativeCapabilityUnavailableException>(
            () => reader.ReadAsync("5", map: null, CancellationToken.None));

        Assert.Contains("baseline", ex.Message);
    }

    [Fact]
    public async Task TheStandInConfirmationClient_RefusesRatherThanReportingInconclusive()
    {
        // Returning an outcome — even Inconclusive — would be a judgement about
        // native state this type has never observed.
        var confirm = new UnavailablePosServerConfirmationClient();

        await Assert.ThrowsAsync<NativeCapabilityUnavailableException>(
            () => confirm.ConfirmRoundAsync(
                TerminalRoundKind.FirstRound, "5", null, null,
                new[] { new TerminalRoundItem("708", 1) }, CancellationToken.None));
    }

    // ─────────────── inert: nothing can reach the driver ───────────────

    [Fact]
    public async Task ANativeRoundOnThisBuild_StopsBeforeTheSendBoundary_AndNeverDrivesTheUi()
    {
        var store = new TerminalRoundStateStore(new DurableLocalLog(NewLogPath()));
        var ui = new FakeIdealposUiAutomationClient(FakeScenario.HappyPath, FakeTerminalScenario.Success);
        var service = new TerminalRoundService(
            ui, store, new UnavailableNativeTableStateReader(), new UnavailablePosServerConfirmationClient());

        var state = await service.ExecuteRoundAsync(Round1(), CancellationToken.None);

        Assert.Equal(TerminalRoundStatus.FAILED_BEFORE_SEND, state.Status);
        Assert.Equal(0, ui.SaveToTableExecuteCount);
        Assert.Contains("not sending without a baseline", state.Detail);
    }

    [Fact]
    public async Task ANativeRoundOnThisBuild_IsRetryable_SoTheCutoverNeedsNoDataRepair()
    {
        // FAILED_BEFORE_SEND is the one post-attempt state that does not lock
        // the key out. Replacing the stand-ins is therefore sufficient to make
        // previously-refused rounds work — no operator has to clean up state
        // left behind by the inert period.
        var store = new TerminalRoundStateStore(new DurableLocalLog(NewLogPath()));
        var ui = new FakeIdealposUiAutomationClient(FakeScenario.HappyPath, FakeTerminalScenario.Success);

        var inert = new TerminalRoundService(
            ui, store, new UnavailableNativeTableStateReader(), new UnavailablePosServerConfirmationClient());
        Assert.Equal(TerminalRoundStatus.FAILED_BEFORE_SEND,
            (await inert.ExecuteRoundAsync(Round1(), CancellationToken.None)).Status);

        // The same durable store, with working dependencies substituted in.
        var tableState = ui.TableState;
        var live = new TerminalRoundService(
            ui, store, new FakeNativeTableStateReader(tableState), new FakePosServerConfirmationClient(tableState));

        Assert.Equal(TerminalRoundStatus.CONFIRMED,
            (await live.ExecuteRoundAsync(Round1(), CancellationToken.None)).Status);
    }

    [Fact]
    public async Task TheRestartSweep_IsSafeOnThisBuild_EscalatingRatherThanConfirming()
    {
        // A round left outstanding by an earlier build must not be "resolved"
        // by a build that cannot look at native state.
        var logPath = NewLogPath();
        var seed = new TerminalRoundStateStore(new DurableLocalLog(logPath));
        seed.Record(new TerminalRoundStateEntry
        {
            ExternalOrderId = "ORD-WIRE-2",
            RoundId = "round-1",
            TableCode = "5",
            Status = TerminalRoundStatus.SEND_INITIATED,
            Items = new[] { new TerminalRoundItem("708", 1) },
            RoundKind = TerminalRoundKind.FirstRound,
        });

        var ui = new FakeIdealposUiAutomationClient(FakeScenario.HappyPath, FakeTerminalScenario.Success);
        var service = new TerminalRoundService(
            ui,
            new TerminalRoundStateStore(new DurableLocalLog(logPath)),
            new UnavailableNativeTableStateReader(),
            new UnavailablePosServerConfirmationClient());

        var swept = await service.ReconcileOutstandingAsync(CancellationToken.None);

        var outcome = Assert.Single(swept);
        Assert.NotEqual(TerminalRoundStatus.CONFIRMED, outcome.Status);
        Assert.Equal(TerminalRoundStatus.UNCERTAIN, outcome.Status);
        Assert.Equal(0, ui.SaveToTableExecuteCount); // reconciliation drives nothing, ever
    }

    // ─────────────── the capability gate stays shut ───────────────

    [Fact]
    public void TheConnector_DoesNotAdvertiseANativeTableRoundCapability()
    {
        // The server's routing seam refuses to create a native command unless
        // the venue's connector reports this capability. This build must not.
        var advertised = ConnectorPollingLoop.AdvertisedCapabilityNames;

        Assert.DoesNotContain(advertised, c => c.Contains("native", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(advertised, c => c.Contains("table_round", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void TheConnector_AdvertisesOnlyCommandTypesItActuallyHandles()
    {
        // The set is meant to stay in lockstep with the dispatch checks. Pin it
        // so adding a capability is a deliberate act with a failing test behind
        // it, not a one-line addition.
        Assert.Equal(
            new[]
            {
                DiscoveryTracerService.CommandType,
                IdealposOrderSubmissionService.CommandType,
                IdealposOrderStatusService.CommandType,
            }.OrderBy(x => x, StringComparer.Ordinal),
            ConnectorPollingLoop.AdvertisedCapabilityNames.OrderBy(x => x, StringComparer.Ordinal));
    }

    public void Dispose() => Directory.Delete(_tempDir, recursive: true);
}
