/**
 * Probe the running Hermes Desktop renderer for selectors needed by the
 * symptom repro scripts. Prints a small inventory of relevant DOM elements
 * so we don't have to guess class names / aria labels.
 */
const { attach } = require("./e2e-attach");

(async () => {
  const { browser, page } = await attach();

  const inventory = await page.evaluate(() => {
    // Helper: short stable descriptor for any element
    function describe(el) {
      if (!el) return null;
      const tag = el.tagName.toLowerCase();
      const id = el.id ? `#${el.id}` : "";
      const cls = el.className
        ? `.${String(el.className).split(/\s+/).slice(0, 3).join(".")}`
        : "";
      const aria = el.getAttribute("aria-label");
      const placeholder = el.getAttribute("placeholder");
      const title = el.getAttribute("title");
      const text = (el.textContent || "").trim().slice(0, 60);
      return {
        sel: `${tag}${id}${cls}`,
        ariaLabel: aria,
        placeholder,
        title,
        text,
      };
    }

    const result = {
      url: window.location.href,
      activeTab: null,
      textareas: [],
      sendCandidates: [],
      newChatCandidates: [],
      modelPicker: null,
      messages: 0,
    };

    // Probe textareas (chat input)
    document.querySelectorAll("textarea").forEach((el) => {
      result.textareas.push(describe(el));
    });

    // Probe send buttons / aria-labels containing send
    document.querySelectorAll("button").forEach((el) => {
      const text = (el.textContent || "").trim();
      const aria = el.getAttribute("aria-label") || "";
      const title = el.getAttribute("title") || "";
      if (/send|submit/i.test(text + " " + aria + " " + title)) {
        result.sendCandidates.push(describe(el));
      }
      if (/new chat|new session|new conversation/i.test(text + " " + aria + " " + title)) {
        result.newChatCandidates.push(describe(el));
      }
    });

    // Probe icon-only buttons too (look for svg children)
    document.querySelectorAll("button").forEach((el) => {
      const aria = el.getAttribute("aria-label") || "";
      if (aria && el.querySelector("svg")) {
        const tooltip = el.getAttribute("title");
        if (!result.sendCandidates.find((c) => c?.ariaLabel === aria)) {
          // include common icon button candidates we might need
          if (/send|new|delete|copy/i.test(aria + " " + (tooltip || ""))) {
            result.sendCandidates.push(describe(el));
          }
        }
      }
    });

    // Look for the chat tab's active state
    const activeNav = document.querySelector(".navigation-item.active, [data-active='true']");
    result.activeTab = activeNav ? describe(activeNav) : null;

    // Model picker
    const mp = document.querySelector(".model-picker, [data-testid='model-picker']");
    result.modelPicker = mp ? describe(mp) : null;

    // Count chat messages currently rendered
    result.messages = document.querySelectorAll(
      ".chat-message, [class*='chat-bubble']",
    ).length;

    return result;
  });

  console.log(JSON.stringify(inventory, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
