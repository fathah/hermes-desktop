export default {
  preparing: "準備中...",
  startingInstall: "開始安裝",
  installationComplete: "安裝完成",
  installationFailed: "安裝失敗",
  installingHermes: "正在安裝 Hermes Agent",
  installationFailedHint: "安裝失敗，請重試或改用終端機安裝。",
  retryInstallation: "重新安裝",
  copied: "已複製！",
  copyLogs: "複製記錄",
  stepLabel: "步驟 {{step}}/{{total}}：{{title}}",
  waitingToStart: "等待開始...",
  continueToSetup: "繼續前往設定",
  confirmTitle: "安裝前確認",
  confirmLocationLabel: "Hermes 將安裝到：",
  confirmFresh: "此處未找到現有安裝 — 將進行全新安裝。",
  confirmUpdate: "此處已有 Hermes 安裝 — 將更新到最新版本。",
  confirmReplace:
    "此處存在一個資料夾，但不是有效的 Hermes 安裝 — 安裝將刪除並取代它。",
  confirmNotInherited:
    "如果你在其他位置或透過命令列安裝過 Hermes，那些安裝不會被沿用。",
  confirmInstallBtn: "安裝 Hermes",
  useExistingBtn: "使用現有安裝",
  useExistingHint:
    "選擇包含你現有 Hermes 安裝的資料夾（即包含 hermes-agent 資料夾的那個）。",
  useExistingInvalid: "在該資料夾中未找到可用的 Hermes 安裝。",
  useExistingDone: "已設定現有安裝 — 結束並重新開啟 Hermes 以套用。",
  useExistingQuitBtn: "結束 Hermes",
} as const;
