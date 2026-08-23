using System.Text.Json;

namespace VerduraIdealposTracer.Core.Persistence;

/// <summary>
/// A durable, fsync'd, append-only local log — the same design and the
/// same durability guarantee (nothing is "durable" until <c>FlushToDisk</c>
/// returns) as Story 2-10's own proof harness
/// (backend/scripts/connector-command-harness.ts), ported here for
/// consistency and because this is exactly the same persist-before-ack
/// property this story must prove for the Windows Connector side. Not
/// necessarily what a production Windows Connector will use (a real
/// service might reasonably use SQLite or LiteDB instead) — the point, as
/// in the TypeScript harness, is that the *protocol property* holds
/// regardless of the specific storage technology.
/// </summary>
public sealed class DurableLocalLog(string filePath)
{
    private static readonly JsonSerializerOptions SerializerOptions = new() { WriteIndented = false };

    public string FilePath { get; } = filePath;

    /// <summary>
    /// Appends one entry and does not return until the write is fsync'd to
    /// disk. Uses <see cref="FileOptions.WriteThrough"/> plus an explicit
    /// <see cref="FileStream.Flush(bool)"/> with <c>flushToDisk: true</c> —
    /// the .NET equivalent of the TypeScript harness's
    /// <c>fs.writeSync</c> + <c>fs.fsyncSync</c> pair.
    /// </summary>
    public void AppendDurable<T>(T entry)
    {
        var line = JsonSerializer.Serialize(entry, SerializerOptions) + "\n";
        var bytes = System.Text.Encoding.UTF8.GetBytes(line);

        using var stream = new FileStream(
            FilePath,
            FileMode.Append,
            FileAccess.Write,
            FileShare.Read,
            bufferSize: 4096,
            options: FileOptions.WriteThrough);
        stream.Write(bytes, 0, bytes.Length);
        stream.Flush(flushToDisk: true);
    }

    public IReadOnlyList<JsonDocument> ReadAll()
    {
        if (!File.Exists(FilePath)) return [];
        var results = new List<JsonDocument>();
        foreach (var line in File.ReadAllLines(FilePath))
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            results.Add(JsonDocument.Parse(line));
        }
        return results;
    }
}
