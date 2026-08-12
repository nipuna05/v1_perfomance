# Management Scan Performance — Run 2 vs. Baseline (2026-08-10 → 2026-08-12)

*Second full end-to-end pass, run per `management-scan-testing-runbook.md`. Report file: `reports/ManagementScan_FULL_Report_2026-08-12_2026-08-12_08-19-28.xlsx`. Compare against `management-scan-baseline-2026-08-10.md`.*

## Headline finding: this did NOT test the new release

The user asked for this run because master has picked up real Management Scan changes since the baseline — notably PR 5665 ("Assessment play - change manager question tokens and remove open questions") and PR 5661 ("Manager report"), plus several Manager-view fixes. **The IT test environment has not been redeployed with these changes.** Confirmed directly: the fresh assessment cycle created for this run still rendered 31 questions for the Manager/evaluator side (`.mgscan-question` count, not a hardcoded assumption) — PR 5665 would have made that 28. Everything below is therefore a **same-build repeat of the baseline**, not a new-release comparison. It's still useful (it shows the baseline numbers are stable two days later, on a fresh dataset), but the actual "does the new release regress anything" question is still open — see Next Steps.

**Dataset**: 3 fresh accounts (PerfTest Director → Manager → Employee) + 1 standalone validation account, same shape as baseline — exactly 1 candidate per manager.

## Timings vs. baseline

Verdicts below are read directly from each run's generated Excel "Details" sheet, not hand-derived. Note: several baseline verdicts (e.g. "Search by name" at 714ms labeled Acceptable, when the Action threshold is Good ≤1,000ms) don't match what today's threshold rule would produce for the same value — the baseline `.md`'s verdict column appears to have been transcribed loosely rather than pulled verbatim from the tool. Treat the **ms deltas** as the reliable comparison; don't over-index on a verdict label differing between the two docs for near-identical timings.

### Employee (Personal Dashboard only)

| Step | 08-10 ms | 08-12 ms | Δ | 08-12 Verdict |
|---|---:|---:|---:|---|
| Login (excluded from scope) | 7,704 | 6,864 | -840 | Slow |
| Page Load - Personal Dashboard | 2,347 | 2,225 | -122 (-5%) | Acceptable |
| Report (HTML) click | 2,982 | 2,422 | -560 (-19%) | Acceptable |
| Report (PDF) click | 12,768 | 6,589 | **-6,179 (-48%)** | Slow |

Report (PDF) is still the single slowest interaction measured, but nearly halved since baseline. Since IT hasn't been redeployed, this isn't attributable to the new release — most likely session/server load variance between the two test windows. Worth a 3rd data point before treating it as a trend.

### Manager (evaluator — "Director" in the feature's own terminology)

| Step | 08-10 ms | 08-12 ms | Δ | 08-12 Verdict |
|---|---:|---:|---:|---|
| Page Load - Nine-Grid | 2,856 | 1,786 | -1,070 (-37%) | Good |
| Search by name | 714 | 682 | -32 | Good |
| Clear search | 328 | 321 | -7 | Good |
| Nine-Grid Generate | 803 | 794 | -9 | Good |
| Grid Cell click | 733 | 719 | -14 | Good |
| Pending tab click | 525 | 525 | 0 | Good |
| Kalibirity tab load | 1,122 | 1,110 | -12 | Acceptable |
| Kalibirity Generate | 220 | 212 | -8 | Good |
| Stage manual override | 711 | 734 | +23 (+3%) | Good |
| Kalibirity batch save | 1,649 | 1,623 | -26 | Acceptable |
| Publish/Unpublish toggle | 1,243 | 1,237 | -6 | Acceptable |

Every step is flat or slightly faster, all within normal variance. No regressions.

### Director (org roll-up, one level above Manager)

| Step | 08-10 ms | 08-12 ms | Δ | 08-12 Verdict |
|---|---:|---:|---:|---|
| Page Load - Nine-Grid | 2,327 | 2,291 | -36 | Acceptable |
| Search by name | 712 | 691 | -21 | Good |
| Nine-Grid Generate | 809 | 780 | -29 | Good |
| Grid Cell click | 735 | 719 | -16 | Good |
| Kalibirity tab load | 1,128 | 1,114 | -14 | Acceptable |
| Kalibirity Generate | 243 | 189 | -54 | Good |
| Stage manual override (blocked, expected) | 30,017 (fail) | 30,006 (fail) | ~0 | FAILED — correctly blocked, not a perf issue |
| Publish/Unpublish toggle | 1,272 | 1,235 | -37 | Acceptable — still 500s server-side, see below |

Same pattern: flat to slightly faster, no regressions.

## Bug re-verification

**`SetManagementScanPublishState` HTTP 500 for a non-authorized caller — STILL PRESENT.** Reproduced a third time (2026-08-10 x2, 2026-08-12), identical response body (`{"Message":"There was an error processing the request.","StackTrace":"","ExceptionType":""}`). Not touched by any PR merged between the two test dates — not a regression, just still open.

**Kalibirity's correct blocking behavior for Director — still correct.** Manual-override swatches remain non-interactive (30s timeout) for the unauthorized Director, consistent with ADR-001.

## Functional checks (Assessment page) — 6/6 passed, unchanged

Identical results to baseline: unanswered-highlight, validation banner, no-navigate-on-fail, Pause/Resume with answer retention (3/3). See `results/assessment-validation-20260812.json`.

## New observations this run

- **"Add New" flake was worse this run**: 2 of 3 attempts to create the standalone validation account landed on the wrong tab and hit the full 45s timeout (vs. baseline's "2 of roughly 6"). Both recovered on manual retry — not a hard blocker, but worth watching if this trends further.
- **Publish/Unpublish log label bug fixed in the test script itself**: `director-publish.mjs` printed "Logged in as Director." regardless of which role was actually being tested — a leftover from before the script supported both roles. Fixed to print the actual role.

## Next steps

1. **This is not a new-release verification.** Confirm with the deploy owner when IT will be redeployed, then re-run `management-scan-testing-runbook.md` §2-§7 once it reflects PR 5665/5661 — specifically re-check that the Manager side now renders 28 questions (not 31), and functionally verify the new Manager report (PR 5661) since this suite doesn't cover it yet.
2. Alternatively, if a faster signal is wanted before IT redeploys, build and run locally against current `master` — accepting a different environment than the baseline (known limitation already called out in the runbook).
3. File the `SetManagementScanPublishState` 500 as an actual ADO bug — it's now been reproduced three times across two sessions and is still only tracked in these docs, not in Azure DevOps.
