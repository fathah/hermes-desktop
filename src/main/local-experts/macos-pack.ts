import type {
  LocalExpertPack,
  LocalExpertRecord,
} from "../../shared/local-experts";

function withMacRecordDefaults(record: LocalExpertRecord): LocalExpertRecord {
  return {
    freshnessDays: 180,
    commonQuestions: [
      `How do I handle ${record.title.toLowerCase()}?`,
      `How can I verify ${record.topic} without guessing?`,
    ],
    dontSay: [
      "Do not claim the Mac's current state unless the user provided evidence or ran an explicit read-only check.",
      "Do not suggest changing settings or running commands without asking first.",
    ],
    authorityNotes:
      "Prefer Apple official guidance for user-facing steps; use admin and developer references only to explain deeper behavior.",
    ...record,
  };
}

export const MACOS_LOCAL_EXPERT_PACK: LocalExpertPack = {
  id: "macos",
  title: "Mac Expert",
  domain: "macos",
  version: "1.0.0",
  description:
    "Source-backed macOS guidance for privacy, security, updates, Finder, networking, and developer workflows.",
  sourceTiers: [
    "apple_official",
    "developer_official",
    "standards_project",
    "mac_admin",
    "community_reference",
  ],
  recipe: {
    name: "Mac Expert",
    description:
      "Answer Mac questions with cited, step-by-step guidance from curated Mac Expert records.",
    job: "Answer Mac questions with cited, step-by-step guidance from the curated Mac Expert records. Ask before suggesting Terminal commands; never claim a setting is enabled unless evidence is provided. V1 is guidance-only: do not run local diagnostics, change settings, delete files, install software, or remediate automatically.",
    inputs:
      "The user's Mac question, symptoms, macOS version if provided, and the installed Mac Expert vault records under expert_macos.",
    output:
      "A concise answer with plain-language steps, verification checks, risk notes, and source references. If evidence is missing, say what the user should check.",
  },
  records: (
    [
      {
        id: "privacy-screen-recording",
        title: "Grant Screen Recording Permission",
        topic: "privacy.screen_recording",
        sourceTier: "apple_official",
        macosVersions: ["14", "15", "26"],
        symptoms: [
          "An app records a black screen",
          "A screenshot or screen-share tool cannot see other windows",
          "The app asks for Screen Recording permission",
        ],
        steps: [
          "Open System Settings.",
          "Go to Privacy & Security.",
          "Open Screen & System Audio Recording or Screen Recording, depending on macOS version.",
          "Enable the app, then quit and reopen it if macOS asks for a restart.",
        ],
        verification: [
          "The app appears enabled in the Screen Recording permission list.",
          "A fresh app session can capture the expected screen or window.",
        ],
        risk: "low",
        sourceUrls: ["https://support.apple.com/guide/mac-help/welcome/mac"],
        lastVerified: "2026-06-17",
        tags: ["privacy", "permissions", "screen-recording"],
      },
      {
        id: "privacy-accessibility",
        title: "Grant Accessibility Permission",
        topic: "privacy.accessibility",
        sourceTier: "apple_official",
        macosVersions: ["14", "15", "26"],
        symptoms: [
          "Automation, hotkeys, or window-control features do not work",
          "A helper app says it needs Accessibility access",
        ],
        steps: [
          "Open System Settings.",
          "Go to Privacy & Security.",
          "Open Accessibility.",
          "Enable the app or helper requesting control, then restart the app if needed.",
        ],
        verification: [
          "The app is enabled in Accessibility.",
          "The blocked automation or keyboard workflow works after relaunch.",
        ],
        risk: "medium",
        sourceUrls: ["https://support.apple.com/guide/mac-help/welcome/mac"],
        lastVerified: "2026-06-17",
        tags: ["privacy", "permissions", "accessibility"],
      },
      {
        id: "security-filevault",
        title: "Understand FileVault Status",
        topic: "security.filevault",
        sourceTier: "apple_official",
        macosVersions: ["14", "15", "26"],
        symptoms: [
          "The user wants to know whether the startup disk is encrypted",
          "A company policy requires FileVault",
        ],
        steps: [
          "Open System Settings.",
          "Go to Privacy & Security.",
          "Open FileVault.",
          "Review whether FileVault is on and how the recovery key is managed.",
        ],
        verification: [
          "System Settings shows FileVault is turned on.",
          "The user knows whether recovery is through iCloud, an institutional key, or a personal recovery key.",
        ],
        risk: "medium",
        sourceUrls: [
          "https://support.apple.com/guide/security/welcome/web",
          "https://support.apple.com/guide/deployment/welcome/web",
        ],
        lastVerified: "2026-06-17",
        tags: ["security", "filevault", "encryption"],
      },
      {
        id: "security-gatekeeper-quarantine",
        title: "Handle Gatekeeper And Quarantine Prompts",
        topic: "security.gatekeeper",
        sourceTier: "apple_official",
        macosVersions: ["14", "15", "26"],
        symptoms: [
          "macOS blocks an app from opening",
          "The user sees a warning about an unidentified developer",
          "A downloaded app cannot launch",
        ],
        steps: [
          "Prefer a notarized copy from the developer's official website or the Mac App Store.",
          "Open System Settings and review Privacy & Security for the blocked app message.",
          "Only allow the app if the source and developer are trusted.",
        ],
        verification: [
          "The app opens without repeated Gatekeeper warnings.",
          "The user can identify where the app came from and why it is trusted.",
        ],
        risk: "high",
        sourceUrls: [
          "https://support.apple.com/guide/security/welcome/web",
          "https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution",
        ],
        lastVerified: "2026-06-17",
        tags: ["security", "gatekeeper", "notarization"],
      },
      {
        id: "updates-security-releases",
        title: "Check macOS Update And Security Posture",
        topic: "updates.security_releases",
        sourceTier: "apple_official",
        macosVersions: ["14", "15", "26"],
        symptoms: [
          "The user asks whether the Mac is up to date",
          "A security release may apply to the installed macOS version",
        ],
        steps: [
          "Open System Settings.",
          "Go to General.",
          "Open Software Update.",
          "Compare the installed macOS version with Apple's current security release notes.",
        ],
        verification: [
          "Software Update reports no available updates, or the user knows which update is pending.",
          "The installed macOS version maps to Apple's security release listing.",
        ],
        risk: "low",
        sourceUrls: [
          "https://support.apple.com/guide/mac-help/welcome/mac",
          "https://support.apple.com/en-us/100100",
        ],
        lastVerified: "2026-06-17",
        tags: ["updates", "security", "software-update"],
      },
      {
        id: "performance-login-items-background",
        title: "Review Login Items And Background Items",
        topic: "performance.login_items",
        sourceTier: "apple_official",
        macosVersions: ["14", "15", "26"],
        symptoms: [
          "The Mac feels slow after login",
          "Unexpected apps start automatically",
          "A background item notification appears",
        ],
        steps: [
          "Open System Settings.",
          "Go to General.",
          "Open Login Items & Extensions or Login Items, depending on macOS version.",
          "Review user-facing login items and allowed background items before disabling anything.",
        ],
        verification: [
          "Only expected apps are listed as opening at login.",
          "The user recognizes each enabled background item or has a source to investigate it.",
        ],
        risk: "medium",
        sourceUrls: [
          "https://support.apple.com/guide/mac-help/welcome/mac",
          "https://support.apple.com/guide/deployment/welcome/web",
        ],
        lastVerified: "2026-06-17",
        tags: ["performance", "login-items", "background-items"],
      },
      {
        id: "performance-storage-pressure",
        title: "Review Storage Pressure Safely",
        topic: "performance.storage_pressure",
        sourceTier: "apple_official",
        macosVersions: ["14", "15", "26"],
        symptoms: [
          "The Mac reports low disk space",
          "Apps are slow because storage may be nearly full",
          "The user wants to understand what can be removed safely",
        ],
        steps: [
          "Open System Settings.",
          "Go to General.",
          "Open Storage.",
          "Review Apple's storage categories before deleting files.",
          "Prefer moving personal files or using built-in recommendations over deleting system or app support files manually.",
        ],
        verification: [
          "Storage settings show the largest categories and available space.",
          "The user can identify personal files or app data before removing anything.",
        ],
        risk: "medium",
        sourceUrls: ["https://support.apple.com/guide/mac-help/welcome/mac"],
        lastVerified: "2026-06-17",
        tags: ["performance", "storage", "disk-space"],
      },
      {
        id: "finder-default-apps",
        title: "Change A File Type's Default App",
        topic: "finder.default_apps",
        sourceTier: "apple_official",
        macosVersions: ["14", "15", "26"],
        symptoms: [
          "A file opens in the wrong app",
          "The user wants all files of one type to open in a chosen app",
        ],
        steps: [
          "Select a file of the type in Finder.",
          "Open Get Info.",
          "Use Open with to choose the preferred app.",
          "Use Change All if the preference should apply to all files of that type.",
        ],
        verification: [
          "Double-clicking a file of that type opens the selected app.",
          "Get Info shows the chosen app under Open with.",
        ],
        risk: "low",
        sourceUrls: ["https://support.apple.com/guide/mac-help/welcome/mac"],
        lastVerified: "2026-06-17",
        tags: ["finder", "default-apps", "files"],
      },
      {
        id: "networking-wifi-dns-vpn",
        title: "Triage Wi-Fi, DNS, VPN, And Captive Portal Issues",
        topic: "networking.triage",
        sourceTier: "apple_official",
        macosVersions: ["14", "15", "26"],
        symptoms: [
          "Wi-Fi is connected but websites do not load",
          "VPN changes network behavior",
          "A captive portal does not appear",
        ],
        steps: [
          "Confirm Wi-Fi is connected to the intended network.",
          "Temporarily note whether VPN, Private Relay, or custom DNS is active before changing anything.",
          "Try a known public website and the router or captive portal address if provided.",
          "Use System Settings Network details to inspect Wi-Fi, DNS, and VPN configuration.",
        ],
        verification: [
          "The user can identify whether the issue is Wi-Fi association, DNS resolution, VPN routing, or captive portal login.",
          "Network settings reflect the expected Wi-Fi, DNS, and VPN state.",
        ],
        risk: "medium",
        sourceUrls: [
          "https://support.apple.com/guide/mac-help/welcome/mac",
          "https://support.apple.com/guide/security/welcome/web",
        ],
        lastVerified: "2026-06-17",
        tags: ["networking", "wifi", "dns", "vpn"],
      },
      {
        id: "security-keychain-passwords",
        title: "Use Keychain And Passwords Safely",
        topic: "security.keychain",
        sourceTier: "apple_official",
        macosVersions: ["14", "15", "26"],
        symptoms: [
          "The user cannot find a saved password",
          "An app repeatedly asks for Keychain access",
          "The user wants to understand where Mac passwords are stored",
        ],
        steps: [
          "Open the Passwords app or System Settings Passwords for website and app passwords.",
          "Use Keychain Access only when troubleshooting certificates, app secrets, or non-website credentials.",
          "Review prompts carefully before allowing an app to access a Keychain item.",
        ],
        verification: [
          "The user can identify whether the item is in Passwords or Keychain Access.",
          "Any Keychain access prompt names an expected app and item.",
        ],
        risk: "medium",
        sourceUrls: [
          "https://support.apple.com/guide/mac-help/welcome/mac",
          "https://support.apple.com/guide/security/welcome/web",
        ],
        lastVerified: "2026-06-17",
        tags: ["security", "keychain", "passwords"],
      },
      {
        id: "developer-signing-notarization",
        title:
          "Orient Developer Signing, Entitlements, Sandbox, And Notarization",
        topic: "developer.signing_notarization",
        sourceTier: "developer_official",
        macosVersions: ["14", "15", "26"],
        symptoms: [
          "A macOS app fails signing, sandbox, entitlement, or notarization checks",
          "A developer needs to understand why macOS blocks or warns about an app",
        ],
        steps: [
          "Identify whether the problem is code signing, entitlements, sandbox permissions, hardened runtime, or notarization.",
          "Compare the app's requested capabilities with Apple entitlement documentation.",
          "Use Apple notarization guidance for distribution outside the Mac App Store.",
        ],
        verification: [
          "The failing stage is named: signing, entitlement, sandbox, hardened runtime, or notarization.",
          "The app's distribution path matches Apple's notarization and sandbox expectations.",
        ],
        risk: "high",
        sourceUrls: [
          "https://developer.apple.com/documentation/security",
          "https://developer.apple.com/documentation/bundleresources/entitlements",
          "https://developer.apple.com/documentation/security/app-sandbox",
          "https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution",
        ],
        lastVerified: "2026-06-17",
        tags: ["developer", "signing", "entitlements", "notarization"],
      },
      {
        id: "backup-time-machine-external-disk",
        title: "Set Up Or Verify Time Machine Backups",
        topic: "backup.time_machine",
        sourceTier: "apple_official",
        macosVersions: ["14", "15", "26"],
        symptoms: [
          "The user wants to back up a Mac",
          "An external disk should be used for Time Machine",
          "The user needs to verify backups are happening",
        ],
        steps: [
          "Connect the intended backup disk or network destination.",
          "Open System Settings.",
          "Go to General.",
          "Open Time Machine and review the selected backup disk.",
          "Confirm the latest backup status before relying on it.",
        ],
        verification: [
          "Time Machine shows a selected backup destination.",
          "The latest backup date is recent enough for the user's risk tolerance.",
        ],
        risk: "low",
        sourceUrls: ["https://support.apple.com/guide/mac-help/welcome/mac"],
        lastVerified: "2026-06-17",
        tags: ["backup", "time-machine", "external-disk"],
      },
    ] satisfies LocalExpertRecord[]
  ).map(withMacRecordDefaults),
};
