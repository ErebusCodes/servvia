namespace VerduraIdealposTracer.Core.Printing;

/// <summary>
/// E8-S1 (expanded, KOT dispatch producer) — the connector-side result
/// vocabulary. Must stay byte-identical to the string constants in
/// backend/src/printer/printer-connector-command.constants.ts
/// (KOT_RESULT_TYPE) — the cloud reconciler switches on these exact
/// strings to decide bounded-retry vs. manual-only vs. terminal. There is
/// deliberately no shared package between the two runtimes (NestJS/
/// TypeScript vs. .NET); the contract is the wire string, matching the
/// existing ConnectorCommand protocol's own convention (commandType is
/// also just an agreed string, not a shared enum type).
/// </summary>
public static class KotPrintResultType
{
    public const string ExecutedAcknowledged = "executed_acknowledged";
    public const string RetryableLocalFailure = "retryable_local_failure";
    public const string Unsupported = "unsupported";
    public const string UnsupportedVersion = "unsupported_version";
    public const string ChecksumMismatch = "checksum_mismatch";
    public const string MalformedPayload = "malformed_payload";
    public const string UncertainLocalResult = "uncertain_local_result";
    public const string Cancelled = "cancelled";
}
