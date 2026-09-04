using System.Text.Json;
using VerduraIdealposTracer.Core.Automation;
using VerduraIdealposTracer.Core.Terminal;
using Xunit;

namespace VerduraIdealposTracer.Tests;

/// <summary>
/// The profile is the ONLY way selectors reach the runtime, so its
/// deserialization is a safety surface: a field that silently fails to bind
/// leaves a selector null and — before 2026-09-04 — was invisible, because
/// <c>Program.cs</c> discarded the selectors and the version anyway.
/// </summary>
public sealed class DiscoveryProfileDeserializationTests
{
    /// <summary>The profile shape currently deployed in production (three fields, nothing else).</summary>
    private const string LegacyProfileJson = """
    {
      "ExpectedProcessName": "IPSClient",
      "ExpectedMainWindowTitleContains": "Idealpos",
      "ProfileVersion": "DUNEDIN-CLOUD-MODE-UNUSED"
    }
    """;

    /// <summary>The shipped sample: new fields present, selectors deliberately null.</summary>
    private const string SampleProfileJson = """
    {
      "_comment": [ "commentary the deserializer must ignore" ],
      "ExpectedProcessName": "IPS",
      "ExpectedMainWindowTitleContains": "Idealpos",
      "SaleScreenWindowTitleEquals": "POS Screen",
      "SaleScreenWindowTitleExcludes": [ "BACKOFFICE" ],
      "SaleScreenWindowPreferredClassNames": [ "ThunderRT6FormDC" ],
      "SaleScreenWindowExcludedClassNames": [ "ThunderRT6MDIForm" ],
      "SaleScreenRequireVisible": true,
      "TableMapControl": null,
      "TableCellTemplate": null,
      "PluEntryField": null,
      "SaveToTableAction": null,
      "TableAssignmentConfirmationControl": null,
      "ProfileVersion": "ips-vb6-native-target-corrected-2026-09-02__control-selectors-PENDING-runtime-capture"
    }
    """;

    /// <summary>A hypothetical fully-populated profile, to prove the fields really do bind.</summary>
    private const string PopulatedProfileJson = """
    {
      "ExpectedProcessName": "IPS",
      "ExpectedMainWindowTitleContains": "Idealpos",
      "SaleScreenWindowTitleEquals": "POS Screen",
      "SaleScreenWindowTitleExcludes": [ "BACKOFFICE" ],
      "SaleScreenWindowPreferredClassNames": [ "ThunderRT6FormDC" ],
      "TableMapControl": { "ClassName": "MSFlexGridWndClass", "ControlId": 4101 },
      "TableCellTemplate": "Table {code}",
      "PluEntryField": { "ClassName": "ThunderRT6TextBox", "ControlId": 4102 },
      "SaveToTableAction": { "ClassName": "ThunderRT6CommandButton", "TextEquals": "Save to Table" },
      "TableAssignmentConfirmationControl": { "ClassName": "ThunderRT6Label", "ControlId": 4110 },
      "ProfileVersion": "verified-2026-09-05-real-capture"
    }
    """;

    private static IdealposVerifiedProfile Parse(string json) =>
        JsonSerializer.Deserialize<IdealposVerifiedProfile>(json)!;

    /// <summary>The production profile must keep parsing — the new fields are additive and optional.</summary>
    [Fact]
    public void LegacyThreeFieldProfile_StillDeserializes()
    {
        var profile = Parse(LegacyProfileJson);

        Assert.Equal("IPSClient", profile.ExpectedProcessName);
        Assert.Equal("DUNEDIN-CLOUD-MODE-UNUSED", profile.ProfileVersion);
        Assert.Null(profile.PluEntryField);
    }

    [Fact]
    public void ShippedSample_DeserializesButIsNotReady()
    {
        var profile = Parse(SampleProfileJson);
        var selectors = profile.BuildTerminalSelectors();

        Assert.False(TerminalSelectorReadiness.IsReadyForLiveExecution(selectors, out var reason));
        Assert.Contains("version", reason);
    }

    [Fact]
    public void ShippedSample_StillSelectsThePosScreenForCapture()
    {
        var criteria = Parse(SampleProfileJson).BuildSaleScreenCriteria();

        Assert.Equal("POS Screen", criteria.TitleEquals);
        Assert.Contains("BACKOFFICE", criteria.TitleExcludes);
        Assert.Contains("ThunderRT6FormDC", criteria.PreferredClassNames);
    }

    [Fact]
    public void PopulatedProfile_BindsEverySelectorAndBecomesReady()
    {
        var profile = Parse(PopulatedProfileJson);
        var selectors = profile.BuildTerminalSelectors();

        Assert.Equal("ThunderRT6TextBox", selectors.PluEntryField!.ClassName);
        Assert.Equal(4102, selectors.PluEntryField.ControlId);
        Assert.Equal("Save to Table", selectors.SaveToTableAction!.TextEquals);
        Assert.Equal("verified-2026-09-05-real-capture", selectors.ProfileVersion);

        Assert.True(TerminalSelectorReadiness.IsReadyForLiveExecution(selectors, out var reason), reason);
    }

    /// <summary>
    /// Readiness must be reachable ONLY through a complete profile — dropping
    /// any single required selector puts it back to refusing.
    /// </summary>
    [Fact]
    public void RemovingTheVerificationSelector_MakesAReadyProfileUnready()
    {
        var profile = Parse(PopulatedProfileJson) with { TableAssignmentConfirmationControl = null };

        Assert.False(TerminalSelectorReadiness.IsReadyForLiveExecution(profile.BuildTerminalSelectors(), out _));
    }
}
