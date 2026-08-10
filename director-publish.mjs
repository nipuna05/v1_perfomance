import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// One-off: as Director, Generate the Nine-Grid, find the completed PerfTest Employee row (under
// PerfTest Manager, in Director's subtree roll-up), and click Publish — per the user's note that
// the Manager's report / the Employee's own score only become visible after the Director
// publishes a completed cycle.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const credsFile = process.env.CREDS_FILE || '.credentials.local.json';
const creds = JSON.parse(fs.readFileSync(path.join(__dirname, credsFile), 'utf-8'));

const runStamp = process.argv[2];
const roleToUse = process.argv[3] || 'director';
const accounts = JSON.parse(fs.readFileSync(path.join(__dirname, 'results', `account-setup-${runStamp}.json`), 'utf-8'));
const director = accounts.find(a => a.role === roleToUse);

const shotsDir = path.join(__dirname, 'shots', 'director-publish');
fs.mkdirSync(shotsDir, { recursive: true });
let seq = 0;
async function shot(page, label) {
  seq++;
  await page.screenshot({ path: path.join(shotsDir, `${String(seq).padStart(2, '0')}-${label}.png`), fullPage: true }).catch(() => {});
  console.log(`  [shot] ${label}`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  // Playwright auto-DISMISSES any unhandled native dialog by default — if onTogglePublish shows
  // a confirm() before actually publishing, that default silently cancels the action, which
  // exactly matches what was observed live (Publish title unchanged after the click).
  page.on('dialog', async (d) => {
    console.log(`  [dialog] ${d.type()}: "${d.message()}" — accepting`);
    await d.accept();
  });
  page.on('console', (msg) => { if (msg.type() === 'error') console.log(`  [console error] ${msg.text()}`); });
  page.on('requestfinished', async (req) => {
    if (req.url().includes('.asmx/')) {
      const res = await req.response();
      console.log(`  [network] ${req.method()} ${req.url()} -> ${res?.status()}`);
      if (res && res.status() >= 400) {
        const body = await res.text().catch(() => '(could not read body)');
        console.log(`  [network ERROR BODY] ${body.slice(0, 2000)}`);
      }
    }
  });
  page.on('requestfailed', (req) => {
    if (req.url().includes('.asmx/')) console.log(`  [network FAILED] ${req.url()} — ${req.failure()?.errorText}`);
  });

  try {
    await page.goto(creds.signInUrl || creds.baseUrl, { waitUntil: 'domcontentloaded' });
    await page.locator('#Login1_UserName').waitFor({ state: 'visible', timeout: 20000 });
    await page.locator('#Login1_UserName').fill(director.username);
    await page.locator('#Login1_Password').fill(director.password);
    await page.locator('#Login1_LoginButton').click();
    await page.locator('#MenuLogout').waitFor({ state: 'visible', timeout: 30000 });
    console.log('Logged in as Director.');

    await page.goto(`${creds.baseUrl}/MgScan.aspx`, { waitUntil: 'domcontentloaded' });
    const nineGridTab = page.locator('#tabMgScanNineGrid');
    await nineGridTab.locator('a[data-bind*="onGenerate"]').waitFor({ state: 'visible', timeout: 20000 });
    await nineGridTab.locator('a[data-bind*="onGenerate"]').click();
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await shot(page, '01-generated');

    // Click a Nine-Grid cell to reveal the candidate list panel on the right (per the Manager
    // view's "Click a manager avatar for the individual report" / cell-click UX).
    const cell = nineGridTab.locator('.mg-nine-cell').first();
    await cell.click();
    await page.waitForTimeout(800);
    await shot(page, '02-cell-clicked');

    // Look for PerfTest Employee's row anywhere in the panel, across Completed/Pending sub-tabs.
    let row = page.locator('.mg-cell-table-row', { hasText: 'PerfTest Employee' });
    if (await row.count() === 0) {
      // Try clicking through all 9 cells until the row appears.
      const cells = await nineGridTab.locator('.mg-nine-cell').all();
      for (const c of cells) {
        await c.click();
        await page.waitForTimeout(500);
        row = page.locator('.mg-cell-table-row', { hasText: 'PerfTest Employee' });
        if (await row.count() > 0) break;
      }
    }
    await shot(page, '03-searching-for-row');

    if (await row.count() === 0) {
      console.log('Could not find PerfTest Employee row in any Nine-Grid cell — dumping page text for diagnosis.');
      await shot(page, '04-not-found');
    } else {
      console.log(`Found PerfTest Employee row (count=${await row.count()}).`);
      const publishBtn = row.first().locator('button[data-bind*="onTogglePublish"]');
      const title = await publishBtn.getAttribute('title').catch(() => null);
      console.log(`Publish button title/state: "${title}"`);
      console.log(`Publish button outerHTML: ${await publishBtn.evaluate(el => el.outerHTML).catch(e => 'ERR: ' + e.message)}`);
      await shot(page, '05-before-publish');
      await publishBtn.click();
      await page.waitForTimeout(1500);
      await shot(page, '06-after-publish');
      const titleAfter = await publishBtn.getAttribute('title').catch(() => null);
      console.log(`Publish button title/state after click: "${titleAfter}"`);
    }

  } catch (e) {
    console.log('ERROR:', e.message);
    await shot(page, 'ERROR');
  } finally {
    await browser.close();
  }
})();
