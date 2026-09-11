namespace VerduraIdealposTracer.Core.Terminal.PosServer;

/// <summary>
/// The evidence payload reported back for one <c>idealpos.native_round_evidence.v1</c>
/// command. Property names must byte-match what
/// <c>connector-native-evidence.reader.ts</c>'s <c>parseEvidencePayload</c>
/// accepts — camelCase on the wire, via the protocol client's JSON options.
///
/// NOTE WHAT IS ABSENT, and it is absent deliberately: there is no
/// <c>preSendTable</c>, no <c>expectedItems</c>, and nothing resembling a
/// verdict. Those are the round's OWN terms, frozen on the attempt row before
/// the socket opened, and the API refuses to take them from a connector report.
/// A connector that could supply them could hand over the values it is being
/// checked against. This type describes what was READ, never what it means.
/// </summary>
public sealed record NativeRoundEvidencePayload
{
    /// <summary>
    /// The token the till holds for this DeviceID.
    /// A string is the stored value; <c>null</c> means we LOOKED and there is
    /// no row; absent means we did not look or could not.
    /// </summary>
    public string? StoredTokenForDevice { get; init; }

    /// <summary>
    /// True only when the token read resolved one way or the other. When false
    /// the property above is omitted from the report entirely, because
    /// serialising a null we never observed would be a fabricated absence — and
    /// a fabricated absence can release a round's lines.
    /// </summary>
    public bool TokenWasRead { get; init; }

    /// <summary>The native table as it stands now, in the API's snapshot vocabulary.</summary>
    public NativeTableSnapshotPayload? CurrentTable { get; init; }

    /// <summary>Operator-facing detail for both reads. Never parsed; always logged.</summary>
    public string? TokenReadReason { get; init; }
}

/// <summary>One native table observation, in the shape the API parses.</summary>
public sealed record NativeTableSnapshotPayload
{
    /// <summary>"observed" | "noOpenSale" | "ambiguous" | "unavailable". Anything else is dropped by the API.</summary>
    public required string Status { get; init; }

    public string? TableCode { get; init; }
    public int? Pos { get; init; }
    public string? Map { get; init; }
    public string? Reason { get; init; }

    /// <summary>
    /// Present only when <see cref="Status"/> is "observed". An observed table
    /// whose lines are absent is treated by the API as UNREADABLE rather than
    /// empty, so this is never omitted on the observed path.
    /// </summary>
    public IReadOnlyList<NativeLinePayload>? Lines { get; init; }
}

/// <summary>One native line, reduced to the only two things confirmation may reason about.</summary>
public sealed record NativeLinePayload(string NativeCode, int Quantity);

/// <summary>
/// Gathers both halves of the confirmation evidence for one round, READ-ONLY.
///
/// ─────────────────────────────────────────────────────────────────────────
/// IT DECIDES NOTHING. It runs two reads and translates their typed results
/// into the report vocabulary. There is no verdict here, no comparison against
/// an expected round, and no notion of "confirmed" — those live in one pure
/// predicate on the API side, and a second opinion in this process would be an
/// untested one that no test on either side covers.
///
/// THE TWO HALVES ARE INDEPENDENT, and that matters. Either can succeed while
/// the other fails, and the report says so rather than collapsing to a single
/// "evidence unavailable". A causal read that worked and a durable read that
/// timed out is a genuinely different situation from both failing: the first
/// will confirm on the next tick once the table is readable, the second will
/// not. Reporting them separately is what lets the sweep converge.
///
/// FAILURE IS ALWAYS SILENCE, NEVER A CLAIM. A read that did not resolve
/// contributes an ABSENT field or an "unavailable" snapshot — never a null
/// token and never an empty line list. The API reads an absent field as "did
/// not look", which confirms nothing and releases nothing. That asymmetry is
/// the whole safety argument and it is asserted by test on both sides of the
/// wire.
/// </summary>
public sealed class NativeRoundEvidenceGatherer(
    IHandheldTokenReader tokenReader,
    INativeTableStateReaderWithDetail tableReader)
{
    public async Task<NativeRoundEvidencePayload> GatherAsync(
        string deviceId,
        string tableCode,
        string? map,
        CancellationToken cancellationToken)
    {
        var token = await ReadTokenAsync(deviceId, cancellationToken);
        var table = await ReadTableAsync(tableCode, map, cancellationToken);

        return new NativeRoundEvidencePayload
        {
            StoredTokenForDevice = token.Value,
            TokenWasRead = token.Resolved,
            TokenReadReason = token.Reason,
            CurrentTable = table,
        };
    }

    private async Task<(bool Resolved, string? Value, string? Reason)> ReadTokenAsync(
        string deviceId,
        CancellationToken cancellationToken)
    {
        HandheldTokenReadResult result;
        try
        {
            result = await tokenReader.ReadStoredTokenAsync(deviceId, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            // A reader that threw told us nothing. Reported as not-read, which
            // the API treats as ignorance.
            return (false, null, $"the token read threw ({ex.GetType().Name}: {ex.Message})");
        }

        return result.Status switch
        {
            // Observed: the value itself, which may legitimately be "".
            HandheldTokenReadStatus.Observed => (true, result.StoredToken ?? string.Empty, null),

            // NoRow is the ONE case that reports a null, and it is a real
            // reading: the receiver inserts a row the first time it sees a
            // device, so an absent row on a device that has sent means the
            // packet never reached IsDuplicateHandheldOrder2.
            HandheldTokenReadStatus.NoRow => (true, null, result.Reason),

            // Ambiguous and Unavailable both mean we do not know. Neither may
            // become a null: reported as absence, either could release the
            // lines of a round that is on a customer's bill.
            _ => (false, null, result.Reason),
        };
    }

    private async Task<NativeTableSnapshotPayload> ReadTableAsync(
        string tableCode,
        string? map,
        CancellationToken cancellationToken)
    {
        NativeTableReadResult result;
        try
        {
            result = await tableReader.ReadTableAsync(tableCode, map, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            return new NativeTableSnapshotPayload
            {
                Status = "unavailable",
                Reason = $"the table read threw ({ex.GetType().Name}: {ex.Message})",
            };
        }

        switch (result.Status)
        {
            case NativeTableReadStatus.NoOpenSale:
                return new NativeTableSnapshotPayload { Status = "noOpenSale", Reason = result.Reason };

            case NativeTableReadStatus.Ambiguous:
                return new NativeTableSnapshotPayload { Status = "ambiguous", Reason = result.Reason };

            case NativeTableReadStatus.Observed when result.Observation is { } observed:
                return new NativeTableSnapshotPayload
                {
                    Status = "observed",
                    TableCode = observed.TableCode,
                    Pos = observed.Pos,
                    Map = observed.Map,
                    // Lines are sent as the canonicalizer produced them: one
                    // entry per physical row, quantities NOT pre-summed. The
                    // API sums by code, and summing in two places is how the
                    // two ends drift.
                    Lines = observed.Lines
                        .Select(l => new NativeLinePayload(l.NativeCode, l.Quantity))
                        .ToList(),
                };

            case NativeTableReadStatus.Observed:
                // Observed with no observation is a contradiction this build
                // will not paper over with an empty line list.
                return new NativeTableSnapshotPayload
                {
                    Status = "unavailable",
                    Reason = "the table read reported an observation it did not carry",
                };

            default:
                return new NativeTableSnapshotPayload
                {
                    Status = "unavailable",
                    Reason = result.Reason ?? "the native table could not be read",
                };
        }
    }
}

/// <summary>
/// The typed table read, as the gatherer needs it.
///
/// <see cref="INativeTableStateReader"/> exists already and is deliberately
/// narrower: it speaks only "a fingerprint, or null", because the round
/// orchestrator it serves has exactly two things to do with the answer. That
/// vocabulary cannot express "ambiguous" or "unavailable", which is precisely
/// what evidence gathering must report. So the gatherer depends on the richer
/// shape rather than on the narrow one, and
/// <see cref="PosServerTableStateReader"/> already implements it.
/// </summary>
public interface INativeTableStateReaderWithDetail
{
    Task<NativeTableReadResult> ReadTableAsync(string tableCode, string? map, CancellationToken cancellationToken);
}
