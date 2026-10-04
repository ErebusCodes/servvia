using VerduraIdealposTracer.Core.Discovery;
using Xunit;

namespace VerduraIdealposTracer.Tests;

/// <summary>
/// Inventories always come from Windows, but the analyser also runs (in CI and
/// in offline analysis) on non-Windows hosts. The owner's executable file name
/// must therefore be derived from a Windows path the same way on every host.
///
/// The existing contradiction test only checks that the verdict CONTAINS
/// "IPSClient.exe", which the full path also satisfies; this test pins the
/// candidate's file name itself.
///
/// UNIT_OR_MOCK evidence: a synthetic inventory, not a real capture.
/// </summary>
public sealed class NativeTerminalBindingEvidencePortabilityTests
{
    [Fact]
    public void WhenADifferentExecutableOwnsTheNativeUi_TheOwnerIsNamedByItsFileNameOnEveryHost()
    {
        const string ownerPath = @"C:\Idealpos Solutions\Idealpos 8\IPSClient.exe";

        var report = NativeTerminalBindingEvidence.Summarize(
            new[]
            {
                Window("0x1", ownerPath, 200, "POS Screen"),
                Window("0x2", ownerPath, 200, "Table Map"),
            },
            "IPS.exe");

        var candidate = Assert.Single(report.Candidates);
        Assert.Equal("IPSClient.exe", candidate.ExecutableFileName);
        Assert.Equal(ownerPath, candidate.ExecutablePath);
        Assert.Equal(2, candidate.WindowCount);
        Assert.True(report.ContradictsExpectedExecutable);
        Assert.StartsWith("CONTRADICTION", report.Verdict);
        Assert.Contains("IPSClient.exe (2 window(s)", report.Verdict);
        Assert.DoesNotContain(ownerPath, report.Verdict);
    }

    [Fact]
    public void WhenTheOwnerPathIsABareFileName_TheFileNameIsThePathItself()
    {
        var report = NativeTerminalBindingEvidence.Summarize(
            new[] { Window("0x1", "IPS.exe", 100, "POS Screen") },
            "IPS.exe");

        var candidate = Assert.Single(report.Candidates);
        Assert.Equal("IPS.exe", candidate.ExecutableFileName);
        Assert.Equal("IPS.exe", candidate.ExecutablePath);
        Assert.True(report.ExpectedExecutableIsPresent);
        Assert.StartsWith("CONSISTENT", report.Verdict);
    }

    private static TopLevelWindowInfo Window(string handle, string exePath, int pid, string title) => new()
    {
        Handle = handle,
        Title = title,
        ClassName = "ThunderRT6FormDC",
        Visible = true,
        ProcessName = "IPSClient",
        ProcessId = pid,
        ExecutablePath = exePath,
        SessionId = 1,
    };
}
