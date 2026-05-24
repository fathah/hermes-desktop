import { useCallback, useEffect, useMemo, useState } from "react";
import { PROVIDERS } from "../../../constants";
import { useI18n } from "../../../components/useI18n";
import type { ModelGroup } from "../types";

interface UseModelConfigResult {
  currentModel: string;
  currentProvider: string;
  currentBaseUrl: string;
  modelGroups: ModelGroup[];
  displayModel: string;
  reload: () => Promise<void>;
  selectModel: (
    provider: string,
    model: string,
    baseUrl: string,
  ) => Promise<void>;
}

function groupModelsByProvider(
  models: { provider: string; model: string; name: string; baseUrl?: string }[],
): ModelGroup[] {
  const groupMap = new Map<string, ModelGroup>();
  for (const m of models) {
    if (!groupMap.has(m.provider)) {
      groupMap.set(m.provider, {
        provider: m.provider,
        providerLabel: PROVIDERS.labels[m.provider] || m.provider,
        models: [],
      });
    }
    groupMap.get(m.provider)!.models.push({
      provider: m.provider,
      model: m.model,
      label: m.name,
      baseUrl: m.baseUrl || "",
    });
  }
  return Array.from(groupMap.values());
}

export function useModelConfig(profile?: string): UseModelConfigResult {
  const { t } = useI18n();
  const [currentModel, setCurrentModel] = useState("");
  const [currentProvider, setCurrentProvider] = useState("auto");
  const [currentBaseUrl, setCurrentBaseUrl] = useState("");
  const [modelGroups, setModelGroups] = useState<ModelGroup[]>([]);

  const reload = useCallback(async (): Promise<void> => {
    const [mc, savedModels] = await Promise.all([
      window.hermesAPI.getModelConfig(profile),
      window.hermesAPI.listModels(),
    ]);
    setCurrentModel(mc.model);
    setCurrentProvider(mc.provider);
    setCurrentBaseUrl(mc.baseUrl);
    setModelGroups(groupModelsByProvider(savedModels));
  }, [profile]);

  // Initial load + reload whenever the profile changes (canonical
  // load-on-mount; setState happens inside `reload` via an awaited IPC call).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
  }, [reload]);

  const selectModel = useCallback(
    async (provider: string, model: string, baseUrl: string): Promise<void> => {
      // Named providers (deepseek, groq, anthropic, …) have a hardcoded
      // canonical base_url in `hermes-agent`'s PROVIDER_REGISTRY.  A stored
      // model entry that carries a stale `baseUrl` from an earlier confused
      // save (e.g. a deepseek-tagged entry whose baseUrl points at the codex
      // endpoint) would route the request to the wrong host.  Drop the
      // baseUrl whenever the entry isn't `custom`; the gateway falls back
      // to the provider's canonical URL.
      const effectiveBaseUrl = provider === "custom" ? baseUrl : "";
      await window.hermesAPI.setModelConfig(
        provider,
        model,
        effectiveBaseUrl,
        profile,
      );
      setCurrentModel(model);
      setCurrentProvider(provider);
      setCurrentBaseUrl(effectiveBaseUrl);
    },
    [profile],
  );

  const displayModel = useMemo(
    () =>
      currentModel
        ? currentModel.split("/").pop() || currentModel
        : currentProvider === "auto"
          ? t("chat.auto")
          : t("chat.noModel"),
    [currentModel, currentProvider, t],
  );

  return {
    currentModel,
    currentProvider,
    currentBaseUrl,
    modelGroups,
    displayModel,
    reload,
    selectModel,
  };
}
