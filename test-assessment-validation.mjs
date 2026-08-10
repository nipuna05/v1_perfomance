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
const account = JSON.parse(fs.readFileSync(path.join(__dirname, 'results', `account-setup-${runStamp}.json`), 'utf-8'))[0];

const shotsDir = path.join(__dirname, 'shots', 'validation');
fs.mkdirSync(shotsDir, { recursive: true });
let seq = 0;
async function shot(page, label) {
  seq++;
  await page.screenshot({ path: path.join(shotsDir, `${String(seq).padStart(2, '0')}-${label}.png`), fullPage: true }).catch(() => {});
  console.log(`  [shot] ${label}`);
}

const findings = [];

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

    // ── Test 1: Submit with nothing answered ────────────────────────────────────────────
    await shot(page, '02-question-page-unanswered');
    await page.locator('.btn-ctrl.primary:visible').click();
    await page.waitForTimeout(1500);
    await shot(page, '03-after-submit-unanswered');

    const unansweredCount = await page.locator('.mgscan-question.is-unanswered').count();
    findings.push({ check: 'Unanswered questions get .is-unanswered highlight after Submit', result: unansweredCount > 0 ? `PASS (${unansweredCount} highlighted)` : 'FAIL (0 highlighted)' });

    const errorBanner = page.locator('[data-bind*="errorMessage"]');
    const bannerText = (await errorBanner.count()) > 0 ? (await errorBanner.first().textContent() || '').trim() : '';
    findings.push({ check: 'Validation error banner shown on submit-without-answering', result: bannerText ? `PASS ("${bannerText}")` : 'FAIL (no banner text found)' });

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
      await pauseBtn.first().click();
      await page.waitForTimeout(1500);
      await shot(page, '05-after-pause');
      findings.push({ check: 'Pause & resume later button present and clickable', result: 'PASS' });

      const backOnDashboard = await page.locator('h1', { hasText: account.fullName }).count() > 0;
      findings.push({ check: 'Pause returns to Personal Dashboard', result: backOnDashboard ? 'PASS' : 'FAIL' });

      // Resume and verify the 3 answers are still selected.
      const continueBtn = page.locator('a[data-bind*="onStartAssessment"]');
      if (await continueBtn.count() > 0) {
        await continueBtn.click();
        await page.locator('.btn-ctrl.primary:visible').waitFor({ state: 'visible', timeout: 15000 });
        await shot(page, '06-resume-intro');
        await page.locator('.btn-ctrl.primary:visible').click(); // "Continue"
        await page.locator('.mgscan-question').first().waitFor({ state: 'visible', timeout: 15000 });
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
