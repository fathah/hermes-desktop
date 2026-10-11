/** Main-issued binding for one editor's connection, configuration and profile. */
export interface ProfileEditorTarget {
  connectionId: string;
  profile: string;
  mode: "local" | "remote" | "ssh";
  scopeToken: string;
}
