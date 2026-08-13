# Management Scan Performance — First Real Release Comparison (2026-08-13)

*Report file: `reports/ManagementScan_FULL_Report_2026-08-13_2026-08-13_07-04-49.xlsx`. Compared against the immediately-prior stability check (`20260812-v2`) via `compare-perf-runs.mjs` — see `docs/management-scan-perf-comparison-latest.md` for the raw table. This doc only covers what the script can't know.*

## Headline: this IS a real release comparison

Confirmed directly via the functional fingerprint check (runbook §9): the Manager/evaluator's assessment play-through now renders **28 questions**, down from 31 — the 3 open-context questions PR 5665 removed are genuinely gone on IT. Also observed in passing: row-level Report(HTML)/(PDF) now show a language popup (added after the 2026-08-12 run), and the Personal Dashboard's reports were unified onto the same popup flow. This run is recorded with a new `releaseId` (`post-2026-08-13-deploy`), distinct from the `pre-PR5661-5665` builds tested on 2026-08-10 and 2026-08-12.

## Scope: much broader than any previous run

This is also the first run of the 2026-08-13 coverage expansion (filters, export, navigation, per-statement assessment timing, message-appearance timing) — 102 total steps across Manager/Director, up from 37. Most of the new steps have no prior baseline to diff against (shown as "NEW STEP" in the auto-generated comparison) — that's expected, not a gap.

## Two flagged "regressions" — one is noise, one is real but not a functional bug

1. **Director Login: 5,984ms → 7,789ms (Acceptable → Slow).** A single login round-trip crossing the 6,000ms bucket boundary. Not treated as a real finding on its own — logins have shown 3-8s of natural variance across every run so far.
2. **Manager Report (HTML) click: 2,422ms → 15,352ms (534% slower).** This is real and measured honestly, but the underlying action still succeeded (`openedNewTab: true` — the report genuinely opened). Two things are true at once: (a) the *old* 2,422ms number was for a simpler, no-popup interaction that no longer exists (the "Unify Manager and Employee report generation" change added a popup step here, so some increase from that alone is expected — the equivalent Director-role row-level HTML step landed at 4,011ms), and (b) 15,352ms is still well above that new expected floor and doesn't have a clear explanation from the code alone. Worth a second data point before deciding if this is a real slowdown or a one-off.

## Bug re-verification

**`SetManagementScanPublishState` HTTP 500 — STILL PRESENT, 4th reproduction.** Identical response body across all four (2026-08-10 x2, 2026-08-12, 2026-08-13). Not touched by this release. Still not filed as an ADO bug — recommend doing that now given the reproduction count.

## New finding this run: validation banner not observed within 10s

Submitting the assessment with nothing answered still correctly highlights every required question client-side (30 of 31, correctly excluding the one optional trailing question) — that's a synchronous, client-only flag (`showValidation(true)`) and fired immediately as always. But the textual validation banner (server-driven, via the `errorMessage` observable set from the `CompleteManagementScan` response) did not appear within a 10-second wait — both the baseline and the 2026-08-12 run found it within ~1.5s. Checked the source (`mgScanAssessment.js`): the code path that sets this message still exists (`_unansweredMessage()` returns "N questions still need an answer..." or a fallback), so this isn't a case of the feature being removed. Not confirmed as a regression one way or the other — could be a slower round-trip in this release (more scoring/validation logic may run server-side now, per the several ADR-017/020 formula-rewrite commits that landed this week) or something else entirely. Recommend a manual check.

## New, real, functional coverage confirmed working

- Personal Dashboard PDF/HTML, Nine-Grid toolbar PDF, and row-level PDF/HTML — all five report-generation paths now produce a real result (verified via actual download events or new-tab creation, not just a click without error).
- Export (.xlsx) — real download, `Management_Scan.xlsx`.
- Department/Function/Supervisor filters (Chosen multi-select) — real selections confirmed (e.g., "Automation Test Department", "PerfTest Manager" as Supervisor).
- Row-click navigation into a candidate's Personal Dashboard and back, "Load All Completed," and the Voltooid↔Openstaand sub-tab round trip — all functioning.
- Per-statement assessment timing — all 28 statement clicks average ~44ms (client-side, no network round-trip per statement, as expected), consistent across both roles.

## Known limitation found and safely handled (not a live-run issue, but worth knowing about)

The "reset filters back to All" step's chip-removal click (`.search-choice-close`) doesn't work as expected in this build/config of the Chosen widget. This was caught safely — a hard iteration cap (added mid-session after an earlier attempt at this exact step hung the whole script for 10+ minutes with an unbounded retry loop) stopped it after one attempt with a clear note, rather than hanging. The filter *selection* itself works correctly; only the close-icon-click path for clearing it doesn't. Needs live browser inspection to find the right interaction — not a blocker for this report, and not indicative of a product bug (more likely a script selector assumption that doesn't hold for this specific Chosen build).

## Process note: two script bugs found and fixed mid-run today

1. `chosenClearAll`'s original implementation was an unbounded `while` loop with no iteration cap — hung the Director-role sweep for 10+ minutes with zero output before being killed and fixed. Now capped at 5 iterations with a no-progress guard.
2. `test-assessment-validation.mjs` picked account index `[0]` from the account-setup file, which was only safe when the validation-only account was alone in its file (a separate `runStamp2`). Reusing the same runStamp as the main hierarchy today (combined with the 2026-08-12 merge-by-role fix) put multiple accounts in one file with validation-only appended last, not first — the script silently grabbed "PerfTest Director" instead and failed looking for a Start-Assessment button Director doesn't have. Fixed to look up by role, matching every other script in this suite.

## Next steps

1. File the `SetManagementScanPublishState` 500 as an ADO bug — four independent reproductions now.
2. Manually verify the validation-banner timing/behavior — is it a real regression, a slower round-trip, or a script-side race?
3. Re-run once more with the same `releaseId` to get a second data point on the Report (HTML) 15s outlier before treating it as a trend.
4. Inspect the Chosen widget's actual DOM live to fix the filter-reset selector properly.
