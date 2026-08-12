# Management Scan Performance — Run 2 Narrative (2026-08-10 → 2026-08-12)

*Second full end-to-end pass, run per `management-scan-testing-runbook.md`. Report file: `reports/ManagementScan_FULL_Report_2026-08-12_v2_2026-08-12_11-53-08.xlsx` (supersedes the original `..._08-19-28.xlsx` — see addendum below).*

*For the raw timing table, see the auto-generated `management-scan-perf-comparison-latest.md` (produced by `compare-perf-runs.mjs` from `results/mgscan-perf-trend.json`) — this doc only covers the judgment calls the script can't make.*

## Addendum (same day, 2026-08-12): terminology fix + real PDF coverage

After the run below, two corrections were made to the same 20260812 dataset (no new browser session needed for the first; the second re-ran just the Director-role sweep):

1. **Dropped "Employee" as a reported role, per explicit instruction ("we only checking with manager and director only").** The report now shows exactly two roles using the feature's own terms — **Manager** (assessed person; was labeled "employee") and **Director** (evaluator; was labeled "manager"). The third org-hierarchy account (one level above the evaluator) is no longer part of the timed sweep at all — it only ever existed to demonstrate the Publish/Unpublish 500 bug, which stays in Known Issues without needing a live re-run every time.
2. **PDF view/download was actually broken in the test, not in the product.** Investigated the real Knockout bindings (`mgScanManager.html`/`.js`) after being asked to verify "PDF view and downloading also now working": the row-level Report (PDF) icon and the Nine-Grid toolbar's Report (PDF) button (a 2-step flow — language popup, then a real `window.open`) were both real, working features, recently touched by PR 5590/5581 (2026-08-07). The test script's row-level check had been silently broken since it matched a static `title="Download PDF"` HTML attribute that gets overwritten at runtime by a Knockout token binding (`attr: { title: tokens().ReportPdf }`) — it always reported "not found" without ever actually testing the click. Fixed by matching the stable `.fa-file-pdf` icon class instead, and added the previously-untested toolbar flow as a new step.

**Result, both now genuinely measured and working:**
- Director, toolbar Report (PDF) (language popup + Ok): **5,449 ms** (real download, `ManagementScanOverviewReport_English_20260812.pdf`)
- Director, row-level Report (PDF) icon: **4,491 ms** (real download, `ManagementScanManagerReport_English_20260812.pdf`)
- Manager, Personal Dashboard Report (PDF): **6,589 ms** (unchanged from the run below, real download, `ManagementScanEmployeeReport_English_20260812.pdf`)

All three PDF paths verdict "Slow" (>3,000ms Action threshold) but functionally correct. This wasn't a perf regression — the toolbar/row-level steps are brand new to the test, there's nothing to regress against yet.

**Process fix found along the way:** `create-mgscan-test-accounts.mjs` used to overwrite `results/account-setup-<runStamp>.json` instead of merging when called a second time for the same runStamp (e.g. creating the standalone validation account after the director/manager/employee hierarchy) — this silently destroyed the earlier accounts' saved credentials and crashed the next script that needed them. Fixed to merge by role.

Trend log entries: `20260812` (original, now superseded for methodology reasons — kept for history) and `20260812-v2` (current). Both share `releaseId: "pre-PR5661-5665"` — this was a test-coverage fix, not a new release.

---

## Original Run 2 (below, now partially superseded — see addendum above for what changed)

## Headline finding: this did NOT test the new release

The user asked for this run because master has picked up real Management Scan changes since the baseline — notably PR 5665 ("Assessment play - change manager question tokens and remove open questions") and PR 5661 ("Manager report"), plus several Manager-view fixes. **The IT test environment has not been redeployed with these changes.** Confirmed directly: the fresh assessment cycle created for this run still rendered 31 questions for the Manager/evaluator side (`.mgscan-question` count, not a hardcoded assumption) — PR 5665 would have made that 28. This run is therefore a **same-build repeat of the baseline** (both recorded with `releaseId: "pre-PR5661-5665"` in the trend log), not a new-release comparison. It's still useful as a stability check, but the actual "does the new release regress anything" question is still open — see Next Steps.

**Dataset**: 3 fresh accounts (PerfTest Director → Manager → Employee) + 1 standalone validation account, same shape as baseline — exactly 1 candidate per manager.

## Timing summary

No step regressed to a worse verdict bucket (confirmed by `compare-perf-runs.mjs`). Everything is flat or slightly faster, well within normal variance, with one outlier: Employee's Report (PDF) click nearly halved (12,768ms → 6,589ms). Since IT wasn't redeployed, this isn't attributable to the new release — most likely session/server load variance between the two test windows. Worth a 3rd data point before treating it as a trend.

Also worth noting: several baseline verdict labels (e.g. "Search by name" at 714ms labeled Acceptable, when the Action threshold is Good ≤1,000ms) don't match what the current threshold rule would produce for the same value — the baseline `.md`'s verdict column appears to have been transcribed loosely rather than pulled verbatim from the tool. Trust the ms deltas in the auto-generated comparison over any verdict-label wording differences between older hand-written docs and the tool's actual output.

## Bug re-verification

**`SetManagementScanPublishState` HTTP 500 for a non-authorized caller — STILL PRESENT.** Reproduced a third time (2026-08-10 x2, 2026-08-12), identical response body (`{"Message":"There was an error processing the request.","StackTrace":"","ExceptionType":""}`). Not touched by any PR merged between the two test dates — not a regression, just still open.

**Kalibirity's correct blocking behavior for Director — still correct.** Manual-override swatches remain non-interactive (30s timeout) for the unauthorized Director, consistent with ADR-001.

## Functional checks (Assessment page) — 6/6 passed, unchanged

Identical results to baseline: unanswered-highlight, validation banner, no-navigate-on-fail, Pause/Resume with answer retention (3/3). See `results/assessment-validation-20260812.json`.

## New observations this run

- **"Add New" flake was worse this run**: 2 of 3 attempts to create the standalone validation account landed on the wrong tab and hit the full 45s timeout (vs. baseline's "2 of roughly 6"). Both recovered on manual retry — not a hard blocker, but worth watching if this trends further.
- **Publish/Unpublish log label bug fixed in the test script itself**: `director-publish.mjs` printed "Logged in as Director." regardless of which role was actually being tested — a leftover from before the script supported both roles. Fixed to print the actual role.

## Next steps

1. **This is not a new-release verification.** Confirm with the deploy owner when IT will be redeployed, then re-run `management-scan-testing-runbook.md` §2-§7 once it reflects PR 5665/5661 — specifically re-check that the Manager side now renders 28 questions (not 31), and functionally verify the new Manager report (PR 5661) since this suite doesn't cover it yet. Give that run a new `releaseId` in the trend log once confirmed.
2. Alternatively, if a faster signal is wanted before IT redeploys, build and run locally against current `master` — accepting a different environment than the baseline (known limitation already called out in the runbook).
3. File the `SetManagementScanPublishState` 500 as an actual ADO bug — it's now been reproduced three times across two sessions and is still only tracked in these docs, not in Azure DevOps.
4. Ask whoever owns IT deploys whether a build/version marker (footer stamp or a `/version` endpoint) could be added — there's currently no way to confirm what's deployed other than probing for a known behavior change, which only works for releases you already know the content of.
