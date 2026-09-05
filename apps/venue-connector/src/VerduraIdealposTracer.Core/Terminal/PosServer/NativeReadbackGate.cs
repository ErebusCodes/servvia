using System.Data.Common;

namespace VerduraIdealposTracer.Core.Terminal.PosServer;

/// <summary>What the composition root should construct for native readback, and why.</summary>
public sealed record NativeReadbackDecision
{
    /// <summary>True when a real POSServer reader may be constructed.</summary>
    public required bool Enabled { get; init; }

    /// <summary>The connection factory to use when <see cref="Enabled"/>. Null otherwise.</summary>
    public Func<DbConnection>? ConnectionFactory { get; init; }

    /// <summary>The configured native table context to read in. Null when disabled.</summary>
    public NativeTableContext? TableContext { get; init; }

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

    /// <summary>Map partition to read. Venue configuration, never assumed.</summary>
    public const string MapVariable = "IDEALPOS_POSSERVER_MAP";

    /// <summary>POS context to read. Venue configuration, never assumed.</summary>
    public const string PosVariable = "IDEALPOS_POSSERVER_POS";

    /// <summary>
    /// The read-only properties this codebase actually GUARANTEES. Every item
    /// here is a structural fact about the reader, asserted by test.
    /// </summary>
    public const string EnforcedReadOnlyProperties =
        "Enforced in code: the connection string must be explicitly configured (never defaulted or inferred); a "
        + "provider must be registered; the reader issues exactly one SELECT held in a constant, with no "
        + "ExecuteNonQuery/ExecuteScalar/BeginTransaction call and no dynamically built SQL.";

    /// <summary>
    /// The privilege requirement this codebase CANNOT check. Stated separately,
    /// and deliberately not phrased as something the connector enforces: a
    /// sysadmin connection string would work exactly as well here, and nothing
    /// in this process could tell.
    /// </summary>
    public const string OperationalPrivilegeRequirement =
        "NOT enforced by this connector, and not enforceable from it — required operationally: the SQL login must "
        + "hold only read access (e.g. db_datareader) on the POSServer database and must lack write and "
        + "administrative rights. Do not use the machine account or a sysadmin login. Granting and auditing this is "
        + "the database administrator's responsibility.";

    /// <summary>
    /// Whether the connection string opts into a read-only application intent.
    /// Reported, not required: not every provider or topology supports it, so
    /// its absence is a fact to surface rather than grounds to refuse.
    /// </summary>
    public static bool DeclaresReadOnlyApplicationIntent(string? connectionString) =>
        connectionString is not null
        && connectionString.Replace(" ", string.Empty)
            .Contains("ApplicationIntent=ReadOnly", StringComparison.OrdinalIgnoreCase);

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
        Func<string, DbProviderFactory?> resolveFactory,
        string? expectedMap = null,
        string? expectedPos = null)
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

        // The table context is venue configuration. Without it the reader would
        // have to assume the map/POS one installation happened to use — exactly
        // the over-claim this gate refuses to make on an operator's behalf.
        if (string.IsNullOrWhiteSpace(expectedMap) || !int.TryParse((expectedPos ?? string.Empty).Trim(), out var pos))
        {
            return new NativeReadbackDecision
            {
                Enabled = false,
                Reason =
                    $"{ConnectionStringVariable} is set but the native table context is not: both {MapVariable} and "
                    + $"{PosVariable} must be configured for this venue. The map and POS observed on one installation "
                    + "are evidence, not defaults. Keeping the fail-closed stand-ins.",
            };
        }

        var captured = connectionString!;
        var intentNote = DeclaresReadOnlyApplicationIntent(captured)
            ? "The connection string declares ApplicationIntent=ReadOnly."
            : "The connection string does not declare ApplicationIntent=ReadOnly; set it where the provider and "
              + "topology support it.";

        return new NativeReadbackDecision
        {
            Enabled = true,
            TableContext = new NativeTableContext { ExpectedMap = expectedMap!.Trim(), ExpectedPos = pos },
            ConnectionFactory = () =>
            {
                var connection = factory.CreateConnection()
                    ?? throw new InvalidOperationException($"Provider '{provider}' returned no connection.");
                connection.ConnectionString = captured;
                return connection;
            },
            Reason =
                $"native POSServer readback enabled via provider '{provider}', map {expectedMap!.Trim()}, POS {pos}. "
                + $"{intentNote} {EnforcedReadOnlyProperties} {OperationalPrivilegeRequirement}",
        };
    }
}
