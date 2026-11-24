// ITMS demo capture: PNGs + WebM videos for docs/demo/.
// Usage: ITMS_BASE_URL=http://localhost:5173 node capture.mjs [--only=png|video]
// Output: PNG + WebM into ../../docs/demo/raw/ (convert.sh makes final GIF/MP4).
//
// Ruling vs plan: ThemeManager opens from /settings ("Change theme" button),
// not from the dashboard header (header has a one-click ThemeToggle). Theme
// flows go through /settings so the clip shows the real manager UI.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = join(ROOT, 'docs', 'demo', 'raw');
mkdirSync(RAW, { recursive: true });
const BASE = process.env.ITMS_BASE_URL || 'http://localhost:5173';
const only = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1] || 'all';
const log = [];
const note = (m) => { log.push(m); console.log(m); };

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 375, height: 812 };

async function newPage(browser, { theme, viewport, video, storageState }) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    recordVideo: video ? { dir: RAW } : undefined,
    storageState,
  });
  await context.addInitScript((t) => localStorage.setItem('itms_theme', t), theme);
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') note(`console.error: ${msg.text().slice(0, 160)}`);
  });
  page.on('pageerror', (err) => note(`page.error: ${String(err).slice(0, 160)}`));
  return { context, page };
}

async function goto(page, path) {
  await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(900); // let aurora + count-up animations start
}

async function tryLogin(page) {
  // If no password field anywhere, assume authed already.
  if ((await page.locator('input[type="password"]').count()) === 0) return;
  const email = page.locator('input[type="email"]').first();
  const pass = page.locator('input[type="password"]').first();
  if ((await email.count()) === 0) return;
  await email.fill(process.env.ITMS_DEMO_EMAIL || 'admin@itms.local');
  await pass.fill(process.env.ITMS_DEMO_PASSWORD || 'demo1234');
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);
}

/** Server theme pref wins on every login — push the wanted theme server-side,
 * then reload so hydration applies it. Must run after tryLogin.
 * instant=true: skip reload (no white flash mid-recording); flip classes
 * in place + PUT server pref so later navigations keep it. */
async function forceTheme(page, theme, instant = false) {
  await page.evaluate(async (t) => {
    const token = localStorage.getItem('itms_token');
    if (token) {
      try {
        await fetch('/api/v1/auth/theme', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ theme: t }),
        });
      } catch {}
    }
    localStorage.setItem('itms_theme', t);
    // Mirror applyTheme() for the liquid themes (no reload → no white flash).
    const root = document.documentElement;
    root.classList.toggle('dark', t === 'dark');
    root.classList.toggle('ledgerly-dark', false);
    root.classList.toggle('ledgerly-light', false);
    window.dispatchEvent(new Event('itms-theme-changed'));
  }, theme);
  if (!instant) {
    await page.reload({ waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1000);
  } else {
    await page.waitForTimeout(600);
  }
  const applied = await page.evaluate(() => ({
    stored: localStorage.getItem('itms_theme'),
    dark: document.documentElement.classList.contains('dark'),
  }));
  note(`theme now: stored=${applied.stored} .dark=${applied.dark} (wanted ${theme})`);
}

/** Open ThemeManager modal via Settings → "Change theme". Returns true if open. */
async function openThemeManager(page) {
  await goto(page, '/settings');
  const opener = page.locator('button:has-text("Change theme")').first();
  if ((await opener.count()) === 0) return false;
  await opener.click();
  await page.waitForTimeout(700);
  return true;
}

async function shot(page, name) {
  const p = join(RAW, name);
  await page.screenshot({ path: p });
  note(`png ${name}`);
  return p;
}

async function saveVideo(page, context, name) {
  await context.close(); // flushes video
  const v = page.video();
  if (!v) throw new Error('no video recorded for ' + name);
  const src = await v.path();
  const dest = join(RAW, name);
  renameSync(src, dest);
  note(`video ${name} (from ${src})`);
}

const browser = await chromium.launch();

try {
  // ---- PNGs ----
  if (only !== 'video') {
    for (const theme of ['light', 'dark']) {
      const { context, page } = await newPage(browser, { theme, viewport: DESKTOP });
      await goto(page, '/login');
      await shot(page, `login-${theme}.png`);
      await tryLogin(page);
      await forceTheme(page, theme);
      await goto(page, '/');
      // Seed guard: at least one digit visible (KPI numbers).
      await page.waitForSelector('text=/\\d/', { timeout: 10000 });
      await shot(page, `dashboard-${theme}.png`);
      await goto(page, '/assets');
      await shot(page, `assets-${theme}.png`);
      if (theme === 'dark') {
        await goto(page, '/tickets');
        await shot(page, 'tickets-dark.png');
      }
      if (theme === 'light') {
        await goto(page, '/cmdb');
        await shot(page, 'cmdb-light.png');
      }
      if (await openThemeManager(page)) {
        // Modal body scrolls (5 cards exceed 900px): pin to bottom so the
        // still shows cards + Cancel/Apply instead of cropped buttons.
        await page.locator('div.overflow-y-auto').first().evaluate((el) => { el.scrollTop = el.scrollHeight; });
        await page.waitForTimeout(400);
        await shot(page, `theme-manager-${theme}.png`);
      } else {
        note(`WARN theme-manager opener missing (${theme})`);
      }
      await context.close();
    }
    // Mobile PNG
    {
      const { context, page } = await newPage(browser, { theme: 'light', viewport: MOBILE });
      await goto(page, '/login');
      await tryLogin(page);
      await forceTheme(page, 'light');
      await goto(page, '/');
      await shot(page, 'mobile-dashboard-light.png');
      await context.close();
    }
  }

  // ---- Videos (WebM raw; convert.sh converts) ----
  // Clips reuse one login (storageState) so recording starts ON the product,
  // not on the login form. forceTheme still runs per clip (server pref wins).
  if (only !== 'png') {
    const AUTH = join(RAW, 'auth.json');
    {
      const { context, page } = await newPage(browser, { theme: 'light', viewport: DESKTOP });
      await goto(page, '/login');
      await tryLogin(page);
      await context.storageState({ path: AUTH });
      await context.close();
      note('auth state saved');
    }
    // 1. hero-dashboard (light): dashboard drift + hover a card
    {
      const { context, page } = await newPage(browser, { theme: 'light', viewport: DESKTOP, video: true, storageState: AUTH });
      await goto(page, '/');
      await forceTheme(page, 'light', true);
      await goto(page, '/');
      await page.waitForTimeout(2500);
      const card = page.locator('main a, main button, [class*="bento" i]').first();
      if ((await card.count()) > 0) await card.hover();
      await page.mouse.move(720, 450, { steps: 20 });
      await page.waitForTimeout(4000);
      await saveVideo(page, context, 'hero-dashboard.webm');
    }
    // 2. theme-switch (starts light, ends dark — THE money clip)
    {
      const { context, page } = await newPage(browser, { theme: 'light', viewport: DESKTOP, video: true, storageState: AUTH });
      await goto(page, '/');
      await forceTheme(page, 'light', true);
      await goto(page, '/');
      await page.waitForTimeout(1500);
      // Prefer the full manager (pretty cards); fall back to header toggle.
      if (await openThemeManager(page)) {
        await page.waitForTimeout(900);
        const darkOpt = page.locator('[role="radio"]:has-text("Liquid Glass Dark")').first();
        if ((await darkOpt.count()) > 0) await darkOpt.click();
        await page.waitForTimeout(800);
        const apply = page.locator('button:has-text("Apply theme")').first();
        if ((await apply.count()) > 0) await apply.click();
        await page.waitForTimeout(2000); // dark settles in manager view…
        await goto(page, '/'); // …then payoff: dark dashboard + aurora
        await page.waitForTimeout(2500);
      } else {
        const toggle = page.locator('button[aria-label^="Theme:"]').first();
        if ((await toggle.count()) > 0) await toggle.click();
        await page.waitForTimeout(5000);
      }
      await saveVideo(page, context, 'theme-switch.webm');
    }
    // 3. tickets-flow (dark): list → open drawer → Advance status (badge flips).
    // NOTE: mutates one ticket — re-seed before capture for determinism.
    {
      const { context, page } = await newPage(browser, { theme: 'dark', viewport: DESKTOP, video: true, storageState: AUTH });
      await goto(page, '/tickets');
      await forceTheme(page, 'dark', true);
      await goto(page, '/tickets');
      await page.waitForTimeout(2000);
      const row = page.locator('tbody tr').first();
      if ((await row.count()) > 0) await row.click();
      const drawer = page.locator('.animate-slide-in-right').first();
      try {
        await drawer.waitFor({ state: 'visible', timeout: 4000 });
      } catch {
        if ((await row.count()) > 0) await row.click(); // retry once (React Query refetch can swallow the first)
        await drawer.waitFor({ state: 'visible', timeout: 4000 }).catch(() => note('WARN ticket drawer never opened'));
      }
      await page.waitForTimeout(1200);
      const advanceBtn = page.locator('button:has-text("Advance to")').first();
      if ((await advanceBtn.count()) > 0 && await advanceBtn.isVisible()) {
        await advanceBtn.click();
        await page.waitForTimeout(3000); // badge flip + list refresh = the payoff
      } else {
        note('WARN no Advance button (ticket already terminal?)');
        await page.waitForTimeout(2500);
      }
      await saveVideo(page, context, 'tickets-flow.webm');
    }
    // 4. cmdb-impact (light): click the Catalyst switch row → "2 impacted".
    // NOTE: seed randomizes asset TAGS per run — select by stable NAME.
    {
      const { context, page } = await newPage(browser, { theme: 'light', viewport: DESKTOP, video: true, storageState: AUTH });
      await goto(page, '/cmdb');
      await forceTheme(page, 'light', true);
      await goto(page, '/cmdb');
      await page.waitForTimeout(2000);
      const target = page.locator('tbody tr:has-text("Catalyst 9300-48P")').first();
      if ((await target.count()) > 0) {
        await target.click();
      } else {
        note('WARN Catalyst row missing, clicking first CI row');
        const fallback = page.locator('tbody tr').first();
        if ((await fallback.count()) > 0) await fallback.click();
      }
      await page.waitForTimeout(5000);
      await saveVideo(page, context, 'cmdb-impact.webm');
    }
    // 5. mobile-nav (light, 375px): bar primaries are Dashboard/Assets/
    // Tickets/Licenses; Scan + CMDB live in the More sheet — tap through both.
    {
      const { context, page } = await newPage(browser, { theme: 'light', viewport: MOBILE, video: true, storageState: AUTH });
      const BAR = 'nav.fixed.inset-x-0';
      await goto(page, '/');
      await forceTheme(page, 'light', true);
      await goto(page, '/');
      await page.waitForTimeout(1200);
      const barTap = async (label) => {
        const tab = page.locator(`${BAR} a:has-text("${label}")`).first();
        if ((await tab.count()) > 0 && await tab.isVisible()) {
          await tab.click();
          await page.waitForTimeout(1400);
          return true;
        }
        note(`WARN mobile bar tab missing/hidden: ${label}`);
        return false;
      };
      const sheetTap = async (label) => {
        const more = page.locator(`${BAR} button[aria-label="More sections"]`).first();
        if ((await more.count()) === 0 || !(await more.isVisible())) {
          note('WARN More button missing'); return false;
        }
        await more.click();
        await page.waitForTimeout(700);
        const item = page.locator(`.animate-sheet-up a:has-text("${label}")`).first();
        if ((await item.count()) > 0) {
          await item.click({ force: true }); // sheet scroll container intercepts hit-test; force is fine for a demo tap
          await page.waitForTimeout(1400);
          return true;
        }
        note(`WARN sheet item missing/hidden: ${label}`);
        await page.keyboard.press('Escape');
        return false;
      };
      await barTap('Tickets');
      await sheetTap('Scan');
      await sheetTap('CMDB');
      await barTap('Dashboard');
      await saveVideo(page, context, 'mobile-nav.webm');
    }
  }
} finally {
  await browser.close();
}
writeFileSync(join(RAW, 'capture.log'), log.join('\n') + '\n');
note(`done → ${RAW}`);
