/** Public routing identity for a provider operation; never carries a secret. */
export interface ProviderRequestTarget {
  connectionId: string;
  mode: "local" | "remote" | "ssh";
  remoteUrl?: string;
  revision: string;
}
