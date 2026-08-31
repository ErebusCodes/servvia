using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace VerduraIdealposBridge.Logging
{
    public enum LogLevel { Debug = 0, Info = 1, Warn = 2, Error = 3 }

    /// <summary>Key=value pair for structured log lines. A plain struct
    /// (not a C# 7 tuple) so this file has no dependency on how a given
    /// build resolves System.ValueTuple.</summary>
    public struct LogField
    {
        public readonly string Key;
        public readonly object Value;
        public LogField(string key, object value) { Key = key; Value = value; }
        public static implicit operator LogField(KeyValuePair<string, object> kv) => new LogField(kv.Key, kv.Value);
    }

    /// <summary>
    /// Small structured file logger — one line per event, key=value pairs,
    /// so a restaurant incident can be grepped after the fact without a log
    /// aggregation stack. No secrets are ever accepted as field values (see
    /// Redacted); callers must not pass API keys or connection strings in.
    /// Deliberately dependency-free (no Serilog/NLog) to match the rest of
    /// this project's zero-NuGet policy.
    /// </summary>
    public static class Logger
    {
        private static readonly object Sync = new object();
        private static string _directory;
        private static LogLevel _minLevel = LogLevel.Info;
        private static bool _echoToConsole = true;

        public static void Init(string directory, string minLevel, bool echoToConsole)
        {
            _directory = directory;
            _echoToConsole = echoToConsole;
            Directory.CreateDirectory(_directory);
            LogLevel parsed;
            _minLevel = Enum.TryParse(minLevel, true, out parsed) ? parsed : LogLevel.Info;
        }

        public static LogField F(string key, object value) => new LogField(key, value);

        public static void Debug(string evt, params LogField[] fields) => Write(LogLevel.Debug, evt, fields);
        public static void Info(string evt, params LogField[] fields) => Write(LogLevel.Info, evt, fields);
        public static void Warn(string evt, params LogField[] fields) => Write(LogLevel.Warn, evt, fields);
        public static void Error(string evt, params LogField[] fields) => Write(LogLevel.Error, evt, fields);

        public static void Error(string evt, Exception ex, params LogField[] fields)
        {
            var all = new List<LogField>(fields)
            {
                new LogField("exception", ex.GetType().Name),
                new LogField("message", ex.Message)
            };
            Write(LogLevel.Error, evt, all.ToArray());
        }

        private static void Write(LogLevel level, string evt, LogField[] fields)
        {
            if (level < _minLevel) return;

            var sb = new StringBuilder();
            sb.Append(DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ"));
            sb.Append(" [").Append(level.ToString().ToUpperInvariant()).Append("] ");
            sb.Append(evt);
            foreach (var f in fields)
            {
                sb.Append(' ').Append(f.Key).Append('=').Append(FormatValue(f.Value));
            }
            string line = sb.ToString();

            if (_echoToConsole)
            {
                try { Console.WriteLine(line); } catch { /* console may be unavailable under a service */ }
            }

            if (string.IsNullOrEmpty(_directory)) return;

            string file = Path.Combine(_directory, "bridge-" + DateTime.UtcNow.ToString("yyyy-MM-dd") + ".log");
            lock (Sync)
            {
                try
                {
                    File.AppendAllText(file, line + Environment.NewLine);
                }
                catch
                {
                    // Never let logging itself take the process down.
                }
            }
        }

        private static string FormatValue(object value)
        {
            if (value == null) return "\"\"";
            string s = value.ToString();
            if (s.IndexOfAny(new[] { ' ', '"', '\n', '\r' }) >= 0)
            {
                s = "\"" + s.Replace("\"", "'").Replace("\r", " ").Replace("\n", " ") + "\"";
            }
            return s;
        }

        /// <summary>
        /// Explicit marker for call sites to signal "this value is
        /// intentionally withheld" rather than accidentally omitting a
        /// field — used for anything derived from ApiKey/connection strings.
        /// </summary>
        public const string Redacted = "[redacted]";
    }
}
