using System.Data.Common;

namespace VerduraIdealposTracer.Core.Terminal.PosServer;

/// <summary>What the composition root should construct for the causal token read, and why.</summary>
public sealed record HandheldTokenDecision
{
    /// <summary>True when a real token reader may be constructed.</summary>
    public required bool Enabled { get; init; }

    /// <summary>The connection factory to use when <see cref="Enabled"/>. Null otherwise.</summary>
    public Func<DbConnection>? ConnectionFactory { get; init; }

    /// <summary>Always populated — the operator-facing explanation, logged either way.</summary>
    public required string Reason { get; init; }

    /// <summary>
    /// The reader to bind, whatever the decision. Never null, and never a real
    /// reader when <see cref="Enabled"/> is false: an unconfigured build binds
    /// one that answers Unavailable with this reason attached.
    /// </summary>
    public IHandheldTokenReader CreateReader() =>
        Enabled && ConnectionFactory is not null
            ? new HandheldTokenReader(ConnectionFactory)
            : new UnconfiguredHandheldTokenReader(Reason);
}

/// <summary>
/// Decides whether the causal token read may be wired, from configuration
/// alone. Pure apart from the factory resolver it is handed, so every branch is
/// testable without a database or a provider.
///
/// SAME SHAPE AS <see cref="NativeReadbackGate"/>, AND FOR THE SAME REASON. The
/// connector has never carried a connection string for this store. Inventing
/// one — or quietly reusing the POSServer connection because the ingress
/// capture makes it look likely — would be exactly the "assume the current
/// production permissions" mistake this work exists to avoid. The default is
/// OFF, the variable is unset in production, and turning it on is a deliberate
/// act by someone who has created a least-privilege login.
///
/// WHY IT IS A SEPARATE VARIABLE FROM THE READBACK'S. The two reads may not
/// live in the same database. The ingress capture shows the
/// <c>AAAExampleData</c> update alongside POSServer statements, which is
/// suggestive and is not proof, and the whole point of this gate is that a
/// suggestion never becomes a default. An operator who has confirmed they are
/// the same database can set both variables to the same value in one line; an
/// operator who has not is not silently committed to a guess.
///
/// EVERY FAILURE KEEPS THE STAND-IN. A missing variable, an unregistered
/// provider, a malformed connection string — none of them throws, and none
/// half-enables anything. They return Disabled with a reason, the composition
/// root logs it, and <see cref="UnconfiguredHandheldTokenReader"/> stays bound
/// so the predicate receives ignorance rather than a fabricated absence.
/// </summary>
public static class HandheldTokenGate
{
    /// <summary>
    /// Connection string for the database holding <c>AAAExampleData</c>. Unset
    /// in production today, and deliberately NOT defaulted to the POSServer
    /// connection string.
    /// </summary>
    public const string ConnectionStringVariable = "IDEALPOS_HANDHELD_TOKEN_CONNECTION_STRING";

    /// <summary>ADO.NET provider invariant name. Defaults to the SQL Server client.</summary>
    public const string ProviderVariable = "IDEALPOS_HANDHELD_TOKEN_PROVIDER";

    public const string DefaultProviderInvariantName = "Microsoft.Data.SqlClient";

    /// <summary>
    /// The read-only properties this codebase actually GUARANTEES for the token
    /// reader. Structural facts about the code, asserted by test.
    /// </summary>
    public const string EnforcedReadOnlyProperties =
        "Enforced in code: the connection string must be explicitly configured (never defaulted or inferred from the "
        + "POSServer connection); a provider must be registered; the reader issues exactly one SELECT held in a "
        + "constant, selecting one column, with no ExecuteNonQuery/ExecuteScalar/BeginTransaction call and no "
        + "dynamically built SQL.";

    /// <summary>
    /// The privilege requirement this codebase CANNOT check, stated separately
    /// so it is never mistaken for something the connector enforces.
    /// </summary>
    public const string OperationalPrivilegeRequirement =
        "NOT enforced by this connector, and not enforceable from it — required operationally: the SQL login must "
        + "hold only read access (e.g. db_datareader) on the database holding AAAExampleData and must lack write and "
        + "administrative rights. Do not use the machine account or a sysadmin login.";

    /// <summary>
    /// The one thing an operator must verify before trusting this reader, and
    /// which no amount of code can establish for them.
    /// </summary>
    public const string UnprovenDatabaseLocation =
        "WHICH DATABASE HOLDS AAAExampleData IS INFERENCE, NOT PROOF. The 2026-09-05 ingress capture shows the "
        + "receiver updating it in the same flow as PendingSaleLines, PendingSales and POSServerMessages, which are "
        + "POSServer tables — suggestive, not conclusive. Point this variable at the database an operator has "
        + "CONFIRMED holds the table. A wrong database yields Unavailable on every read, which costs confirmations "
        + "and cannot cost correctness.";

    public static NativeReadbackDecisionKind Kind => NativeReadbackDecisionKind.HandheldToken;

    /// <summary>Decides from raw configuration values.</summary>
    /// <param name="connectionString">The value of <see cref="ConnectionStringVariable"/>, or null/blank when unset.</param>
    /// <param name="providerInvariantName">The value of <see cref="ProviderVariable"/>, or null/blank for the default.</param>
    /// <param name="resolveFactory">
    /// Resolves an ADO.NET provider factory by invariant name — normally
    /// <c>DbProviderFactories.GetFactory</c>. Injected so the gate can be
    /// tested without any provider package being present.
    /// </param>
    public static HandheldTokenDecision Decide(
        string? connectionString,
        string? providerInvariantName,
        Func<string, DbProviderFactory?> resolveFactory)
    {
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            return new HandheldTokenDecision
            {
                Enabled = false,
                Reason =
                    $"{ConnectionStringVariable} is not set, so the causal token read stays disabled. Without it no "
                    + "round can ever be machine-confirmed: content agreement alone is correlation, and a waiter "
                    + "keying the same items produces identical evidence. Rounds will escalate to a human instead.",
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
            return new HandheldTokenDecision
            {
                Enabled = false,
                Reason =
                    $"{ConnectionStringVariable} is set but the ADO.NET provider '{provider}' could not be resolved "
                    + $"({ex.GetType().Name}: {ex.Message}). Keeping the unconfigured reader, which answers "
                    + "Unavailable rather than reporting an absent token.",
            };
        }

        if (factory is null)
        {
            return new HandheldTokenDecision
            {
                Enabled = false,
                Reason =
                    $"{ConnectionStringVariable} is set but no ADO.NET provider is registered under '{provider}'. Add "
                    + "a SQL client package and register it with DbProviderFactories.RegisterFactory before enabling "
                    + "the causal token read. Keeping the unconfigured reader.",
            };
        }

        var captured = connectionString!;
        var intentNote = NativeReadbackGate.DeclaresReadOnlyApplicationIntent(captured)
            ? "The connection string declares ApplicationIntent=ReadOnly."
            : "The connection string does not declare ApplicationIntent=ReadOnly; set it where the provider and "
              + "topology support it.";

        return new HandheldTokenDecision
        {
            Enabled = true,
            ConnectionFactory = () =>
            {
                var connection = factory.CreateConnection()
                    ?? throw new InvalidOperationException($"Provider '{provider}' returned no connection.");
                connection.ConnectionString = captured;
                return connection;
            },
            Reason =
                $"causal handheld-token read enabled via provider '{provider}'. {intentNote} "
                + $"{EnforcedReadOnlyProperties} {OperationalPrivilegeRequirement} {UnprovenDatabaseLocation}",
        };
    }
}

/// <summary>Which gate a decision came from. Used only in operator-facing logging.</summary>
public enum NativeReadbackDecisionKind
{
    PosServerTableState,
    HandheldToken,
}
