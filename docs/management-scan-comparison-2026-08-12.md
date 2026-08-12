# Management Scan Performance — Run 2 Narrative (2026-08-10 → 2026-08-12)

*Second full end-to-end pass, run per `management-scan-testing-runbook.md`. Report file: `reports/ManagementScan_FULL_Report_2026-08-12_2026-08-12_08-19-28.xlsx`.*

*For the raw timing table, see the auto-generated `management-scan-perf-comparison-latest.md` (produced by `compare-perf-runs.mjs` from `results/mgscan-perf-trend.json`) — this doc only covers the judgment calls the script can't make.*

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
