namespace VerduraIdealposTracer.Core.Terminal;

/// <summary>
/// How a binding identifies its control. The original selector model
/// (<see cref="TerminalUiSelectors"/>) assumed UI Automation ids throughout,
/// which was right for a WinForms target and is wrong for the real one:
/// static analysis on 2026-09-02 established that the Idealpos POS terminal
/// is <c>IPS.exe</c>, a NATIVE VB6 binary (no CLR directory in its PE
/// header), not the managed <c>IPSClient.exe</c> — which turned out to be
/// the data-replication client and contains no sale, table, tender or
/// kitchen UI at all.
///
/// VB6 exposes a sparse UIA tree, so <see cref="Win32Control"/> (window
/// class + control id) and <see cref="Msaa"/> are the primary mechanisms
/// here and <see cref="Uia"/> is the fallback — the inverse of the original
/// assumption.
/// </summary>
public enum BindingMechanism
{
    /// <summary>Unset. Never valid for execution.</summary>
    None = 0,

    /// <summary>UI Automation element identity (AutomationId / ControlType).</summary>
    Uia,

    /// <summary>Win32 window class + control id, via EnumChildWindows. Primary for VB6.</summary>
    Win32Control,

    /// <summary>MSAA/IAccessible identity, for controls that expose neither of the above.</summary>
    Msaa,

    /// <summary>A menu command id, invoked as a menu selection rather than a click.</summary>
    MenuCommand,

    /// <summary>A keyboard accelerator published by the application itself.</summary>
    Accelerator,

    /// <summary>
    /// Synthesised input at a verified location. The mechanism of last
    /// resort, and the only one that can act on a control it cannot name.
    /// </summary>
    GuardedInput,
}

/// <summary>
/// How well a binding is actually known — the difference between "we read
/// this name out of a binary" and "we saw this control in the live tree".
/// Ordered: a later value is strictly stronger evidence than an earlier one.
/// </summary>
public enum EvidenceLevel
{
    /// <summary>No evidence. The default, so an unpopulated binding is never usable.</summary>
    Unknown = 0,

    /// <summary>Some fields known, identity not sufficient to bind uniquely.</summary>
    Partial,

    /// <summary>
    /// Read from the vendor binary (control name, menu name, form name).
    /// Real evidence, but it does NOT establish that the control exists on
    /// the screen the driver will face, nor its runtime class or id.
    /// </summary>
    ProvenStatic,

    /// <summary>Matched against a live captured control tree on this installation.</summary>
    ProvenRuntime,
}

/// <summary>
/// One evidence-graded way to find one control on one screen.
///
/// Every identity field is nullable because different mechanisms need
/// different subsets, and a field that was never discovered must read as
/// absent rather than as an empty-string "match anything". Readiness is
/// decided by <see cref="TerminalBindingReadiness"/>, never by the presence
/// of a value alone.
/// </summary>
public sealed record TerminalActionBinding
{
    public required string Action { get; init; }
    public BindingMechanism Mechanism { get; init; } = BindingMechanism.None;
    public EvidenceLevel EvidenceLevel { get; init; } = EvidenceLevel.Unknown;

    // ── Host identity ──
    public string? ProcessName { get; init; }
    public string? WindowTitle { get; init; }

    /// <summary>The VB6 form this control lives on, e.g. <c>frmSale</c>.</summary>
    public string? FormType { get; init; }

    // ── Control identity, by mechanism ──
    public string? AutomationId { get; init; }
    public string? ControlName { get; init; }
    public string? WindowClass { get; init; }
    public int? ControlId { get; init; }
    public string? AccessibleName { get; init; }
    public int? MenuCommandId { get; init; }
    public string? Accelerator { get; init; }

    /// <summary>
    /// Last-resort location, and only ever meaningful RELATIVE to a
    /// runtime-verified parent — never absolute screen coordinates.
    /// </summary>
    public BindingGeometry? Geometry { get; init; }

    /// <summary>The container this binding is resolved within, if any.</summary>
    public TerminalActionBinding? ParentBinding { get; init; }

    /// <summary>Free-text note on where the evidence came from.</summary>
    public string? EvidenceNote { get; init; }
}

/// <summary>
/// A rectangle relative to a parent control's client area. Deliberately not
/// screen coordinates: a blind absolute point is the failure mode this whole
/// model exists to prevent.
/// </summary>
public sealed record BindingGeometry
{
    public required int RelativeX { get; init; }
    public required int RelativeY { get; init; }
    public required int Width { get; init; }
    public required int Height { get; init; }
}

/// <summary>
/// The fail-closed gate for bindings, mirroring
/// <see cref="TerminalSelectorReadiness"/>'s role for the older selector
/// model: one pure, cross-platform-testable place where "may this binding
/// drive a live action?" is decided, so the rule is exercised by unit tests
/// rather than asserted to hold on a machine nobody runs tests on.
/// </summary>
public static class TerminalBindingReadiness
{
    /// <summary>
    /// Controls the driver must never bind to under any evidence level.
    /// These take payment, tender, or destroy sale lines. Nothing in the
    /// Verdura round contract — select a table, enter a code and quantity,
    /// save the round — needs any of them, so binding one at all indicates
    /// a mis-derived binding rather than a feature. Matched
    /// case-insensitively as a whole control name.
    ///
    /// Names are real, read out of IPS.exe on 2026-09-02.
    /// </summary>
    private static readonly HashSet<string> ForbiddenControls = new(StringComparer.OrdinalIgnoreCase)
    {
        "cmdPay", "cmdPayAll", "cmdPayLine", "cmdPayment", "cmdGotoTender", "cmdTender",
        "cmdCashDecs", "cmdDelete", "cmdDeleteLine", "cmdDeleteText", "cmdVoid", "cmdRefund",
    };

    /// <summary>True if this binding names a payment/tender/destructive control.</summary>
    public static bool IsForbiddenControl(TerminalActionBinding binding) =>
        binding?.ControlName is { } name && ForbiddenControls.Contains(name);

    /// <summary>
    /// Whether a binding may drive a MUTATING live action (anything that
    /// changes Idealpos state: opening a table, entering a code, saving a
    /// round).
    ///
    /// The bar is deliberately higher than for a read: static evidence
    /// names a control, it does not prove the control is on the screen the
    /// driver is looking at, nor what its runtime class or id is. Acting on
    /// a name that was never matched against a live tree is precisely how a
    /// driver clicks the wrong button.
    /// </summary>
    public static bool CanDriveMutatingAction(TerminalActionBinding? binding, out string reason)
    {
        if (binding is null)
        {
            reason = "no binding supplied";
            return false;
        }

        if (IsForbiddenControl(binding))
        {
            reason = $"control '{binding.ControlName}' is a payment/tender/destructive control and is permanently forbidden";
            return false;
        }

        if (binding.Mechanism == BindingMechanism.None)
        {
            reason = $"action '{binding.Action}' has no binding mechanism";
            return false;
        }

        if (binding.EvidenceLevel != EvidenceLevel.ProvenRuntime)
        {
            reason = $"action '{binding.Action}' is {binding.EvidenceLevel}, and a mutating action requires {nameof(EvidenceLevel.ProvenRuntime)}";
            return false;
        }

        if (!HasIdentityFor(binding, out var missing))
        {
            reason = $"action '{binding.Action}' uses {binding.Mechanism} but is missing {missing}";
            return false;
        }

        // Synthesised input can act on a control it cannot name, so it
        // carries the extra requirement of a verified container and a
        // relative target — never a bare screen point.
        if (binding.Mechanism == BindingMechanism.GuardedInput)
        {
            if (binding.Geometry is null)
            {
                reason = $"action '{binding.Action}' uses GuardedInput without geometry";
                return false;
            }
            if (binding.ParentBinding is null)
            {
                reason = $"action '{binding.Action}' uses GuardedInput without a parent binding to resolve its geometry against";
                return false;
            }
            if (binding.ParentBinding.EvidenceLevel != EvidenceLevel.ProvenRuntime)
            {
                reason = $"action '{binding.Action}' uses GuardedInput whose parent is only {binding.ParentBinding.EvidenceLevel}";
                return false;
            }
        }

        reason = "binding is runtime-proven and carries identity for its mechanism";
        return true;
    }

    /// <summary>
    /// Whether a binding may be used for a READ-ONLY probe (locating a
    /// control, reading an observed price, reading existing sale lines).
    /// Static evidence is enough to go looking for something; it is not
    /// enough to act on what is found.
    /// </summary>
    public static bool CanProbe(TerminalActionBinding? binding, out string reason)
    {
        if (binding is null)
        {
            reason = "no binding supplied";
            return false;
        }
        if (IsForbiddenControl(binding))
        {
            reason = $"control '{binding.ControlName}' is forbidden even for probing";
            return false;
        }
        if (binding.Mechanism == BindingMechanism.None)
        {
            reason = $"action '{binding.Action}' has no binding mechanism";
            return false;
        }
        if (binding.EvidenceLevel < EvidenceLevel.ProvenStatic)
        {
            reason = $"action '{binding.Action}' is {binding.EvidenceLevel}, below the {nameof(EvidenceLevel.ProvenStatic)} minimum for a probe";
            return false;
        }

        // A probe deliberately does NOT require the identity its mechanism
        // will eventually need. Static analysis yields a control NAME and a
        // FORM, never a runtime window class or control id — those are what
        // the probe exists to discover. Requiring them here would make the
        // catalogue unusable for the one job it has.
        if (!HasAnyIdentity(binding))
        {
            reason = $"action '{binding.Action}' carries no identity of any kind to search by";
            return false;
        }

        reason = "binding carries at least one identity field to search by";
        return true;
    }

    /// <summary>
    /// Any field that could be used to go LOOKING for a control. A form name
    /// alone is enough — "walk frmSale and report what is there" is a valid
    /// probe, and is exactly how a static name graduates to runtime-proven.
    /// </summary>
    private static bool HasAnyIdentity(TerminalActionBinding binding) =>
        !string.IsNullOrWhiteSpace(binding.AutomationId)
        || !string.IsNullOrWhiteSpace(binding.ControlName)
        || !string.IsNullOrWhiteSpace(binding.WindowClass)
        || binding.ControlId is not null
        || !string.IsNullOrWhiteSpace(binding.AccessibleName)
        || binding.MenuCommandId is not null
        || !string.IsNullOrWhiteSpace(binding.Accelerator)
        || !string.IsNullOrWhiteSpace(binding.FormType);

    /// <summary>
    /// Whether the binding carries the identity fields its own mechanism
    /// needs. A binding that names a mechanism it cannot satisfy is a
    /// configuration error, not a near-miss.
    /// </summary>
    private static bool HasIdentityFor(TerminalActionBinding binding, out string missing)
    {
        switch (binding.Mechanism)
        {
            case BindingMechanism.Uia when string.IsNullOrWhiteSpace(binding.AutomationId):
                missing = nameof(TerminalActionBinding.AutomationId);
                return false;
            case BindingMechanism.Win32Control when binding.ControlId is null && string.IsNullOrWhiteSpace(binding.WindowClass):
                missing = $"{nameof(TerminalActionBinding.ControlId)} or {nameof(TerminalActionBinding.WindowClass)}";
                return false;
            case BindingMechanism.Msaa when string.IsNullOrWhiteSpace(binding.AccessibleName):
                missing = nameof(TerminalActionBinding.AccessibleName);
                return false;
            case BindingMechanism.MenuCommand when binding.MenuCommandId is null:
                missing = nameof(TerminalActionBinding.MenuCommandId);
                return false;
            case BindingMechanism.Accelerator when string.IsNullOrWhiteSpace(binding.Accelerator):
                missing = nameof(TerminalActionBinding.Accelerator);
                return false;
            default:
                missing = string.Empty;
                return true;
        }
    }
}
