import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// One-off setup: completes BOTH sides of the Management Scan 360 assessment for the fresh
// PerfTest hierarchy — Employee's self-assessment, then Manager's assessment about that
// employee — so Nine-Grid/Kalibirity/report data becomes real instead of empty. Per the
// Explore-agent research: all-on-one-page (no Next/Prev), scored questions are radio-style
// `label.mgscan-scale-option` clicks, open-context questions are a `<textarea>`, Submit is
// never disabled (server validates), and respondent type (Candidate vs MyManager) is resolved
// server-side purely from which account is logged in — no client param to set.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const credsFile = process.env.CREDS_FILE || '.credentials.local.json';
const creds = JSON.parse(fs.readFileSync(path.join(__dirname, credsFile), 'utf-8'));

const runStamp = process.argv[2];
if (!runStamp) {
  console.error('Usage: node complete-mgscan-assessments.mjs <runStamp>');
  process.exit(1);
}
const accounts = JSON.parse(fs.readFileSync(path.join(__dirname, 'results', `account-setup-${runStamp}.json`), 'utf-8'));
const employee = accounts.find(a => a.role === 'employee');
const manager = accounts.find(a => a.role === 'manager');

const shotsDir = path.join(__dirname, 'shots', 'assessments');
fs.mkdirSync(shotsDir, { recursive: true });
let seq = 0;
async function shot(page, label) {
  seq++;
  await page.screenshot({ path: path.join(shotsDir, `${String(seq).padStart(2, '0')}-${label}.png`), fullPage: true }).catch(() => {});
  console.log(`  [shot] ${label}`);
}

function now() { return process.hrtime.bigint(); }
function msSince(start) { return Number(now() - start) / 1e6; }
async function timeIt(flowArr, label, fn) {
  const start = now();
  let ok = true, error = null, extra = null;
  try { extra = await fn(); } catch (e) { ok = false; error = e.message?.slice(0, 300) || String(e); }
  const ms = Math.round(msSince(start));
  flowArr.push({ label, ms, ok, error, extra });
  return extra;
}

async function login(page, account) {
  await page.goto(creds.signInUrl || creds.baseUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('#Login1_UserName').waitFor({ state: 'visible', timeout: 20000 });
  await page.locator('#Login1_UserName').fill(account.username);
  await page.locator('#Login1_Password').fill(account.password);
  await page.locator('#Login1_LoginButton').click();
  await page.locator('#MenuLogout').waitFor({ state: 'visible', timeout: 30000 });
}

// Per-statement timing: all 28 scored statements render on one page/DOM at once (no per-page
// autosave - only Pause and Submit hit the server, confirmed via source 2026-08-13), so each
// `.mgscan-scale-option` click is a pure client-side response - this measures UI responsiveness
// per click, not a network round-trip. Open-context textareas (up to 3) are timed separately
// since they're a fill, not a click. This is the only place assessment-play timing can be
// captured at all: once an assessment completes it shows "Done" and can't be replayed for 3
// months (see docs/management-scan-testing-runbook.md), so there is no way to re-run this
// interaction on demand the way the Nine-Grid/Kalibirity sweep can be re-run anytime - this
// script's one-time completion run during account setup IS the only measurement opportunity per
// fresh dataset.
async function answerAllQuestions(page, flowArr, rolePrefix) {
  await page.locator('.mgscan-question').first().waitFor({ state: 'visible', timeout: 15000 });
  const questions = await page.locator('.mgscan-question').all();
  console.log(`  Answering ${questions.length} questions...`);
  let scoredCount = 0, openCount = 0;
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const textarea = q.locator('textarea');
    if (await textarea.count() > 0) {
      openCount++;
      await timeIt(flowArr, `${rolePrefix} - Open question #${openCount} - textarea fill`, async () => {
        await textarea.fill('Sample answer entered for Management Scan performance testing.');
      });
    } else {
      const options = q.locator('label.mgscan-scale-option');
      const count = await options.count();
      if (count > 0) {
        scoredCount++;
        await timeIt(flowArr, `${rolePrefix} - Statement #${scoredCount} - scale-option click`, async () => {
          await options.nth(Math.min(2, count - 1)).click();
        });
      } else {
        console.log(`  WARNING: question #${i + 1} has neither textarea nor scale options.`);
      }
    }
  }
  return { scoredCount, openCount };
}

async function completeAssessment(page, label, flowArr) {
  // Views are toggled via Knockout `visible` (display:none), not `if` — the hidden view's DOM
  // node still matches a plain '.btn-ctrl.primary' selector, and .first() doesn't skip it,
  // so a *later* Playwright click (e.g. Submit) can resolve back to the earlier, now-hidden
  // Start button and hang forever waiting for it to become visible (confirmed live). Playwright's
  // ':visible' pseudo-class filters to only the currently-shown one.
  const visiblePrimaryBtn = page.locator('.btn-ctrl.primary:visible');

  // 'start' view — click the primary Start/Continue button.
  await timeIt(flowArr, `${label} - Assessment start view load`, async () => {
    await visiblePrimaryBtn.waitFor({ state: 'visible', timeout: 20000 });
  });
  await shot(page, `${label}-01-intro`);
  await timeIt(flowArr, `${label} - Click Start/Continue -> question view renders`, async () => {
    await visiblePrimaryBtn.click();
    await page.locator('.mgscan-question').first().waitFor({ state: 'visible', timeout: 15000 });
  });

  // 'question' view — answer everything (individually timed), then Submit.
  await answerAllQuestions(page, flowArr, label);
  await shot(page, `${label}-02-answered`);

  const submitResult = await timeIt(flowArr, `${label} - Submit -> response (validation banner or end view)`, async () => {
    await visiblePrimaryBtn.click();
    // Race the two possible outcomes rather than a blind fixed wait, so this step's ms reflects
    // how long the actual response took, not an arbitrary sleep.
    const errorBanner = page.locator('[data-bind*="errorMessage"]');
    const endViewMarker = page.getByText(/back to dashboard/i);
    await Promise.race([
      errorBanner.first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {}),
      endViewMarker.first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {}),
    ]);
    const bannerVisible = await errorBanner.first().isVisible().catch(() => false);
    const bannerText = bannerVisible ? (await errorBanner.first().textContent() || '').trim() : null;
    if (bannerText) console.log(`  Validation/error banner: "${bannerText}"`);
    return { bannerShown: bannerVisible, bannerText };
  });
  await shot(page, `${label}-03-after-submit`);

  // 'end' view — click Back to dashboard if present.
  const backBtn = page.getByText(/back to dashboard/i);
  if (await backBtn.count() > 0) {
    await timeIt(flowArr, `${label} - Back to dashboard`, async () => {
      await backBtn.first().click();
      await page.waitForTimeout(1000);
    });
    await shot(page, `${label}-04-end`);
  }
  return submitResult;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const employeeFlow = [];
  const managerFlow = [];

  try {
    console.log('=== Employee self-assessment ===');
    const empPage = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await login(empPage, employee);
    await empPage.goto(`${creds.baseUrl}/MgScan.aspx`, { waitUntil: 'domcontentloaded' });
    await shot(empPage, 'employee-dashboard-before');
    const startAssessmentBtn = empPage.locator('a[data-bind*="onStartAssessment"]');
    await startAssessmentBtn.waitFor({ state: 'visible', timeout: 15000 });
    await startAssessmentBtn.click();
    await completeAssessment(empPage, 'employee', employeeFlow);
    await empPage.close();

    console.log('\n=== Manager assessment about Employee ===');
    const mgrPage = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await login(mgrPage, manager);
    await mgrPage.goto(`${creds.baseUrl}/MgScan.aspx`, { waitUntil: 'domcontentloaded' });
    await mgrPage.locator('#tabMgScanNineGrid a[data-bind*="onGenerate"]').waitFor({ state: 'visible', timeout: 20000 });
    await mgrPage.locator('#tabMgScanNineGrid a[data-bind*="onGenerate"]').click();
    await mgrPage.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await shot(mgrPage, 'manager-nine-grid-generated');

    // Switch to the Pending sub-tab to find the employee's "start assessment" row action.
    const pendingTab = mgrPage.locator('button', { hasText: /pending/i });
    if (await pendingTab.count() > 0) {
      await pendingTab.first().click();
      await mgrPage.waitForTimeout(500);
    }
    await shot(mgrPage, 'manager-pending-list');

    const pendingStartBtn = mgrPage.locator('.mg-cell-pending-start').first();
    await pendingStartBtn.waitFor({ state: 'visible', timeout: 10000 });
    await pendingStartBtn.click();
    await completeAssessment(mgrPage, 'manager', managerFlow);
    await mgrPage.close();

  } catch (e) {
    console.log('FATAL:', e.message);
  } finally {
    await browser.close();
  }

  // Saved in the same {role, flow, notes} shape as measure-mgscan-full.mjs's output so
  // build-final-report-data.mjs / record-perf-run.mjs can merge it in without a special case.
  // Role names here are the org-hierarchy account roles ('employee'/'manager') - relabeled to
  // the feature's own terms (Manager/Director) by build-final-report-data.mjs, same as every
  // other script's output (see that file's ROLE_DISPLAY_NAME map).
  const outPath = path.join(__dirname, 'results', `assessment-play-timing-${runStamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify({
    runLabel: 'assessment-play-timing',
    runTimestamp: runStamp,
    baseUrl: creds.baseUrl,
    results: [
      { role: 'employee', username: employee.username, flow: employeeFlow, notes: [] },
      { role: 'manager', username: manager.username, flow: managerFlow, notes: [] },
    ],
  }, null, 2));
  console.log(`\nSaved assessment-play timing to ${outPath}`);
})();
