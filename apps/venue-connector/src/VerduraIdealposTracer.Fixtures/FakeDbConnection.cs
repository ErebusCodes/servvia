using System.Collections;
using System.Data;
using System.Data.Common;

namespace VerduraIdealposTracer.Fixtures;

/// <summary>
/// A minimal in-memory <see cref="DbConnection"/> so the POSServer reader can
/// be exercised offline, against no database at all.
///
/// It is a transport double, not a database double: it returns the rows a test
/// hands it and records the SQL and parameters it was asked to run. It
/// deliberately does NOT interpret the WHERE clause — the filtering rules live
/// in the pure canonicalizer and are tested there, so a fake that re-implemented
/// them would be testing itself.
///
/// UNIT_OR_MOCK evidence only. Nothing here is a real SQL Server.
/// </summary>
public sealed class FakeDbConnection : DbConnection
{
    private ConnectionState _state = ConnectionState.Closed;

    /// <summary>Rows returned by the next command, as raw provider values.</summary>
    public List<object?[]> Rows { get; set; } = new();

    /// <summary>Column names, in the order the reader will expose them.</summary>
    public List<string> Columns { get; set; } = new();

    /// <summary>Set to have Open() fail, standing in for an unreachable or permission-denied server.</summary>
    public Exception? FailOnOpen { get; set; }

    /// <summary>Set to have command execution fail, standing in for a timeout or a mid-query fault.</summary>
    public Exception? FailOnExecute { get; set; }

    /// <summary>Every command text this connection was asked to execute.</summary>
    public List<string> ExecutedCommands { get; } = new();

    /// <summary>Parameter name/value pairs of the most recent command.</summary>
    public Dictionary<string, object?> LastParameters { get; } = new();

    /// <summary>How many times a reader was executed — proves the read is one round trip.</summary>
    public int ExecuteCount { get; private set; }

    /// <summary>
    /// Result sets to hand out IN ORDER, one per executed command.
    ///
    /// WHY THIS EXISTS. <see cref="Rows"/>/<see cref="Columns"/> describe ONE
    /// result and are returned for every statement, which is right for a reader
    /// that issues a single SELECT. A reader that issues two different ones —
    /// discovering a schema, then selecting the columns it found — would
    /// otherwise be handed the schema rows a second time and read them off the
    /// wrong shape. Queue a result set per statement and each gets its own.
    ///
    /// Empty by default, so every existing test keeps the single-result
    /// behaviour unchanged. When the queue runs out, the fallback is
    /// <see cref="Rows"/>/<see cref="Columns"/> as before.
    /// </summary>
    public Queue<(List<string> Columns, List<object?[]> Rows)> ResultSets { get; } = new();

    public override string ConnectionString { get; set; } = "fake";
    public override string Database => "POSServer";
    public override string DataSource => "fake";
    public override string ServerVersion => "0.0";
    public override ConnectionState State => _state;

    public override void Open()
    {
        if (FailOnOpen is not null) throw FailOnOpen;
        _state = ConnectionState.Open;
    }

    public override void Close() => _state = ConnectionState.Closed;
    public override void ChangeDatabase(string databaseName) => throw new NotSupportedException();
    protected override DbTransaction BeginDbTransaction(IsolationLevel isolationLevel) => throw new NotSupportedException();
    protected override DbCommand CreateDbCommand() => new FakeDbCommand(this);

    internal DbDataReader Execute(FakeDbCommand command)
    {
        if (FailOnExecute is not null) throw FailOnExecute;
        ExecuteCount++;
        ExecutedCommands.Add(command.CommandText);
        LastParameters.Clear();
        foreach (DbParameter p in command.Parameters) LastParameters[p.ParameterName] = p.Value;
        if (ResultSets.Count > 0)
        {
            var next = ResultSets.Dequeue();
            return new FakeDbDataReader(next.Columns, next.Rows);
        }
        return new FakeDbDataReader(Columns, Rows);
    }
}

internal sealed class FakeDbCommand(FakeDbConnection connection) : DbCommand
{
    private readonly FakeDbParameterCollection _parameters = new();

    public override string CommandText { get; set; } = string.Empty;
    public override int CommandTimeout { get; set; }
    public override CommandType CommandType { get; set; }
    public override bool DesignTimeVisible { get; set; }
    public override UpdateRowSource UpdatedRowSource { get; set; }
    protected override DbConnection? DbConnection { get; set; } = connection;
    protected override DbParameterCollection DbParameterCollection => _parameters;
    protected override DbTransaction? DbTransaction { get; set; }

    public override void Cancel() { }

    /// <summary>Never used by the reader — a write path would have to call this.</summary>
    public override int ExecuteNonQuery() =>
        throw new InvalidOperationException("The POSServer reader must never execute a non-query.");

    public override object? ExecuteScalar() =>
        throw new InvalidOperationException("The POSServer reader must never execute a scalar command.");

    public override void Prepare() { }
    protected override DbParameter CreateDbParameter() => new FakeDbParameter();
    protected override DbDataReader ExecuteDbDataReader(CommandBehavior behavior) => connection.Execute(this);
}

internal sealed class FakeDbParameter : DbParameter
{
    public override DbType DbType { get; set; }
    public override ParameterDirection Direction { get; set; }
    public override bool IsNullable { get; set; }
    public override string ParameterName { get; set; } = string.Empty;
    public override int Size { get; set; }
    public override string SourceColumn { get; set; } = string.Empty;
    public override bool SourceColumnNullMapping { get; set; }
    public override object? Value { get; set; }
    public override void ResetDbType() { }
}

internal sealed class FakeDbParameterCollection : DbParameterCollection
{
    private readonly List<DbParameter> _items = new();

    public override int Count => _items.Count;
    public override object SyncRoot { get; } = new();

    public override int Add(object value) { _items.Add((DbParameter)value); return _items.Count - 1; }
    public override void AddRange(Array values) { foreach (var v in values) Add(v!); }
    public override void Clear() => _items.Clear();
    public override bool Contains(object value) => _items.Contains((DbParameter)value);
    public override bool Contains(string value) => _items.Any(p => p.ParameterName == value);
    public override void CopyTo(Array array, int index) => ((ICollection)_items).CopyTo(array, index);
    public override IEnumerator GetEnumerator() => _items.GetEnumerator();
    public override int IndexOf(object value) => _items.IndexOf((DbParameter)value);
    public override int IndexOf(string parameterName) => _items.FindIndex(p => p.ParameterName == parameterName);
    public override void Insert(int index, object value) => _items.Insert(index, (DbParameter)value);
    public override void Remove(object value) => _items.Remove((DbParameter)value);
    public override void RemoveAt(int index) => _items.RemoveAt(index);
    public override void RemoveAt(string parameterName) => _items.RemoveAt(IndexOf(parameterName));
    protected override DbParameter GetParameter(int index) => _items[index];
    protected override DbParameter GetParameter(string parameterName) => _items[IndexOf(parameterName)];
    protected override void SetParameter(int index, DbParameter value) => _items[index] = value;
    protected override void SetParameter(string parameterName, DbParameter value) => _items[IndexOf(parameterName)] = value;
}

internal sealed class FakeDbDataReader(List<string> columns, List<object?[]> rows) : DbDataReader
{
    private int _index = -1;

    private object?[] Current => rows[_index];

    public override int Depth => 0;
    public override int FieldCount => columns.Count;
    public override bool HasRows => rows.Count > 0;
    public override bool IsClosed => false;
    public override int RecordsAffected => 0;
    public override object this[int ordinal] => GetValue(ordinal);
    public override object this[string name] => GetValue(GetOrdinal(name));

    public override bool Read() => ++_index < rows.Count;
    public override bool NextResult() => false;
    public override IEnumerator GetEnumerator() => rows.GetEnumerator();

    public override bool IsDBNull(int ordinal) => Current[ordinal] is null or DBNull;
    public override object GetValue(int ordinal) => Current[ordinal] ?? DBNull.Value;
    public override int GetValues(object[] values)
    {
        var n = Math.Min(values.Length, FieldCount);
        for (var i = 0; i < n; i++) values[i] = GetValue(i);
        return n;
    }

    public override string GetName(int ordinal) => columns[ordinal];
    public override int GetOrdinal(string name) => columns.IndexOf(name);
    public override string GetDataTypeName(int ordinal) => GetFieldType(ordinal).Name;
    public override Type GetFieldType(int ordinal) => Current[ordinal]?.GetType() ?? typeof(object);

    public override bool GetBoolean(int ordinal) => Convert.ToBoolean(GetValue(ordinal));
    public override byte GetByte(int ordinal) => Convert.ToByte(GetValue(ordinal));
    public override long GetBytes(int ordinal, long dataOffset, byte[]? buffer, int bufferOffset, int length) => 0;
    public override char GetChar(int ordinal) => Convert.ToChar(GetValue(ordinal));
    public override long GetChars(int ordinal, long dataOffset, char[]? buffer, int bufferOffset, int length) => 0;
    public override DateTime GetDateTime(int ordinal) => Convert.ToDateTime(GetValue(ordinal));
    public override decimal GetDecimal(int ordinal) => Convert.ToDecimal(GetValue(ordinal));
    public override double GetDouble(int ordinal) => Convert.ToDouble(GetValue(ordinal));
    public override float GetFloat(int ordinal) => Convert.ToSingle(GetValue(ordinal));
    public override Guid GetGuid(int ordinal) => (Guid)GetValue(ordinal);
    public override short GetInt16(int ordinal) => Convert.ToInt16(GetValue(ordinal));
    public override int GetInt32(int ordinal) => Convert.ToInt32(GetValue(ordinal));
    public override long GetInt64(int ordinal) => Convert.ToInt64(GetValue(ordinal));
    public override string GetString(int ordinal) => Convert.ToString(GetValue(ordinal)) ?? string.Empty;
}

/// <summary>
/// A <see cref="DbProviderFactory"/> producing <see cref="FakeDbConnection"/>,
/// so the readback gate can be exercised end to end without any SQL client
/// package being referenced. UNIT_OR_MOCK only.
/// </summary>
public sealed class FakeDbProviderFactory : DbProviderFactory
{
    public static readonly FakeDbProviderFactory Instance = new();

    private FakeDbProviderFactory() { }

    public override DbConnection CreateConnection() => new FakeDbConnection { Columns = new List<string>() };
}
