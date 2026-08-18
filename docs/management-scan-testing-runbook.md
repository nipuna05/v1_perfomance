# Management Scan — Performance & Functional Testing Runbook

*Written 2026-08-10 after the first full end-to-end pass (page-load sweep, 3-level test hierarchy, real assessment completion, publish, per-role interaction timing, Assessment-page validation). This is the "how to redo this" reference — see `management-scan-baseline-2026-08-10.md` for the numbers this run produced, to compare future runs against.*

## 0. Terminology — read this first

The feature's own UI uses "Manager" and "Director" for the **two sides of one assessment cycle**, which is a different meaning from the org-hierarchy test account names below:

| This runbook's account name | Org role | Feature's own term for them |
|---|---|---|
| PerfTest Employee | Bottom of hierarchy | **"Manager"** (the assessment subject) |
| PerfTest Manager | Employee's manager | **"Director"** (the evaluator / computed MyManager) |
| PerfTest Director | Manager's manager | Not part of the 2-person cycle — only used for the Nine-Grid roll-up/subtree view, and is a *different* authorization class from PerfTest Manager (see §4) |

Keep this straight when reading Nine-Grid's own "Manager 1/2 (50%)" / "Director 1/2 (50%)" progress bars — those are the cycle-side completion counts, not our account roles.

## 1. Environment & credentials

- Suite lives at `D:\FlexForce\v1_perfomance\`. Two credential files:
  - `.credentials.local.json` — the real IT environment (`https://q-assessments-hrmforce-it.h2software.nl`). Default target for everything in this runbook (all scripts read `CREDS_FILE` env var, default `.credentials.local.json`).
  - `.credentials.localhost.json` — a bare `iisexpress /path /port` local instance. Needs `signInUrl` set explicitly (localhost has no default-document configured, unlike a real IIS deployment) — see script comments for why.
- Admin account: `service@hrmforce.com`. Used only to create test accounts (never to test Management Scan itself — Admin bypasses authorization checks but doesn't structurally render as a Manager/Director in the UI).

## 2. Create the 3-level test hierarchy

```bash
CREDS_FILE=.credentials.local.json node create-mgscan-test-accounts.mjs <runStamp>
```

Creates fresh Director → Manager → Employee accounts (bottom-up dependency order — the Manager-picker popup can only select an account that already exists) via `CandidateNew.aspx`'s real "Add New" UI flow, never direct SQL. Saves `results/account-setup-<runStamp>.json` with usernames/passwords.

**Known gotchas, already handled in the script:**
- The "+New" button click is intermittently flaky — it can land on an unrelated "My Account" tab instead of the new-candidate form if clicked before Knockout's binding is wired up. The script retries (re-navigate + re-click) up to 3 times.
- The Language dropdown may already be pre-filled (e.g. "English - United Kingdom") — don't blindly select "the first non-empty option," since the placeholder option itself can carry a non-empty sentinel value and you'll silently clear a good default.
- Save button: use `getByRole('button', { name: 'Save', exact: true })`, not a `data-bind*="onSave"` substring selector — that also matches the unrelated inline password-save button (`onSavePassword` contains "onSave" as a substring).

To create one standalone account with no manager (for Assessment-validation testing, so it never touches the real hierarchy's completed/published cycle):
```bash
node create-mgscan-test-accounts.mjs <runStamp> validation-only
```
Then give it a manager (Management Scan refuses to assign a cycle to a manager-less candidate — "This Management Scan is not available to start right now" is the exact, correct message, not a bug):
```bash
node assign-manager.mjs "<TargetLastName>" "<ManagerLastName>"
```

## 3. Complete both sides of one real assessment

```bash
node complete-mgscan-assessments.mjs <runStamp>
```

Logs in as Employee, completes their self-assessment (31 questions: 28 scored 1–6 + 3 open-text), then logs in as Manager and completes the assessment *about* the Employee. All-on-one-page UI, no Next/Prev.

**Gotchas:**
- Views (`start` / `question` / `end`) are toggled via Knockout `visible` (`display:none`), not `if` — the DOM node for a hidden view still exists and still matches a plain class selector. A locator like `.btn-ctrl.primary` without `:visible` can resolve to the *wrong*, now-hidden button (confirmed live: `.first()` grabbed the old "Start" button instead of "Submit", hanging for the full 30s timeout). Always use `.btn-ctrl.primary:visible`.
- Submit is never disabled — validation is server-confirmed and shown via a banner + `.is-unanswered` highlighting after the fact, not a disabled button.

## 4. Publish — and who is actually allowed to

```bash
node director-publish.mjs <runStamp> <role>   # role = 'manager' or 'director'
```

**This is the one authorization rule worth internalizing:** `SetManagementScanPublishState` is gated by "a super-user role, OR the caller is this specific candidate's computed MyManager" (ADR-001). In this hierarchy, that's **PerfTest Manager**, not PerfTest Director (Director is 2 levels up, not the direct MyManager). Confirmed live, reproduced twice:

- Publish as **Manager** → `200`, title flips Publish ⇄ Unpublish correctly.
- Publish as **Director** → HTTP **500** (`SetManagementScanPublishState`), not a graceful "UnAuthorized" result. **This is a real bug** — worth a fix so an unauthorized caller gets a clean error instead of an unhandled exception. Logged in `docs/` as a known issue; re-verify it's still present before re-reporting it as new.

The Employee's own dashboard (scores, Nine-Grid position, Report buttons) only unlocks once BOTH sides are Done **and** it's been Published.

## 5. Per-role interaction timing (respecting real permissions)

```bash
node measure-mgscan-full.mjs <runStamp> employee mgscan-full <runTs>
node measure-mgscan-full.mjs <runStamp> manager  mgscan-full <runTs>
node measure-mgscan-full.mjs <runStamp> director mgscan-full <runTs>
```

One script, role-aware branching — Employee only ever attempts Personal-Dashboard actions (and asserts the Nine-Grid/Kalibirity tabs are genuinely absent, rather than trying to force access); Manager/Director both run the full sweep: search, the 4 filters (Department/Function/Supervisor multi-select via Chosen, Group single-select), Generate (baseline, filtered, and reset), Export (.xlsx download), toolbar + row-level Report(HTML)/(PDF) (all four go through a language popup as of 2026-08-13), row-click navigation into a candidate's Personal Dashboard and back, "Load All Completed" (ADR-012), a Voltooid↔Openstaand sub-tab round trip, Kalibirity Generate, stage + save a manual override, and Publish/Unpublish toggle. See §10 for the full 2026-08-13 coverage expansion and why some of this (assessment-play timing) lives in a different script entirely.

**Gotchas worth knowing before you extend this script:**
- `commonFilter` (search box, filters, Generate button) is mounted **twice simultaneously** — once under the Nine-Grid tab, once under Kalibirity — because `MgScan.aspx` keeps both tabs' components alive via `visible` (not `if`) so switching tabs doesn't lose state. An unscoped `a[data-bind*="onGenerate"]` matches 2 elements and strict-mode-fails. Always scope to `#tabMgScanNineGrid` or `#tabMgScanKalibirity`.
- The Nine-Grid's selected-cell state does **not** survive a tab round-trip (Kalibirity → Nine-Grid) — re-click a cell after switching back, don't assume the previously-opened candidate-list panel is still showing.
- Kalibirity's batch-save button text is dynamic: `"Save calibrations (N)"` when N changes are staged, `"Calibrations saved (0)"` when none are — not the Dutch "Kalibraties opgeslagen" guessed early on. Select it via `a[data-bind*="click: onSave"]` inside `#tabMgScanKalibirity`, and check the label text to confirm a change was actually staged before treating a click as a real save attempt.
- To stage an override: click a `.kal-swatch:not(.is-current)` inside the candidate's `.kal-row`, then optionally fill `.kal-inline-edit-input` (the "Reason for override" comment).
- After Publish/Unpublish, the candidate's row can legitimately **disappear** from the currently-viewed list/cell (confirmed both directions) — don't assume the button element persists; use short (~3s) explicit timeouts on any post-click `getAttribute` check, or Playwright's default 30s auto-wait silently makes the step look "slow" when really it's just chasing a vanished element.
- A "Loading..." modal briefly covers the page after several actions (Kalibirity Generate, dashboard navigation) — wait for it to hide before checking for content, not just `networkidle` (confirmed live: `networkidle` can resolve while the modal is still up).
- Report (HTML)/(PDF) buttons: match by **visible text** (`page.locator('button, a').filter({ hasText: 'Report (HTML)' })`), not `getByRole('button', { name: ... })` — icon+text buttons' accessible name doesn't reliably match the visible label. Row-level report icons are worse: their `title` attribute is a Knockout token binding (`attr: { title: tokens().ReportPdf }`) that overwrites whatever static `title` sits in the markup at runtime — match the icon class instead (`.fa-file-pdf` / `.fa-code`), confirmed 2026-08-12 after a title-text match silently found nothing for an entire session.
- Chosen multi-select filters (Department/Function/Supervisor, added 2026-08-11): the native `<select multiple>` is hidden: interact with the widget it renders, `#<selectId>_chosen` (click to open, `.chosen-results li.active-result` for options, `.search-choice-close` per chip to deselect) — Playwright's `selectOption()` won't work since Chosen intercepts the real dropdown. A real, selectable "All ..." option (ID -111) is always prepended server-side and lands at index 0 — skip it (`nth(1)`) to pick a genuine value.
- Row-level Report(HTML)/(PDF) gained their own language popups as of the 2026-08-13 master sync (`rowHtmlPopupVisibility`/`rowPdfPopupVisibility`) — same Ok-button pattern as the toolbar popups (`a[data-bind="click: onOk"]:visible`), but this is a **behaviour change**: a script written against the pre-08-13 immediate-`window.open` version will silently hang waiting for a download that never fires until the popup's Ok is clicked. `measure-mgscan-full.mjs`'s `rowReport()` helper detects which behaviour is live and handles both.

## 6. Assessment-page validation/button checks

```bash
node test-assessment-validation.mjs <runStamp-of-validation-only-account>
```

Checks (all passed 2026-08-10): submit-without-answering highlights every unanswered question and shows a specific validation banner without navigating away; Pause & Resume correctly persists partial answers across a full logout-equivalent round-trip (dashboard → resume → same answers selected). As of 2026-08-13 each finding also carries an `ms` field where a message/UI-response appearance time is meaningful (validation banner appearance time, Pause round-trip, Resume round-trip) — rendered as a "Time (ms)" column in the Functional Checks sheet, blank for pure state assertions where a time wouldn't mean anything.

## 7. Build the consolidated report

```bash
node build-final-report-data.mjs <employeeResultFile> <managerResultFile> <directorResultFile> <validationResultFile> <combinedOutputFile>
node generate-excel-perf.mjs "results/<combinedOutputFile>" "reports/ManagementScan_FULL_Report.xlsx"
```

Produces a 4-sheet workbook: **Summary** (one row per role, kept separate), **Details** (every step, color-coded), **Functional Checks** (pass/fail), **Known Issues** (bugs + observations, for dev handoff). The `knownIssues`/`functionalChecks`/`terminologyNote` fields in the combined JSON are additive — omitting them (e.g. for the plain page-load sweep) leaves `generate-excel-perf.mjs`'s original Summary/Details-only behavior untouched, so this hasn't broken its use for the FlexForce-sibling suite.

## 8. Comparing a future run against the baseline

1. Run §2–§7 again with a new `<runStamp>`.
2. Open `management-scan-baseline-2026-08-10.md` alongside the new report's Details sheet.
3. For each matching step label, flag anything that moved from Good→Acceptable/Slow (thresholds: Page Load ≤2s good/≤4s ok, Action ≤1s good/≤3s ok — see `generate-excel-perf.mjs`'s `THRESHOLDS`).
4. Re-check whether the Director-publish 500 bug (§4) has been fixed — if so, remove/update that Known Issue rather than re-reporting it as new.
5. Note dataset differences honestly: this baseline used exactly 1 candidate per manager — Load More/pagination was untestable below that threshold. If a future run seeds more data, that comparison becomes possible for the first time, not "regressed" from the baseline having a real number.
6. Also do §9 below — a manual doc diff alone doesn't scale past two runs, and doesn't tell you whether you actually tested a new build.

## 9. Tracking against each release

Formalized 2026-08-12, after a run intended to test a new release turned out to still be measuring the old build (IT hadn't been redeployed yet — the assessment still played 31 questions for the Manager side, not the 28 the newly-merged PR would have produced). Two problems, two fixes:

**Problem 1: "did I actually test what I think I tested?"** HRMForce has no version/build endpoint or footer stamp (checked — `AssemblyInfo.cs` has a static `1.0.0.0` that never changes, and no `.master` page renders a build marker). There is currently no reliable way to ask the environment directly what commit it's running. Until that changes (worth asking whoever owns deploys to add one, or at least note the deployed SHA somewhere reachable), the practical workaround is a **functional fingerprint check**: before running the full suite, exercise one behavior that's known to have changed in the release you're trying to test, and confirm it actually changed. Pick whatever the most recent relevant merged PR touched — e.g. after PR 5665 ("remove Manager's open questions"), the fingerprint is "does the Manager's assessment side render 28 `.mgscan-question` elements or 31." Record what you checked and what you found in the run's `release.json` (see below) — don't skip this and assume the deploy happened just because time passed.

**Problem 2: comparing N runs by hand doesn't scale, and free-text "which release was this" notes can't be diffed reliably.** Every run now gets recorded into a single persistent trend log instead of one-off comparison docs:

```bash
# after building the combined report (§7 step 1, before generate-excel-perf.mjs):
node record-perf-run.mjs <combinedResultsFile> <runStamp> <date> <releaseJsonFile>
```

`<releaseJsonFile>` is a small JSON file you write per run, e.g. `results/release-<runStamp>.json`:

```json
{
  "repo": "HRMForce",
  "releaseId": "pre-PR5661-5665",
  "confirmedSha": null,
  "approxSha": "<= 21fa566 (2026-08-11 10:27 UTC, PR 5651) - confirmed to predate PR 5661/5665",
  "confirmedBy": "Functional probe: Manager side rendered 31 questions, not 28",
  "note": "free text - anything future-you needs to know about how confident this identification is"
}
```

- **`releaseId`** is the field comparisons actually key off — give it the **same value** across runs that are genuinely the same deployed build (like the 2026-08-10 and 2026-08-12 runs both being `pre-PR5661-5665`), and a new value whenever you've confirmed IT moved forward. This is a short canonical tag you invent, not required to be a real SHA — use a real `confirmedSha` when you have one (e.g. if a deploy pipeline or the person who deployed it tells you), leave it `null` otherwise. Don't try to make `sameRelease` detection work off the free-text `approxSha`/`note` fields — two honest descriptions of the same build will rarely be worded identically, which is exactly the bug that got fixed here.
- Then diff any two runs (defaults to the two most recent):

```bash
node compare-perf-runs.mjs [runStampA] [runStampB] > docs/management-scan-perf-comparison-latest.md
```

This auto-generates a markdown table (every step, both runs' ms, delta, delta %, current verdict, and a REGRESSION flag for anything that crossed into a worse verdict bucket) and prints a same-release warning banner when `releaseId` matches, so nobody reads a stability-check as a release comparison by mistake. It replaces hand-transcribing numbers into a new dated `.md` file each time — keep writing a short dated narrative doc alongside it (`docs/management-scan-comparison-<date>.md`) only for things the script can't know: bug re-verification status, new functional observations, next-step recommendations. The trend log itself (`results/mgscan-perf-trend.json`) is the durable source of truth — it's what a chart across 5+ releases would eventually be built from, not any single comparison doc.

**Per-release checklist, going forward:**
1. Confirm what you're actually testing — run the functional fingerprint check for whatever changed in the target release; write down what you checked either way.
2. Run §2–§7.
3. Write `results/release-<runStamp>.json` with a `releaseId` — reuse the prior run's `releaseId` if the fingerprint check says nothing changed, invent a new one if it did.
4. `node record-perf-run.mjs ...`
5. `node compare-perf-runs.mjs > docs/management-scan-perf-comparison-latest.md`
6. Write the short dated narrative doc for anything the script can't see (bug status, new findings, recommendations).
7. Update the project dashboard's Performance section from the comparison output.

## 10. Comprehensive coverage expansion (2026-08-13)

Written after the user asked to cover "each and every performance related measurement with different roles including navigation, filtering, sorting, downloading, searching, assessment play, button validation message popup or message appearing time" — a real coverage audit against live source (not assumption) first, then the actual script changes below. **Not yet run against a real release** — this is prep for whenever the user confirms the dev team's performance update has shipped; sync master again first per [[workflow-check-uptodate-before-local-run]] since more UI can land between now and then.

### Coverage matrix

| Category | Exists? | Covered by |
|---|---|---|
| Sorting | **No** — confirmed via code search (grepped all MgScan JS for `sortBy/onSort/sortable/orderBy`, zero hits). Nine-Grid is a fixed 3×3, lists have static non-clickable headers. Don't build a test for this. | N/A |
| Filtering | 4 filters + search. Department/Function/Supervisor are multi-select (jQuery Chosen, added 2026-08-11); Group stays single-select. | `measure-mgscan-full.mjs` — 4 new filter steps + a Generate-with-filters + reset-filters + Generate-reset round trip |
| Navigation | Menu entry, Nine-Grid↔Kalibirity tabs, Voltooid↔Openstaand sub-tabs, cell drill-down, row-click into a candidate's dashboard (an in-page Knockout view swap, not a real navigation — `MgScanVM.openDashboard` just sets `currentView('employee')`), "Load All Completed" (ADR-012). The Rev-3 "Start Management Scan" entry point on the HRMForce Start Page **is not built anywhere** (checked local, master, and the branch literally named for it) — don't test it yet. | `measure-mgscan-full.mjs` — row-click→dashboard→back, Load All Completed, sub-tab round trip |
| Downloading | Toolbar Export (a real **.xlsx**, not CSV, recomputed server-side from active filters), toolbar Report(HTML)/(PDF), row-level Report(HTML)/(PDF) — **all four now go through a language popup** as of 2026-08-13 (row-level popups are new; toolbar ones existed since 2026-08-07/PR 5590). | `measure-mgscan-full.mjs` — Export step; `rowReport()` helper for both row-level icons, handles either popup or immediate-open |
| Searching | Name search + a working clear-icon. | Already covered (unchanged) |
| Assessment play | All 28 statements render on one page/DOM at once, each independently clickable — no per-page autosave, only Pause and Submit hit the server. Can only be measured **once per fresh dataset** (an assessment can't be replayed for 3 months once complete), unlike Nine-Grid/Kalibirity which can be re-exercised anytime. | `complete-mgscan-assessments.mjs` — now times the start-view load, each statement click and each open-question fill individually, the Submit→response race (banner or end-view, whichever resolves first), and Back-to-dashboard; writes `results/assessment-play-timing-<runStamp>.json` in the same `{role, flow, notes}` shape as everything else |
| Button validation / messages | No `alert()`/toast component anywhere in MgScan (checked both branches) — all feedback is Knockout-bound inline text: the validation banner, `.is-unanswered` highlighting, Kalibirity's dynamic save-button label, disabled-button states. Two different loading indicators exist: `.nd-loading-screen` (app-wide, fires on every ajax call via `$(document).ajaxStart/ajaxStop`) and `.mg-loading-overlay` (Nine-Grid-specific, tied to the `isLoading` observable during Generate). A real regression was found in passing: the assessment's open-question textarea still has `maxlength="250"` on both branches even though a merged PR removed it (DB is now unbounded) — reintroduced by a merge conflict; worth a dedicated test once actually fixed. | `test-assessment-validation.mjs` — the Submit-without-answering and Pause/Resume checks now carry a real measured `ms` (time until the banner/dashboard/resumed-view actually appeared), not just pass/fail; `generate-excel-perf.mjs`'s Functional Checks sheet gained a "Time (ms)" column to show it |

### Updated command sequence

`build-final-report-data.mjs` now merges by role instead of overwriting, and takes an optional 5th argument for the assessment-play timing file — pass it whenever you have a freshly-created dataset for this run (you won't on a repeat run against an already-completed cycle, since that data can't be regenerated):

```bash
node create-mgscan-test-accounts.mjs <runStamp>
node complete-mgscan-assessments.mjs <runStamp>          # now also writes results/assessment-play-timing-<runStamp>.json
node director-publish.mjs <runStamp> manager
node measure-mgscan-full.mjs <runStamp> employee mgscan-full <runTs>
node measure-mgscan-full.mjs <runStamp> manager  mgscan-full <runTs>   # now covers filters/export/navigation/Load-All-Completed too
node measure-mgscan-full.mjs <runStamp> director mgscan-full <runTs>
node create-mgscan-test-accounts.mjs <runStamp2> validation-only
node assign-manager.mjs "ValidationCheck" "Manager"
node test-assessment-validation.mjs <runStamp2>          # findings now carry ms where meaningful
node build-final-report-data.mjs <employeeFile> <managerFile> <validationFile> <combinedFile> results/assessment-play-timing-<runStamp>.json
node generate-excel-perf.mjs "results/<combinedFile>" "reports/ManagementScan_FULL_Report.xlsx"
```

### New gotchas specific to this expansion

- **`create-mgscan-test-accounts.mjs` used to silently overwrite, not merge, `results/account-setup-<runStamp>.json`** on a second call for the same runStamp — creating the standalone validation account after the director/manager/employee hierarchy destroyed the earlier accounts' saved credentials and crashed every later script that needed them. Fixed 2026-08-12 (merges by role now), but if you're working from an older checkout, watch for it.
- Filter/Export/navigation timings are all **new steps with no baseline to compare against yet** — the first real run of this expanded script establishes a fresh mini-baseline for just these steps, layered on top of the existing 2026-08-10 baseline for everything else. Don't read "no prior number" as a regression.
- Assessment-play timing can only ever be captured on a **freshly-created** dataset. If a future run reuses an already-completed cycle (no new account creation), there's no assessment-play data for that run — this is an expected gap, not a script failure.

## 11. New gotchas found on the 2026-08-14 ADR-023 run

- **Don't reuse a runStamp across multiple same-day account-creation attempts without checking what already exists under it.** This run's "Username already exists" errors on the Director and ValidationCheck accounts looked at first like a UI false-positive (a plausible-sounding bug, and one worth being suspicious of) — but checking `git show HEAD:results/account-setup-<runStamp>.json` before finalizing this report showed both usernames had genuinely already been created earlier the **same day**, under the same runStamp, by an earlier attempt. The error was correct both times, not a product bug. **Before treating "Username already exists" as a false positive, always check `results/account-setup-<runStamp>.json` (and its git history) for a pre-existing entry first** — only call it a false positive once you've confirmed the username was genuinely never used before.
- **A fresh-looking account can actually be a leftover from an interrupted earlier attempt under the same runStamp.** In this run, `perftest.director.20260814` turned out to already exist from an earlier same-day attempt at this exact hierarchy that stopped right after creating the Director account (creation is bottom-up — Director → Manager → Employee — so an interruption after step 1 leaves exactly this shape: a director entry with no errors, and no manager/employee entries at all). Reusing it without noticing meant testing against a half-configured account rather than a fresh one — in this case, its "Is Test Manager" checkbox was unchecked, which caused MgScan.aspx to render an empty Personal Dashboard instead of the Nine-Grid. Check via `CandidateNew.aspx` → search the account → Edit → look for the "Is Test Manager" checkbox in the DOM (`document.querySelectorAll('input[type="checkbox"]')`, find the one whose containing label/parent text includes "Is Test Manager") for any account you didn't just watch get created end-to-end.

## 12. Kalibirity override-staging hang (2026-08-14) — confirmed fixed 2026-08-18

The direct-manager evaluator's "Stage a manual override" hang, flagged as an open, unresolved regression on 2026-08-14, is fixed as of a fresh sync against master on 2026-08-18: `check-kalibirity-adr024.mjs` reused the existing `perftest.manager.20260814` account (no fresh hierarchy needed — Kalibirity data is re-exercisable anytime) and the override click completed in **33ms** (was 10–30s / timeout). Confirmed via a network-request fingerprint, not just the timing: Kalibirity's Generate now calls a new `GetFilteredScansForCalibration` endpoint instead of the old `GetFilteredScans`, matching a server-side authorization/list-filtering change that landed on master between 2026-08-14 and 2026-08-18.

**One open caveat, not a re-break:** the org-rollup account (`perftest.director.20260814`, 2 levels up) still doesn't see the employee's Kalibirity row — same as before. Whether that's still-correct scoping (this account was never supposed to see it) or a widened-authorization change that hasn't reached this environment yet isn't confirmed either way — don't assume which without checking the deployed server code directly, since this session found the git history and the deployed IT build aren't always in sync (see `results/kalibirity-adr024-check-20260818.json` for the raw check).

Reusable script: `check-kalibirity-adr024.mjs` — logs in as a given account, opens Kalibirity, and reports whether the Employee row is visible and whether an override click succeeds, with the network fingerprint captured alongside. Adapt the account list at the bottom of the file for a future re-check rather than writing a new one-off script each time.

## 13. Daily update-check workflow (established 2026-08-18)

This suite tracks a moving target — HRMForce ships to master continuously, not on a fixed release cadence — so the recurring job is: **every day, check whether anything shipped that this suite doesn't cover yet, and add coverage for it before it becomes an untested blind spot.**

1. **Sync**: in the HRMForce repo, `git fetch origin` then `git merge origin/master --no-edit` into your personal branch (never the shared team branch — see [[git-branch-safety-63017]]). If the merge is blocked by a locally-modified file you didn't intend to touch (e.g. `.claude/settings.json`'s accumulated permission allowlist), stash just that file, merge, then pop the stash back — don't discard it and don't let it block the sync.
2. **Diff since the last check**: `git log --oneline <last-known-good-sha>..origin/master` (the trend log's `release.approxSha`/`confirmedSha` fields, or the last dated runbook section, tell you where "last known good" was). Read each commit message; anything touching `HRMForce _Web/UserControlComponents/MgScan/**`, `HRMForce _Web/Javascript/knockout/MgScan/**`, `HRMForce _BL/ManagementScan/**`, `HRMForce _Web/Service/MgScanService.asmx.cs`, or a new `Docs/5_ManagementScan/DECISIONS/ADR-*.md` is in scope; everything else (Job Profile, BILAPlus, unrelated Settings work, etc.) isn't, unless a commit message says otherwise.
3. **Classify each in-scope change**: a real regression fix for something already tracked in `knownIssues` (re-test the specific broken step, confirm fixed or still-broken, update the doc either way — don't just assume a merge fixed it); a brand-new UI feature (needs a brand-new script step — see the Manager-conversation-panel example below); or an internal refactor with no visible behavior change (note it, no test change needed).
4. **Add script coverage for anything new** on this branch (`nipuna/perf-suite-v1` as of 2026-08-18 — create a fresh dated branch off it if the work is large enough to want its own review, otherwise keep committing here). Prefer extending the existing role-based flow in `measure-mgscan-full.mjs`/`test-assessment-validation.mjs` over a new one-off `check-*.mjs` script — reserve one-off scripts for a single targeted fix-verification (like `check-kalibirity-adr024.mjs`) that doesn't belong in the standard timed sweep.
5. **Run it** against the existing test hierarchy where possible (Nine-Grid/Kalibirity/Personal-Dashboard interactions are re-exercisable anytime; only assessment-play needs a fresh account, since a cycle can't be replayed for 3 months).
6. **Record it**: append a dated entry to this runbook (pattern: `## N. <what happened> (YYYY-MM-DD)`), and update the standalone Performance History doc/artifact with a new timeline row so the running history stays in one place instead of scattered across daily files only.
7. **Commit to the branch, don't push** unless explicitly asked — same standing rule as every other day's work in this suite.

### Worked example: 2026-08-18 sync

Ran this process for the first time as a named workflow. Found 21 new commits since the 2026-08-14 sync. Three were in scope:

- **ADR-024/ADR-025** (Kalibirity authorization) — a regression fix for the already-tracked override-staging hang. Re-tested and confirmed fixed (see §12).
- **"Add Manager conversation panel with editable date and year fields"** (`1fb964a3`) — a brand-new, purely client-side UI feature on the Personal Dashboard (`mgScanEmployee.html`/`.js`): two fields (date of conversation, year of next scan) each toggled read-only/editable by their own pencil button, no backend wiring yet. Added two new steps to `measure-mgscan-full.mjs`'s Personal Dashboard flow (`a[data-bind="click: onToggleConversationDateEditable"]` / `onToggleNextScanYearEditable`) — both toggle in single-digit milliseconds, as expected for a pure Knockout observable flip with no network round-trip. If this feature gains real backend persistence later, these steps will need a save-and-reload round trip added, not just the toggle.
- **"Enhance Management Scan Reports with Localization and Token Updates"** (`154c234c`) — mostly report-content/localization work (out of scope for a timing suite), but its description also mentioned "Removed maxlength attribute from textarea... to allow for longer answers," which is the exact fix for a regression this suite has been tracking since before 2026-08-13 (reintroduced by a merge conflict). Added a non-destructive attribute check to `test-assessment-validation.mjs` (reads `textarea[maxlength]`, doesn't type anything, so it can't disturb the unanswered-count assertion that runs right after it) — confirmed fixed: no `maxlength` attribute present.

Everything else in the 21 commits (Job Profile/Agreements visibility settings, BILAPlus refactoring, the Azure DevOps project-guard hook update, a token-only report-text pass) was judged out of scope for Management Scan performance/functional testing and not actioned.
- **The Kalibirity "Loading..." overlay can look like a native OS dialog but isn't one.** When a swatch click hangs, don't assume it's a real `window.confirm`/`alert` — a screenshot during one hang showed an in-page HTML modal with a blue title bar reading "HrmForce" (matching `document.title`) and a spinner, styled to mimic a native dialog. Registering `page.on('dialog', ...)` and re-running confirmed it never fires — treat any suspected native dialog in this app as in-page DOM first, and verify with the `dialog` event before writing a dialog handler for it.
- **`assign-manager.mjs`'s manager-picker search has no date/username disambiguation** — it searches `page.locator('tr', { hasText: targetLastName }).first()` by bare last name only. Running the same-named test hierarchy across multiple days (e.g. "Director"/"Manager"/"Employee" recreated on both `20260814` and `20260814b`) means this can match ANY same-named account from ANY prior day's run, not necessarily today's, depending on sort order. Prefer disambiguating by full username/email where the picker UI allows it, or clean up same-named stale accounts before re-running.
