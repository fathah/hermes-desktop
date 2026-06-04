import { Bot } from "../../assets/icons";
import claudeLogo from "../../assets/logos/claude-color.svg";
import geminiLogo from "../../assets/logos/gemini-color.svg";
import nousLogo from "../../assets/logos/nousresearch.svg";
import openaiLogo from "../../assets/logos/openai.svg";
import openrouterLogo from "../../assets/logos/openrouter.svg";
import moonshotLogo from "../../assets/logos/moonshot.svg";
import metaLogo from "../../assets/logos/meta-color.svg";
import nvidiaLogo from "../../assets/logos/nvidia-color.svg";
import groqLogo from "../../assets/logos/groq.svg";
import minimaxLogo from "../../assets/logos/minimax-color.svg";
import zaiLogo from "../../assets/logos/zai.svg";
import cerebrasLogo from "../../assets/logos/cerebras-color.svg";
import fireworksLogo from "../../assets/logos/fireworks-color.svg";
import grokLogo from "../../assets/logos/grok.svg";
import huggingfaceLogo from "../../assets/logos/huggingface.svg";
import mistralLogo from "../../assets/logos/mistral-color.svg";
import opencodeLogo from "../../assets/logos/opencode.svg";
import perplexityLogo from "../../assets/logos/perplexity-color.svg";
import togetherLogo from "../../assets/logos/together-color.svg";
import deepseekLogo from "../../assets/logos/deepseek-color.svg";
import telegramLogo from "../../assets/logos/telegram.svg";
import discordLogo from "../../assets/logos/discord.svg";
import whatsappLogo from "../../assets/logos/whatsapp-icon.svg";
import mattermostLogo from "../../assets/logos/mattermost-dark.svg";
import slackLogo from "../../assets/logos/slack.svg";
import signalLogo from "../../assets/logos/signal.svg";
import matrixLogo from "../../assets/logos/matrix-dark.svg";
import emailLogo from "../../assets/logos/email.svg";
import smsLogo from "../../assets/logos/sms.svg";
import imessageLogo from "../../assets/logos/imessage.svg";
import dingtalkLogo from "../../assets/logos/dingtalk.svg";
import larkLogo from "../../assets/logos/lark.svg";
import wecomLogo from "../../assets/logos/wecom.svg";
import wechatLogo from "../../assets/logos/wechat.svg";
import webhookLogo from "../../assets/logos/webhook.svg";
import homeAssistantLogo from "../../assets/logos/home-assist.svg";
import qqbotLogo from "../../assets/logos/qqbot.svg";
import yuanbaoLogo from "../../assets/logos/yuanbao.svg";
import apiLogo from "../../assets/logos/api.svg";

type BrandKey =
  | "claude"
  | "gemini"
  | "nous"
  | "openai"
  | "openrouter"
  | "moonshot"
  | "meta"
  | "nvidia"
  | "groq"
  | "minimax"
  | "zai"
  | "cerebras"
  | "fireworks"
  | "grok"
  | "huggingface"
  | "mistral"
  | "opencode"
  | "perplexity"
  | "together"
  | "deepseek"
  | "telegram"
  | "discord"
  | "whatsapp"
  | "mattermost"
  | "slack"
  | "signal"
  | "matrix"
  | "email"
  | "sms"
  | "imessage"
  | "dingtalk"
  | "feishu"
  | "wecom"
  | "weixin"
  | "qqbot"
  | "yuanbao"
  | "api_server"
  | "webhooks"
  | "home_assistant"
  | "unknown";

const LOGOS: Record<Exclude<BrandKey, "unknown">, string> = {
  claude: claudeLogo,
  gemini: geminiLogo,
  nous: nousLogo,
  openai: openaiLogo,
  openrouter: openrouterLogo,
  moonshot: moonshotLogo,
  meta: metaLogo,
  nvidia: nvidiaLogo,
  groq: groqLogo,
  minimax: minimaxLogo,
  zai: zaiLogo,
  cerebras: cerebrasLogo,
  fireworks: fireworksLogo,
  grok: grokLogo,
  huggingface: huggingfaceLogo,
  mistral: mistralLogo,
  opencode: opencodeLogo,
  perplexity: perplexityLogo,
  together: togetherLogo,
  deepseek: deepseekLogo,
  telegram: telegramLogo,
  discord: discordLogo,
  whatsapp: whatsappLogo,
  mattermost: mattermostLogo,
  slack: slackLogo,
  signal: signalLogo,
  matrix: matrixLogo,
  email: emailLogo,
  sms: smsLogo,
  imessage: imessageLogo,
  dingtalk: dingtalkLogo,
  feishu: larkLogo,
  wecom: wecomLogo,
  weixin: wechatLogo,
  qqbot: qqbotLogo,
  yuanbao: yuanbaoLogo,
  api_server: apiLogo,
  webhooks: webhookLogo,
  home_assistant: homeAssistantLogo,
};

function detectBrand(provider?: string, modelId?: string): BrandKey {
  const haystack = `${provider || ""} ${modelId || ""}`.toLowerCase();
  if (/(claude|anthropic)/.test(haystack)) return "claude";
  if (/(gemini|google)/.test(haystack)) return "gemini";
  if (/(gpt|openai)/.test(haystack)) return "openai";
  if (/nous/.test(haystack)) return "nous";
  if (/(moonshot|kimi)/.test(haystack)) return "moonshot";
  if (/(meta|llama)/.test(haystack)) return "meta";
  if (/(nvidia|nemotron)/.test(haystack)) return "nvidia";
  if (/groq/.test(haystack)) return "groq";
  if (/(grok|xai)/.test(haystack)) return "grok";
  if (/minimax/.test(haystack)) return "minimax";
  if (/(zai|z\.ai|glm|zhipu)/.test(haystack)) return "zai";
  if (/cerebras/.test(haystack)) return "cerebras";
  if (/fireworks/.test(haystack)) return "fireworks";
  if (/(huggingface|hugging_face|\bhf[_\b])/.test(haystack))
    return "huggingface";
  if (/mistral/.test(haystack)) return "mistral";
  if (/opencode/.test(haystack)) return "opencode";
  if (/perplexity/.test(haystack)) return "perplexity";
  if (/together/.test(haystack)) return "together";
  if (/deepseek/.test(haystack)) return "deepseek";
  if (/telegram/.test(haystack)) return "telegram";
  if (/discord/.test(haystack)) return "discord";
  if (/whatsapp/.test(haystack)) return "whatsapp";
  if (/mattermost/.test(haystack)) return "mattermost";
  if (/slack/.test(haystack)) return "slack";
  if (/signal/.test(haystack)) return "signal";
  if (/matrix/.test(haystack)) return "matrix";
  if (/(bluebubbles|imessage)/.test(haystack)) return "imessage";
  if (/dingtalk/.test(haystack)) return "dingtalk";
  if (/(feishu|lark)/.test(haystack)) return "feishu";
  if (/wecom/.test(haystack)) return "wecom";
  if (/(weixin|wechat)/.test(haystack)) return "weixin";
  if (/qqbot/.test(haystack)) return "qqbot";
  if (/yuanbao/.test(haystack)) return "yuanbao";
  if (/api_server/.test(haystack)) return "api_server";
  if (/webhook/.test(haystack)) return "webhooks";
  if (/(home_assistant|home-assist|homeassistant)/.test(haystack))
    return "home_assistant";
  if (/email/.test(haystack)) return "email";
  if (/sms/.test(haystack)) return "sms";
  if (/openrouter/.test(haystack)) return "openrouter";
  return "unknown";
}

interface Props {
  provider?: string;
  modelId?: string;
  size?: number;
  matchTheme?: boolean;
  className?: string;
}

function BrandLogo({
  provider,
  modelId,
  size = 20,
  matchTheme = true,
  className = "",
}: Props): React.JSX.Element {
  const brand = detectBrand(provider, modelId);

  if (brand === "unknown") {
    return (
      <Bot
        size={size}
        className={`brand-logo brand-logo--fallback ${className}`.trim()}
      />
    );
  }

  const classes = [
    "brand-logo",
    matchTheme ? "brand-logo--match-theme" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <img
      src={LOGOS[brand]}
      width={size}
      height={size}
      className={classes}
      alt={brand}
    />
  );
}

export default BrandLogo;
