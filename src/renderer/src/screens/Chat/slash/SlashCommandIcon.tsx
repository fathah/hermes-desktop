import React from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Archive,
  ArrowUpCircle,
  Award,
  Bot,
  Brain,
  Bug,
  Building2,
  Calendar,
  CheckCircle2,
  Code2,
  Coins,
  Columns,
  Compass,
  Eraser,
  FileText,
  Flame,
  Globe,
  HelpCircle,
  Image as ImageIcon,
  Info,
  LineChart,
  ListOrdered,
  MessageCircleQuestion,
  MessageSquarePlus,
  Mic,
  Minimize2,
  Radio,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Server,
  Settings,
  Share2,
  Puzzle,
  Target,
  Terminal,
  Undo2,
  User,
  UserCheck,
  Users,
  Video,
  Wrench,
  XCircle,
  Zap,
  MessageSquareCode,
} from "lucide-react";

export const CUSTOM_SLASH_SVGS: Record<string, string | React.ReactNode> = {};

/**
 * Strip active content from a raw SVG string. The icon is injected via
 * `dangerouslySetInnerHTML`, so a string carrying a `<script>` tag or an
 * `onerror`/`onload` handler would execute in the Electron renderer. Legitimate
 * icon markup never needs scripts, event handlers, or `javascript:` URIs, so we
 * remove them defensively. This is a guard, not a full sanitizer — only pass
 * trusted markup; a remote/plugin-sourced SVG should still go through a proper
 * sanitizer (e.g. DOMPurify) before reaching here.
 */
function stripActiveSvgContent(svg: string): string {
  return svg
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<\/?(?:script|foreignObject)\b[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s/>]+)/gi, "")
    .replace(/(href|xlink:href)\s*=\s*("|')\s*javascript:[^"']*\2/gi, "");
}

/**
 * Register a custom SVG string or React element for any slash command. String
 * markup is passed through [[stripActiveSvgContent]] before storage; React
 * elements are inert and stored as-is.
 */
export function registerCustomSlashSvg(
  name: string,
  svg: string | React.ReactNode,
): void {
  const clean = name.replace(/^\//, "").toLowerCase();
  CUSTOM_SLASH_SVGS[clean] =
    typeof svg === "string" ? stripActiveSvgContent(svg) : svg;
}

const ICON_MAP: Record<string, LucideIcon> = {
  // Chat control
  new: MessageSquarePlus,
  clear: Eraser,

  // Agent commands
  btw: MessageCircleQuestion,
  bg: MessageCircleQuestion,
  background: MessageCircleQuestion,
  approve: CheckCircle2,
  deny: XCircle,
  status: Activity,
  reset: RotateCcw,
  compact: Minimize2,
  undo: Undo2,
  retry: RotateCw,
  fast: Zap,
  compress: Archive,
  usage: Coins,
  debug: Bug,
  goal: Target,
  steer: Compass,
  queue: ListOrdered,
  update: ArrowUpCircle,

  // Tools
  web: Globe,
  image: ImageIcon,
  browse: Compass,
  code: Code2,
  file: FileText,
  shell: Terminal,

  // Info
  help: HelpCircle,
  tools: Wrench,
  skills: Puzzle,
  "reload-skills": RefreshCw,
  kanban: Columns,
  schedules: Calendar,
  curator: Award,
  model: Bot,
  agents: Users,
  office: Building2,
  discover: Compass,
  providers: Server,
  gateway: Radio,
  memory: Brain,
  persona: UserCheck,
  version: Info,

  // Skills & Agent built-ins
  voice: Mic,
  "weights-and-biases": LineChart,
  whoami: User,
  xurl: Share2,
  yolo: Flame,
  "youtube-content": Video,
  yuanbao: Bot,

  // Desktop
  settings: Settings,
  commands: HelpCircle,
  "explain-selection": MessageSquareCode,
  learn: Brain,
};

const CATEGORY_DEFAULTS: Record<string, LucideIcon> = {
  chat: MessageSquarePlus,
  agent: Bot,
  "hermes agent": Bot,
  tools: Wrench,
  "tools & skills": Wrench,
  info: Info,
  "pages & settings": Info,
  desktop: Settings,
  navigation: Compass,
};

export interface SlashCommandIconProps {
  name: string;
  category?: string;
  className?: string;
  size?: number;
}

// @lat: [[chat-commands#Slash command execution#Central command router]]
export function SlashCommandIcon({
  name,
  category,
  className = "",
  size = 14,
}: SlashCommandIconProps): React.JSX.Element {
  const cleanName = name.replace(/^\//, "").toLowerCase();

  // 1. Custom SVG override
  const custom = CUSTOM_SLASH_SVGS[cleanName];
  if (custom) {
    if (typeof custom === "string") {
      return (
        <span
          className={`slash-icon-custom ${className}`}
          style={{ width: size, height: size, display: "inline-flex" }}
          dangerouslySetInnerHTML={{ __html: custom }}
        />
      );
    }
    return <span className={`slash-icon-custom ${className}`}>{custom}</span>;
  }

  // 2. Exact Lucide map
  const IconComponent: LucideIcon =
    ICON_MAP[cleanName] ??
    (category ? CATEGORY_DEFAULTS[category.toLowerCase()] : undefined) ??
    Zap;

  return <IconComponent size={size} className={className} />;
}
