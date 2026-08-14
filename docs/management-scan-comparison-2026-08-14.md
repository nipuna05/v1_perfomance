# Management Scan Performance — Second Real Release (2026-08-14)

*Report file: `reports/ManagementScan_FULL_Report_2026-08-14_2026-08-14_06-21-59.xlsx`. Compared against the 2026-08-13 release via `compare-perf-runs.mjs` — see `docs/management-scan-perf-comparison-latest.md` for the raw 102-step table. This doc covers what the script can't know.*

## Headline: genuine forward progress, confirmed twice

20 new commits merged since the 2026-08-13 verified release (Kalibirity grid-sync fix, pending-list duplicate fix, Manager report work, and a Personal Dashboard report-button redesign). Recorded with a new `releaseId` (`post-2026-08-14-deploy`). Confirmed via two independent signals, not just the usual question-count fingerprint: the count check still shows 28 questions on the Manager/evaluator side (unchanged, as expected — that PR is older), and the Personal Dashboard's Report(HTML)/(PDF) buttons are now icon-only where they used to have visible text labels, matching PR 5718's "management scan employee report" fixes.

## Result: one flagged item, otherwise a clean, stable release

Only one step crossed a verdict boundary: **Director/Filter: Function jumped from 294ms to 1,144ms (+289%)** — still lands in "Acceptable" (under 3,000ms), not "Slow", so not urgent, but worth watching if it climbs further on the next run. Every other one of 102 steps held steady or improved, including a genuinely good one: **Reset filters dropped from 2,642ms to 953ms (-64%)**.

## Bug re-verification

**`SetManagementScanPublishState` HTTP 500 — 5th reproduction, byte-identical, across three separate deployed releases now (pre-PR5661-5665, post-2026-08-13-deploy, post-2026-08-14-deploy).** This bug has outlived two full release cycles untouched. Strongly recommend filing it in ADO at this point rather than continuing to re-confirm it — the evidence is thorough.

## Escalated finding: validation banner — now confirmed on 2 consecutive runs

The assessment's validation banner (server-driven text shown after submitting with nothing answered) did not appear within 10 seconds on **both** the 2026-08-13 and 2026-08-14 runs — a change from the ~1.5s it took on the baseline and 2026-08-12 runs. The client-side highlight (30 of 31 questions correctly flagged) still works instantly and correctly both times; only the server-driven text message is affected. Two consecutive confirmations moves this from "might be a fluke" to "real and worth prioritizing" — recommend a manual check of the `CompleteManagementScan` response path.

## Real UI change found and adapted to (not a product bug)

The Personal Dashboard's Report(HTML)/(PDF) buttons lost their visible "Report (HTML)"/"Report (PDF)" text labels this release — now icon-only, matching the row-level icon style used elsewhere. Confirmed via source (`mgScanEmployee.html`) and a live screenshot showing the dashboard rendering correctly (real scores, Nine-Grid position, publish state). The test's old text-based selector found nothing and would have wrongly reported this as broken; fixed to match by icon class. Both report types confirmed genuinely working after the fix.

## Process finding: "Add New" flake rate spiked, then fixed

The known "lands on My Account instead of the candidate form" flake — historically about 1-in-6 attempts — hit **5 failures in a row** creating the standalone validation account today, and needed a retry mid-batch for the main hierarchy too. Widened the pre-click settle wait from 500ms to 1,500ms in `create-mgscan-test-accounts.mjs`, which fixed it immediately on the next attempt. Consistent with Knockout's binding attachment taking measurably longer after this release's changes (which also touched `Starter.aspx.cs` and session handling) rather than pure chance — worth keeping an eye on if it degrades further.

## Confirmed still working

- Kalibirity's correct blocking for the unauthorized org-rollup account (30s timeout, no mutation possible).
- All five PDF/HTML report generation paths (Personal Dashboard, toolbar, row-level).
- Filters (Department/Function/Supervisor/Group), Export (.xlsx), row navigation, Load All Completed, sub-tab round trip.
- Per-statement assessment timing — consistent ~40-48ms/click across both roles, both releases.
- Pause/Resume with answer retention.

## Next steps

1. File the `SetManagementScanPublishState` 500 as an ADO bug now — 5 reproductions across 3 releases is more than enough evidence.
2. Get someone to manually check the validation-banner behavior directly (browser dev tools on the `CompleteManagementScan` response) — this needs an actual explanation now, not just another automated re-check.
3. Watch the "Filter: Function" timing on the next run — one data point isn't a trend yet, but it's now flagged.
4. Watch the "Add New" flake rate on the next run to see if 1,500ms was enough or if it needs to go higher.
