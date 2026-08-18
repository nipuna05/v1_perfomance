import { chromium } from 'playwright';
import fs from 'fs';

// One-off verification (2026-08-18): re-checks the Kalibirity override-staging hang found
// on 2026-08-14 against the newly-merged ADR-024/ADR-025 (Kalibirity gets its own
// authorization-filtered candidate list; calibration auth widened to downward subtree).
// Reuses the existing 2026-08-14 hierarchy (Nine-Grid/Kalibirity data is re-exercisable
// anytime, unlike assessment-play). Captures the actual network call Kalibirity's
// Generate button fires, to fingerprint whether GetFilteredScansForCalibration
// (ADR-024's new endpoint) is actually live, rather than assuming from the release date.

const creds = JSON.parse(fs.readFileSync('.credentials.local.json', 'utf-8'));

async function checkAs(username, password, roleLabel) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const calls = [];
  page.on('request', req => {
    const url = req.url();
    if (/MgScanService\.asmx\/(GetFilteredScans|GetFilteredScansForCalibration)/i.test(url)) {
      calls.push(url.split('/').pop());
    }
  });

  await page.goto(creds.signInUrl || creds.baseUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('#Login1_UserName').fill(username);
  await page.locator('#Login1_Password').fill(password);
  await page.locator('#Login1_LoginButton').click();
  await page.locator('#MenuLogout').waitFor({ state: 'visible', timeout: 30000 });

  await page.goto(`${creds.baseUrl}/MgScan.aspx`, { waitUntil: 'domcontentloaded' });
  await page.locator('#tabMgScanKalibirity').waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  const kalTab = page.locator('a', { hasText: 'Kalibirity' }).first();
  await kalTab.click().catch(() => {});
  await page.waitForTimeout(1500);

  const genericLoading = page.getByText('Loading...', { exact: true });
  await genericLoading.waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1000);

  const kalRow = page.locator('#tabMgScanKalibirity .kal-row').filter({ hasText: 'PerfTest Employee' });
  const rowCount = await kalRow.count();
  let overrideResult = { attempted: false };

  if (rowCount > 0) {
    const start = Date.now();
    try {
      const otherSwatch = kalRow.first().locator('.kal-swatch:not(.is-current)').first();
      await otherSwatch.click({ timeout: 15000 });
      overrideResult = { attempted: true, ok: true, ms: Date.now() - start };
    } catch (e) {
      overrideResult = { attempted: true, ok: false, ms: Date.now() - start, error: e.message.split('\n')[0] };
    }
  }

  await page.screenshot({ path: `C:/Users/NIPUNA~1/AppData/Local/Temp/claude/d--QAssessment-HRMForce-GIT/4c919854-b671-4446-ad27-3862e560be10/scratchpad/kal-check-${roleLabel}.png`, fullPage: true });
  await browser.close();

  return {
    role: roleLabel,
    username,
    networkCallsSeen: calls,
    kalibirityRowFoundForEmployee: rowCount > 0,
    overrideResult,
  };
}

const results = [];
results.push(await checkAs('perftest.manager.20260814', 'PerfTest@2026', 'evaluator (feature Director, direct manager)'));
results.push(await checkAs('perftest.director.20260814', 'PerfTest@2026', 'org-rollup Director (2 levels up)'));

console.log(JSON.stringify(results, null, 2));
fs.writeFileSync('results/kalibirity-adr024-check-20260818.json', JSON.stringify(results, null, 2));
