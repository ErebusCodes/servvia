using VerduraIdealposTracer.Core.Terminal;
using Xunit;

namespace VerduraIdealposTracer.Tests;

/// <summary>
/// Regression tests for Phase 1 audit defect D4: the previous verifier asked
/// whether the control text CONTAINED the table code, so table 5 matched 15,
/// 25, 50 and "Table 5 of 19". Selecting or confirming the wrong table is a
/// §29 stop condition, so these cases are asserted individually.
/// </summary>
public sealed class TableIdentityTests
{
    [Theory]
    [InlineData("Table 5", "5")]
    [InlineData("TABLE 5", "5")]
    [InlineData("5", "5")]
    [InlineData("Table 5 - Seated", "5")]
    [InlineData("Table 05", "5")]
    [InlineData("Table 5 (2 covers)", "5")]
    public void TextCarryingTheTableAsAWholeToken_Matches(string text, string code)
    {
        Assert.True(TableIdentity.TextCarriesTable(text, code));
    }

    [Theory]
    [InlineData("Table 15", "5")]
    [InlineData("Table 25", "5")]
    [InlineData("Table 50", "5")]
    [InlineData("Table 51", "5")]
    [InlineData("15", "5")]
    [InlineData("Table 155", "15")]
    public void TextWhereTheCodeIsOnlyASubstring_DoesNotMatch(string text, string code)
    {
        Assert.False(TableIdentity.TextCarriesTable(text, code));
    }

    /// <summary>
    /// The specific pairing the directive calls out: Table 5 must never be
    /// confused with Table 15, in either direction.
    /// </summary>
    [Fact]
    public void Table5AndTable15_AreNeverTheSameTable()
    {
        Assert.False(TableIdentity.SameTable("5", "15"));
        Assert.False(TableIdentity.SameTable("15", "5"));
        Assert.False(TableIdentity.TextCarriesTable("Table 15", "5"));
        Assert.False(TableIdentity.TextCarriesTable("Table 5", "15"));
    }

    [Fact]
    public void SameTable_IsCaseInsensitiveAndTrimmed()
    {
        Assert.True(TableIdentity.SameTable(" a1 ", "A1"));
        Assert.False(TableIdentity.SameTable("A1", "A10"));
    }

    [Fact]
    public void SameTable_TreatsLeadingZerosAsTheSameNumericTable()
    {
        Assert.True(TableIdentity.SameTable("05", "5"));
        Assert.False(TableIdentity.SameTable("05", "50"));
    }

    [Fact]
    public void BlankCode_NeverMatches()
    {
        Assert.False(TableIdentity.TextCarriesTable("Table 5", ""));
        Assert.False(TableIdentity.TextCarriesTable("Table 5", null));
        Assert.False(TableIdentity.SameTable(null, null));
    }

    [Fact]
    public void RenderCellText_RequiresTheCodePlaceholder()
    {
        Assert.Equal("Table 5", TableIdentity.RenderCellText("Table {code}", "5"));
        Assert.Null(TableIdentity.RenderCellText("Table", "5"));
        Assert.Null(TableIdentity.RenderCellText(null, "5"));
    }
}
