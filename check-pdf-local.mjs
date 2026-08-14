import { chromium } from 'playwright';

const baseUrl = 'http://localhost:62542';
const username = 'perftest.manager.20260813';
const password = 'PerfTest@2026';

const shotsDir = 'C:\\Users\\NIPUNA~1\\AppData\\Local\\Temp\\claude\\d--QAssessment-HRMForce-GIT\\4c919854-b671-4446-ad27-3862e560be10\\scratchpad\\pdf-check-shots';
import fs from 'fs';
fs.mkdirSync(shotsDir, { recursive: true });
let seq = 0;
async function shot(page, label) {
  seq++;
  await page.screenshot({ path: `${shotsDir}\\${String(seq).padStart(2, '0')}-${label}.png`, fullPage: true }).catch((e) => console.log('shot failed:', e.message));
  console.log(`  [shot] ${label}`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('console', (msg) => { if (msg.type() === 'error') console.log('[console error]', msg.text().slice(0, 300)); });
  page.on('pageerror', (err) => console.log('[pageerror]', err.message.slice(0, 300)));
  page.on('requestfinished', async (req) => {
    if (req.url().includes('.asmx/') || req.url().includes('Report.aspx')) {
      const res = await req.response();
      if (res) console.log(`[network] ${req.url().split('/HRMForce')[1] || req.url()} -> ${res.status()}`);
    }
  });
  page.on('requestfailed', (req) => console.log('[request FAILED]', req.url(), req.failure()?.errorText));

  try {
    console.log('=== Login (localhost) ===');
    await page.goto(`${baseUrl}/Login.aspx`, { waitUntil: 'commit', timeout: 30000 });
    await page.locator('#Login1_UserName').waitFor({ state: 'visible', timeout: 20000 });
    await page.locator('#Login1_UserName').fill(username);
    await page.locator('#Login1_Password').fill(password);
    await page.locator('#Login1_LoginButton').click();
    await page.locator('#MenuLogout').waitFor({ state: 'visible', timeout: 30000 });
    console.log('Logged in successfully as', username);

    console.log('=== Navigate to Management Scan ===');
    await page.goto(`${baseUrl}/MgScan.aspx`, { waitUntil: 'commit', timeout: 30000 });
    const nineGridTab = page.locator('#tabMgScanNineGrid');
    await nineGridTab.locator('a[data-bind*="onGenerate"]').waitFor({ state: 'visible', timeout: 20000 });
    await shot(page, 'nine-grid-loaded');

    await nineGridTab.locator('a[data-bind*="onGenerate"]').click();
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await shot(page, 'after-generate');

    console.log('Data on page:', await page.locator('.mg-nine-count').allTextContents());

    // Click a cell with data
    const cellWithAvatar = nineGridTab.locator('.mg-nine-cell', { has: page.locator('.mgscan-avatar, [class*="avatar"]') });
    const target = (await cellWithAvatar.count()) > 0 ? cellWithAvatar.first() : nineGridTab.locator('.mg-nine-cell').first();
    await target.click();
    await page.waitForTimeout(800);
    await shot(page, 'cell-clicked');

    const row = page.locator('.mg-cell-table-row', { hasText: 'PerfTest Employee' });
    console.log('PerfTest Employee row found:', await row.count());

    if (await row.count() > 0) {
      console.log('=== Attempt row-level PDF ===');
      const btn = row.first().locator('.mg-cell-row-actions button:has(.fa-file-pdf)');
      console.log('PDF button found:', await btn.count());
      if (await btn.count() > 0) {
        await btn.click();
        await page.waitForTimeout(1000);
        await shot(page, 'after-pdf-icon-click');
        const okBtn = page.locator('a[data-bind="click: onOk"]:visible');
        console.log('Language popup visible:', await okBtn.count());
        if (await okBtn.count() > 0) {
          await shot(page, 'language-popup');
          const [popup] = await Promise.all([
            page.waitForEvent('popup', { timeout: 15000 }).catch((e) => { console.log('popup wait error:', e.message); return null; }),
            okBtn.click(),
          ]);
          await page.waitForTimeout(2000);
          if (popup) {
            console.log('Popup opened, URL:', popup.url());
            await popup.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch((e) => console.log('popup load error:', e.message));
            await shot(popup, 'pdf-popup-content');
            console.log('Popup final URL:', popup.url());
          } else {
            console.log('NO POPUP OPENED - this is the issue.');
          }
        }
      }
    } else {
      console.log('No PerfTest Employee row visible in this cell — trying toolbar PDF instead.');
      const toolbarBtn = nineGridTab.locator('a[data-bind*="onReportPdf"]');
      await toolbarBtn.click();
      await page.waitForTimeout(500);
      const okBtn = page.locator('a[data-bind="click: onOk"]:visible');
      await shot(page, 'toolbar-popup');
      if (await okBtn.count() > 0) {
        const [popup] = await Promise.all([
          page.waitForEvent('popup', { timeout: 15000 }).catch((e) => { console.log('popup wait error:', e.message); return null; }),
          okBtn.click(),
        ]);
        if (popup) {
          console.log('Toolbar popup opened, URL:', popup.url());
          await popup.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch((e) => console.log('popup load error:', e.message));
          await shot(popup, 'toolbar-pdf-popup-content');
        } else {
          console.log('NO TOOLBAR POPUP OPENED - this is the issue.');
        }
      }
    }

  } catch (e) {
    console.log('FATAL:', e.message);
    await shot(page, 'FATAL');
  } finally {
    await browser.close();
  }
})();
