import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { Endpoints, type CredentialInfo, type SettingsDescribeValue } from "./protocol";
import { rpc } from "./rpc";
import {
  SEARCH_SERVICES, SEARCH_SERVICES_LIST, LEGACY_SEARCH_PROVIDER, configOps, draftFrom,
  hasLiteralKey, modelKeyRef, namespace, rebaseDraft, searchKeyRef, section, selectedMode,
  selectionOps, targetKeyRef, validateDraft,
  type SearchDraft, type SearchMode, type SearchService,
} from "./web-search-settings";

interface CredentialState extends Partial<CredentialInfo> { known: boolean }
export interface WebSearchSettingsOptions { onRefreshCredentials?: () => void }
const emptyDraft = (): SearchDraft => ({ limit: "", keySource: "model", apiKeyDraft: "" });
const emptyDrafts = (): Record<SearchService, SearchDraft> => ({ api: emptyDraft(), exa: emptyDraft() });

export function useWebSearchSettings(options?: WebSearchSettingsOptions) {
  const t = useT();
  const translation = useRef(t);
  translation.current = t;
  const callbacks = useRef(options);
  callbacks.current = options;
  const snapshot = useRef<SettingsDescribeValue | null>(null);
  const draftsRef = useRef(emptyDrafts());
  const modeRef = useRef<SearchMode>("api");
  const savingRef = useRef(false);
  const alive = useRef(true);
  const loadSequence = useRef(0);
  const credentialSequence = useRef(0);
  const [drafts, setDrafts] = useState(draftsRef.current);
  const [mode, setMode] = useState<SearchMode>("api");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [writable, setWritable] = useState(false);
  const [credentials, setCredentials] = useState<Record<string, CredentialState>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const publishDrafts = useCallback((next: typeof draftsRef.current) => {
    draftsRef.current = next;
    setDrafts(next);
  }, []);
  const refreshCredentials = useCallback(async () => {
    const current = snapshot.current;
    if (!current) return;
    const sequence = ++credentialSequence.current;
    const refs = [...new Set(SEARCH_SERVICES_LIST.flatMap((service) => [
      modelKeyRef(current),
      searchKeyRef(namespace(current, SEARCH_SERVICES[service].ns)),
      targetKeyRef(current, service, "independent"),
    ]))];
    setCredentials((before) => Object.fromEntries(refs.map((ref) => [ref, { ...before[ref], known: false }])));
    try {
      const result = await rpc<Record<string, CredentialInfo>>(Endpoints.credentialsDescribe, { refs });
      if (!alive.current || sequence !== credentialSequence.current) return;
      setCredentials(Object.fromEntries(refs.map((ref) => [ref, result?.[ref]
        ? { ...result[ref], known: true } : { known: false }])));
    } catch {
      // 状态未知时禁用凭据编辑，仍允许不涉及凭据的配置保存。
    }
  }, []);
  const load = useCallback(async (saved?: SearchService) => {
    const sequence = ++loadSequence.current;
    try {
      let result = await rpc<SettingsDescribeValue>(Endpoints.settingsDescribe, {});
      if (!alive.current || sequence !== loadSequence.current) return false;
      if (!Array.isArray(result?.namespaces) || !namespace(result, "web")) throw new Error("配置不可用");
      // 旧版搜索已下线：可写时静默迁移到新版，普通用户无感；失败则按外部配置兜底，下次进入再试。
      if (result.writable === true && section(namespace(result, "web")).searchProvider === LEGACY_SEARCH_PROVIDER) {
        const webNs = namespace(result, "web");
        const ops = selectionOps(result, "api");
        if (webNs && ops.length) {
          try {
            await rpc(Endpoints.settingsMutate, { ns: "web", ops, expectedRevision: webNs.revision });
            const migrated = await rpc<SettingsDescribeValue>(Endpoints.settingsDescribe, {});
            if (Array.isArray(migrated?.namespaces) && namespace(migrated, "web")) result = migrated;
          } catch {
            // 迁移失败不阻塞设置页加载。
          }
        }
        if (!alive.current || sequence !== loadSequence.current) return false;
      }
      const previous = snapshot.current;
      const next = { ...draftsRef.current };
      for (const service of SEARCH_SERVICES_LIST) {
        next[service] = previous && service !== saved
          ? rebaseDraft(next[service], draftFrom(previous, service), draftFrom(result, service))
          : draftFrom(result, service);
      }
      if (!previous || modeRef.current === selectedMode(previous)) {
        modeRef.current = selectedMode(result);
        setMode(modeRef.current);
      }
      snapshot.current = result;
      publishDrafts(next);
      setWritable(result.writable === true);
      setLoaded(true);
      setLoadError(null);
      await refreshCredentials();
      return true;
    } catch {
      if (!alive.current || sequence !== loadSequence.current) return false;
      setLoaded(false);
      setLoadError(translation.current("settings.webSearch.loadFailed"));
      return false;
    }
  }, [publishDrafts, refreshCredentials]);
  useEffect(() => {
    alive.current = true;
    void load();
    return () => { alive.current = false; ++loadSequence.current; ++credentialSequence.current; };
  }, [load]);

  const edit = useCallback((field: keyof SearchDraft, value: string) => {
    const currentMode = modeRef.current;
    if (savingRef.current || currentMode === "external") return;
    publishDrafts({ ...draftsRef.current, [currentMode]: { ...draftsRef.current[currentMode], [field]: value } });
    setMessage(null);
    setError(null);
  }, [publishDrafts]);
  const changeMode = useCallback((value: SearchMode) => {
    if (savingRef.current) return;
    modeRef.current = value;
    setMode(value);
    setMessage(null);
    setError(null);
  }, []);

  const currentNamespace = mode === "external" ? undefined : namespace(snapshot.current, SEARCH_SERVICES[mode].ns);
  const draft = mode === "external" ? emptyDraft() : drafts[mode];
  const activeRef = snapshot.current && mode !== "external" ? targetKeyRef(snapshot.current, mode, draft.keySource) : "";
  const credential = credentials[activeRef];
  const baseline = snapshot.current && mode !== "external" ? draftFrom(snapshot.current, mode) : emptyDraft();
  const literalRetained = hasLiteralKey(currentNamespace) && draft.keySource === baseline.keySource && !draft.apiKeyDraft.trim();
  const needsBinding = Boolean(currentNamespace && (searchKeyRef(currentNamespace) !== activeRef || hasLiteralKey(currentNamespace)));
  const formAvailable = mode !== "external" && Boolean(currentNamespace);

  const save = async () => {
    if (savingRef.current) return;
    setMessage(null);
    setError(null);
    const current = snapshot.current;
    const targetMode = modeRef.current;
    if (!loaded || !current || targetMode === "external") return;
    const targetNs = namespace(current, SEARCH_SERVICES[targetMode].ns);
    if (!targetNs) return;
    const selectedDraft = draftsRef.current[targetMode];
    const invalid = validateDraft(targetMode, selectedDraft);
    if (invalid) { setError(translation.current("settings.webSearch." + invalid)); return; }
    const keyChange = selectedDraft.keySource === "independent" && Boolean(selectedDraft.apiKeyDraft.trim());
    const ops = configOps(current, targetMode, selectedDraft, true);
    const selectOps = selectionOps(current, targetMode);
    if (!current.writable && (ops.length || selectOps.length)) {
      setError(translation.current("settings.webSearch.readOnly")); return;
    }
    const ref = targetKeyRef(current, targetMode, selectedDraft.keySource);
    const literalKept = hasLiteralKey(targetNs) && !ops.some((op) => op.path[0] === "apiKey");
    if (selectedDraft.keySource === "independent" && !literalKept && !credentials[ref]?.configured && !keyChange) {
      setError(translation.current("settings.webSearch.keyRequired")); return;
    }
    if (keyChange && (!credentials[ref]?.known || credentials[ref]?.writable !== true)) {
      setError(translation.current("settings.webSearch.apiKey.statusErrorDesc")); return;
    }
    savingRef.current = true;
    setSaving(true);
    let serviceSaved = false;
    try {
      if (keyChange) {
        await rpc(Endpoints.credentialsSet, { ref, value: selectedDraft.apiKeyDraft.trim() });
        const verified = await rpc<Record<string, CredentialInfo>>(Endpoints.credentialsDescribe, { refs: [ref] });
        if (!verified?.[ref]?.configured) throw new Error("凭据未保存");
        publishDrafts({ ...draftsRef.current, [targetMode]: { ...draftsRef.current[targetMode], apiKeyDraft: "" } });
        callbacks.current?.onRefreshCredentials?.();
      }
      // 与 dsh 官方一致：目标服务设置先落盘，最后才启用它。
      if (ops.length) {
        await rpc(Endpoints.settingsMutate, { ns: targetNs.ns, ops, expectedRevision: targetNs.revision });
        serviceSaved = true;
      }
      if (selectOps.length) await rpc(Endpoints.settingsMutate, {
        ns: "web", ops: selectOps, expectedRevision: namespace(current, "web")!.revision,
      });
      if (await load(targetMode) && alive.current) setMessage(translation.current("settings.webSearch.savedSuccess"));
    } catch {
      // 错误原文可能含凭据，不放进界面或日志。回读快照供重试，保留未保存草稿。
      await load(serviceSaved ? targetMode : undefined);
      if (alive.current) setError(translation.current("settings.webSearch.saveFailed"));
    } finally {
      savingRef.current = false;
      if (alive.current) setSaving(false);
    }
  };

  return {
    mode, changeMode, ...draft, edit, loaded, saving, writable, formAvailable,
    availableModes: SEARCH_SERVICES_LIST.filter((service) => namespace(snapshot.current, SEARCH_SERVICES[service].ns)),
    hasExternalConfiguration: Boolean(snapshot.current && selectedMode(snapshot.current) === "external"),
    externalProvider: String(section(namespace(snapshot.current, "web")).searchProvider ?? ""),
    hasKey: Boolean(literalRetained || credential?.configured),
    keyStatusKnown: Boolean(literalRetained || credential?.known),
    keyWritable: Boolean(credential?.known && credential.writable && (writable || !needsBinding)),
    message, error: error ?? loadError, save, refresh: load, refreshCredentials,
  };
}
export type WebSearchSettingsController = ReturnType<typeof useWebSearchSettings>;
