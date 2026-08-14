import { chromium } from 'playwright';
import fs from 'fs';
const creds = JSON.parse(fs.readFileSync('.credentials.local.json', 'utf-8'));

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(creds.signInUrl || creds.baseUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('#Login1_UserName').fill('perftest.director.20260814');
  await page.locator('#Login1_Password').fill('PerfTest@2026');
  await page.locator('#Login1_LoginButton').click();
  await page.locator('#MenuLogout').waitFor({ state: 'visible', timeout: 30000 });
  await page.goto(`${creds.baseUrl}/MgScan.aspx`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const hasNineGrid = await page.locator('#tabMgScanNineGrid').count();
  console.log('Has Nine-Grid tabs now:', hasNineGrid);
  const shotPath = 'C:/Users/NIPUNA~1/AppData/Local/Temp/claude/d--QAssessment-HRMForce-GIT/4c919854-b671-4446-ad27-3862e560be10/scratchpad/pdf-check-shots/director-0814-fixed.png';
  await page.screenshot({ path: shotPath, fullPage: true });
  await browser.close();
})();
