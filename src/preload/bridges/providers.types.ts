import type * as Api from "../api-types";

export interface ProvidersBridgeApi {
  getCredentialPool: (
    profile?: string,
  ) => Promise<Record<string, Array<Api.CredentialPoolEntry>>>;

  setCredentialPool: (
    provider: string,
    entries: Array<Api.CredentialPoolEntry>,
    profile?: string,
  ) => Promise<boolean>;

  addCredentialPoolEntry: (
    provider: string,
    apiKey: string,
    label: string,
    profile?: string,
  ) => Promise<Array<Api.CredentialPoolEntry>>;

  getOAuthProviderStatus: (
    provider: string,
    profile?: string,
  ) => Promise<Api.OAuthProviderStatus>;

  removeOAuthProviderCredentials: (
    provider: string,
    profile?: string,
  ) => Promise<Api.OAuthProviderRemovalResult>;

  // Models

  listModels: () => Promise<
    Array<{
      id: string;
      name: string;
      provider: string;
      model: string;
      baseUrl: string;
      createdAt: number;
    }>
  >;

  addModel: (
    name: string,
    provider: string,
    model: string,
    baseUrl: string,
  ) => Promise<{
    id: string;
    name: string;
    provider: string;
    model: string;
    baseUrl: string;
    createdAt: number;
  }>;

  removeModel: (id: string) => Promise<boolean>;

  updateModel: (id: string, fields: Record<string, string>) => Promise<boolean>;

  // Updates
}
