using VerduraIdealposTracer.Core.Discovery;
using Xunit;

namespace VerduraIdealposTracer.Tests;

/// <summary>
/// The Front-desk capture exists to settle ONE question before any selector
/// work happens: which executable actually owns the visible native IdealPOS
/// terminal UI?
///
/// The failure mode these tests exist to prevent is subtle and one-directional:
/// a capture that only ever looks at processes named IPS/IPSClient cannot
/// report "something else owns it" — it reports "nothing found", which reads
/// as "IdealPOS was not running" and quietly re-confirms the assumption it was
/// supposed to test. So the analysis must be able to say CONTRADICTION out
/// loud, and must never turn an absence of evidence into a confirmation.
///
/// UNIT_OR_MOCK evidence: these are synthetic inventories, not a real capture.
/// </summary>
public sealed class NativeTerminalBindingEvidenceTests
{
    private static TopLevelWindowInfo Window(
        string handle,
        string? className,
        string? exePath,
        int pid,
        int? session = 1,
        bool visible = true,
        string? title = "POS Screen") => new()
    {
        Handle = handle,
        Title = title,
        ClassName = className,
        Visible = visible,
        ProcessName = exePath is null ? null : Path.GetFileNameWithoutExtension(exePath),
        ProcessId = pid,
        ExecutablePath = exePath,
        SessionId = session,
    };

    [Fact]
    public void WhenTheExpectedExecutableOwnsTheVb6Windows_TheEvidenceIsConsistent()
    {
        var report = NativeTerminalBindingEvidence.Summarize(
            new[]
            {
                Window("0x1", "ThunderRT6FormDC", @"C:\Program Files\Idealpos\IPS.exe", 100),
                Window("0x2", "ThunderRT6FormDC", @"C:\Program Files\Idealpos\IPS.exe", 100, title: "Table Map"),
            },
            "IPS.exe");

        Assert.True(report.ExpectedExecutableIsPresent);
        Assert.False(report.ContradictsExpectedExecutable);
        Assert.StartsWith("CONSISTENT", report.Verdict);
        var candidate = Assert.Single(report.Candidates);
        Assert.Equal("IPS.exe", candidate.ExecutableFileName);
        Assert.Equal(2, candidate.WindowCount);
    }

    [Fact]
    public void WhenADifferentExecutableOwnsTheNativeUi_TheContradictionIsStatedOutLoud()
    {
        // This is the case the whole type exists for: the native terminal is
        // right there on screen, and IPS.exe is not the thing drawing it.
        var report = NativeTerminalBindingEvidence.Summarize(
            new[]
            {
                Window("0x1", "ThunderRT6FormDC", @"C:\Idealpos Solutions\Idealpos 8\IPSClient.exe", 200),
                Window("0x2", "ThunderRT6FormDC", @"C:\Idealpos Solutions\Idealpos 8\IPSClient.exe", 200, title: "Table Map"),
            },
            "IPS.exe");

        Assert.False(report.ExpectedExecutableIsPresent);
        Assert.True(report.ContradictsExpectedExecutable);
        Assert.StartsWith("CONTRADICTION", report.Verdict);
        Assert.Contains("IPSClient.exe", report.Verdict);
        Assert.Contains("must be re-decided", report.Verdict);
    }

    [Fact]
    public void AnEmptyInventory_IsAnAbsenceOfEvidence_NeverAContradiction()
    {
        var report = NativeTerminalBindingEvidence.Summarize(Array.Empty<TopLevelWindowInfo>(), "IPS.exe");

        Assert.False(report.ContradictsExpectedExecutable);
        Assert.False(report.ExpectedExecutableIsPresent);
        Assert.StartsWith("NO EVIDENCE", report.Verdict);
    }

    [Fact]
    public void Vb6WindowsWhoseExecutableCannotBeRead_AreReportedAsInconclusive_NotAsAbsent()
    {
        var report = NativeTerminalBindingEvidence.Summarize(
            new[] { Window("0x1", "ThunderRT6FormDC", exePath: null, pid: 300) },
            "IPS.exe");

        Assert.Equal(1, report.WindowsWithUnreadableExecutable);
        Assert.False(report.ContradictsExpectedExecutable);
        Assert.StartsWith("NO EVIDENCE", report.Verdict);
        Assert.Contains("inconclusive", report.Verdict, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void InvisibleWindows_AreIgnored_BecauseTheyOwnNoVisibleNativeUi()
    {
        var report = NativeTerminalBindingEvidence.Summarize(
            new[] { Window("0x1", "ThunderRT6FormDC", @"C:\x\IPS.exe", 100, visible: false) },
            "IPS.exe");

        Assert.Empty(report.Candidates);
        Assert.False(report.ExpectedExecutableIsPresent);
    }

    [Fact]
    public void NonVb6Windows_AreNotCountedAsNativeTerminalOwners()
    {
        var report = NativeTerminalBindingEvidence.Summarize(
            new[]
            {
                Window("0x1", "Chrome_WidgetWin_1", @"C:\x\chrome.exe", 400, title: "a browser"),
                Window("0x2", "ThunderRT6FormDC", @"C:\x\IPS.exe", 100),
            },
            "IPS.exe");

        var candidate = Assert.Single(report.Candidates);
        Assert.Equal("IPS.exe", candidate.ExecutableFileName);
    }

    [Fact]
    public void MultipleOwners_AreAllReported_MostWindowsFirst()
    {
        var report = NativeTerminalBindingEvidence.Summarize(
            new[]
            {
                Window("0x1", "ThunderRT6FormDC", @"C:\x\Other.exe", 500),
                Window("0x2", "ThunderRT6FormDC", @"C:\x\IPS.exe", 100),
                Window("0x3", "ThunderRT6FormDC", @"C:\x\IPS.exe", 100),
            },
            "IPS.exe");

        Assert.Equal(2, report.Candidates.Count);
        Assert.Equal("IPS.exe", report.Candidates[0].ExecutableFileName); // 2 windows, listed first
        Assert.True(report.ExpectedExecutableIsPresent);
        Assert.False(report.ContradictsExpectedExecutable); // expected IS present, even alongside another owner
    }

    [Fact]
    public void CandidatesSpanningMoreThanOneSession_AreFlagged()
    {
        var report = NativeTerminalBindingEvidence.Summarize(
            new[]
            {
                Window("0x1", "ThunderRT6FormDC", @"C:\x\IPS.exe", 100, session: 1),
                Window("0x2", "ThunderRT6FormDC", @"C:\x\Other.exe", 500, session: 2),
            },
            "IPS.exe");

        Assert.Equal(new[] { 1, 2 }, report.ObservedSessionIds);
        Assert.Contains("more than one session", report.Verdict);
    }

    [Fact]
    public void TheEvidenceCarriesTheFullBindingChain_HandleToPidToExecutableToSessionToClassAndTitle()
    {
        // The Front-desk capture must establish exactly this chain. If any
        // link stops being recorded, this test is what notices.
        var report = NativeTerminalBindingEvidence.Summarize(
            new[] { Window("0xABCD", "ThunderRT6FormDC", @"C:\x\IPS.exe", 4242, session: 1, title: "Table Map") },
            "IPS.exe");

        var candidate = Assert.Single(report.Candidates);
        Assert.Equal(@"C:\x\IPS.exe", candidate.ExecutablePath);   // executable
        Assert.Equal(new[] { 4242 }, candidate.ProcessIds);        // PID
        Assert.Equal(new[] { 1 }, candidate.SessionIds);           // session
        var description = Assert.Single(candidate.WindowDescriptions);
        Assert.Contains("0xABCD", description);                    // HWND
        Assert.Contains("ThunderRT6FormDC", description);          // class
        Assert.Contains("Table Map", description);                 // title
    }

    [Fact]
    public void TheAnalyserPopulatesNoSelectorAndChoosesNoWindow()
    {
        // A guard against this type quietly growing into a binder. It returns
        // a report; it must never return something a driver could act on.
        var properties = typeof(NativeTerminalBindingReport).GetProperties().Select(p => p.Name).ToArray();
        Assert.DoesNotContain(properties, n => n.Contains("Selector", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(properties, n => n.Contains("Bind", StringComparison.OrdinalIgnoreCase)
            && !n.Contains("Binding", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(properties, n => n.Equals("ChosenWindow", StringComparison.OrdinalIgnoreCase));
    }
}
