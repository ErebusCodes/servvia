namespace VerduraIdealposTracer.Core.Discovery;

/// <summary>
/// Shared vocabulary for every independent result dimension this tracer
/// tracks. The SAME enum is reused across dimensions deliberately, so no
/// dimension can express "success" using a different word than another
/// (see Story 9-2's Required State and Result Separation section) — but
/// each dimension's field is always populated (or left at
/// <see cref="NotAttempted"/>) independently; nothing here implies any
/// other dimension's state.
/// </summary>
public enum TracerOutcomeState
{
    /// <summary>This dimension was never attempted in this run.</summary>
    NotAttempted,

    /// <summary>A presence/liveness fact was positively observed (e.g. the Idealpos process exists).</summary>
    Detected,

    /// <summary>The observed state was checked against a verified profile and matched.</summary>
    Matched,

    /// <summary>An action toward this dimension was started but its outcome is not yet known.</summary>
    Attempted,

    /// <summary>Truthfully confirmed via authoritative evidence — never inferred from a lack of error.</summary>
    Confirmed,

    /// <summary>Refused/stopped deliberately — a mismatch, missing permission, or unsafe state was detected before proceeding.</summary>
    FailedClosed,

    /// <summary>The outcome cannot be determined safely — never auto-retried; requires reconciliation.</summary>
    Uncertain,
}

/// <summary>EFTPOS has its own vocabulary — this story never initiates EFTPOS, so this exists only so the field can be explicitly present and explicitly unused.</summary>
public enum EftposResultState
{
    NotAttempted,
    Initiated,
    Authorised,
    Declined,
    Unknown,
}

/// <summary>KOT/printer has its own vocabulary for the same reason.</summary>
public enum KotResultState
{
    NotAttempted,
    Accepted,
    Printed,
    Unknown,
}
