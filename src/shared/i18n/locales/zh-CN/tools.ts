export default {
  title: "工具",
  subtitle: "启用或禁用在对话中代理可用的工具集",
  mcpServers: "MCP 服务器",
  mcpSubtitle: "在 config.yaml 中配置的模型上下文协议服务器。在终端中使用 hermes mcp add/remove 管理。",
  web: {
    label: "网络搜索",
    description: "搜索网络并从 URL 提取内容",
  },
  browser: {
    label: "浏览器",
    description: "导航、点击、输入并与网页交互",
  },
  terminal: {
    label: "终端",
    description: "执行 Shell 命令和脚本",
  },
  file: {
    label: "文件操作",
    description: "读取、写入、搜索和管理文件",
  },
  code_execution: {
    label: "代码执行",
    description: "直接执行 Python 和 Shell 代码",
  },
  vision: { label: "视觉", description: "分析图片和视觉内容" },
  image_gen: {
    label: "图片生成",
    description: "使用 DALL-E 和其他模型生成图片",
  },
  tts: { label: "文本转语音", description: "将文本转换为语音音频" },
  skills: {
    label: "技能",
    description: "创建、管理和执行可重用的技能",
  },
  memory: {
    label: "记忆",
    description: "存储和回忆持久知识",
  },
  session_search: {
    label: "会话搜索",
    description: "搜索过去的对话",
  },
  clarify: {
    label: "澄清问题",
    description: "在需要时向用户询问澄清",
  },
  delegation: {
    label: "委托",
    description: "生成子代理以并行处理任务",
  },
  cronjob: {
    label: "定时任务",
    description: "创建和管理计划任务",
  },
  moa: {
    label: "混合代理",
    description: "协调多个 AI 模型协同工作",
  },
  todo: {
    label: "任务规划",
    description: "为复杂任务创建和管理待办事项列表",
  },
} as const;
