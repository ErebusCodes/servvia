using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using VerduraIdealposTracer.Core.Discovery;

namespace VerduraIdealposTracer.Windows;

/// <summary>
/// READ-ONLY MSAA / <c>IAccessible</c> enumeration.
///
/// Every call here is an observation: <c>AccessibleObjectFromWindow</c>,
/// <c>AccessibleChildren</c>, and the <c>accName</c> / <c>accRole</c> /
/// <c>accState</c> / <c>accValue</c> / <c>accLocation</c> /
/// <c>accDefaultAction</c> property getters. <b>Nothing invokes
/// <c>accDoDefaultAction</c>, <c>accSelect</c>, or <c>put_accValue</c></b> —
/// the three IAccessible members that could change the application. The
/// default action's NAME is read; the action is never performed.
///
/// This exists because the Win32 child-HWND path is proven insufficient on
/// the IdealPOS sale screen (one container, zero grandchildren). VB6
/// lightweight controls have no HWND and surface only as accessible child
/// IDs, so MSAA is the mechanism that can see them if anything can.
/// </summary>
internal static class MsaaDiscovery
{
    public const int MaxNodes = 3000;
    public const int MaxDepth = 12;

    private const uint OBJID_CLIENT = 0xFFFFFFFC;
    private const uint OBJID_WINDOW = 0x00000000;
    private static readonly Guid IID_IAccessible = new("618736E0-3C3D-11CF-810C-00AA00389B71");

    /// <summary>Probes one window. <paramref name="useWindowObject"/> selects OBJID_WINDOW over OBJID_CLIENT.</summary>
    public static MsaaProbeResult Probe(IntPtr hwnd, string? className, string? title, bool useWindowObject = false)
    {
        var handleText = "0x" + hwnd.ToInt64().ToString("X");
        var objectId = useWindowObject ? "WINDOW" : "CLIENT";

        try
        {
            var iid = IID_IAccessible;
            var hr = MsaaNative.AccessibleObjectFromWindow(
                hwnd, useWindowObject ? OBJID_WINDOW : OBJID_CLIENT, ref iid, out var acc);

            if (hr != 0 || acc is null)
            {
                return new MsaaProbeResult
                {
                    Handle = handleText, WindowClassName = className, WindowTitle = title, ObjectId = objectId,
                    Reachable = false, FailureReason = $"AccessibleObjectFromWindow hr=0x{hr:X8}",
                };
            }

            var budget = new Budget();
            var root = Describe(acc, childId: 0, depth: 0, budget);

            var all = Flatten(root).ToList();
            return new MsaaProbeResult
            {
                Handle = handleText, WindowClassName = className, WindowTitle = title, ObjectId = objectId,
                Reachable = true, Root = root,
                TotalNodes = all.Count,
                AddressableNodes = all.Count(n => n.IsAddressable),
            };
        }
        catch (Exception ex)
        {
            return new MsaaProbeResult
            {
                Handle = handleText, WindowClassName = className, WindowTitle = title, ObjectId = objectId,
                Reachable = false, FailureReason = $"{ex.GetType().Name}: {ex.Message}",
            };
        }
    }

    public static IEnumerable<MsaaAccessibleNode> Flatten(MsaaAccessibleNode? node)
    {
        if (node is null) yield break;
        yield return node;
        foreach (var c in node.Children)
            foreach (var d in Flatten(c))
                yield return d;
    }

    private sealed class Budget
    {
        public int Used;
        public bool Exhausted => Used >= MaxNodes;
    }

    private static MsaaAccessibleNode Describe(object acc, int childId, int depth, Budget budget)
    {
        budget.Used++;

        var self = ChildVariant(childId);
        var role = GetInt(acc, "accRole", self);
        var state = GetInt(acc, "accState", self);
        var (left, top, width, height) = GetLocation(acc, childId);

        var node = new MsaaAccessibleNode
        {
            ChildId = childId,
            Role = role,
            RoleText = RoleText(role),
            Name = ControlTreeSanitizer.Sanitize(GetString(acc, "accName", self)),
            Value = ControlTreeSanitizer.Sanitize(GetString(acc, "accValue", self)),
            State = state,
            StateText = StateText(state),
            DefaultAction = ControlTreeSanitizer.Sanitize(GetString(acc, "accDefaultAction", self)),
            Left = left, Top = top, Width = width, Height = height,
            OwningHandle = OwningHandle(acc),
            Depth = depth,
            Children = childId == 0 && depth < MaxDepth && !budget.Exhausted
                ? EnumerateChildren(acc, depth, budget)
                : Array.Empty<MsaaAccessibleNode>(),
        };

        return node;
    }

    /// <summary>
    /// Enumerates children. Two kinds come back, and the distinction is the
    /// whole point of this probe: a COM object is a nested accessible (recurse
    /// into it), while a boxed int is a WINDOWLESS child addressed only by id
    /// on this parent — the VB6 lightweight-control case.
    /// </summary>
    private static IReadOnlyList<MsaaAccessibleNode> EnumerateChildren(object acc, int depth, Budget budget)
    {
        var count = GetInt(acc, "accChildCount", null);
        if (count <= 0) return Array.Empty<MsaaAccessibleNode>();

        count = Math.Min(count, MaxNodes - budget.Used);
        if (count <= 0) return Array.Empty<MsaaAccessibleNode>();

        var buffer = new object[count];
        int obtained;
        try
        {
            var hr = MsaaNative.AccessibleChildren(acc, 0, count, buffer, out obtained);
            if (hr != 0 && obtained == 0) return Array.Empty<MsaaAccessibleNode>();
        }
        catch
        {
            return Array.Empty<MsaaAccessibleNode>();
        }

        var children = new List<MsaaAccessibleNode>(obtained);
        for (var i = 0; i < obtained && !budget.Exhausted; i++)
        {
            var item = buffer[i];
            if (item is null) continue;

            if (item is int id)
            {
                // Windowless child: described against the PARENT accessible.
                children.Add(Describe(acc, id, depth + 1, budget));
            }
            else
            {
                try { children.Add(Describe(item, 0, depth + 1, budget)); }
                catch { /* a child that refuses description is not fatal to the walk */ }
            }
        }

        return children;
    }

    // ---- late-bound IAccessible property reads (all getters) --------------

    private static object? ChildVariant(int childId) => childId == 0 ? (object)0 : childId;

    private static string? GetString(object acc, string member, object? child)
    {
        try
        {
            var args = child is null ? null : new[] { child };
            return acc.GetType().InvokeMember(member, BindingFlags.GetProperty, null, acc, args) as string;
        }
        catch { return null; }
    }

    private static int GetInt(object acc, string member, object? child)
    {
        try
        {
            var args = child is null ? null : new[] { child };
            var v = acc.GetType().InvokeMember(member, BindingFlags.GetProperty, null, acc, args);
            return v is null ? 0 : Convert.ToInt32(v);
        }
        catch { return 0; }
    }

    private static (int Left, int Top, int Width, int Height) GetLocation(object acc, int childId)
    {
        try
        {
            var args = new object?[] { 0, 0, 0, 0, childId == 0 ? 0 : childId };
            acc.GetType().InvokeMember("accLocation", BindingFlags.InvokeMethod, null, acc, args);
            return (Convert.ToInt32(args[0]), Convert.ToInt32(args[1]), Convert.ToInt32(args[2]), Convert.ToInt32(args[3]));
        }
        catch { return (0, 0, 0, 0); }
    }

    private static string? OwningHandle(object acc)
    {
        try
        {
            var hr = MsaaNative.WindowFromAccessibleObject(acc, out var hwnd);
            return hr == 0 && hwnd != IntPtr.Zero ? "0x" + hwnd.ToInt64().ToString("X") : null;
        }
        catch { return null; }
    }

    private static string? RoleText(int role)
    {
        if (role <= 0) return null;
        var sb = new StringBuilder(128);
        return MsaaNative.GetRoleText((uint)role, sb, (uint)sb.Capacity) > 0 ? sb.ToString() : null;
    }

    private static IReadOnlyList<string> StateText(int state)
    {
        if (state == 0) return Array.Empty<string>();
        var result = new List<string>();
        for (var bit = 0; bit < 31; bit++)
        {
            var mask = 1u << bit;
            if ((state & mask) == 0) continue;
            var sb = new StringBuilder(128);
            if (MsaaNative.GetStateText(mask, sb, (uint)sb.Capacity) > 0) result.Add(sb.ToString());
        }
        return result;
    }
}

/// <summary>oleacc interop. Every entry point observes; none acts.</summary>
internal static class MsaaNative
{
    [DllImport("oleacc.dll")]
    public static extern int AccessibleObjectFromWindow(
        IntPtr hwnd, uint id, ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object ppvObject);

    [DllImport("oleacc.dll")]
    public static extern int AccessibleChildren(
        [MarshalAs(UnmanagedType.IUnknown)] object paccContainer,
        int iChildStart, int cChildren,
        [Out, MarshalAs(UnmanagedType.LPArray, ArraySubType = UnmanagedType.Struct)] object[] rgvarChildren,
        out int pcObtained);

    [DllImport("oleacc.dll")]
    public static extern int WindowFromAccessibleObject(
        [MarshalAs(UnmanagedType.IUnknown)] object pacc, out IntPtr phwnd);

    [DllImport("oleacc.dll", CharSet = CharSet.Unicode)]
    public static extern uint GetRoleText(uint lRole, StringBuilder lpszRole, uint cchRoleMax);

    [DllImport("oleacc.dll", CharSet = CharSet.Unicode)]
    public static extern uint GetStateText(uint lStateBit, StringBuilder lpszStateBit, uint cchStateBitMax);
}
