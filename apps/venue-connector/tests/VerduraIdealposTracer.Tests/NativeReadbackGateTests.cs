using System.Data.Common;
using VerduraIdealposTracer.Core.Terminal.PosServer;
using VerduraIdealposTracer.Fixtures;
using Xunit;

namespace VerduraIdealposTracer.Tests;

/// <summary>
/// The gate deciding whether the real POSServer reader is wired.
///
/// Production sets neither variable, so the first test below is the production
/// case: stand-ins, refusals before the send boundary, no behaviour change. The
/// rest exist because every OTHER outcome must also keep the stand-ins — a gate
/// that throws, or that half-enables, would turn a configuration mistake into
/// an outage or, worse, into a reader that silently answers wrongly.
/// </summary>
public sealed class NativeReadbackGateTests
{
    private static DbProviderFactory? NoProvider(string name) => null;

    private static DbProviderFactory? ThrowingProvider(string name) =>
        throw new ArgumentException($"no factory registered for '{name}'");

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void WithNoConnectionStringConfigured_ReadbackStaysDisabled(string? connectionString)
    {
        // The production case, today.
        var decision = NativeReadbackGate.Decide(connectionString, null, NoProvider);

        Assert.False(decision.Enabled);
        Assert.Null(decision.ConnectionFactory);
        Assert.Contains(NativeReadbackGate.ConnectionStringVariable, decision.Reason);
        Assert.Contains("stand-ins", decision.Reason);
    }

    [Fact]
    public void WithAConnectionStringButNoRegisteredProvider_ReadbackStaysDisabled()
    {
        // This build references no SQL client package, so this is what happens
        // if somebody sets the variable today: a clear refusal, not a crash.
        var decision = NativeReadbackGate.Decide("Server=x;Database=POSServer;", null, NoProvider);

        Assert.False(decision.Enabled);
        Assert.Contains("no ADO.NET provider is registered", decision.Reason);
        Assert.Contains(NativeReadbackGate.DefaultProviderInvariantName, decision.Reason);
    }

    [Fact]
    public void WhenTheProviderLookupThrows_ReadbackStaysDisabled_AndTheGateDoesNot()
    {
        // DbProviderFactories.GetFactory throws for an unknown name. The gate
        // must absorb that: a misconfigured connector should refuse native
        // rounds, not fail to start.
        var decision = NativeReadbackGate.Decide("Server=x;", "Nonsense.Provider", ThrowingProvider);

        Assert.False(decision.Enabled);
        Assert.Contains("could not be resolved", decision.Reason);
        Assert.Contains("Nonsense.Provider", decision.Reason);
    }

    [Fact]
    public void WithAConnectionStringAndARegisteredProvider_ReadbackIsEnabled()
    {
        var decision = NativeReadbackGate.Decide(
            "Server=x;Database=POSServer;", "Fake.Provider", _ => FakeDbProviderFactory.Instance);

        Assert.True(decision.Enabled);
        Assert.NotNull(decision.ConnectionFactory);
        Assert.Contains("Fake.Provider", decision.Reason);
    }

    [Fact]
    public void TheEnabledFactoryAppliesTheConfiguredConnectionString()
    {
        var decision = NativeReadbackGate.Decide(
            "Server=posserver;Database=POSServer;", "Fake.Provider", _ => FakeDbProviderFactory.Instance);

        using var connection = decision.ConnectionFactory!();

        Assert.Equal("Server=posserver;Database=POSServer;", connection.ConnectionString);
    }

    [Fact]
    public void TheEnabledReasonCarriesTheLeastPrivilegeExpectation()
    {
        // The privilege requirement travels with the wiring, so an operator
        // enabling this reads it at the moment they enable it rather than
        // needing to find a runbook.
        var decision = NativeReadbackGate.Decide("Server=x;", "Fake.Provider", _ => FakeDbProviderFactory.Instance);

        Assert.Contains("db_datareader", decision.Reason);
        Assert.Contains("sysadmin", decision.Reason);
    }

    [Fact]
    public async Task AnEnabledGateProducesAWorkingReadOnlyReader()
    {
        // End to end through the gate: configuration -> factory -> reader ->
        // typed result, with no database and no provider package.
        var decision = NativeReadbackGate.Decide("Server=x;", "Fake.Provider", _ => FakeDbProviderFactory.Instance);
        var reader = new PosServerTableStateReader(decision.ConnectionFactory!);

        var result = await reader.ReadTableAsync("5", null, CancellationToken.None);

        // The fake provider yields a connection with no rows, which is a
        // genuinely free table — not an error.
        Assert.Equal(NativeTableReadStatus.NoOpenSale, result.Status);
    }
}
