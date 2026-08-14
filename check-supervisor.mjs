import { chromium } from 'playwright';
import fs from 'fs';
const creds = JSON.parse(fs.readFileSync('.credentials.local.json', 'utf-8'));

async function checkSupervisor(username, password) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(creds.signInUrl || creds.baseUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('#Login1_UserName').fill(username);
  await page.locator('#Login1_Password').fill(password);
  await page.locator('#Login1_LoginButton').click();
  await page.locator('#MenuLogout').waitFor({ state: 'visible', timeout: 30000 });
  await page.goto(`${creds.baseUrl}/MgScan.aspx`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const supervisorText = await page.locator('text=/Supervisor:/').first().textContent().catch(() => 'NOT FOUND');
  const hasNineGrid = await page.locator('#tabMgScanNineGrid').count();
  console.log(`${username}: Supervisor line = "${supervisorText?.trim()}" | hasNineGrid=${hasNineGrid}`);
  await browser.close();
}

await checkSupervisor('perftest.manager.20260814', 'PerfTest@2026');
await checkSupervisor('perftest.director.20260814', 'PerfTest@2026');
