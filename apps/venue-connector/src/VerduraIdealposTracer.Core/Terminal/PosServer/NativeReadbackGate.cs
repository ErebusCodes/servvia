using System.Data.Common;

namespace VerduraIdealposTracer.Core.Terminal.PosServer;

/// <summary>What the composition root should construct for native readback, and why.</summary>
public sealed record NativeReadbackDecision
{
    /// <summary>True when a real POSServer reader may be constructed.</summary>
    public required bool Enabled { get; init; }

    /// <summary>The connection factory to use when <see cref="Enabled"/>. Null otherwise.</summary>
    public Func<DbConnection>? ConnectionFactory { get; init; }

    /// <summary>Always populated — the operator-facing explanation, logged either way.</summary>
    public required string Reason { get; init; }
}

/// <summary>
/// Decides whether the real POSServer readback may be wired, from configuration
/// alone. Pure apart from the factory resolver it is handed, so every branch is
/// testable without a database or a provider.
///
/// WHY THIS IS A GATE AND NOT A DEFAULT. The connector has never carried a
/// POSServer connection string: none of its environment variables supplies one,
/// and inventing one — or reusing the Bridge's, or falling back to a trusted
/// connection under the service account — would be exactly the "rely on current
/// SYSTEM/sysadmin production permissions" mistake this work is meant to avoid.
/// So the default is OFF, the variable is unset in production, and turning it on
/// is a deliberate act by someone who has created a least-privilege login.
///
/// EVERY FAILURE KEEPS THE STAND-INS. A missing variable, an unregistered
/// provider, a malformed connection string — none of them throws, and none of
/// them half-enables anything. They return Disabled with a reason, the
/// composition root logs it, and the fail-closed stand-ins stay in place. A
/// connector that cannot read POSServer is a connector whose native rounds
/// refuse before the send boundary, which is the correct behaviour, not an
/// outage.
/// </summary>
public static class NativeReadbackGate
{
    /// <summary>Connection string for the POSServer database. Unset in production today.</summary>
    public const string ConnectionStringVariable = "IDEALPOS_POSSERVER_CONNECTION_STRING";

    /// <summary>ADO.NET provider invariant name. Defaults to the SQL Server client.</summary>
    public const string ProviderVariable = "IDEALPOS_POSSERVER_PROVIDER";

    public const string DefaultProviderInvariantName = "Microsoft.Data.SqlClient";

    /// <summary>
    /// The privilege this reader expects, stated where the wiring happens so it
    /// travels with the code rather than living only in a runbook.
    /// </summary>
    public const string LeastPrivilegeNote =
        "The configured login should hold db_datareader on the POSServer database and nothing more — this reader "
        + "issues exactly one SELECT over dbo.PendingSales and dbo.PendingSaleLines. Do NOT configure it with the "
        + "machine account, a sysadmin login, or any principal that can write. Set ApplicationIntent=ReadOnly where "
        + "the deployment supports it.";

    /// <summary>
    /// Decides from raw configuration values.
    /// </summary>
    /// <param name="connectionString">The value of <see cref="ConnectionStringVariable"/>, or null/blank when unset.</param>
    /// <param name="providerInvariantName">The value of <see cref="ProviderVariable"/>, or null/blank for the default.</param>
    /// <param name="resolveFactory">
    /// Resolves an ADO.NET provider factory by invariant name — normally
    /// <c>DbProviderFactories.GetFactory</c>. Injected so the gate can be
    /// tested without any provider package being present.
    /// </param>
    public static NativeReadbackDecision Decide(
        string? connectionString,
        string? providerInvariantName,
        Func<string, DbProviderFactory?> resolveFactory)
    {
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            return new NativeReadbackDecision
            {
                Enabled = false,
                Reason =
                    $"{ConnectionStringVariable} is not set, so native POSServer readback stays disabled and the "
                    + "fail-closed stand-ins remain. Native rounds refuse before the send boundary.",
            };
        }

        var provider = string.IsNullOrWhiteSpace(providerInvariantName)
            ? DefaultProviderInvariantName
            : providerInvariantName!.Trim();

        DbProviderFactory? factory;
        try
        {
            factory = resolveFactory(provider);
        }
        catch (Exception ex)
        {
            return new NativeReadbackDecision
            {
                Enabled = false,
                Reason =
                    $"{ConnectionStringVariable} is set but the ADO.NET provider '{provider}' could not be resolved "
                    + $"({ex.GetType().Name}: {ex.Message}). Keeping the fail-closed stand-ins rather than enabling a "
                    + "readback that cannot connect.",
            };
        }

        if (factory is null)
        {
            return new NativeReadbackDecision
            {
                Enabled = false,
                Reason =
                    $"{ConnectionStringVariable} is set but no ADO.NET provider is registered under '{provider}'. This "
                    + "build does not reference a SQL client package; add one and register it with "
                    + "DbProviderFactories.RegisterFactory before enabling native readback. Keeping the fail-closed "
                    + "stand-ins.",
            };
        }

        var captured = connectionString!;
        return new NativeReadbackDecision
        {
            Enabled = true,
            ConnectionFactory = () =>
            {
                var connection = factory.CreateConnection()
                    ?? throw new InvalidOperationException($"Provider '{provider}' returned no connection.");
                connection.ConnectionString = captured;
                return connection;
            },
            Reason = $"native POSServer readback enabled via provider '{provider}'. {LeastPrivilegeNote}",
        };
    }
}
