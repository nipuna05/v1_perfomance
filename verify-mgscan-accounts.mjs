import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// One-off verification: confirm each freshly-created test account (see
// create-mgscan-test-accounts.mjs / results/account-setup-*.json) actually logs in and renders
// MgScan.aspx as expected for its role, before building interaction-timing scripts on top of them.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const creds = JSON.parse(fs.readFileSync(path.join(__dirname, '.credentials.local.json'), 'utf-8'));

const runStamp = process.argv[2];
if (!runStamp) {
  console.error('Usage: node verify-mgscan-accounts.mjs <runStamp used with create-mgscan-test-accounts.mjs>');
  process.exit(1);
}
const accountsFile = path.join(__dirname, 'results', `account-setup-${runStamp}.json`);
const accounts = JSON.parse(fs.readFileSync(accountsFile, 'utf-8'));

const outDir = path.join(__dirname, 'shots', 'verify-accounts');
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });

  for (const account of accounts) {
    console.log(`\n=== Verifying ${account.role}: ${account.username} ===`);
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    try {
      await page.goto(creds.signInUrl || creds.baseUrl, { waitUntil: 'domcontentloaded' });
      await page.locator('#Login1_UserName').waitFor({ state: 'visible', timeout: 20000 });
      await page.locator('#Login1_UserName').fill(account.username);
      await page.locator('#Login1_Password').fill(account.password);
      await page.locator('#Login1_LoginButton').click();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(1500);

      const loggedIn = await page.locator('#MenuLogout').count() > 0;
      console.log(`  Login: ${loggedIn ? 'OK' : 'FAILED'} — url after login: ${page.url()}`);
      await page.screenshot({ path: path.join(outDir, `${account.role}-01-post-login.png`), fullPage: true });

      if (loggedIn) {
        await page.goto(`${creds.baseUrl}/MgScan.aspx`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(4000);
        await page.screenshot({ path: path.join(outDir, `${account.role}-02-mgscan.png`), fullPage: true });
        console.log(`  MgScan.aspx loaded — url: ${page.url()}`);
      }
    } catch (e) {
      console.log(`  ERROR: ${e.message}`);
      await page.screenshot({ path: path.join(outDir, `${account.role}-ERROR.png`), fullPage: true }).catch(() => {});
    } finally {
      await page.close();
    }
  }

  await browser.close();
})();
