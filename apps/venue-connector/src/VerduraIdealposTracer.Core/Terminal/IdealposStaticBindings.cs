namespace VerduraIdealposTracer.Core.Terminal;

/// <summary>
/// The static binding catalogue derived on 2026-09-02 by read-only string
/// and resource analysis of <c>IPS.exe</c> (40,143,120 bytes, native VB6 —
/// its PE header carries no CLR directory). The vendor binary was never
/// modified, patched, or executed to produce any of this.
///
/// WHY THIS FILE EXISTS AT ALL, AND WHY IT IS NOT SELECTORS
/// -------------------------------------------------------
/// The tracer previously targeted <c>IPSClient.exe</c>. Decompiling it
/// (ilspycmd) showed 95 classes and ~40 Forms, every one of them data
/// replication or housekeeping — OverwriteInProgress2Form,
/// OverwriteTransferring, SavedPacketListViewForm, ListenForHibernationForm
/// — which map 1:1 onto the window titles the live captures kept returning.
/// Its term counts settle it: Tender 0, Kitchen 0, Quantity 0, Receipt 0;
/// its 164 "Table" hits are TableLayoutPanel and colTable (database tables
/// being replicated), and its single "PLU" hit is the Xceed grid property
/// ShowPlusMinus. IPSClient is the sync client. It has no POS UI.
///
/// IPS.exe, by contrast, carries the vocabulary: "Table Map" x8, Tender x93,
/// Quantity x54, Kitchen x25, PLU x6, Recall x5.
///
/// EVERY binding below is <see cref="EvidenceLevel.ProvenStatic"/> — a real
/// name read out of the vendor binary, and nothing more. Static evidence
/// does NOT establish that a control is present on the screen the driver
/// will face, nor its runtime window class or control id. That is precisely
/// why <see cref="TerminalBindingReadiness.CanDriveMutatingAction"/> refuses
/// everything here: this catalogue is a map for the next passive capture to
/// confirm, not a licence to act. Bindings graduate to
/// <see cref="EvidenceLevel.ProvenRuntime"/> only by matching a live tree.
/// </summary>
public static class IdealposStaticBindings
{
    /// <summary>The real POS terminal process. NOT IPSClient.</summary>
    public const string PosProcessName = "IPS";

    /// <summary>VB6 form names read from IPS.exe.</summary>
    public const string SaleScreenForm = "frmSale";
    public const string TableMapForm = "frmTables";
    public const string TableDetailsForm = "frmTableDetails";
    public const string TableSummaryForm = "frmTableSummary";
    public const string TouchScreenForm = "frmTouchScreen";
    public const string TouchScreenGridForm = "frmTouchscreenGrid";

    private static TerminalActionBinding Static(string action, string form, string? control, string note) => new()
    {
        Action = action,
        // Native VB6 exposes a sparse UIA tree, so control identity is
        // expected to resolve as a Win32 child window (class + id). The
        // runtime capture supplies both; neither is guessed here.
        Mechanism = BindingMechanism.Win32Control,
        EvidenceLevel = EvidenceLevel.ProvenStatic,
        ProcessName = PosProcessName,
        FormType = form,
        ControlName = control,
        EvidenceNote = note,
    };

    /// <summary>
    /// Actions the Verdura round contract needs, each mapped to the control
    /// name IPS.exe actually publishes. Deliberately does NOT include any
    /// payment, tender, or line-deletion control — see
    /// <see cref="TerminalBindingReadiness"/>'s forbidden list, which holds
    /// the real names (cmdPay, cmdPayAll, cmdGotoTender, cmdTender,
    /// cmdDeleteLine, ...) so that a mis-derived binding to one is rejected
    /// rather than merely absent here.
    /// </summary>
    public static IReadOnlyList<TerminalActionBinding> All { get; } = new[]
    {
        Static("NavigateToTableMap", TableMapForm, null,
            "Strings 'Loading Table Map...', 'Return to Table Map without paying'; form frmTables. Control name not yet isolated."),

        Static("OpenRequestedTable", TableMapForm, null,
            "Table cells are drawn from the configurable table map (frmFileTableMaps); per-cell identity must come from the runtime tree, never a guessed template."),

        Static("ReadExistingSaleLines", SaleScreenForm, null,
            "frmSale is the sale screen; the line grid control is not isolated statically (38 grd* controls exist across all forms)."),

        Static("EnterNativeCode", SaleScreenForm, null,
            "Strings 'PLU Code', 'PLU CODE', 'Plu Code'; entry control not isolated statically."),

        Static("EnterQuantity", SaleScreenForm, "cmdPopulateQuantity",
            "Strings 'Enter Quantity', 'A valid quantity is required.', 'Invalid Quantity!'; control cmdPopulateQuantity present."),

        Static("SendRound", SaleScreenForm, "cmdSave",
            "cmdSave/cmdSave_Click present; failure string 'Cannot Save to Table' confirms a save-to-table path exists and can refuse."),

        Static("ReopenExistingTable", SaleScreenForm, "cmdRecall",
            "cmdRecall/cmdRecall_Click; procedure trace '.RecallPendingSale on Line:'."),

        Static("ObserveKitchenPrint", SaleScreenForm, "cmdKitchen",
            "cmdKitchen/cmdKitchen_Click and cmdReprintKitchen. Bound for OBSERVATION only - the round must never invoke a reprint."),
    };

    /// <summary>
    /// Idealpos option names governing kitchen printing, read from IPS.exe.
    /// These matter to the "exactly one KOT per round" criterion and to
    /// discovery checklist item F (whether kitchen printing can be
    /// suppressed by scope). Recorded as names only — whether any is enabled
    /// for this venue is a live configuration question this file cannot
    /// answer.
    ///
    /// <c>IdealWebitAutoPrintKitchen</c> is the one to note for native/Webit
    /// mutual exclusion: it shows the Webit web-ordering path has its own
    /// kitchen auto-print trigger, independent of the native sale screen, so
    /// "exactly one KOT" has to be argued across BOTH paths, not just within
    /// the native one.
    /// </summary>
    public static IReadOnlyList<string> KitchenPrintOptionNames { get; } = new[]
    {
        "AutoKitchenPrint",
        "InhibitKitchenPrinting",
        "DontPrinttoKitchen",
        "DontSendRefundsToKitchen",
        "AccumulateItemsonKitchen",
        "DepartmentSalesNOTgotoKitchen",
        "COMPONENTSTOKITCHEN",
        "KITCHENSEPARATE",
        "IdealWebitAutoPrintKitchen",
    };

    /// <summary>
    /// Internal procedure names recovered from VB6 error-handler traces
    /// ("<c>.ProcName on Line:</c>"). Not callable and not bindable — they
    /// are corroborating evidence about how the application talks to
    /// POSServer, which is what reconciliation will have to reason about.
    ///
    /// <c>SendNewlinesToServer</c> is the notable one: it is direct evidence
    /// that IPS itself models a second round as sending only NEW lines,
    /// which is the behaviour the second-round acceptance criterion asserts.
    /// </summary>
    public static IReadOnlyList<string> PosServerProcedureNames { get; } = new[]
    {
        "SendNewlinesToServer",
        "SendTableDatatoServer",
        "SendODSTableStatus",
        "SendODSPacket",
        "SendCommand_SALE",
        "SendCommand_PAYMENT",
        "SendCommand_ADJUSTMENT",
        "RecallPendingSale",
    };

    /// <summary>
    /// Idealpos calls it a "Kitchen" print, never a "KOT" — the string KOT
    /// does not appear in IPS.exe at all. Recorded so nobody searches the
    /// binary, the database, or a report for the wrong word and concludes
    /// the feature is absent.
    /// </summary>
    public const string KitchenPrintVocabularyNote =
        "IPS.exe contains zero occurrences of 'KOT'; the vendor term is 'Kitchen' (Kitchen Printers, Reprint Kitchen, AutoKitchenPrint).";
}
