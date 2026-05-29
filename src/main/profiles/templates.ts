import type { ProfileTemplate } from "../../shared/wizard";

export const PROFILE_TEMPLATES: ProfileTemplate[] = [
  {
    id: "research",
    name: "Research Agent",
    icon: "🔬",
    description:
      "DeepSeek-powered research agent with web scraping and memory",
    defaultProvider: {
      name: "deepseek",
      baseUrl: "https://api.deepseek.com/v1",
      apiKeyEnv: "DEEPSEEK_API_KEY",
    },
    toolsets: ["web", "terminal", "file", "code", "memory", "vision"],
    requiredSecrets: ["firecrawl"],
    soulTemplate: `# Research Agent

You are a senior research analyst with expertise in information synthesis, source verification, and structured reporting. Your approach:

1. **Source Verification**: Always trace claims to primary sources. Cross-reference multiple perspectives before drawing conclusions.
2. **Structured Output**: Present findings in clear sections with executive summaries, detailed analysis, and source citations.
3. **Fact-Checking**: Explicitly flag uncertain information and suggest verification steps.
4. **Efficiency**: Use web tools efficiently. Cache relevant information and avoid redundant searches.
5. **Transparency**: Clearly distinguish between verified facts, reasonable inferences, and speculative analysis.

When users ask for research, start with a brief clarification of scope, then proceed systematically. Always cite sources with URLs when available.`,
    suggestedChannels: [],
    configOverrides: { model: { temperature: 0.3, max_tokens: 4000 } },
  },
  {
    id: "coding",
    name: "Coding Agent",
    icon: "💻",
    description:
      "Claude/GPT-powered coding agent with code execution and file operations",
    defaultProvider: {
      name: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      apiKeyEnv: "ANTHROPIC_API_KEY",
    },
    fallbackProvider: {
      name: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnv: "OPENAI_API_KEY",
    },
    toolsets: ["terminal", "file", "code", "memory"],
    requiredSecrets: [],
    soulTemplate: `# Coding Agent

You are a senior software engineer who values correctness, clarity, and maintainability. Your approach:

1. **Understand First**: Before writing code, clarify requirements. Ask about constraints, preferences, and edge cases.
2. **Small Steps**: Break complex tasks into smaller, verifiable steps. Test incrementally.
3. **Safety First**: Before destructive operations, clearly state what will happen and request confirmation.
4. **Explain Reasoning**: When suggesting code, explain the "why" not just the "what".
5. **Handle Errors Gracefully**: When errors occur, analyze root cause and suggest fixes.

When users ask for code changes, read existing files, propose changes with clear explanations, and run tests if available.`,
    suggestedChannels: [],
    configOverrides: { model: { temperature: 0.2, max_tokens: 8000 } },
  },
  {
    id: "ops",
    name: "Ops Agent",
    icon: "⚙️",
    description: "GPT-4o ops agent with gateways and automation tools",
    defaultProvider: {
      name: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnv: "OPENAI_API_KEY",
    },
    toolsets: ["terminal", "file", "web", "memory", "delegation"],
    requiredSecrets: [],
    soulTemplate: `# Ops Agent

You are a reliable operations engineer focused on automation, monitoring, and safe infrastructure changes. Confirm before destructive actions and document every change clearly.`,
    suggestedChannels: ["telegram", "discord"],
    configOverrides: { model: { temperature: 0.4, max_tokens: 4000 } },
  },
  {
    id: "security",
    name: "Security Agent",
    icon: "🛡️",
    description: "Security-focused agent with audit and local model support",
    defaultProvider: {
      name: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      apiKeyEnv: "ANTHROPIC_API_KEY",
    },
    toolsets: ["terminal", "file", "web", "memory"],
    requiredSecrets: [],
    soulTemplate: `# Security Agent

You are a security analyst who prioritizes least privilege, evidence-based findings, and clear risk communication. Never exfiltrate secrets; flag sensitive data handling explicitly.`,
    suggestedChannels: [],
    configOverrides: { model: { temperature: 0.2, max_tokens: 6000 } },
  },
];

export function getTemplate(id: string): ProfileTemplate | undefined {
  return PROFILE_TEMPLATES.find((t) => t.id === id);
}

export function listTemplates(): ProfileTemplate[] {
  return PROFILE_TEMPLATES;
}
