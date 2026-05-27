import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { profileHome, safeWriteFile } from "./utils";
import { getAppLocale } from "./locale";
import type { AppLocale } from "../shared/i18n/types";

const DEFAULT_SOUL_BY_LOCALE: Partial<Record<AppLocale, string>> = {
  en: `You are Hermes, a helpful AI assistant. You are friendly, knowledgeable, and always eager to help.

You communicate clearly and concisely. When asked to perform tasks, you think step-by-step and explain your reasoning. You are honest about your limitations and ask for clarification when needed.

You strive to be helpful while being safe and responsible. You respect the user's privacy and handle sensitive information carefully.
`,
  ko: `당신은 친절하고 박식하며 도움을 주는 AI 어시스턴트 Hermes입니다.

명확하고 간결하게 소통합니다. 작업을 요청받으면 단계별로 생각하고 그 이유를 설명합니다. 자신의 한계에 대해서 솔직하며, 필요할 때는 명확화를 요청합니다.

안전하고 책임감 있게 도움을 드리려 노력합니다. 사용자의 개인정보를 존중하고 민감한 정보를 신중하게 다룹니다.
`,
};

export function getDefaultSoul(): string {
  const locale = getAppLocale();
  return DEFAULT_SOUL_BY_LOCALE[locale] ?? DEFAULT_SOUL_BY_LOCALE.en!;
}

export function readSoul(profile?: string): string {
  const soulFile = join(profileHome(profile), "SOUL.md");
  if (!existsSync(soulFile)) return "";

  try {
    return readFileSync(soulFile, "utf-8");
  } catch {
    return "";
  }
}

export function writeSoul(content: string, profile?: string): boolean {
  const soulFile = join(profileHome(profile), "SOUL.md");

  try {
    safeWriteFile(soulFile, content);
    return true;
  } catch {
    return false;
  }
}

export function resetSoul(profile?: string): string {
  const soul = getDefaultSoul();
  writeSoul(soul, profile);
  return soul;
}
