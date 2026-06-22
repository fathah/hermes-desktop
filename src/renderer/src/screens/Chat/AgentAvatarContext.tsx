import { createContext, useContext } from "react";

/** Appearance of the profile/agent that owns the current chat, so the avatar
 *  shown next to agent turns matches the one on the Profiles page. */
export interface AgentAppearance {
  /** Profile name — drives the letter/default colour fallback. */
  name?: string;
  /** Accent colour for the letter fallback. */
  color?: string | null;
  /** Custom avatar image as a data URL; when set it wins over the logo. */
  avatar?: string | null;
}

const AgentAvatarContext = createContext<AgentAppearance>({});

export const AgentAvatarProvider = AgentAvatarContext.Provider;

export function useAgentAppearance(): AgentAppearance {
  return useContext(AgentAvatarContext);
}
