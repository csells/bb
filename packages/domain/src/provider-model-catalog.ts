import type { ProviderModelCatalogScope } from "./provider-types.js";

export const PROVIDER_MODEL_CATALOG_FRESH_MS = 60_000;

export function providerModelCatalogDependsOnWorkspace(
  scope: ProviderModelCatalogScope | undefined,
): boolean {
  return scope !== "host";
}
