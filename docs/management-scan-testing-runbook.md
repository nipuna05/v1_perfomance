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

One script, role-aware branching — Employee only ever attempts Personal-Dashboard actions (and asserts the Nine-Grid/Kalibirity tabs are genuinely absent, rather than trying to force access); Manager/Director both run the full Nine-Grid + Kalibirity sweep (search, filter, Generate, cell-click, Kalibirity Generate, stage + save a manual override, Publish/Unpublish toggle, inline report generation).

**Gotchas worth knowing before you extend this script:**
- `commonFilter` (search box, filters, Generate button) is mounted **twice simultaneously** — once under the Nine-Grid tab, once under Kalibirity — because `MgScan.aspx` keeps both tabs' components alive via `visible` (not `if`) so switching tabs doesn't lose state. An unscoped `a[data-bind*="onGenerate"]` matches 2 elements and strict-mode-fails. Always scope to `#tabMgScanNineGrid` or `#tabMgScanKalibirity`.
- The Nine-Grid's selected-cell state does **not** survive a tab round-trip (Kalibirity → Nine-Grid) — re-click a cell after switching back, don't assume the previously-opened candidate-list panel is still showing.
- Kalibirity's batch-save button text is dynamic: `"Save calibrations (N)"` when N changes are staged, `"Calibrations saved (0)"` when none are — not the Dutch "Kalibraties opgeslagen" guessed early on. Select it via `a[data-bind*="click: onSave"]` inside `#tabMgScanKalibirity`, and check the label text to confirm a change was actually staged before treating a click as a real save attempt.
- To stage an override: click a `.kal-swatch:not(.is-current)` inside the candidate's `.kal-row`, then optionally fill `.kal-inline-edit-input` (the "Reason for override" comment).
- After Publish/Unpublish, the candidate's row can legitimately **disappear** from the currently-viewed list/cell (confirmed both directions) — don't assume the button element persists; use short (~3s) explicit timeouts on any post-click `getAttribute` check, or Playwright's default 30s auto-wait silently makes the step look "slow" when really it's just chasing a vanished element.
- A "Loading..." modal briefly covers the page after several actions (Kalibirity Generate, dashboard navigation) — wait for it to hide before checking for content, not just `networkidle` (confirmed live: `networkidle` can resolve while the modal is still up).
- Report (HTML)/(PDF) buttons: match by **visible text** (`page.locator('button, a').filter({ hasText: 'Report (HTML)' })`), not `getByRole('button', { name: ... })` — icon+text buttons' accessible name doesn't reliably match the visible label.

## 6. Assessment-page validation/button checks

```bash
node test-assessment-validation.mjs <runStamp-of-validation-only-account>
```

Checks (all passed 2026-08-10): submit-without-answering highlights every unanswered question and shows a specific validation banner without navigating away; Pause & Resume correctly persists partial answers across a full logout-equivalent round-trip (dashboard → resume → same answers selected).

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
