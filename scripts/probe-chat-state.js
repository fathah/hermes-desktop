/**
 * Probe current chat DOM state — selector inventory + message dump.
 * Run BEFORE / DURING / AFTER a chat to verify wait conditions.
 */
const { attach } = require("./e2e-attach");

(async () => {
  const { browser, page } = await attach();
  const state = await page.evaluate(() => {
    const sendBtn = document.querySelector("button.chat-send-btn");
    return {
      sendBtnDisabled: sendBtn?.disabled,
      sendBtnAriaDisabled: sendBtn?.getAttribute("aria-disabled"),
      countByClass: {
        chatMessageAgent: document.querySelectorAll(".chat-message-agent").length,
        chatMessageUser: document.querySelectorAll(".chat-message-user").length,
        chatBubbleAgent: document.querySelectorAll(".chat-bubble-agent").length,
        chatBubbleUser: document.querySelectorAll(".chat-bubble-user").length,
        anyChatMessage: document.querySelectorAll(".chat-message").length,
      },
      allMessages: Array.from(document.querySelectorAll(".chat-message")).map((el) => ({
        cls: el.className,
        text: el.textContent.trim().slice(0, 80),
      })),
    };
  });
  console.log(JSON.stringify(state, null, 2));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
