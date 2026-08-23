using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using VerduraIdealposTracer.Core.Persistence;
using VerduraIdealposTracer.Core.Printing;
using VerduraIdealposTracer.Core.Protocol;
using Xunit;

namespace VerduraIdealposTracer.Tests;

/// <summary>
/// E8-S1 (expanded, KOT dispatch producer) — connector-side handler tests.
/// This is DURABLE_LOCAL_LOG / unit-tier evidence, not
/// REAL_WINDOWS_CONNECTOR or REAL_KOT_PRINTER evidence — every test here
/// uses SimulatedKotPrintTransport, never a real device. See the story
/// file's Real-Environment Evidence Tiers section.
/// </summary>
public sealed class PrintKotCommandHandlerTests : IDisposable
{
    private readonly string _tempDir = Directory.CreateTempSubdirectory("kot-handler-tests-").FullName;

    private DurableLocalLog NewLog() => new(Path.Combine(_tempDir, $"log-{Guid.NewGuid()}.jsonl"));

    private static string Sha256Hex(string content)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(content));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }

    private static ClaimedCommand ValidCommand(string content = "KITCHEN ORDER TICKET\n1x Burger", string commandId = "cmd-1")
    {
        var payload = new Dictionary<string, object?>
        {
            ["renderedContent"] = content,
            ["contentChecksum"] = Sha256Hex(content),
            ["printAttemptId"] = "printer_job:job-1:attempt:0",
            ["printerId"] = "printer-1",
            ["station"] = "kitchen",
        };
        return new ClaimedCommand(commandId, PrintKotCommandType.Value, PrintKotCommandType.SchemaVersion, payload, PrintKotCommandType.Value);
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDir)) Directory.Delete(_tempDir, recursive: true);
    }

    [Fact]
    public async Task A_successful_print_reports_succeeded_with_executed_acknowledged()
    {
        var handler = new PrintKotCommandHandler(NewLog(), new SimulatedKotPrintTransport(new KotPrintResult(KotPrintOutcome.ExecutedAcknowledged)));
        var result = await handler.HandleAsync(ValidCommand(), "idem-1", CancellationToken.None);

        Assert.Equal("succeeded", result.Outcome);
        Assert.Equal(KotPrintResultType.ExecutedAcknowledged, result.ResultType);
    }

    [Fact]
    public async Task A_retryable_local_failure_from_the_transport_is_reported_as_failed_retryable()
    {
        var handler = new PrintKotCommandHandler(NewLog(), new SimulatedKotPrintTransport(new KotPrintResult(KotPrintOutcome.RetryableLocalFailure, "connection refused")));
        var result = await handler.HandleAsync(ValidCommand(), "idem-1", CancellationToken.None);

        Assert.Equal("failed", result.Outcome);
        Assert.Equal(KotPrintResultType.RetryableLocalFailure, result.ResultType);
        Assert.Equal("connection refused", result.FailureReason);
    }

    [Fact]
    public async Task An_unrecognized_command_type_is_rejected_as_unsupported_without_calling_the_transport()
    {
        var transport = new SimulatedKotPrintTransport(new KotPrintResult(KotPrintOutcome.ExecutedAcknowledged));
        var handler = new PrintKotCommandHandler(NewLog(), transport);
        var command = ValidCommand() with { CommandType = "printer.print_receipt.v1" };

        var result = await handler.HandleAsync(command, "idem-1", CancellationToken.None);

        Assert.Equal("failed", result.Outcome);
        Assert.Equal(KotPrintResultType.Unsupported, result.ResultType);
        Assert.Equal(0, transport.CallCount);
    }

    [Fact]
    public async Task An_unknown_schema_version_is_rejected_as_unsupported_version_without_calling_the_transport()
    {
        var transport = new SimulatedKotPrintTransport(new KotPrintResult(KotPrintOutcome.ExecutedAcknowledged));
        var handler = new PrintKotCommandHandler(NewLog(), transport);
        var command = ValidCommand() with { SchemaVersion = 99 };

        var result = await handler.HandleAsync(command, "idem-1", CancellationToken.None);

        Assert.Equal(KotPrintResultType.UnsupportedVersion, result.ResultType);
        Assert.Equal(0, transport.CallCount);
    }

    [Fact]
    public async Task A_checksum_mismatch_is_never_sent_to_the_transport()
    {
        var transport = new SimulatedKotPrintTransport(new KotPrintResult(KotPrintOutcome.ExecutedAcknowledged));
        var handler = new PrintKotCommandHandler(NewLog(), transport);
        var payload = new Dictionary<string, object?>
        {
            ["renderedContent"] = "KITCHEN ORDER TICKET\n1x Burger",
            ["contentChecksum"] = "not-the-real-checksum",
            ["printAttemptId"] = "attempt-1",
        };
        var command = new ClaimedCommand("cmd-1", PrintKotCommandType.Value, PrintKotCommandType.SchemaVersion, payload, null);

        var result = await handler.HandleAsync(command, "idem-1", CancellationToken.None);

        Assert.Equal(KotPrintResultType.ChecksumMismatch, result.ResultType);
        Assert.Equal(0, transport.CallCount);
    }

    [Fact]
    public async Task A_malformed_payload_missing_required_fields_is_rejected_without_calling_the_transport()
    {
        var transport = new SimulatedKotPrintTransport(new KotPrintResult(KotPrintOutcome.ExecutedAcknowledged));
        var handler = new PrintKotCommandHandler(NewLog(), transport);
        var command = new ClaimedCommand("cmd-1", PrintKotCommandType.Value, PrintKotCommandType.SchemaVersion, new Dictionary<string, object?>(), null);

        var result = await handler.HandleAsync(command, "idem-1", CancellationToken.None);

        Assert.Equal(KotPrintResultType.MalformedPayload, result.ResultType);
        Assert.Equal(0, transport.CallCount);
    }

    [Fact]
    public async Task A_hostile_control_character_transport_exception_is_classified_as_retryable_not_uncertain()
    {
        var handler = new PrintKotCommandHandler(NewLog(), new ThrowingTransport());
        var result = await handler.HandleAsync(ValidCommand(), "idem-1", CancellationToken.None);

        Assert.Equal("failed", result.Outcome);
        Assert.Equal(KotPrintResultType.RetryableLocalFailure, result.ResultType);
    }

    private sealed class ThrowingTransport : IKotPrintTransport
    {
        public Task<KotPrintResult> PrintAsync(string renderedContent, CancellationToken cancellationToken)
            => throw new InvalidOperationException("simulated transport crash");
    }

    [Fact]
    public async Task Execution_intent_is_persisted_before_the_transport_is_called()
    {
        var log = NewLog();
        var probe = new IntentCheckingTransport(log);
        var handler = new PrintKotCommandHandler(log, probe);

        await handler.HandleAsync(ValidCommand(), "idem-1", CancellationToken.None);

        Assert.True(probe.IntentWasPersistedBeforePrintWasCalled);
    }

    private sealed class IntentCheckingTransport(DurableLocalLog log) : IKotPrintTransport
    {
        public bool IntentWasPersistedBeforePrintWasCalled { get; private set; }

        public Task<KotPrintResult> PrintAsync(string renderedContent, CancellationToken cancellationToken)
        {
            var entries = log.ReadAll();
            IntentWasPersistedBeforePrintWasCalled = entries.Any(e =>
                e.RootElement.TryGetProperty("Phase", out var p) && p.GetString() == "intent_persisted");
            return Task.FromResult(new KotPrintResult(KotPrintOutcome.ExecutedAcknowledged));
        }
    }

    [Fact]
    public async Task Crash_after_intent_persisted_but_before_result_recorded_is_detected_on_replay_as_uncertain_never_reprinted()
    {
        // Simulates the crash-after-print-before-ack window directly at the
        // persistence layer (unit/DURABLE_LOCAL_LOG tier) — NOT a real
        // separate-process kill like CrashReplayTests.cs uses for the
        // discovery tracer. See this file's own class doc comment.
        var log = NewLog();
        log.AppendDurable(new { CommandId = "cmd-1", PrintAttemptId = "attempt-1", Phase = "intent_persisted", ResultType = (string?)null, TimestampUtc = DateTime.UtcNow.ToString("o") });

        var transport = new SimulatedKotPrintTransport(new KotPrintResult(KotPrintOutcome.ExecutedAcknowledged));
        var handler = new PrintKotCommandHandler(log, transport);

        var result = await handler.HandleAsync(ValidCommand(commandId: "cmd-1"), "idem-1", CancellationToken.None);

        Assert.Equal(KotPrintResultType.UncertainLocalResult, result.ResultType);
        Assert.Equal(0, transport.CallCount); // never re-attempted
    }

    [Fact]
    public async Task A_resolved_prior_intent_does_not_block_a_later_command_with_the_same_command_id_reused_in_a_fresh_log()
    {
        // A command whose result WAS recorded is not "unresolved" — this
        // guards only the crash window, not every prior command forever.
        var log = NewLog();
        log.AppendDurable(new { CommandId = "cmd-1", PrintAttemptId = "attempt-1", Phase = "intent_persisted", ResultType = (string?)null, TimestampUtc = DateTime.UtcNow.ToString("o") });
        log.AppendDurable(new { CommandId = "cmd-1", PrintAttemptId = "attempt-1", Phase = "result_recorded", ResultType = KotPrintResultType.ExecutedAcknowledged, TimestampUtc = DateTime.UtcNow.ToString("o") });

        var handler = new PrintKotCommandHandler(log, new SimulatedKotPrintTransport(new KotPrintResult(KotPrintOutcome.ExecutedAcknowledged)));
        Assert.False(handler.HasUnresolvedIntent("cmd-1"));
    }
}
