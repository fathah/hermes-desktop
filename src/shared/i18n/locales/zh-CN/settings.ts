export default {
  title: "设置",
  sections: {
    hermesAgent: "Hermes 代理",
    appearance: "外观",
    credentialPool: "凭据池",
  },
  language: {
    label: "语言",
    hint: "选择您的首选语言",
  },
  theme: {
    label: "主题",
    hint: "选择您的首选外观",
    system: "系统",
    light: "浅色",
    dark: "深色",
  },
  connection: {
    title: "连接",
    mode: "模式",
    local: "本地",
    remote: "远程",
    localHint: "使用安装在此设备上的 Hermes",
    remoteHint: "连接到网络或云上的 Hermes API 服务器",
  },
  notDetected: "未检测到",
  updatedSuccessfully: "更新成功！",
  updateFailed: "更新失败。",
  migrationComplete: "迁移完成！您的配置、密钥和数据已导入。",
  migrationFailed: "迁移失败。",
} as const;
