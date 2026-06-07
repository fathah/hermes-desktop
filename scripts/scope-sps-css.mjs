// scope-sps-css.mjs — confine the SPS Agent design-system CSS to a `.sps-scope`
// container so its tokens (--accent, --font-sans) and global body/*/html rules
// don't leak into the Hermes desktop renderer.
// Run once after copying the CSS:  node scripts/scope-sps-css.mjs
import postcss from "postcss";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "src/renderer/src/screens/SpsAgent/styles";
const FILES = ["sps-tokens.css", "home.css", "notion.css", "v3.css"];
const SCOPE = ".sps-scope";

function scopeSelector(sel) {
  return sel
    .split(",")
    .map((raw) => {
      const part = raw.trim();
      if (!part) return part;
      if (
        part === ":root" ||
        part === "html" ||
        part === "body" ||
        part === ".ds-body"
      )
        return SCOPE;
      if (part === "*") return `${SCOPE} *`;
      if (part.startsWith("[")) return SCOPE + part;
      return `${SCOPE} ${part}`;
    })
    .join(", ");
}

let total = 0;
for (const file of FILES) {
  const path = join(DIR, file);
  const root = postcss.parse(readFileSync(path, "utf-8"));
  let n = 0;
  root.walkRules((rule) => {
    if (
      rule.parent &&
      rule.parent.type === "atrule" &&
      /keyframes/i.test(rule.parent.name)
    )
      return;
    rule.selector = scopeSelector(rule.selector);
    n++;
  });
  writeFileSync(path, root.toString(), "utf-8");
  console.log(`scoped ${file}: ${n} rules`);
  total += n;
}
console.log(`done — ${total} rules scoped`);
