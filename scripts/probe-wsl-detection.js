// Standalone probe — does Node's fs see \\wsl$\... paths?
const fs = require("fs");
const tests = [
  "\\\\wsl$\\",
  "\\\\wsl$\\Ubuntu-24.04",
  "\\\\wsl$\\Ubuntu-24.04\\home",
  "\\\\wsl$\\Ubuntu-24.04\\home\\pmos69",
  "\\\\wsl$\\Ubuntu-24.04\\home\\pmos69\\.hermes",
  "\\\\wsl$\\Ubuntu-24.04\\home\\pmos69\\.hermes\\.env",
];
for (const p of tests) {
  try {
    console.log(p.padEnd(60), "→", fs.existsSync(p));
  } catch (e) {
    console.log(p.padEnd(60), "→ ERR", e.message);
  }
}
console.log();
// Show what readdir says about the wsl root
try {
  console.log("readdirSync \\\\wsl$\\:", fs.readdirSync("\\\\wsl$\\"));
} catch (e) {
  console.log("readdir failed:", e.message);
}
