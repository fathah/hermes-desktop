const { attach } = require("./e2e-attach");
(async () => {
  const { browser, page } = await attach();
  // Make sure we're on Models tab
  await page.click('text=/^Models$/').catch(() => {});
  await new Promise((r) => setTimeout(r, 400));
  const result = await page.evaluate(() => {
    // Find any element containing "test-arc-codex-bug-A"
    const matches = Array.from(document.querySelectorAll("*"))
      .filter((el) => el.textContent && el.textContent.includes("test-arc-codex-bug-A") && el.children.length < 10);
    return {
      matchCount: matches.length,
      examples: matches.slice(0, 3).map((el) => ({
        tag: el.tagName.toLowerCase(),
        cls: el.className,
        html: el.outerHTML.slice(0, 400),
      })),
      // Also dump all buttons in the model list area
      buttons: Array.from(document.querySelectorAll("button"))
        .filter((b) => {
          // Find buttons inside elements that contain the test model name
          let p = b.parentElement;
          while (p) {
            if ((p.textContent || "").includes("test-arc-codex-bug-A")) return true;
            p = p.parentElement;
          }
          return false;
        })
        .map((b) => ({
          cls: b.className,
          title: b.getAttribute("title"),
          aria: b.getAttribute("aria-label"),
          text: (b.textContent || "").trim().slice(0, 30),
        })),
    };
  });
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
