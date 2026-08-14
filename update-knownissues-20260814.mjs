import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// One-off per-run patch (2026-08-14): build-final-report-data.mjs bakes in a static
// knownIssues/terminologyNote template that's stale as of 2026-08-12/13. This overwrites
// both fields with today's actual findings, following the established per-day pattern.
// Run once against results/mgscan-full-combined-20260814.json, then delete.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(__dirname, 'results', 'mgscan-full-combined-20260814.json');
const combined = JSON.parse(fs.readFileSync(file, 'utf-8'));

combined.knownIssues = [
  {
    severity: 'Bug (confirmed, recurring)',
    area: 'Assessment page — validation error banner',
    summary: '"Validation error banner shown on submit-without-answering" has now FAILED on 2 consecutive test days (2026-08-13 and 2026-08-14): no banner text is found within a 10s wait after submitting with unanswered required questions. The per-question ".is-unanswered" red highlighting still works correctly both days (30/31 questions flagged, correctly excluding the one optional trailing question), and Submit correctly does not navigate away — only the banner/message itself is missing.',
    reproduction: 'Log in as PerfTest ValidationCheck, start the assessment, click Submit without answering any questions, wait up to 10s for a validation banner.',
    evidence: 'assessment-validation-20260814c.json: "Validation error banner shown on submit-without-answering": "FAIL (no banner text found)" (10048ms wait) — same result as 2026-08-13.',
  },
  {
    severity: 'Bug (new, needs investigation)',
    area: 'Kalibirity manual override — direct-manager evaluator (Director role)',
    summary: 'For the account that IS the candidate\'s direct manager/evaluator (feature-term "Director", org-hierarchy "manager" account — the one role that SHOULD be able to stage an override), clicking a non-current position swatch now times out instead of registering the click. Reproduced on 3 consecutive attempts today (30008ms, 30008ms, 10051ms with a reduced timeout). A screenshot showed an in-page HTML modal styled like a native OS dialog (blue title bar reading "HrmForce", "Loading..." spinner) sitting over the page; adding a page.on(\'dialog\') handler and re-running confirmed it never fires as a real native dialog, so something is leaving an in-page loading overlay covering the swatch rather than a true browser prompt. This is distinct from the previously-documented "Good (by design)" case below — that one is an authorization boundary working as intended; this is an authorized account\'s own action failing.',
    reproduction: 'Log in as the evaluator (feature "Director", e.g. perftest.manager.20260814), open Kalibirity tab, Generate, click an alternate (non-current) position swatch on the direct report\'s row.',
    evidence: 'mgscan-full-manager-20260814.json / relabeled "Director" entry in mgscan-full-combined-20260814.json: "Action - Stage a manual override (click a non-current swatch)" ok:false, "locator.click: Timeout 10000ms exceeded."',
  },
  {
    severity: 'Bug (confounded result — do not report as resolved without re-testing)',
    area: 'Publish/Unpublish (Nine-Grid Completed list) — cross-manager authorization',
    summary: 'This release merged ADR-023 ("Client-scope the super-user branch of Management Scan authorization"), which changes SetPublishState\'s authorization check so non-Admin super-user account types (Test_Manager, Client, Partner, Distributor, etc.) must have the same Client_ID as the target employee, while Admin stays unconditionally exempt. Separately, mid-run today we found and fixed a test-data bug: the org-rollup "Director" test account\'s "Is Test Manager" checkbox was unchecked, which had been suppressing its Nine-Grid view entirely. After fixing that flag, Director\'s Publish/Unpublish today returned 200 OK (toggled Unpublish -> Publish, ~1236ms) instead of the 500 reproduced on every prior run. This is NOT a clean confirmation that ADR-023 fixed the original bug: our Director test account sits in the SAME test client as the employee, which is exactly the branch ADR-023 says should succeed regardless of whether the original 500 was ever fixed. We have not yet exercised the branch that would actually distinguish the two explanations — a super-user account whose Client_ID differs from the target employee\'s, which per ADR-023 should now fail closed with a graceful authorization error instead of a 500.',
    reproduction: 'Today: log in as perftest.director.20260814 (org-rollup, 2 levels up, same test client as the employee), open Nine-Grid, Generate, select the candidate\'s cell, click Publish/Unpublish — succeeds (200 OK) both in the reported "Director" row and the org-rollup director sweep.',
    evidence: 'mgscan-full-director-20260814.json and mgscan-full-manager-20260814.json (relabeled "Director"): "Action - Publish/Unpublish toggle" ok:true, ms:1235-1236, extra.toggled:true. Compare against every prior run (2026-08-10 through 2026-08-13), where the same interaction returned HTTP 500.',
    suggestedFix: 'Re-run this specific check with a super-user test account provisioned under a DIFFERENT Client_ID than the target employee. Expected per ADR-023: a graceful authorization failure (not a 500). If it still 500s, the original bug is unfixed and ADR-023 only tightened scope without touching the underlying unhandled-exception path in ManagementScanPlayBO.SetPublishState.',
  },
  {
    severity: 'Retracted — test-tooling mistake, not a product bug (corrected after further investigation)',
    area: 'CandidateNew.aspx — "Username already exists" on account creation',
    summary: 'Earlier today this was logged as a false-positive validation error on genuinely-fresh usernames. Checked against git history before finalizing this report and that framing was wrong: both occurrences were re-attempts to create a username that had ALREADY been created earlier the SAME DAY under an identical runStamp. perftest.director.20260814 was already committed (with zero errors) from an earlier same-day attempt at this exact hierarchy that appears to have stopped right after creating the Director account (Manager/Employee were not yet created) — consistent with account creation happening bottom-up and something interrupting the run after step 1. perftest.validationcheck.20260814b was already committed (with zero errors) from the earlier same-day post-2026-08-14-deploy checkpoint run. Re-running account creation against the same runStamp a second time correctly reported "Username already exists" both times — that is accurate behavior, not a UI bug.',
    evidence: 'git show HEAD:results/account-setup-20260814.json (pre-today) already contained a zero-error "director" entry for perftest.director.20260814 before this run touched the file; git show HEAD:results/account-setup-20260814b.json (pre-today) already contained a zero-error "validationcheck" entry for perftest.validationcheck.20260814b. Lesson for the runbook: don\'t reuse a runStamp across multiple same-day account-creation attempts without checking what already exists under it first.',
  },
  {
    severity: 'Info (test-data gotcha, fixed this run — add to runbook)',
    area: 'CandidateNew.aspx — "Is Test Manager" checkbox not set on a leftover, partially-set-up account',
    summary: 'The org-rollup Director test account used in this run (perftest.director.20260814) had "Is Test Manager" unchecked, which caused MgScan.aspx to render an empty candidate Personal Dashboard instead of the Nine-Grid supervisor view — even though the account\'s manager hierarchy (its own "Manager" field) was correctly linked. Likely explanation (see the retracted finding above): this account was created hours earlier the same day by an interrupted first attempt at this hierarchy that stopped right after the Director step, so it never went through whatever later part of that day\'s setup flow would have set this flag — this run picked up and reused a half-configured leftover account without realizing it wasn\'t actually fresh. Root-caused by comparing against yesterday\'s still-working director account and manually inspecting the checkbox via the Edit view. Fixed by checking the box and saving; verified the Nine-Grid rendered correctly afterward.',
    evidence: 'check-testmanager-flag.mjs: perftest.director.20260814 = false (before fix); check-director-fixed.mjs: "Has Nine-Grid tabs now: 1" (after fix).',
    suggestedFix: 'Runbook/tooling fix: before reusing a runStamp for account creation, check results/account-setup-<runStamp>.json for pre-existing entries rather than assuming a fresh hierarchy — an interrupted prior attempt under the same runStamp can leave a partially-configured account that looks fresh but isn\'t.',
  },
  {
    severity: 'Info (carried forward, not re-verified this run)',
    area: 'CandidateNew.aspx — "+New" button intermittent mis-landing',
    summary: 'Previously observed on 2 of ~6 attempts landing on an unrelated "My Account" tab instead of the new-candidate form; not specifically re-measured today (today\'s account-creation runs hit the "Username already exists" false-positive instead, see above, rather than this symptom). Carried forward as a known intermittent issue rather than re-confirmed.',
  },
  {
    severity: 'Info',
    area: 'Report (PDF/HTML) generation time — this run',
    summary: 'Today\'s Report(HTML)/Report(PDF) times cluster around 4.0s / 5.3-5.4s across both reported roles (Manager\'s own dashboard, Director\'s toolbar and row-level reports) — noticeably lower than a previously-reported ~12.8s PDF figure from an earlier run. Not flagged as a regression (the earlier figure was higher, not lower), but the day-to-day spread is wide enough that a fixed number shouldn\'t be treated as a stable baseline without more samples.',
    evidence: 'mgscan-full-combined-20260814.json: Manager "Report (PDF)" 5414ms; Director toolbar PDF 5301ms, row PDF 5435ms.',
  },
  {
    severity: 'Info (not verified this run)',
    area: 'Full page-load sweep (~93 modules)',
    summary: 'Not re-run today — this run only exercised Management Scan flows (account setup, assessment play, Nine-Grid/Kalibirity interactions, validation checks). The previously-reported 2-module failure (Dashboard.aspx, AdminTools.aspx?t=0) is carried forward as historical context only, not re-confirmed against today\'s release.',
  },
];

combined.terminologyNote = 'The Nine-Grid\'s own "Manager"/"Director" progress bars refer to the two sides of a Management Scan cycle (the assessment SUBJECT is labeled "Manager"; their evaluator/boss is labeled "Director") — NOT the org-hierarchy test account names used to script this suite. In this test hierarchy: PerfTest Employee is the assessment subject (feature\'s "Manager"), PerfTest Manager is the evaluator/direct manager (feature\'s "Director"), and PerfTest Director is one level further up (org-rollup only, not one of the two reported roles) — used to exercise the super-user/cross-manager authorization branch described in ADR-023 and the Publish/Unpublish confound above.';

combined.releaseNote = {
  date: '2026-08-14',
  summary: 'Synced local branch to master (32 new commits since the 2026-08-13 baseline) ahead of this run, per a confirmed new IT release. Most relevant merged change: ADR-023 ("Client-scope the super-user branch of Management Scan authorization"), a GDPR/security fix closing a cross-tenant report-read and Publish/Unpublish-write gap for non-Admin super-user account types. See the Publish/Unpublish knownIssues entry above for why today\'s test results cannot yet confirm whether this also fixed the previously-tracked 500 bug.',
};

fs.writeFileSync(file, JSON.stringify(combined, null, 2));
console.log('knownIssues, terminologyNote, and releaseNote updated for 20260814.');
