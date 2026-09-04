import { OAUTH_PROVIDERS } from "../../constants";

export interface LibModel {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
  providerLabel?: string;
}

export interface PickerProvider {
  key: string;
  brand: string;
  label: string;
  provider: string;
  baseUrl: string;
  keyEnv: string;
  providerLabel?: string;
  models: LibModel[];
}

export type OAuthProviderStatuses = Record<string, boolean>;

/**
 * Turn authenticated OAuth plans into active-model picker entries without
 * exposing their credentials to the renderer.
 */
export function buildAuthenticatedOAuthPickerProviders(
  statuses: OAuthProviderStatuses,
  modelsByBrand: ReadonlyMap<string, LibModel[]>,
  excludedBrands: ReadonlySet<string> = new Set(),
): PickerProvider[] {
  return OAUTH_PROVIDERS.flatMap((oauthProvider) => {
    if (!statuses[oauthProvider.id] || excludedBrands.has(oauthProvider.id)) {
      return [];
    }
    return [
      {
        key: `brand:${oauthProvider.id}`,
        brand: oauthProvider.id,
        label: oauthProvider.name,
        provider: oauthProvider.id,
        baseUrl: "",
        keyEnv: "",
        models: modelsByBrand.get(oauthProvider.id) ?? [],
      },
    ];
  });
}
