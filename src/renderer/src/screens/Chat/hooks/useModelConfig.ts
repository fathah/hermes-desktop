import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PROVIDERS } from "../../../constants";
import { useDiscoveredModels } from "../../../hooks/useDiscoveredModels";
import { useI18n } from "../../../components/useI18n";
import type { ModelGroup } from "../types";

const OLLAMA_CLOUD_PROVIDER = "ollama-cloud";
const OLLAMA_CLOUD_BASE_URL = "https://ollama.com/v1";

/**
 * Named providers (deepseek, groq, anthropic, …) have a hardcoded canonical
 * base_url in hermes-agent's PROVIDER_REGISTRY, so a stored `baseUrl` on those
 * entries can be stale and would misroute the request. Keep the baseUrl only
 * for `custom` and `ollama-cloud` entries, where it is authoritative; clear it
 * otherwise so the backend falls back to the provider's canonical URL. Shared
 * by `selectModel` and the chat-screen session override so they can't drift.
 */
export function effectiveOverrideBaseUrl(
  provider: string,
  baseUrl: string,
): string {
  return provider === "custom" || provider === OLLAMA_CLOUD_PROVIDER
    ? baseUrl
    : "";
}

interface SavedModelForPicker {
  provider: string;
  model: string;
  name: string;
  baseUrl?: string;
}

function mergeLiveOllamaCloudModels(
  savedModels: SavedModelForPicker[],
  liveModels: string[],
  liveStatus: string,
): SavedModelForPicker[] {
  if (liveStatus !== "ok" || liveModels.length === 0) {
    return savedModels;
  }

  const liveEntries = Array.from(new Set(liveModels))
    .sort()
    .map((model) => ({
      provider: OLLAMA_CLOUD_PROVIDER,
      model,
      name: `Ollama Cloud · ${model}`,
      baseUrl: OLLAMA_CLOUD_BASE_URL,
    }));

  return [
    ...savedModels.filter((model) => model.provider !== OLLAMA_CLOUD_PROVIDER),
    ...liveEntries,
  ];
}

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
    options?: { persist?: boolean },
  ) => Promise<void>;
}

function groupModelsByProvider(models: SavedModelForPicker[]): ModelGroup[] {
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
  const [savedModels, setSavedModels] = useState<SavedModelForPicker[]>([]);
  const loadSeqRef = useRef(0);

  const ollamaCloudDiscovery = useDiscoveredModels({
    provider: OLLAMA_CLOUD_PROVIDER,
    profile,
    enabled: true,
  });

  const modelsForPicker = useMemo(
    () =>
      mergeLiveOllamaCloudModels(
        savedModels,
        ollamaCloudDiscovery.models,
        ollamaCloudDiscovery.status,
      ),
    [savedModels, ollamaCloudDiscovery.models, ollamaCloudDiscovery.status],
  );

  const reload = useCallback(async (): Promise<void> => {
    const seq = ++loadSeqRef.current;
    const [mc, savedModels] = await Promise.all([
      window.hermesAPI.getModelConfig(profile),
      window.hermesAPI.listModels(),
    ]);
    if (seq !== loadSeqRef.current) return;
    setCurrentModel(mc.model);
    setCurrentProvider(mc.provider);
    setCurrentBaseUrl(mc.baseUrl);
    setSavedModels(savedModels);
  }, [profile]);

  // Initial load + reload whenever the profile changes (canonical
  // load-on-mount; setState happens inside `reload` via an awaited IPC call).
  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    setModelGroups(groupModelsByProvider(modelsForPicker));
  }, [modelsForPicker]);

  useEffect(() => {
    return window.hermesAPI.onConnectionConfigChanged(() => {
      setModelGroups([]);
      void reload();
    });
  }, [reload]);

  useEffect(() => {
    return window.hermesAPI.onModelLibraryChanged(() => {
      void reload();
    });
  }, [reload]);

  const selectModel = useCallback(
    async (
      provider: string,
      model: string,
      baseUrl: string,
      { persist = true }: { persist?: boolean } = {},
    ): Promise<void> => {
      const effectiveBaseUrl = effectiveOverrideBaseUrl(provider, baseUrl);
      setCurrentModel(model);
      setCurrentProvider(provider);
      setCurrentBaseUrl(effectiveBaseUrl);
      // Session-only selection: update local state only, do not write to
      // config.yaml so the global default model is preserved (issue #688).
      // Advance the sequence counter so any in-flight reload() triggered by
      // onConnectionConfigChanged / onModelLibraryChanged cannot clobber the
      // session-scoped selection with the persisted value.
      if (!persist) {
        ++loadSeqRef.current;
        return;
      }
      const seq = ++loadSeqRef.current;
      try {
        await window.hermesAPI.setModelConfig(
          provider,
          model,
          effectiveBaseUrl,
          profile,
        );
        const mc = await window.hermesAPI.getModelConfig(profile);
        if (seq !== loadSeqRef.current) return;
        setCurrentModel(mc.model);
        setCurrentProvider(mc.provider);
        setCurrentBaseUrl(mc.baseUrl);
      } catch (err) {
        if (seq === loadSeqRef.current) await reload();
        throw err;
      }
    },
    [profile, reload],
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
