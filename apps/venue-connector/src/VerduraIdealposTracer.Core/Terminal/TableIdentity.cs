namespace VerduraIdealposTracer.Core.Terminal;

/// <summary>
/// Exact, delimiter-aware matching of a native table code against text read
/// off the native UI.
///
/// This type exists because the previous verifier asked whether the
/// confirmation control's text CONTAINED the requested code. Table "5" is a
/// substring of "15", "25", "50" and "Table 5 of 19", so a substring test
/// could report the wrong table as assigned — the precise condition
/// directive §29 requires a stop for. Matching is therefore done on whole
/// tokens, never on substrings.
///
/// A token is a maximal run of letters and digits. Two tokens match when
/// they are equal ignoring case, or when both are all-digits and equal
/// numerically (so a UI that renders "05" still matches native code "5"
/// without "5" ever matching "15").
/// </summary>
public static class TableIdentity
{
    /// <summary>
    /// Splits text into alphanumeric tokens. Everything else — spaces,
    /// punctuation, parentheses, currency, newlines — is a delimiter.
    /// </summary>
    public static IReadOnlyList<string> Tokenize(string? text)
    {
        var tokens = new List<string>();
        if (string.IsNullOrEmpty(text)) return tokens;

        var start = -1;
        for (var i = 0; i < text.Length; i++)
        {
            if (char.IsLetterOrDigit(text[i]))
            {
                if (start < 0) start = i;
            }
            else if (start >= 0)
            {
                tokens.Add(text[start..i]);
                start = -1;
            }
        }
        if (start >= 0) tokens.Add(text[start..]);
        return tokens;
    }

    /// <summary>True when two individual tokens denote the same table code.</summary>
    public static bool TokensMatch(string? a, string? b)
    {
        if (string.IsNullOrWhiteSpace(a) || string.IsNullOrWhiteSpace(b)) return false;

        var left = a.Trim();
        var right = b.Trim();

        if (string.Equals(left, right, StringComparison.OrdinalIgnoreCase)) return true;

        // Numeric equality only when BOTH sides are entirely digits. This
        // deliberately does not fall back to a numeric parse of "Table 5" —
        // a token is compared as a token.
        if (left.All(char.IsDigit) && right.All(char.IsDigit)
            && long.TryParse(left, out var l) && long.TryParse(right, out var r))
        {
            return l == r;
        }

        return false;
    }

    /// <summary>
    /// True when <paramref name="text"/> carries <paramref name="tableCode"/>
    /// as a whole token. "Table 5" matches "5"; "Table 15", "Table 50" and
    /// "15" do not.
    /// </summary>
    public static bool TextCarriesTable(string? text, string? tableCode)
    {
        if (string.IsNullOrWhiteSpace(tableCode)) return false;
        foreach (var token in Tokenize(text))
        {
            if (TokensMatch(token, tableCode)) return true;
        }
        return false;
    }

    /// <summary>
    /// True when two table codes are the same table. Used wherever a
    /// requested code is compared with an observed one.
    /// </summary>
    public static bool SameTable(string? a, string? b) => TokensMatch(a?.Trim(), b?.Trim());

    /// <summary>
    /// Renders a cell template such as <c>"Table {code}"</c> for a specific
    /// table. Returns null when the template cannot address a single table.
    /// </summary>
    public static string? RenderCellText(string? template, string? tableCode)
    {
        if (string.IsNullOrWhiteSpace(template) || string.IsNullOrWhiteSpace(tableCode)) return null;
        if (!template.Contains("{code}", StringComparison.OrdinalIgnoreCase)) return null;
        return template.Replace("{code}", tableCode.Trim(), StringComparison.OrdinalIgnoreCase);
    }
}
