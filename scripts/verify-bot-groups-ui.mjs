/** Real renderer component smoke; IPC is synthetic and no runtime is started. */
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const server = await createServer({
  configFile: false,
  plugins: [react(), tailwindcss()],
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
const port = server.httpServer.address().port;
const browser = await chromium.launch({
  channel: process.env.BOT_GROUPS_BROWSER_CHANNEL || undefined,
});
const output = resolve(
  process.env.BOT_GROUPS_SCREENSHOTS || ".sandbox/bot-groups-ui",
);
await mkdir(output, { recursive: true });
try {
  for (const width of [1280, 600]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}/tests/fixtures/bot-groups.html`);
    await page.getByRole("heading", { name: "Research team" }).waitFor();
    await page.getByRole("button", { name: "@review", exact: true }).click();
    const input = page.getByRole("textbox");
    if ((await input.inputValue()) !== "@review ")
      throw new Error("Mention did not reach the composer.");
    await input.fill("Fixture follow-up");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.getByText("Fixture follow-up", { exact: true }).waitFor();
    if ((await input.inputValue()) !== "")
      throw new Error("Accepted send did not clear its draft.");
    if (
      !(await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ))
    )
      throw new Error("Horizontal overflow.");
    if (errors.length) throw new Error(errors.join("\n"));
    await page.screenshot({ path: resolve(output, `desktop-${width}.png`) });
    await page.close();
    console.log(`PASS Bot groups renderer at ${width}px (synthetic IPC)`);
  }
} finally {
  await browser.close();
  await server.close();
}
