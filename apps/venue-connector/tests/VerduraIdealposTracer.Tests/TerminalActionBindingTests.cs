using VerduraIdealposTracer.Core.Terminal;
using Xunit;

namespace VerduraIdealposTracer.Tests;

/// <summary>
/// The fail-closed rules for the evidence-graded binding model that replaces
/// the UIA-only selector assumption, now that the real target is known to be
/// the native VB6 IPS.exe rather than the managed IPSClient.exe.
///
/// The single most important property proved here: NOTHING in the static
/// catalogue can drive a live mutating action. Static analysis recovers real
/// control names, and a real name is still not evidence that the control is
/// on the screen the driver is looking at.
/// </summary>
public sealed class TerminalActionBindingTests
{
    private static TerminalActionBinding RuntimeProven(string action = "SendRound") => new()
    {
        Action = action,
        Mechanism = BindingMechanism.Win32Control,
        EvidenceLevel = EvidenceLevel.ProvenRuntime,
        ProcessName = IdealposStaticBindings.PosProcessName,
        FormType = IdealposStaticBindings.SaleScreenForm,
        ControlName = "cmdSave",
        WindowClass = "ThunderRT6CommandButton",
        ControlId = 4210,
    };

    // ── The central safety property ──

    [Fact]
    public void NoStaticBinding_CanDriveAMutatingAction()
    {
        Assert.NotEmpty(IdealposStaticBindings.All);

        foreach (var binding in IdealposStaticBindings.All)
        {
            Assert.Equal(EvidenceLevel.ProvenStatic, binding.EvidenceLevel);
            Assert.False(
                TerminalBindingReadiness.CanDriveMutatingAction(binding, out var reason),
                $"'{binding.Action}' must not be able to act on static evidence alone.");
            Assert.Contains("ProvenRuntime", reason);
        }
    }

    [Fact]
    public void StaticBindings_MayStillBeProbed()
    {
        // Static evidence is enough to go looking for a control - that is
        // what the next passive capture does - just not to act on it.
        foreach (var binding in IdealposStaticBindings.All)
        {
            Assert.True(TerminalBindingReadiness.CanProbe(binding, out var reason), reason);
        }
    }

    [Fact]
    public void StaticCatalogue_TargetsIPS_NotIPSClient()
    {
        // The whole reason this model exists: IPSClient.exe has no POS UI.
        Assert.Equal("IPS", IdealposStaticBindings.PosProcessName);
        Assert.All(IdealposStaticBindings.All, b => Assert.Equal("IPS", b.ProcessName));
        Assert.DoesNotContain(IdealposStaticBindings.All, b =>
            string.Equals(b.ProcessName, "IPSClient", StringComparison.OrdinalIgnoreCase));
    }

    // ── Forbidden controls ──

    [Theory]
    [InlineData("cmdPay")]
    [InlineData("cmdPayAll")]
    [InlineData("cmdPayLine")]
    [InlineData("cmdPayment")]
    [InlineData("cmdGotoTender")]
    [InlineData("cmdTender")]
    [InlineData("cmdDeleteLine")]
    public void PaymentAndDestructiveControls_AreRefused_EvenWhenRuntimeProven(string control)
    {
        var binding = RuntimeProven("SendRound") with { ControlName = control };

        Assert.True(TerminalBindingReadiness.IsForbiddenControl(binding));
        Assert.False(TerminalBindingReadiness.CanDriveMutatingAction(binding, out var reason));
        Assert.Contains("permanently forbidden", reason);
    }

    [Fact]
    public void AForbiddenControl_CannotEvenBeProbed()
    {
        var binding = RuntimeProven() with { ControlName = "cmdPay" };
        Assert.False(TerminalBindingReadiness.CanProbe(binding, out var reason));
        Assert.Contains("forbidden", reason);
    }

    [Fact]
    public void TheStaticCatalogue_ContainsNoForbiddenControl()
    {
        Assert.DoesNotContain(IdealposStaticBindings.All, TerminalBindingReadiness.IsForbiddenControl);
    }

    // ── Mechanism / identity coherence ──

    [Fact]
    public void ARuntimeProvenBinding_WithIdentity_CanAct()
    {
        Assert.True(TerminalBindingReadiness.CanDriveMutatingAction(RuntimeProven(), out var reason), reason);
    }

    [Fact]
    public void AMechanismWithoutItsIdentityField_IsRefused()
    {
        // Names a mechanism it cannot satisfy: Win32 with neither class nor id.
        var binding = RuntimeProven() with { WindowClass = null, ControlId = null };

        Assert.False(TerminalBindingReadiness.CanDriveMutatingAction(binding, out var reason));
        Assert.Contains("ControlId", reason);
    }

    [Fact]
    public void UiaWithoutAnAutomationId_IsRefused()
    {
        var binding = RuntimeProven() with { Mechanism = BindingMechanism.Uia, AutomationId = null };

        Assert.False(TerminalBindingReadiness.CanDriveMutatingAction(binding, out var reason));
        Assert.Contains(nameof(TerminalActionBinding.AutomationId), reason);
    }

    [Fact]
    public void AMenuCommandWithoutACommandId_IsRefused()
    {
        var binding = RuntimeProven() with { Mechanism = BindingMechanism.MenuCommand, MenuCommandId = null };

        Assert.False(TerminalBindingReadiness.CanDriveMutatingAction(binding, out var reason));
        Assert.Contains(nameof(TerminalActionBinding.MenuCommandId), reason);
    }

    [Fact]
    public void ABindingWithNoMechanism_IsRefused()
    {
        var binding = RuntimeProven() with { Mechanism = BindingMechanism.None };

        Assert.False(TerminalBindingReadiness.CanDriveMutatingAction(binding, out var reason));
        Assert.Contains("no binding mechanism", reason);
    }

    [Fact]
    public void ANullBinding_IsRefused_ForBothActingAndProbing()
    {
        Assert.False(TerminalBindingReadiness.CanDriveMutatingAction(null, out _));
        Assert.False(TerminalBindingReadiness.CanProbe(null, out _));
    }

    [Fact]
    public void ADefaultBinding_IsUnknown_AndCannotDoAnything()
    {
        // The default must be unusable, so an unpopulated binding can never
        // read as configured.
        var binding = new TerminalActionBinding { Action = "Unset" };

        Assert.Equal(EvidenceLevel.Unknown, binding.EvidenceLevel);
        Assert.Equal(BindingMechanism.None, binding.Mechanism);
        Assert.False(TerminalBindingReadiness.CanDriveMutatingAction(binding, out _));
        Assert.False(TerminalBindingReadiness.CanProbe(binding, out _));
    }

    // ── Guarded input: the last-resort mechanism ──

    [Fact]
    public void GuardedInput_WithoutGeometry_IsRefused()
    {
        var binding = RuntimeProven() with { Mechanism = BindingMechanism.GuardedInput, Geometry = null };

        Assert.False(TerminalBindingReadiness.CanDriveMutatingAction(binding, out var reason));
        Assert.Contains("without geometry", reason);
    }

    [Fact]
    public void GuardedInput_WithoutAParent_IsRefused_SoThereAreNoBlindCoordinates()
    {
        var binding = RuntimeProven() with
        {
            Mechanism = BindingMechanism.GuardedInput,
            Geometry = new BindingGeometry { RelativeX = 10, RelativeY = 10, Width = 80, Height = 40 },
            ParentBinding = null,
        };

        Assert.False(TerminalBindingReadiness.CanDriveMutatingAction(binding, out var reason));
        Assert.Contains("without a parent binding", reason);
    }

    [Fact]
    public void GuardedInput_WithAMerelyStaticParent_IsRefused()
    {
        var binding = RuntimeProven() with
        {
            Mechanism = BindingMechanism.GuardedInput,
            Geometry = new BindingGeometry { RelativeX = 10, RelativeY = 10, Width = 80, Height = 40 },
            ParentBinding = RuntimeProven("TableMap") with { EvidenceLevel = EvidenceLevel.ProvenStatic },
        };

        Assert.False(TerminalBindingReadiness.CanDriveMutatingAction(binding, out var reason));
        Assert.Contains("ProvenStatic", reason);
    }

    [Fact]
    public void GuardedInput_RuntimeProvenWithGeometryAndRuntimeParent_IsAllowed()
    {
        var binding = RuntimeProven() with
        {
            Mechanism = BindingMechanism.GuardedInput,
            Geometry = new BindingGeometry { RelativeX = 10, RelativeY = 10, Width = 80, Height = 40 },
            ParentBinding = RuntimeProven("TableMap"),
        };

        Assert.True(TerminalBindingReadiness.CanDriveMutatingAction(binding, out var reason), reason);
    }

    // ── Evidence ordering ──

    [Fact]
    public void EvidenceLevels_AreOrderedWeakestToStrongest()
    {
        Assert.True(EvidenceLevel.Unknown < EvidenceLevel.Partial);
        Assert.True(EvidenceLevel.Partial < EvidenceLevel.ProvenStatic);
        Assert.True(EvidenceLevel.ProvenStatic < EvidenceLevel.ProvenRuntime);
    }

    [Fact]
    public void PartialEvidence_CannotEvenProbe()
    {
        var binding = RuntimeProven() with { EvidenceLevel = EvidenceLevel.Partial };

        Assert.False(TerminalBindingReadiness.CanProbe(binding, out var reason));
        Assert.Contains("Partial", reason);
    }

    [Fact]
    public void AFormNameAlone_IsEnoughToProbe_ButNotToAct()
    {
        // Several catalogue entries have no isolated control yet - only the
        // form. "Walk frmSale and report what is there" is the probe that
        // turns a static name into a runtime-proven one.
        var binding = new TerminalActionBinding
        {
            Action = "ReadExistingSaleLines",
            Mechanism = BindingMechanism.Win32Control,
            EvidenceLevel = EvidenceLevel.ProvenStatic,
            ProcessName = IdealposStaticBindings.PosProcessName,
            FormType = IdealposStaticBindings.SaleScreenForm,
        };

        Assert.True(TerminalBindingReadiness.CanProbe(binding, out _));
        Assert.False(TerminalBindingReadiness.CanDriveMutatingAction(binding, out _));
    }

    [Fact]
    public void ABindingWithNoIdentityAtAll_CannotBeProbed()
    {
        var binding = new TerminalActionBinding
        {
            Action = "Nothing",
            Mechanism = BindingMechanism.Win32Control,
            EvidenceLevel = EvidenceLevel.ProvenStatic,
        };

        Assert.False(TerminalBindingReadiness.CanProbe(binding, out var reason));
        Assert.Contains("no identity of any kind", reason);
    }
}
