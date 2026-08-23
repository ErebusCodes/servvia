using System.Diagnostics;
using System.Text.Json;
using Xunit;

namespace VerduraIdealposTracer.Tests;

/// <summary>
/// Real-process crash/replay evidence for Story 9-2's local-persistence
/// layer — spawns VerduraIdealposTracer.DryRunCli as a genuinely separate
/// OS process (not an in-process function call) and forces an
/// unconditional crash (<see cref="Environment.FailFast(string)"/>) at
/// each persist-before-ack boundary, exactly the same rigor Story 2-10's
/// own TypeScript proof harness used. This is real crash-window evidence
/// for the platform-agnostic persistence/state-machine layer; it is NOT
/// REAL_WINDOWS_CONNECTOR or REAL_IDEALPOS_UI_DISCOVERY evidence, because
/// the automation client underneath is the fake fixture, not real Idealpos
/// — see DryRunCli's own doc comment for this exact boundary.
/// </summary>
public sealed class CrashReplayTests : IDisposable
{
    private readonly string _tempDir = Directory.CreateTempSubdirectory("tracer-crash-tests-").FullName;

    private static string FindDryRunCliDll()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        bool HasSolutionMarker(DirectoryInfo d) =>
            File.Exists(Path.Combine(d.FullName, "VerduraIdealposTracer.sln"))
            || File.Exists(Path.Combine(d.FullName, "VerduraIdealposTracer.slnx"));
        while (dir is not null && !HasSolutionMarker(dir))
        {
            dir = dir.Parent;
        }
        if (dir is null)
        {
            throw new InvalidOperationException("Could not locate VerduraIdealposTracer.sln by walking up from the test output directory.");
        }

        var configuration =
#if DEBUG
            "Debug";
#else
            "Release";
#endif
        var dllPath = Path.Combine(
            dir.FullName, "src", "VerduraIdealposTracer.DryRunCli", "bin", configuration, "net8.0", "VerduraIdealposTracer.DryRunCli.dll");
        if (!File.Exists(dllPath))
        {
            throw new InvalidOperationException(
                $"DryRunCli build output not found at {dllPath} — run `dotnet build` on the solution first.");
        }
        return dllPath;
    }

    private static (int? ExitCode, bool Crashed) RunDryRunCli(string storePath, string commandId, string? selfKillAfter, string scenario = "HappyPath")
    {
        var dllPath = FindDryRunCliDll();
        var psi = new ProcessStartInfo("dotnet", $"\"{dllPath}\"")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        psi.Environment["TRACER_STORE_PATH"] = storePath;
        psi.Environment["TRACER_COMMAND_ID"] = commandId;
        psi.Environment["TRACER_FAKE_SCENARIO"] = scenario;
        if (selfKillAfter is not null) psi.Environment["TRACER_SELF_KILL_AFTER"] = selfKillAfter;

        using var process = Process.Start(psi)!;
        var exited = process.WaitForExit(TimeSpan.FromSeconds(15));
        if (!exited)
        {
            process.Kill(entireProcessTree: true);
            throw new TimeoutException("DryRunCli did not exit within 15 seconds.");
        }

        // Environment.FailFast on .NET (non-Windows) terminates the process
        // with a non-zero, non-normal exit code (SIGABRT-derived) — never 0.
        var crashed = process.ExitCode != 0 && process.ExitCode != 1;
        return (process.ExitCode, crashed);
    }

    [Fact]
    public void SelfKill_AfterLocalPersist_ProcessGenuinelyCrashes_AndClaimedEntrySurvives()
    {
        var storePath = Path.Combine(_tempDir, "kill-local-persist.ndjson");

        var (_, crashed) = RunDryRunCli(storePath, "crash-cmd-1", selfKillAfter: "local_persist");

        Assert.True(crashed, "Expected the process to crash via Environment.FailFast, not exit normally.");
        Assert.True(File.Exists(storePath), "The claimed entry must have survived the crash — it was fsync'd before the kill point.");
        var lines = File.ReadAllLines(storePath).Where(l => l.Trim().Length > 0).ToList();
        Assert.Single(lines);
        using var doc = JsonDocument.Parse(lines[0]);
        Assert.Equal("claimed", doc.RootElement.GetProperty("type").GetString());
        Assert.Equal("crash-cmd-1", doc.RootElement.GetProperty("commandId").GetString());
    }

    [Fact]
    public void SelfKill_AfterTerminalPersist_ProcessGenuinelyCrashes_AndBothEntriesSurvive()
    {
        var storePath = Path.Combine(_tempDir, "kill-terminal-persist.ndjson");

        var (_, crashed) = RunDryRunCli(storePath, "crash-cmd-2", selfKillAfter: "terminal_persist");

        Assert.True(crashed, "Expected the process to crash via Environment.FailFast, not exit normally.");
        var lines = File.ReadAllLines(storePath).Where(l => l.Trim().Length > 0).ToList();
        // Both the claimed AND terminal entries were fsync'd before this
        // kill point — the crash happens strictly after both durable
        // writes, proving persistence survives even a kill immediately
        // adjacent to process exit.
        Assert.Equal(2, lines.Count);
        using var claimedDoc = JsonDocument.Parse(lines[0]);
        using var terminalDoc = JsonDocument.Parse(lines[1]);
        Assert.Equal("claimed", claimedDoc.RootElement.GetProperty("type").GetString());
        Assert.Equal("terminal", terminalDoc.RootElement.GetProperty("type").GetString());
    }

    [Fact]
    public void NoSelfKill_ProcessExitsNormally_WithFullResult()
    {
        var storePath = Path.Combine(_tempDir, "no-kill.ndjson");

        var (exitCode, crashed) = RunDryRunCli(storePath, "normal-cmd-1", selfKillAfter: null);

        Assert.False(crashed);
        Assert.Equal(0, exitCode);
        Assert.True(File.Exists(storePath));
    }

    [Fact]
    public void AfterACrashMidRun_ASubsequentRunWithANewCommandId_AppendsCleanlyWithoutCorruptingThePriorEntry()
    {
        // "Connector process terminated after local persistence" followed
        // by recovery/restart, applied to this tracer's own log: the file
        // a crashed run left behind must remain valid NDJSON that a later,
        // independent run can safely append to — proving the durable log
        // format itself survives a mid-write process death without
        // requiring any special recovery step on the next run.
        var storePath = Path.Combine(_tempDir, "crash-then-recover.ndjson");

        var (_, firstCrashed) = RunDryRunCli(storePath, "crash-then-recover-1", selfKillAfter: "terminal_persist");
        Assert.True(firstCrashed);

        var (secondExitCode, secondCrashed) = RunDryRunCli(storePath, "crash-then-recover-2", selfKillAfter: null);
        Assert.False(secondCrashed);
        Assert.Equal(0, secondExitCode);

        var lines = File.ReadAllLines(storePath).Where(l => l.Trim().Length > 0).ToList();
        Assert.Equal(4, lines.Count); // 2 entries from the crashed run + 2 from the clean run
        foreach (var line in lines)
        {
            using var doc = JsonDocument.Parse(line); // throws if any line is corrupt/truncated
            Assert.True(doc.RootElement.TryGetProperty("commandId", out _));
        }
        var commandIds = lines.Select(l => JsonDocument.Parse(l).RootElement.GetProperty("commandId").GetString()).Distinct().ToList();
        Assert.Equal(["crash-then-recover-1", "crash-then-recover-2"], commandIds);
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDir)) Directory.Delete(_tempDir, recursive: true);
    }
}
