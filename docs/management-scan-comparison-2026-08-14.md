# Management Scan Performance — Second Real Release (2026-08-14)

*Report file: `reports/ManagementScan_FULL_Report_2026-08-14_2026-08-14_06-21-59.xlsx`. Compared against the 2026-08-13 release via `compare-perf-runs.mjs` — see `docs/management-scan-perf-comparison-latest.md` for the raw 102-step table. This doc covers what the script can't know.*

> **Superseded by a later run the same day — read the "FINAL UPDATE" section at the bottom first.** Everything below this notice was accurate for the `post-2026-08-14-deploy` checkpoint (master at `cd4c0e6`, captured earlier on 2026-08-14). 28 more commits landed on master later that day, including ADR-023, and a fresh full run (`runStamp 20260814`, `releaseId post-2026-08-14-adr023-deploy`) was captured after syncing to them. In particular, **the Publish/Unpublish 500 bug's "recommend filing now" verdict below no longer stands as-is** — see the update for why.

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

## Next steps (as of the `post-2026-08-14-deploy` checkpoint — see FINAL UPDATE below for what actually happened next)

1. ~~File the `SetManagementScanPublishState` 500 as an ADO bug now~~ — **superseded, see FINAL UPDATE**: the bug did not reproduce on the next (final) run of this same day, but for reasons that don't yet prove it's fixed.
2. Get someone to manually check the validation-banner behavior directly (browser dev tools on the `CompleteManagementScan` response) — this needs an actual explanation now, not just another automated re-check. **Still open — see FINAL UPDATE, now a 2-day-running FAIL became a 2-day-running FAIL again on the very next run, i.e. still unfixed.**
3. Watch the "Filter: Function" timing on the next run — one data point isn't a trend yet, but it's now flagged.
4. Watch the "Add New" flake rate on the next run to see if 1,500ms was enough or if it needs to go higher.

---

## FINAL UPDATE — later run the same day, post-ADR-023 (`runStamp 20260814`, `releaseId post-2026-08-14-adr023-deploy`)

*Report file: the Excel generated from `results/mgscan-full-combined-20260814.json` (post-knownIssues-patch). Compared against the `post-2026-08-14-deploy` checkpoint above via `compare-perf-runs.mjs` (now the default last-two-runs comparison) — see `docs/management-scan-perf-comparison-latest.md`, regenerated to reflect this pair.*

### What changed on master between the two checkpoints today

28 more commits landed after the `post-2026-08-14-deploy` checkpoint above, most notably **87d4101 "Fix cross-tenant report access and publish authorization (ADR-023)"** — see `Docs/5_ManagementScan/DECISIONS/ADR-023-client-scope-super-user-report-authorization.md`. ADR-023 client-scopes the super-user branch of Management Scan authorization: non-Admin super-user account types (`Test_Manager`, `Client`, `Partner`, `Distributor`, etc.) must now have the same `Client_ID` as the target employee to pass; `Admin` stays unconditionally exempt.

### The Publish/Unpublish 500 bug: no longer reproduces today, but this is NOT a confirmed fix

Mid-run today we also found and fixed an unrelated **test-data bug**: the org-rollup Director test account's "Is Test Manager" checkbox was unchecked, which had been suppressing its Nine-Grid view entirely (it was showing an empty candidate Personal Dashboard instead). Once fixed, Director's Publish/Unpublish today returned **200 OK** (toggled Unpublish → Publish, ~1,236ms) instead of the 500 reproduced on every prior run including the checkpoint above.

**This is a confounded result, not a clean fix confirmation.** Our Director test account sits in the same test Client as the employee — exactly the branch ADR-023 says should succeed regardless of whether the original 500 was ever actually fixed. We have not yet exercised the one branch that would distinguish the two explanations: a super-user account whose `Client_ID` differs from the target employee's. Per ADR-023 that should now fail closed with a graceful authorization error; if it still 500s, the underlying unhandled-exception path in `ManagementScanPlayBO.SetPublishState` is untouched and ADR-023 only tightened scope around it. **Recommend re-testing with a cross-client super-user account before closing out the original bug report.**

### New regression found: Kalibirity override-staging now hangs for the direct-manager evaluator

Unrelated to ADR-023 and to the item above: for the account that IS the candidate's direct manager (feature-term "Director", the one role that should be able to freely stage an override), clicking a non-current position swatch now times out. This is a genuine change since the checkpoint above — the same interaction took 732ms and succeeded there; today it failed 3 consecutive times (30,008ms, 30,008ms, then 10,051ms after tightening the click timeout defensively). The auto-diff flagged this as `OK-STATUS CHANGED` (see `management-scan-perf-comparison-latest.md`), which is the strongest signal in this report that it's a real regression and not test flakiness. A screenshot showed an in-page HTML modal styled like a native OS dialog (blue "HrmForce" title bar, "Loading..." spinner) sitting over the page; registering a Playwright `page.on('dialog')` handler and re-running confirmed it never fires as a real native dialog — something is leaving an in-page loading overlay in place rather than a true browser prompt. Needs a manual repro to find the actual DOM/JS cause; automated re-checks alone won't get further than this.

Separately, worth noting: there is an **unmerged branch** (`origin/bugfix/Iteration_1024-nine-grid-and-calibrity-dropdowns-fucntion-check`, commit `b90a2f6`, dated 2026-08-14) titled "Widen calibration authorization to include downward subtree" that touches exactly this area (`CalibrationController`, `NineGridController`, `mgScanKalibirity.js`, a new `GetFilteredScansForCalibration` endpoint) and introduces its own ADR-024/ADR-025. It is **not yet in this run's tested code** — flagging only because whoever picks up the override-hang regression above should check whether that branch already addresses it before starting from scratch. Also flagging a real numbering collision on that branch: it adds its own `Docs/5_ManagementScan/DECISIONS/ADR-023-kalibirity-authorization-filtered-candidate-list.md`, reusing number 23, which is already taken by the ADR-023 that shipped in this run. The repo's `Docs/.adr-sequence` ledger will force a merge conflict on that branch (22→23 on master vs. 22→24 on the branch) rather than silently duplicating — exactly what that mechanism is for — but it will need a `feature_docs.py renumber` pass when the branch merges.

### Validation banner: now 2 consecutive days FAIL, unrelated to ADR-023

Re-ran the same check that failed on 2026-08-13 and on this same day's earlier checkpoint. Still fails identically today: "Validation error banner shown on submit-without-answering" → no banner text found within 10s, while the `.is-unanswered` highlight (30/31 questions) continues to work correctly. Three data points now (2026-08-13, both 2026-08-14 checkpoints) — this needs the manual `CompleteManagementScan` response check called for above; automated re-runs have said everything they can.

### "Username already exists" errors today — investigated and retracted as a product bug

Initially logged as a suspicious false-positive on two accounts (director-role, validationcheck-role). Checking `git show HEAD:results/account-setup-<runStamp>.json` before finalizing this report showed both usernames had genuinely already been created **earlier the same day** under the same runStamp — `perftest.director.20260814` from an attempt that appears to have stopped right after the Director step (account creation is bottom-up: Director → Manager → Employee), `perftest.validationcheck.20260814b` from the earlier `post-2026-08-14-deploy` checkpoint run. Both errors were accurate, not false positives. Retracted from knownIssues as a product bug; the real lesson is a test-tooling one — see the runbook's new §11 gotcha about not reusing a runStamp across same-day attempts without checking what already exists under it. This also gives a better explanation for the Is-Test-Manager finding below: the Director account wasn't a fresh account with a defaulting quirk, it was a half-configured leftover from that interrupted earlier attempt.

### Confirmed still working (this checkpoint)

- All five PDF/HTML report generation paths (Personal Dashboard, toolbar, row-level) — HTML ~4.0s, PDF ~5.3–5.4s.
- Filters (Department/Function/Supervisor/Group), Export (.xlsx), row navigation, Load All Completed, sub-tab round trip.
- Per-statement assessment timing — consistent ~40–48ms/click across both roles.
- Pause/Resume with answer retention.
- Only one minor timing-bucket regression outside the items above: Director's "Reset filters" moved from 953ms to 1,145ms (Good → Acceptable) — not urgent, just flagged by the auto-diff.

### Revised next steps

1. **Do not close the Publish/Unpublish 500 bug report based on today's result.** Re-test specifically with a cross-Client super-user account; only a graceful-failure result there (not a 500) actually confirms ADR-023 fixed the original defect.
2. **New, higher priority than anything carried over from the earlier checkpoint:** get a manual repro on the Kalibirity override-staging hang for the direct-manager evaluator — this blocks a core Kalibirity workflow for the one role that's supposed to have full access, and the `OK-STATUS CHANGED` flag means it's a real regression, not noise.
3. Manually check the `CompleteManagementScan` response path for the missing validation banner — now 3 data points across 2 days.
4. Before starting fresh work on the override-hang regression, check whether `origin/bugfix/Iteration_1024-nine-grid-and-calibrity-dropdowns-fucntion-check` already addresses it; separately, flag the ADR-023 numbering collision on that branch to whoever owns it.
5. Add an "Is Test Manager" checkbox check to the test-account creation checklist/runbook — a fresh account meant to see the Nine-Grid can otherwise silently render an empty dashboard instead.
