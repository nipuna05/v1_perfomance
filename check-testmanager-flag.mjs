import { chromium } from 'playwright';
import fs from 'fs';
const creds = JSON.parse(fs.readFileSync('.credentials.local.json', 'utf-8'));
const admin = creds.users.find(u => u.role === 'Admin');

async function checkFlag(page, email) {
  await page.goto(`${creds.baseUrl}/CandidateNew.aspx`, { waitUntil: 'domcontentloaded' });
  const emailBox = page.locator('input[placeholder="Email address"]');
  await emailBox.waitFor({ state: 'visible', timeout: 20000 });
  await emailBox.fill(email);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  const row = page.locator('tr', { hasText: email }).first();
  await row.waitFor({ state: 'visible', timeout: 10000 });
  await row.click();
  await page.waitForTimeout(1000);
  const editBtn = page.getByRole('button', { name: 'Edit', exact: true });
  await editBtn.click();
  await page.waitForFunction(() => document.querySelector('#pwdInput') !== null, { timeout: 15000 });
  await page.waitForTimeout(500);
  const isTestManagerChecked = await page.locator('input[type="checkbox"]').evaluateAll(boxes => {
    // find the checkbox nearest text "Is Test Manager"
    for (const b of boxes) {
      const label = b.closest('label') || b.parentElement;
      if (label && label.textContent.includes('Is Test Manager')) return b.checked;
    }
    return 'checkbox not found';
  });
  console.log(`${email}: Is Test Manager checked = ${isTestManagerChecked}`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(creds.signInUrl || creds.baseUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('#Login1_UserName').fill(admin.username);
  await page.locator('#Login1_Password').fill(admin.password);
  await page.locator('#Login1_LoginButton').click();
  await page.locator('#MenuLogout').waitFor({ state: 'visible', timeout: 30000 });

  await checkFlag(page, 'perftest.director.20260814@example.invalid');
  await checkFlag(page, 'perftest.director.20260813@example.invalid');
  await checkFlag(page, 'perftest.manager.20260814@example.invalid');

  await browser.close();
})();
