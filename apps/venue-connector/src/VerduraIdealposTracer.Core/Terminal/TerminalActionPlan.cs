namespace VerduraIdealposTracer.Core.Terminal;

/// <summary>
/// The canonical, ordered intent of a native round, as human-readable
/// steps. Shared so the dry-run CLI, the fake, and the fail-closed Windows
/// scaffold all describe the SAME plan rather than three drifting copies.
/// Building the plan touches nothing — it is pure text.
/// </summary>
public static class TerminalActionPlan
{
    public static IReadOnlyList<string> Build(TerminalRoundRequest request)
    {
        var plus = string.Join(", ", request.Items.Select(i => $"PLU {i.NativeCode} x{i.Quantity}"));
        var open = request.RoundKind == TerminalRoundKind.SecondRound
            ? $"reopen existing native table sale for Table {request.TableCode} (retain prior lines)"
            : $"open a normal native table sale for Table {request.TableCode}";
        return new[]
        {
            "1. locate IPS terminal process",
            "2. verify expected native sale/table screen",
            $"3. locate Table {request.TableCode} on the table map",
            $"4. {open}",
            $"5. enter {plus}",
            "6. apply requested quantities",
            "7. verify each PLU resolves to its expected native item",
            "8. observe IdealPOS-native price (read-only; IdealPOS is the pricing authority)",
            "9. identify the Save-to-Table / Send action",
            "10. await native POSServer confirmation (never treat UI completion alone as confirmed)",
        };
    }
}
