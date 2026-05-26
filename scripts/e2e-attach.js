/**
 * Attach to a running dev Electron instance via the Chrome DevTools Protocol.
 *
 * Requires the app to have been launched with ENABLE_CDP=1 (see main/index.ts —
 * the switch opens remote-debugging-port=9222 only when that env var is set).
 *
 * Usage from a test/repro script:
 *
 *   const { attach } = require("./scripts/e2e-attach");
 *   const { browser, context, page } = await attach();
 *   await page.click('text=New Chat');
 *   await page.fill('textarea', 'hello');
 *   await page.keyboard.press('Enter');
 *   await page.waitForSelector('text=Hey', { timeout: 30000 });
 *   await browser.close();   // detaches; does NOT close the Electron app
 */

const { chromium } = require("playwright");

/**
 * @param {object} [opts]
 * @param {string} [opts.cdpUrl] — CDP HTTP endpoint. Default http://127.0.0.1:9222.
 * @param {string} [opts.titleHint] — substring of window title to pick a page when
 *                                    multiple windows are open. Default: the
 *                                    first page whose URL ends with index.html.
 * @returns {Promise<{browser: import('playwright').Browser, context: import('playwright').BrowserContext, page: import('playwright').Page}>}
 */
async function attach(opts = {}) {
  const cdpUrl =
    opts.cdpUrl ||
    `http://127.0.0.1:${process.env.CDP_PORT || "9222"}`;
  const titleHint = opts.titleHint || null;

  const browser = await chromium.connectOverCDP(cdpUrl);
  const contexts = browser.contexts();
  if (contexts.length === 0) {
    throw new Error(
      `No browser contexts found at ${cdpUrl}. ` +
        `Is the dev electron running with ENABLE_CDP=1?`,
    );
  }
  const context = contexts[0];
  const pages = context.pages();

  let page;
  if (titleHint) {
    page = pages.find(async (p) => (await p.title()).includes(titleHint));
  }
  if (!page) {
    // electron-vite dev serves the renderer at http://localhost:5173/ (no
    // index.html in the URL). Accept either form, and fall back to the
    // first page if there's only one.
    page =
      pages.find((p) => /index\.html(\?|$)/.test(p.url())) ||
      pages.find((p) => /^http:\/\/localhost:\d+\/?$/.test(p.url())) ||
      pages[0];
  }
  if (!page) {
    throw new Error(
      `No pages in the first context at ${cdpUrl}. URLs: ${pages
        .map((p) => p.url())
        .join(", ")}`,
    );
  }

  return { browser, context, page };
}

module.exports = { attach };

// CLI sanity check — `node scripts/e2e-attach.js` prints a one-line summary
// of the attached page so you can verify the harness works.
if (require.main === module) {
  attach()
    .then(async ({ browser, page }) => {
      const title = await page.title();
      const url = page.url();
      const sessionsCount = await page.evaluate(async () => {
        if (!window.hermesAPI || !window.hermesAPI.listSessions) return null;
        try {
          const s = await window.hermesAPI.listSessions(5, 0);
          return Array.isArray(s) ? s.length : "unknown";
        } catch (e) {
          return `error: ${e?.message || e}`;
        }
      });
      console.log(`[attach OK]`);
      console.log(`  url:            ${url}`);
      console.log(`  title:          ${title}`);
      console.log(`  hermesAPI:      ${sessionsCount === null ? "absent" : "present"}`);
      console.log(`  listSessions(5): ${sessionsCount}`);
      await browser.close();
    })
    .catch((err) => {
      console.error("[attach FAILED]", err.message);
      process.exit(1);
    });
}
