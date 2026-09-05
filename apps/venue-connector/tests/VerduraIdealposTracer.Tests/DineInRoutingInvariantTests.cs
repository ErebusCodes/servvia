using System.Reflection;
using VerduraIdealposTracer.Core.Terminal;
using Xunit;

namespace VerduraIdealposTracer.Tests;

/// <summary>
/// Executable guards for the structural invariants that are easy to state
/// and easy to lose: dine-in has exactly ONE route, an unstable POSServer
/// row ID is never durable identity, and no price ever enters IdealPOS from
/// Verdura.
///
/// These are deliberately architecture-level rather than behavioural. Each
/// one is a rule that a perfectly reasonable future edit could break without
/// any behavioural test noticing — a helper added "just to reuse the bridge
/// client", an ID field added to durable state "for debugging", a price
/// added to a payload "so the tablet total matches". They cost nothing to
/// run and they fail loudly at exactly the moment the invariant dies.
/// </summary>
public sealed class DineInRoutingInvariantTests
{
    private static DirectoryInfo SolutionRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null
            && !File.Exists(Path.Combine(dir.FullName, "VerduraIdealposTracer.slnx"))
            && !File.Exists(Path.Combine(dir.FullName, "VerduraIdealposTracer.sln")))
        {
            dir = dir.Parent;
        }
        Assert.NotNull(dir);
        return dir!;
    }

    private static IReadOnlyList<(string File, string Text)> SourcesUnder(params string[] relativeParts)
    {
        var dir = Path.Combine(new[] { SolutionRoot().FullName }.Concat(relativeParts).ToArray());
        Assert.True(Directory.Exists(dir), $"Expected source directory {dir} to exist.");
        return Directory.GetFiles(dir, "*.cs", SearchOption.AllDirectories)
            .Select(f => (File: Path.GetFileName(f), Text: File.ReadAllText(f)))
            .ToList();
    }

    // ───────────────────────── one route for dine-in ─────────────────────────

    /// <summary>
    /// Identifiers that only appear if the native terminal path has started
    /// talking to the Webit/Bridge submission path. Deliberately specific
    /// type and command names, not the bare word "Webit" — IdealPOS option
    /// catalogues legitimately record strings like
    /// <c>IdealWebitAutoPrintKitchen</c> as evidence, and evidence is not
    /// coupling.
    /// </summary>
    private static readonly string[] BridgeRouteIdentifiers =
    {
        "IdealposBridgeClient",
        "IdealposOrderSubmissionService",
        "BridgeOrderRequest",
        "Core.OrderSubmission",
        "idealpos.submit_order.v1",
        "WebPendingOrder",
    };

    private static readonly string[] NativeRouteIdentifiers =
    {
        "TerminalRoundService",
        "TerminalRoundRequest",
        "NativeRoundPlan",
        "TerminalConfirmationEvaluator",
        "Core.Terminal",
    };

    [Fact]
    public void TheNativeTerminalRoundPath_NeverReachesForTheWebitBridgeSubmissionPath()
    {
        var offences = new List<string>();
        foreach (var (file, text) in SourcesUnder("src", "VerduraIdealposTracer.Core", "Terminal"))
        {
            foreach (var identifier in BridgeRouteIdentifiers)
            {
                if (text.Contains(identifier, StringComparison.Ordinal))
                {
                    offences.Add($"{file} references '{identifier}'");
                }
            }
        }

        Assert.True(offences.Count == 0,
            "Dine-in must have exactly one route (NATIVE_IDEALPOS_TABLE). The native terminal path has acquired a "
            + "dependency on the Webit/Bridge submission path, which is how a dual-write or a silent fallback starts: "
            + string.Join("; ", offences));
    }

    [Fact]
    public void TheWebitBridgeSubmissionPath_NeverReachesForTheNativeTerminalRoundPath()
    {
        var offences = new List<string>();
        foreach (var (file, text) in SourcesUnder("src", "VerduraIdealposTracer.Core", "OrderSubmission"))
        {
            foreach (var identifier in NativeRouteIdentifiers)
            {
                if (text.Contains(identifier, StringComparison.Ordinal))
                {
                    offences.Add($"{file} references '{identifier}'");
                }
            }
        }

        Assert.True(offences.Count == 0,
            "The Bridge submission path must not fall back to, or dual-write through, the native terminal path: "
            + string.Join("; ", offences));
    }

    [Fact]
    public void NoTerminalTypeIsReachableFromTheOrderSubmissionAssemblySurface()
    {
        // The source scan above catches static calls; this catches the other
        // half — a Terminal type appearing in an OrderSubmission signature.
        var offences = new List<string>();
        var assembly = typeof(TerminalRoundService).Assembly;

        foreach (var type in assembly.GetTypes().Where(t => t.Namespace?.EndsWith(".OrderSubmission", StringComparison.Ordinal) == true))
        {
            IEnumerable<Type> Referenced()
            {
                foreach (var p in type.GetProperties(BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static)) yield return p.PropertyType;
                foreach (var f in type.GetFields(BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static)) yield return f.FieldType;
                foreach (var m in type.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly))
                {
                    yield return m.ReturnType;
                    foreach (var p in m.GetParameters()) yield return p.ParameterType;
                }
            }

            foreach (var referenced in Referenced())
            {
                var candidates = referenced.IsGenericType
                    ? new[] { referenced }.Concat(referenced.GetGenericArguments())
                    : new[] { referenced };
                foreach (var candidate in candidates)
                {
                    if (candidate.Namespace?.EndsWith(".Terminal", StringComparison.Ordinal) == true)
                    {
                        offences.Add($"{type.Name} exposes {candidate.Name}");
                    }
                }
            }
        }

        Assert.True(offences.Count == 0,
            "A Bridge-submission type exposes a native terminal type — the two dine-in routes must stay disjoint: "
            + string.Join("; ", offences));
    }

    // ──────────────── unstable POSServer row ID is never identity ────────────────

    /// <summary>
    /// POSServer regenerates a pending sale's row ID on ordinary edits — the
    /// 2026-09-05 live run watched one materially unchanged Table 5 sale move
    /// through four IDs. Anything that stored such an ID as durable identity
    /// would silently lose the round it was tracking, so no durable terminal
    /// type may carry one at all.
    /// </summary>
    [Theory]
    [InlineData(typeof(TableSaleFingerprint))]
    [InlineData(typeof(TerminalLineFingerprint))]
    [InlineData(typeof(TerminalRoundStateEntry))]
    [InlineData(typeof(TerminalRoundRequest))]
    [InlineData(typeof(TerminalRoundItem))]
    [InlineData(typeof(NativeRoundStep))]
    public void NoDurableTerminalType_CarriesAPosServerRowId(Type type)
    {
        string[] forbidden = { "PendingSale", "PendingSales", "RowId", "SaleId", "NativeId", "PosServerId", "RecordId" };

        foreach (var property in type.GetProperties(BindingFlags.Public | BindingFlags.Instance))
        {
            var name = property.Name;

            Assert.False(string.Equals(name, "Id", StringComparison.OrdinalIgnoreCase),
                $"{type.Name}.{name} is a bare Id — durable terminal identity must be the Verdura key "
                + "(ExternalOrderId, RoundId) or the natural POSServer key (Code, Pos, Map), never a regenerated row ID.");

            foreach (var fragment in forbidden)
            {
                Assert.False(name.Contains(fragment, StringComparison.OrdinalIgnoreCase),
                    $"{type.Name}.{name} looks like a POSServer row ID ('{fragment}'). POSServer regenerates that value "
                    + "on ordinary edits, so it can never be durable causal or idempotency identity.");
            }
        }
    }

    [Fact]
    public void TheIdempotencyKey_IsTheVerduraRoundKey_AndNothingElse()
    {
        // Stated as a test so the key cannot quietly gain a third component
        // (or lose one) without a decision being made about it.
        var entry = typeof(TerminalRoundStateEntry);
        Assert.NotNull(entry.GetProperty("ExternalOrderId"));
        Assert.NotNull(entry.GetProperty("RoundId"));

        var find = typeof(TerminalRoundStateStore).GetMethod(nameof(TerminalRoundStateStore.Find))!;
        Assert.Equal(
            new[] { "externalOrderId", "roundId" },
            find.GetParameters().Select(p => p.Name).ToArray());
    }

    // ─────────── one chokepoint into the native driver ───────────

    /// <summary>
    /// TerminalRoundService must be the ONLY production caller of the native
    /// drive. Every guarantee in this system — the durable idempotency gate,
    /// the pre-send preconditions, the persisted baseline, "reconcile, never
    /// resend" — lives inside that method. A second caller anywhere would not
    /// weaken those rules, it would bypass them entirely, and no behavioural
    /// test of the service would notice, because the service would simply not
    /// be involved.
    ///
    /// Interface and implementation DECLARATIONS are fine and expected; this
    /// counts call sites (a leading dot and an argument list), which is why
    /// the fake and the Windows driver implementing the method do not trip
    /// it.
    /// </summary>
    [Fact]
    public void OnlyTerminalRoundService_EverInvokesTheNativeDrive()
    {
        var callSites = new List<string>();
        foreach (var (file, text) in SourcesUnder("src"))
        {
            if (!text.Contains(".AttemptSaveToTableAsync(", StringComparison.Ordinal)) continue;
            if (string.Equals(file, "TerminalRoundService.cs", StringComparison.Ordinal)) continue;
            callSites.Add(file);
        }

        Assert.True(callSites.Count == 0,
            "The native drive is invoked outside TerminalRoundService, bypassing the durable idempotency gate, the "
            + "pre-send preconditions and the persisted baseline entirely: " + string.Join(", ", callSites));
    }

    // ─────────── the retired S6 "Save to Table" model stays retired ───────────

    /// <summary>
    /// The 2026-09-05 Table 5 capture proved the native send is selecting the
    /// destination table on the TABLE MAP. There is no Save button in that
    /// workflow.
    ///
    /// IPS.exe does contain <c>cmdSave</c> and the string "Cannot Save to
    /// Table" — recorded in <c>IdealposStaticBindings</c> as real static
    /// evidence — so the S6 model is not fiction, it is simply not the proven
    /// workflow. That combination is exactly what makes it liable to creep
    /// back: a plausible-looking button, present in the binary, one config
    /// field away from being driven. These guards make the creep a build
    /// failure instead of a live action.
    /// </summary>
    [Fact]
    public void TheSelectorModel_HasNoSaveButtonToPopulate()
    {
        var saveish = typeof(TerminalUiSelectors).GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Where(p => p.Name.Contains("Save", StringComparison.OrdinalIgnoreCase)
                || p.Name.Contains("Commit", StringComparison.OrdinalIgnoreCase)
                || p.Name.Contains("Confirm", StringComparison.OrdinalIgnoreCase))
            .Select(p => p.Name)
            .ToArray();

        Assert.True(saveish.Length == 0,
            "The retired S6 model is back: TerminalUiSelectors has gained a save/commit/confirm control. The native "
            + "send is selecting the table on the TABLE MAP — a populated Save selector would be a second, unproven "
            + "send path: " + string.Join(", ", saveish));
    }

    [Fact]
    public void TheNativePlan_HasNoSaveStep_ForEitherRoundKind()
    {
        foreach (var kind in new[] { TerminalRoundKind.FirstRound, TerminalRoundKind.SecondRound })
        {
            var request = new TerminalRoundRequest
            {
                ExternalOrderId = "ORD-INV",
                RoundId = "round-1",
                RoundKind = kind,
                OrderReference = "REF-INV",
                TableCode = "5",
                Items = new[] { new TerminalRoundItem("708", 1) },
            };

            var steps = NativeRoundPlan.Build(request);

            Assert.DoesNotContain(steps, s => s.Description.Contains("Save", StringComparison.OrdinalIgnoreCase));
            Assert.Equal(
                NativeStepKind.SelectTableCommit,
                Assert.Single(steps, s => s.IsSendBoundary).Kind);
        }
    }

    [Fact]
    public void TheOnlySendBoundaryStepKind_IsTheTableMapSelection()
    {
        // Stated over the enum itself so a new mutating step kind cannot
        // quietly become a second send boundary.
        foreach (var kind in Enum.GetValues<NativeStepKind>())
        {
            var step = new NativeRoundStep { Kind = kind, Description = "probe" };
            Assert.Equal(kind == NativeStepKind.SelectTableCommit, step.IsSendBoundary);
        }
    }

    // ──────────────── IdealPOS remains the pricing authority ────────────────

    [Theory]
    [InlineData(typeof(TerminalRoundItem))]
    [InlineData(typeof(TerminalRoundRequest))]
    [InlineData(typeof(NativeRoundStep))]
    [InlineData(typeof(TerminalLineFingerprint))]
    public void NoInputToTheNativeRound_CanCarryAPrice(Type type)
    {
        string[] priceish = { "price", "amount", "total", "cost", "money", "tax", "discount" };

        foreach (var property in type.GetProperties(BindingFlags.Public | BindingFlags.Instance))
        {
            foreach (var fragment in priceish)
            {
                Assert.False(property.Name.Contains(fragment, StringComparison.OrdinalIgnoreCase),
                    $"{type.Name}.{property.Name} could carry a price INTO IdealPOS. IdealPOS is the sole pricing "
                    + "authority: a price may only be OBSERVED back, on ObservedTerminalLine.");
            }
        }
    }

    [Fact]
    public void APriceExistsOnlyAsAnObservationReadBackFromIdealpos()
    {
        var observed = typeof(ObservedTerminalLine).GetProperty(nameof(ObservedTerminalLine.ObservedNativeUnitPrice));
        Assert.NotNull(observed);
        Assert.Equal(typeof(decimal?), observed!.PropertyType);

        // And it lives on a RESULT, never reachable from a request: nothing a
        // round sends can name it.
        Assert.DoesNotContain(
            typeof(TerminalRoundRequest).GetProperties(),
            p => p.PropertyType == typeof(ObservedTerminalLine)
                || (p.PropertyType.IsGenericType && p.PropertyType.GetGenericArguments().Contains(typeof(ObservedTerminalLine))));
    }
}
