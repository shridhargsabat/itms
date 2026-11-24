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

async function newPage(browser, { theme, viewport, video }) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    recordVideo: video ? { dir: RAW } : undefined,
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
      await goto(page, '/');
      await shot(page, 'mobile-dashboard-light.png');
      await context.close();
    }
  }

  // ---- Videos (WebM raw; convert.sh converts) ----
  if (only !== 'png') {
    // 1. hero-dashboard (light): dashboard drift + hover a card
    {
      const { context, page } = await newPage(browser, { theme: 'light', viewport: DESKTOP, video: true });
      await goto(page, '/login');
      await tryLogin(page);
      await goto(page, '/');
      await page.waitForTimeout(2500);
      const card = page.locator('main a, main button, [class*="bento" i]').first();
      if ((await card.count()) > 0) await card.hover();
      await page.mouse.move(720, 450, { steps: 20 });
      await page.waitForTimeout(6000);
      await saveVideo(page, context, 'hero-dashboard.webm');
    }
    // 2. theme-switch (starts light, ends dark — THE money clip)
    {
      const { context, page } = await newPage(browser, { theme: 'light', viewport: DESKTOP, video: true });
      await goto(page, '/login');
      await tryLogin(page);
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
        await page.waitForTimeout(2500); // dark settles in manager view…
        await goto(page, '/'); // …then payoff: dark dashboard + aurora
        await page.waitForTimeout(3000);
      } else {
        const toggle = page.locator('button[aria-label^="Theme:"]').first();
        if ((await toggle.count()) > 0) await toggle.click();
        await page.waitForTimeout(5000);
      }
      await saveVideo(page, context, 'theme-switch.webm');
    }
    // 3. tickets-flow (dark)
    {
      const { context, page } = await newPage(browser, { theme: 'dark', viewport: DESKTOP, video: true });
      await goto(page, '/login');
      await tryLogin(page);
      await goto(page, '/tickets');
      await page.waitForTimeout(2000);
      const row = page.locator('tbody tr, [role="row"], main a, main button').first();
      if ((await row.count()) > 0) await row.click();
      await page.waitForTimeout(4000);
      await saveVideo(page, context, 'tickets-flow.webm');
    }
    // 4. cmdb-impact (light)
    {
      const { context, page } = await newPage(browser, { theme: 'light', viewport: DESKTOP, video: true });
      await goto(page, '/login');
      await tryLogin(page);
      await goto(page, '/cmdb');
      await page.waitForTimeout(2000);
      const node = page.locator('main button, main a, svg g, [class*="node" i]').first();
      if ((await node.count()) > 0) await node.click();
      await page.waitForTimeout(5000);
      await saveVideo(page, context, 'cmdb-impact.webm');
    }
    // 5. mobile-nav (light, 375px)
    {
      const { context, page } = await newPage(browser, { theme: 'light', viewport: MOBILE, video: true });
      await goto(page, '/login');
      await tryLogin(page);
      await goto(page, '/');
      for (const label of ['Tickets', 'Scan', 'CMDB', 'Dashboard']) {
        const tab = page.locator(`nav a:has-text("${label}"), nav button:has-text("${label}")`).first();
        if ((await tab.count()) > 0) {
          await tab.click();
          await page.waitForTimeout(1400);
        } else {
          note(`WARN mobile tab missing: ${label}`);
        }
      }
      await saveVideo(page, context, 'mobile-nav.webm');
    }
  }
} finally {
  await browser.close();
}
writeFileSync(join(RAW, 'capture.log'), log.join('\n') + '\n');
note(`done → ${RAW}`);
