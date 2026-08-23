# Story 9-2 — Idealpos Discovery Tracer: Operator Runbook

**Audience:** the authorised operator running this on the real Windows machine at the Dunedin venue (or an equivalent test machine with Idealpos installed) — not a developer, not this repository's author (who had no Windows/Idealpos access when writing it).

**Before you do anything:** read the [Safety Boundary](#safety-boundary) section below in full. If anything here conflicts with your own judgement about what's safe on this machine, stop and ask the engineering owner — do not proceed on your own interpretation.

---

## What this is

A small program that checks whether a specific, expected version of Idealpos is running on this machine, and — only if everything looks exactly as expected — reads the title of its main window once, without touching any table, order, item, or payment screen. It never creates a sale, never prints anything, never touches EFTPOS.

It produces a small JSON file describing what it found. That file (redacted per the checklist below) is the evidence this story needs.

## What this is NOT

- It is **not** the production Verdura Connector.
- It does **not** create real Idealpos orders.
- It does **not** touch payments, EFTPOS, or kitchen printing.
- Running it does **not** authorise any of those things to happen later — a separate, later story and a separate approval are required before any of that is built.

---

## Safety boundary

- Do not run this against a real production venue database unless you have been explicitly told this specific run is approved against production. When in doubt, ask first.
- Do not enter, save, or approve anything in Idealpos yourself while this tool is running.
- Do not run this while a real customer order is open on the same terminal.
- If Idealpos shows anything unexpected (a dialog, an error, a locked screen) while this is running, the tool is designed to stop itself and report a failure — but if you see anything that looks wrong, close the tool immediately (see [Stop](#stop) below) rather than waiting for it to finish.
- Never type a licence key, password, card number, or any other secret into anything related to this tool, and never send screenshots that show one.

---

## Setup (one time)

1. You will be given a folder named `venue-connector` (the repository's `apps/venue-connector/`, copied out on its own — it does not need the rest of the Verdura repository). Copy it to the target Windows machine.
2. Install the free **.NET 8 SDK** from Microsoft's official site if it is not already installed — ask the engineering owner if you're unsure whether it already is. (Search "download .NET 8 SDK" on Microsoft's own site; do not download from any other source.)
3. Open a Command Prompt window in the `venue-connector` folder.
4. Run this exact command once to confirm the tool builds on this machine:
   ```
   dotnet build venue-connector\VerduraIdealposTracer.slnx
   ```
   If this fails, stop and send the engineering owner the exact error text — do not try to fix it yourself.

## Step 1 — Dry run (no Idealpos required)

This proves the tool itself works on this machine, using a fake/practice Idealpos instead of the real one. Run:

```
set TRACER_STORE_PATH=%TEMP%\tracer-dryrun.ndjson
set TRACER_COMMAND_ID=dryrun-1
dotnet run --project src\VerduraIdealposTracer.DryRunCli
```

You should see a block of JSON print to the screen ending with something like `"FailClosedReason": null`. If you see an error instead, stop and send the engineering owner the exact output.

## Step 2 — Complete the discovery profile

Copy `docs\discovery-profile.sample.json` to `docs\discovery-profile.local.json` and fill in the real values observed on this machine (exact process name, a distinctive piece of text you actually see in the Idealpos window's title bar, and a version label you choose, e.g. today's date). Do not guess — if you're not sure what to put, ask the engineering owner rather than filling in something approximate.

## Step 3 — Real discovery run (requires explicit approval)

**Do not run this step until an authorised operator has explicitly approved it for this specific machine and time.** When approved:

1. Make sure Idealpos is running normally on this machine, logged in, with no dialogs open, and no order currently being entered by anyone.
2. Run:
   ```
   set TRACER_STORE_PATH=%TEMP%\tracer-live-discovery.ndjson
   set TRACER_COMMAND_ID=live-discovery-1
   set TRACER_PROFILE_PATH=docs\discovery-profile.local.json
   dotnet run --project src\VerduraIdealposTracer.Cli
   ```
3. Watch the screen. The tool should finish within a few seconds and print a JSON result.
4. **Confirm nothing changed in Idealpos** — no new order, no printed ticket, no open table that wasn't already open. If anything looks different, stop and tell the engineering owner immediately, even if the tool itself reported success.

## Stop

At any point, press `Ctrl+C` in the Command Prompt window, or close the window. The tool makes no change that needs to be "undone" if stopped mid-run — closing it is always safe.

## Cleanup

- Delete the `%TEMP%\tracer-*.ndjson` files once the evidence below has been captured and handed over — they contain no secrets, but there is no reason to keep them longer than needed.
- Do not leave `docs\discovery-profile.local.json` on a shared machine if it contains anything you're unsure is safe to leave — it should only ever contain a process name, a window-title fragment, and a version label, never a secret.

---

## Evidence to return

For each run (dry run and, if approved and performed, the real discovery run), return:

1. The full JSON output printed to the screen.
2. The exact date/time and machine name it was run on.
3. The exact Idealpos version/build shown in Idealpos's own Help/About screen (type this in by hand — do not screenshot the licence screen).
4. Confirmation, in your own words, that nothing changed in Idealpos (no order created, nothing printed) after the real discovery run.
5. If anything failed or looked unexpected: what you saw on screen, in your own words — not a full-desktop screenshot. A cropped screenshot of only the specific error message is fine if a full-desktop one would show other open windows/data.

Do not return: licence keys, passwords, card data, full-desktop screenshots, or anything from the Idealpos database.
