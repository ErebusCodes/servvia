using System.Data.Common;
using VerduraIdealposTracer.Core.Terminal.PosServer;
using VerduraIdealposTracer.Fixtures;
using Xunit;

namespace VerduraIdealposTracer.Tests;

/// <summary>
/// The gate deciding whether the real POSServer reader is wired.
///
/// Production sets none of these variables, so the first test below is the
/// production case: stand-ins, refusals before the send boundary, no behaviour
/// change. The rest exist because every OTHER outcome must also keep the
/// stand-ins — a gate that throws, or that half-enables, would turn a
/// configuration mistake into an outage or, worse, into a reader that silently
/// answers wrongly.
/// </summary>
public sealed class NativeReadbackGateTests
{
    private const string Conn = "Server=posserver;Database=POSServer;";

    private static DbProviderFactory? NoProvider(string name) => null;

    private static DbProviderFactory? ThrowingProvider(string name) =>
        throw new ArgumentException($"no factory registered for '{name}'");

    private static DbProviderFactory? WorkingProvider(string name) => FakeDbProviderFactory.Instance;

    /// <summary>A fully configured gate: connection, provider, and an explicit table context.</summary>
    private static NativeReadbackDecision FullyConfigured(string map = "1", string pos = "1", string conn = Conn) =>
        NativeReadbackGate.Decide(conn, "Fake.Provider", WorkingProvider, map, pos);

    // ─────────────────── disabled paths all keep the stand-ins ───────────────────

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void WithNoConnectionStringConfigured_ReadbackStaysDisabled(string? connectionString)
    {
        // The production case, today.
        var decision = NativeReadbackGate.Decide(connectionString, null, NoProvider, "1", "1");

        Assert.False(decision.Enabled);
        Assert.Null(decision.ConnectionFactory);
        Assert.Null(decision.TableContext);
        Assert.Contains(NativeReadbackGate.ConnectionStringVariable, decision.Reason);
        Assert.Contains("stand-ins", decision.Reason);
    }

    [Fact]
    public void WithAConnectionStringButNoRegisteredProvider_ReadbackStaysDisabled()
    {
        // This build references no SQL client package, so this is what happens
        // if somebody sets the variable today: a clear refusal, not a crash.
        var decision = NativeReadbackGate.Decide(Conn, null, NoProvider, "1", "1");

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
        var decision = NativeReadbackGate.Decide(Conn, "Nonsense.Provider", ThrowingProvider, "1", "1");

        Assert.False(decision.Enabled);
        Assert.Contains("could not be resolved", decision.Reason);
        Assert.Contains("Nonsense.Provider", decision.Reason);
    }

    // ─────────────────── the table context is configuration ───────────────────

    [Theory]
    [InlineData(null, "1")]
    [InlineData("", "1")]
    [InlineData("1", null)]
    [InlineData("1", "")]
    [InlineData("1", "not-a-number")]
    public void WithoutACompleteTableContext_ReadbackStaysDisabled(string? map, string? pos)
    {
        // The map and POS seen on one installation on one day are evidence, not
        // defaults. A connection string alone is not enough to start reading.
        var decision = NativeReadbackGate.Decide(Conn, "Fake.Provider", WorkingProvider, map, pos);

        Assert.False(decision.Enabled);
        Assert.Contains(NativeReadbackGate.MapVariable, decision.Reason);
        Assert.Contains(NativeReadbackGate.PosVariable, decision.Reason);
        Assert.Contains("evidence, not defaults", decision.Reason);
    }

    [Fact]
    public void AFullyConfiguredGate_CarriesTheConfiguredContext_NotAnAssumedOne()
    {
        var decision = FullyConfigured(map: "3", pos: "2");

        Assert.True(decision.Enabled);
        Assert.Equal("3", decision.TableContext!.ExpectedMap);
        Assert.Equal(2, decision.TableContext.ExpectedPos);
        Assert.Contains("map 3", decision.Reason);
        Assert.Contains("POS 2", decision.Reason);
    }

    [Fact]
    public void TheEnabledFactoryAppliesTheConfiguredConnectionString()
    {
        using var connection = FullyConfigured().ConnectionFactory!();

        Assert.Equal(Conn, connection.ConnectionString);
    }

    // ─────────────────── enforced vs operational, stated accurately ───────────────────

    [Fact]
    public void TheReasonSeparatesWhatIsEnforcedFromWhatIsMerelyRequired()
    {
        // The correction: a message mentioning db_datareader does not make the
        // connector an enforcer of least privilege. The two claims must be
        // distinguishable to whoever reads the log line.
        var decision = FullyConfigured();

        Assert.Contains(NativeReadbackGate.EnforcedReadOnlyProperties, decision.Reason);
        Assert.Contains(NativeReadbackGate.OperationalPrivilegeRequirement, decision.Reason);
    }

    [Fact]
    public void TheEnforcedClaimCoversOnlyPropertiesThisCodebaseActuallyGuarantees()
    {
        var enforced = NativeReadbackGate.EnforcedReadOnlyProperties;

        Assert.Contains("explicitly configured", enforced);
        Assert.Contains("exactly one SELECT", enforced);
        // It must NOT claim anything about the login's rights.
        Assert.DoesNotContain("db_datareader", enforced);
        Assert.DoesNotContain("privilege", enforced, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void ThePrivilegeRequirementIsLabelledAsNotEnforcedByTheConnector()
    {
        var operational = NativeReadbackGate.OperationalPrivilegeRequirement;

        Assert.Contains("NOT enforced by this connector", operational);
        Assert.Contains("db_datareader", operational);
        Assert.Contains("database administrator", operational);
    }

    [Theory]
    [InlineData("Server=x;ApplicationIntent=ReadOnly;", true)]
    [InlineData("Server=x;applicationintent=readonly", true)]
    [InlineData("Server=x; ApplicationIntent = ReadOnly ;", true)]
    [InlineData("Server=x;", false)]
    [InlineData("Server=x;ApplicationIntent=ReadWrite;", false)]
    [InlineData(null, false)]
    public void ReadOnlyApplicationIntentIsDetected(string? connectionString, bool expected)
    {
        Assert.Equal(expected, NativeReadbackGate.DeclaresReadOnlyApplicationIntent(connectionString));
    }

    [Fact]
    public void AMissingReadOnlyIntentIsReported_ButDoesNotRefuse()
    {
        // Not every provider or topology supports ApplicationIntent, so its
        // absence is a fact to surface rather than grounds to disable a
        // deliberately configured readback.
        var without = FullyConfigured(conn: "Server=x;");
        var with = FullyConfigured(conn: "Server=x;ApplicationIntent=ReadOnly;");

        Assert.True(without.Enabled);
        Assert.Contains("does not declare ApplicationIntent=ReadOnly", without.Reason);
        Assert.True(with.Enabled);
        Assert.Contains("declares ApplicationIntent=ReadOnly", with.Reason);
    }

    [Fact]
    public async Task AnEnabledGateProducesAWorkingReadOnlyReader()
    {
        // End to end through the gate: configuration -> factory -> context ->
        // reader -> typed result, with no database and no provider package.
        var decision = FullyConfigured();
        var reader = new PosServerTableStateReader(decision.ConnectionFactory!, decision.TableContext!);

        var result = await reader.ReadTableAsync("5", null, CancellationToken.None);

        // The fake provider yields a connection with no rows, which is a
        // genuinely free table — not an error.
        Assert.Equal(NativeTableReadStatus.NoOpenSale, result.Status);
    }
}
