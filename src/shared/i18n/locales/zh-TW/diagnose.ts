export default {
  title: "設定健康狀態",
  description:
    "檢查桌面端設定（環境變數、config.yaml、模型）。會顯示常見導致聊天失敗的不一致問題，並在可安全自動套用時提供一鍵修正。",
  rerun: "重新執行檢查",
  allGood: "未偵測到問題。設定看起來一致。",
  banner: {
    lead: "偵測到設定問題：",
    errors: "{{count}} 個錯誤",
    warnings: "{{count}} 個警告",
    infos: "{{count}} 則注意事項",
    showDetails: "顯示詳細資訊",
  },
  apiKeyBanner: {
    lead: "尚未設定 API Server Key — 聊天會失敗。",
    setNow: "立即設定",
  },
  apiKeyModal: {
    title: "設定 API Server Key",
    description:
      "Hermes 閘道需要 API_SERVER_KEY 來驗證請求。請立即設定以啟用聊天。如果密碼存放在 vault（KeePassXC、Bitwarden 等），且 Hermes `secrets.provider` 已指向該處，可以忽略此警告 — provider 會直接提供 Key。",
    label: "API Server Key",
    placeholder: "sk-… 或任意密碼",
    autoGenerate: "自動產生",
    hint: "可以貼上自己的 Key，或產生隨機 UUID。",
  },
  fix: {
    apply: "套用修正",
    running: "套用中…",
    success: "已套用修正。",
    failure: "修正失敗。",
  },
} as const;
