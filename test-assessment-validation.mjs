import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Functional check (not a timing run) of the Assessment page's validation/button behavior, per
// the user's "assessment page also need to include other validation functionality and button
// validation edit save everything" request — submit-without-answering, the unanswered-highlight
// banner, and Pause & resume's answer persistence. Uses the standalone PerfTest ValidationCheck
// account (no manager relationship, so this never touches the real completed/published
// Employee/Manager/Director cycle).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const credsFile = process.env.CREDS_FILE || '.credentials.local.json';
const creds = JSON.parse(fs.readFileSync(path.join(__dirname, credsFile), 'utf-8'));

const runStamp = process.argv[2];
const accounts = JSON.parse(fs.readFileSync(path.join(__dirname, 'results', `account-setup-${runStamp}.json`), 'utf-8'));
// Was `accounts[0]` - safe only when the validation-only account was the sole entry in its own
// file (a distinct runStamp2 from the main hierarchy). Now that create-mgscan-test-accounts.mjs
// merges by role instead of overwriting, calling it twice for the SAME runStamp (main hierarchy,
// then validation-only) puts multiple accounts in one file with validation-only appended last,
// not first - confirmed live 2026-08-13: index [0] silently picked up "PerfTest Director" instead
// and the run failed looking for a Start-Assessment button Director doesn't have. Look up by role
// like every other script in this suite does, regardless of which runStamp convention was used.
const account = accounts.find(a => a.role === 'validationcheck');
if (!account) {
  console.error(`No 'validationcheck' role found in results/account-setup-${runStamp}.json - did you create it with the 'validation-only' argument?`);
  process.exit(1);
}

const shotsDir = path.join(__dirname, 'shots', 'validation');
fs.mkdirSync(shotsDir, { recursive: true });
let seq = 0;
async function shot(page, label) {
  seq++;
  await page.screenshot({ path: path.join(shotsDir, `${String(seq).padStart(2, '0')}-${label}.png`), fullPage: true }).catch(() => {});
  console.log(`  [shot] ${label}`);
}

const findings = [];
function now() { return process.hrtime.bigint(); }
function msSince(start) { return Math.round(Number(now() - start) / 1e6); }

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  try {
    await page.goto(creds.signInUrl || creds.baseUrl, { waitUntil: 'domcontentloaded' });
    await page.locator('#Login1_UserName').waitFor({ state: 'visible', timeout: 20000 });
    await page.locator('#Login1_UserName').fill(account.username);
    await page.locator('#Login1_Password').fill(account.password);
    await page.locator('#Login1_LoginButton').click();
    await page.locator('#MenuLogout').waitFor({ state: 'visible', timeout: 30000 });
    console.log('Logged in.');

    await page.goto(`${creds.baseUrl}/MgScan.aspx`, { waitUntil: 'domcontentloaded' });
    await page.locator('a[data-bind*="onStartAssessment"]').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('a[data-bind*="onStartAssessment"]').click();
    await page.locator('.btn-ctrl.primary:visible').waitFor({ state: 'visible', timeout: 15000 });
    await shot(page, '01-intro');
    await page.locator('.btn-ctrl.primary:visible').click();
    await page.locator('.mgscan-question').first().waitFor({ state: 'visible', timeout: 15000 });

    // ── Test 0: Open-question textarea maxlength (regression tracked since before 2026-08-13,
    // reported fixed 2026-08-14/154c234c — "Removed maxlength attribute from textarea in
    // mgScanAssessment.html to allow for longer answers"). Read-only check (no typing), placed
    // before Test 1 so it can't affect the unanswered-count assertion below.
    const firstTextarea = page.locator('.mgscan-question textarea').first();
    if (await firstTextarea.count() > 0) {
      const maxlength = await firstTextarea.getAttribute('maxlength');
      findings.push({ check: 'Open-question textarea has no maxlength cap (250-char regression fixed)', result: maxlength === null ? 'PASS (no maxlength attribute)' : `FAIL (maxlength="${maxlength}")` });
    } else {
      findings.push({ check: 'Open-question textarea has no maxlength cap (250-char regression fixed)', result: 'SKIP (no open-question textarea on this account\'s assessment)' });
    }

    // ── Test 1: Submit with nothing answered ────────────────────────────────────────────
    await shot(page, '02-question-page-unanswered');
    const submitClickStart = now();
    await page.locator('.btn-ctrl.primary:visible').click();
    // Time the actual appearance of the validation banner/highlight, not a blind sleep -
    // this is the "message appearing time" measurement, distinct from whether it shows at all.
    const errorBanner = page.locator('[data-bind*="errorMessage"]');
    const bannerAppeared = await errorBanner.first().waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);
    const bannerAppearMs = msSince(submitClickStart);
    await shot(page, '03-after-submit-unanswered');

    const unansweredCount = await page.locator('.mgscan-question.is-unanswered').count();
    findings.push({ check: 'Unanswered questions get .is-unanswered highlight after Submit', result: unansweredCount > 0 ? `PASS (${unansweredCount} highlighted)` : 'FAIL (0 highlighted)', ms: bannerAppearMs });

    const bannerText = bannerAppeared ? (await errorBanner.first().textContent() || '').trim() : '';
    findings.push({ check: 'Validation error banner shown on submit-without-answering', result: bannerText ? `PASS ("${bannerText}")` : 'FAIL (no banner text found)', ms: bannerAppearMs });

    const stillOnQuestionView = await page.locator('.mgscan-question').first().isVisible();
    findings.push({ check: 'Submit does NOT navigate away when validation fails (stays on question view)', result: stillOnQuestionView ? 'PASS' : 'FAIL' });

    // ── Test 2: Pause & resume persists partial answers ─────────────────────────────────
    const questions = await page.locator('.mgscan-question').all();
    const answeredLabels = [];
    for (let i = 0; i < Math.min(3, questions.length); i++) {
      const opts = questions[i].locator('label.mgscan-scale-option');
      if (await opts.count() > 0) {
        await opts.nth(1).click();
        answeredLabels.push(i);
      }
    }
    await shot(page, '04-partially-answered');

    const pauseBtn = page.locator('button, a').filter({ hasText: /pause/i });
    if (await pauseBtn.count() === 0) {
      findings.push({ check: 'Pause & resume later button present', result: 'FAIL (not found)' });
    } else {
      const pauseClickStart = now();
      await pauseBtn.first().click();
      const dashboardHeading = page.locator('h1', { hasText: account.fullName });
      const backOnDashboard = await dashboardHeading.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);
      const pauseMs = msSince(pauseClickStart);
      await shot(page, '05-after-pause');
      findings.push({ check: 'Pause & resume later button present and clickable', result: 'PASS', ms: pauseMs });
      findings.push({ check: 'Pause returns to Personal Dashboard', result: backOnDashboard ? 'PASS' : 'FAIL', ms: pauseMs });

      // Resume and verify the 3 answers are still selected.
      const continueBtn = page.locator('a[data-bind*="onStartAssessment"]');
      if (await continueBtn.count() > 0) {
        const resumeStart = now();
        await continueBtn.click();
        await page.locator('.btn-ctrl.primary:visible').waitFor({ state: 'visible', timeout: 15000 });
        await shot(page, '06-resume-intro');
        await page.locator('.btn-ctrl.primary:visible').click(); // "Continue"
        await page.locator('.mgscan-question').first().waitFor({ state: 'visible', timeout: 15000 });
        const resumeMs = msSince(resumeStart);
        findings.push({ check: 'Resume -> question view with retained answers renders', result: 'PASS', ms: resumeMs });
        await shot(page, '07-resumed-question-page');

        const questionsAfterResume = await page.locator('.mgscan-question').all();
        let retainedCount = 0;
        for (const i of answeredLabels) {
          const selected = await questionsAfterResume[i].locator('label.mgscan-scale-option.is-selected').count();
          if (selected > 0) retainedCount++;
        }
        findings.push({ check: `Answers retained after Pause + Resume (${answeredLabels.length} answered before pause)`, result: retainedCount === answeredLabels.length ? `PASS (${retainedCount}/${answeredLabels.length} retained)` : `FAIL (${retainedCount}/${answeredLabels.length} retained)` });
      }
    }

  } catch (e) {
    findings.push({ check: 'FATAL', result: `ERROR: ${e.message}` });
    console.log('FATAL:', e.message);
    await shot(page, 'FATAL');
  } finally {
    await browser.close();
  }

  console.log('\n=== FINDINGS ===');
  findings.forEach(f => console.log(`${f.result.startsWith('PASS') ? '✓' : '✗'} ${f.check}: ${f.result}`));

  const outPath = path.join(__dirname, 'results', `assessment-validation-${runStamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(findings, null, 2));
  console.log(`\nSaved to ${outPath}`);
})();
