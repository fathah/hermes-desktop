# Hermes Desktop - Testing Guide (Easy 1-2-3)

> For testers who just want to run the app without any technical setup

---

## Option 1: Download Pre-built Release (Easiest)

### Step 1: Download the Right File for Your Computer

| Your Computer | Download This File | Install Method |
|--------------|-------------------|----------------|
| **Mac (Apple Silicon - M1/M2/M3)** | `hermes-desktop-X.X.X-arm64.dmg` | Open DMG, drag to Applications |
| **Mac (Intel)** | `hermes-desktop-X.X.X-x64.dmg` | Open DMG, drag to Applications |
| **Windows** | `hermes-desktop-X.X.X-setup.exe` | Double-click, click "Run anyway" if Windows warns |
| **Linux (Ubuntu/Debian)** | `hermes-desktop_X.X.X_amd64.deb` | Double-click to install |
| **Linux (Fedora/RHEL)** | `hermes-desktop-X.X.X.rpm` | `sudo dnf install ./hermes-desktop-X.X.X.rpm` |
| **Linux (Any - Portable)** | `hermes-desktop-X.X.X.AppImage` | Double-click to run (no install) |

**Where to download:** https://github.com/fathah/hermes-desktop/releases

### Step 2: Verify, Install & Open

For unofficial tester builds, verify `SHA256SUMS.txt` against a hash shared through a trusted channel before bypassing operating-system warnings.

- **Mac**: Open the `.dmg`, drag Hermes Agent to Applications, open from Applications folder
- **Windows**: Run the installer. If SmartScreen warns, verify the hash first, then click "More info" → "Run anyway" only if you trust the build source
- **Linux**: Use your package manager or run the AppImage

### Step 3: First-Time Setup

When the app opens:
1. Choose **"Local Mode"** (recommended for testing)
2. The app will download and install Hermes Agent automatically (may take 2-5 minutes)
3. Pick an AI provider (OpenRouter is easiest - just need an API key)
4. Start chatting!

---

## Option 2: Build From Source (For Developers)

If you have the source code and want to build locally:

```bash
# 1. Install dependencies
npm install

# 2. Build the app
npm run build:mac      # or :win, :linux

# 3. Find the installer in the dist/ folder
```

The tester packaging scripts require bash-compatible tools. On Windows, use Git Bash or WSL.

---

## What to Test

Once the app is running, try these:

1. **Chat** - Send a message, check if AI responds
2. **Tools** - Ask it to search the web or run a command
3. **Sessions** - Close and reopen app, check if history saves
4. **Profiles** - Create a new profile from the top-level Profiles section
5. **Settings** - Change theme, check all tabs load

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "App is damaged" (Mac) | Verify the hash first, then run: `xattr -cr /Applications/Hermes\ Agent.app` only if you trust the build source |
| "Windows protected your PC" | Verify the hash first, then click "More info" → "Run anyway" only if you trust the build source |
| Installer hangs on Linux | Grant passwordless sudo temporarily (see README) |
| App won't start | Rename `~/.hermes` to a dated backup first, then try again |

---

## Need Help?

- **Telegram**: https://t.me/hermes_agent_desktop
- **GitHub Issues**: https://github.com/fathah/hermes-desktop/issues

---

## Quick Validation Checklist

- [ ] App opens without errors
- [ ] First-run installer completes
- [ ] Can send a chat message
- [ ] AI responds with text
- [ ] Can access Settings page
- [ ] Can view Session history
- [ ] App closes and reopens properly
