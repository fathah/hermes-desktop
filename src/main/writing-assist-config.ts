import {
  DEFAULT_WRITING_ASSIST_SETTINGS,
  normalizeWritingAssistSettings,
  type WritingAssistSettings,
} from "../shared/writing-assist";
import { readDesktopConfig, writeDesktopConfig } from "./config";

const WRITING_ASSIST_KEY = "writingAssist";

export function getWritingAssistSettings(): WritingAssistSettings {
  const data = readDesktopConfig();
  return normalizeWritingAssistSettings(data[WRITING_ASSIST_KEY]);
}

export function setWritingAssistSettings(
  settings: WritingAssistSettings,
): WritingAssistSettings {
  const data = readDesktopConfig();
  const normalized = normalizeWritingAssistSettings(settings);
  data[WRITING_ASSIST_KEY] = normalized;
  writeDesktopConfig(data);
  return normalized;
}

export function resetWritingAssistSettings(): WritingAssistSettings {
  return setWritingAssistSettings(DEFAULT_WRITING_ASSIST_SETTINGS);
}
