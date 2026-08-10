import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// One-off LIVE exploration script: the IT environment's CandidateNew.aspx UI does not match
// what's in our current git branch (confirmed via create-mgscan-test-accounts.mjs's failed run),
// so this discovers the ACTUAL live selectors/flow by clicking through and dumping HTML at each
// step. Read-only in intent — it will click "Edit" but will NOT click Save, so no data changes.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const creds = JSON.parse(fs.readFileSync(path.join(__dirname, '.credentials.local.json'), 'utf-8'));
const admin = creds.users.find(u => u.role === 'Admin');

const outDir = path.join(__dirname, 'shots', 'explore-it');
fs.mkdirSync(outDir, { recursive: true });

async function dump(page, label) {
  await page.screenshot({ path: path.join(outDir, `${label}.png`), fullPage: true }).catch(() => {});
  const html = await page.content();
  fs.writeFileSync(path.join(outDir, `${label}.html`), html);
  console.log(`  [dumped] ${label} — url: ${page.url()}`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  try {
    await page.goto(creds.baseUrl, { waitUntil: 'domcontentloaded' });
    await page.locator('#Login1_UserName').waitFor({ state: 'visible', timeout: 20000 });
    await page.locator('#Login1_UserName').fill(admin.username);
    await page.locator('#Login1_Password').fill(admin.password);
    await page.locator('#Login1_LoginButton').click();
    await page.locator('#MenuLogout').waitFor({ state: 'visible', timeout: 30000 });
    console.log('Logged in.');

    await page.goto(`${creds.baseUrl}/CandidateNew.aspx`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await dump(page, '01-listing');

    await page.locator('a.new-design-add-new-btn, +New, a:has-text("New"), button:has-text("New")').first().click({ timeout: 10000 }).catch(async (e) => {
      console.log('  Primary "+New" selector failed, trying text="+New" exact:', e.message?.slice(0, 150));
      await page.getByText('+New', { exact: true }).click();
    });
    await page.waitForTimeout(3000);
    await dump(page, '02-after-new-click');
    console.log('  Current URL after +New click:', page.url());

    // If this landed in a "view" state with an Edit button (per the earlier screenshot), click it.
    const editBtn = page.getByRole('button', { name: 'Edit', exact: true });
    if (await editBtn.count() > 0) {
      await editBtn.first().click();
      await page.waitForTimeout(2000);
      await dump(page, '03-after-edit-click');
      console.log('  Clicked Edit. URL now:', page.url());
    } else {
      console.log('  No "Edit" button found after +New click — form may already be in edit state.');
    }

  } catch (e) {
    console.log('ERROR:', e.message);
    await dump(page, 'ERROR-state');
  } finally {
    await browser.close();
  }
})();
