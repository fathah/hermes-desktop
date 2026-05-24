const { execSync } = require("child_process");
const path = require("path");

// Sign a single path, ignoring "not an Mach-O" errors for non-binary files.
function sign(target) {
  try {
    execSync(`codesign --force --sign - "${target}"`, { stdio: "pipe" });
  } catch (e) {
    // Ignore files that aren't signable (scripts, plists, etc.)
    const msg = (e.stderr || e.stdout || "").toString();
    if (
      !msg.includes("is not an Mach-O file") &&
      !msg.includes("bundle format unrecognized")
    ) {
      throw e;
    }
  }
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );

  console.log(`Ad-hoc re-signing (inside-out): ${appPath}`);

  // Step 1: sign .dylib files (deepest leaves first)
  execSync(
    `find "${appPath}" -name "*.dylib" | while IFS= read -r f; do codesign --force --sign - "$f" 2>/dev/null || true; done`,
    { stdio: "inherit", shell: "/bin/bash" },
  );

  // Step 2: sign XPC services and nested .app bundles inside Frameworks
  execSync(
    `find "${appPath}/Contents/Frameworks" -mindepth 1 -maxdepth 4 \\( -name "*.xpc" -o -name "*.app" \\) -prune | while IFS= read -r f; do codesign --force --sign - "$f" 2>/dev/null || true; done`,
    { stdio: "inherit", shell: "/bin/bash" },
  );

  // Step 3: sign each .framework (the versioned bundle, not through symlinks)
  execSync(
    `find "${appPath}/Contents/Frameworks" -mindepth 1 -maxdepth 1 -name "*.framework" | while IFS= read -r f; do codesign --force --sign - "$f" 2>/dev/null || true; done`,
    { stdio: "inherit", shell: "/bin/bash" },
  );

  // Step 4: sign the outer .app
  execSync(`codesign --force --sign - "${appPath}"`, { stdio: "inherit" });

  console.log("Ad-hoc re-signing complete.");
};
