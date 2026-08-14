import { chromium } from 'playwright';

const baseUrl = 'http://localhost:62542';
const username = 'service@hrmforce.com';
const password = 'Password$1';
const shotsDir = 'C:\\Users\\NIPUNA~1\\AppData\\Local\\Temp\\claude\\d--QAssessment-HRMForce-GIT\\4c919854-b671-4446-ad27-3862e560be10\\scratchpad\\pdf-check-shots';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('console', (msg) => { if (msg.type() === 'error') console.log('[console error]', msg.text().slice(0, 250)); });
  page.on('requestfailed', (req) => console.log('[request FAILED]', req.url().slice(0, 120)));

  try {
    console.log('Navigating to Login.aspx ...');
    const t0 = Date.now();
    await page.goto(`${baseUrl}/Login.aspx`, { waitUntil: 'commit', timeout: 30000 });
    console.log(`Navigation committed in ${Date.now() - t0}ms`);

    await page.locator('#Login1_UserName').waitFor({ state: 'visible', timeout: 20000 });
    console.log(`Login form visible at ${Date.now() - t0}ms`);
    await page.screenshot({ path: `${shotsDir}\\login-01-form.png` });

    await page.locator('#Login1_UserName').fill(username);
    await page.locator('#Login1_Password').fill(password);
    console.log('Submitting login ...');
    const t1 = Date.now();
    await page.locator('#Login1_LoginButton').click();
    await page.locator('#MenuLogout').waitFor({ state: 'visible', timeout: 30000 });
    console.log(`Logged in successfully in ${Date.now() - t1}ms. Current URL: ${page.url()}`);
    await page.screenshot({ path: `${shotsDir}\\login-02-loggedin.png` });
  } catch (e) {
    console.log('FAILED:', e.message);
    await page.screenshot({ path: `${shotsDir}\\login-FATAL.png` }).catch(() => {});
  } finally {
    await browser.close();
  }
})();
