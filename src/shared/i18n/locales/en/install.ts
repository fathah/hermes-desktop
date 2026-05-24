export default {
  preparing: "Preparing...",
  startingInstall: "Starting installation",
  installationComplete: "Installation Complete",
  installationFailed: "Installation Failed",
  installingHermes: "Installing Hermes Agent",
  installationFailedHint:
    "Installation failed. Please try again or install via terminal.",
  retryInstallation: "Retry Installation",
  copied: "Copied!",
  copyLogs: "Copy Logs",
  stepLabel: "Step {{step}}/{{total}}: {{title}}",
  waitingToStart: "Waiting to start...",
  continueToSetup: "Continue to Setup",
  confirmTitle: "Before installing",
  confirmLocationLabel: "Hermes will be installed at:",
  confirmFresh:
    "No existing installation was found here — a fresh copy will be set up.",
  confirmUpdate:
    "An existing Hermes installation is here — it will be updated to the latest version.",
  confirmReplace:
    "A folder exists here but isn't a valid Hermes installation — installing will delete and replace it.",
  confirmNotInherited:
    "If you installed Hermes somewhere else, or via the command line, it won't be carried over.",
  confirmInstallBtn: "Install Hermes",
  useExistingBtn: "Use an existing installation",
  useExistingHint:
    "Select the folder that holds your existing Hermes installation (the one containing the hermes-agent folder).",
  useExistingInvalid: "No usable Hermes installation was found in that folder.",
  useExistingDone:
    "Existing installation set — quit and reopen Hermes to apply it.",
  useExistingQuitBtn: "Quit Hermes",
} as const;
