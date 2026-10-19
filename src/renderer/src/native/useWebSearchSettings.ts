import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { Endpoints, type CredentialInfo, type SettingsDescribeValue } from "./protocol";
import { rpc } from "./rpc";
import {
  SEARCH_MODES, configOps, draftFrom, hasLiteralKey, modelKeyRef, namespace,
  rebaseDraft, searchKeyRef, section, selectedMode, selectionOps, targetKeyRef, validateDraft,
  type DeepSeekSearchMode, type SearchDraft, type SearchMode,
} from "./web-search-settings";

interface CredentialState extends Partial<CredentialInfo> { known: boolean }
export interface WebSearchSettingsOptions { onRefreshCredentials?: () => void }
const emptyDraft = (): SearchDraft => ({ baseURL: "", limit: "", keySource: "model", apiKeyDraft: "" });

export function useWebSearchSettings(options?: WebSearchSettingsOptions) {
  const t = useT();
  const translation = useRef(t);
  translation.current = t;
  const callbacks = useRef(options);
  callbacks.current = options;
  const snapshot = useRef<SettingsDescribeValue | null>(null);
  const draftsRef = useRef({ api: emptyDraft(), messages: emptyDraft() });
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

  const publishDrafts = useCallback((next: typeof draftsRef.current) => {
    draftsRef.current = next;
    setDrafts(next);
  }, []);
  const refreshCredentials = useCallback(async () => {
    const current = snapshot.current;
    if (!current) return;
    const sequence = ++credentialSequence.current;
    const refs = [...new Set([modelKeyRef(current), ...(["api", "messages"] as const).flatMap((key) => [
      searchKeyRef(namespace(current, SEARCH_MODES[key].ns)), SEARCH_MODES[key].independentRef,
    ])])];
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
  const load = useCallback(async (savedMode?: DeepSeekSearchMode) => {
    const sequence = ++loadSequence.current;
    try {
      const result = await rpc<SettingsDescribeValue>(Endpoints.settingsDescribe, {});
      if (!alive.current || sequence !== loadSequence.current) return false;
      if (!Array.isArray(result?.namespaces) || !namespace(result, "web")) throw new Error("配置不可用");
      const previous = snapshot.current;
      const next = { ...draftsRef.current };
      for (const key of ["api", "messages"] as const) {
        next[key] = previous && key !== savedMode
          ? rebaseDraft(next[key], draftFrom(previous, key), draftFrom(result, key)) : draftFrom(result, key);
      }
      if (!previous || modeRef.current === selectedMode(previous)) {
        modeRef.current = selectedMode(result);
        setMode(modeRef.current);
      }
      snapshot.current = result;
      publishDrafts(next);
      setWritable(result.writable === true);
      setLoaded(true);
      await refreshCredentials();
      return true;
    } catch {
      if (!alive.current || sequence !== loadSequence.current) return false;
      setLoaded(false);
      setError(translation.current("settings.webSearch.loadFailed"));
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

  const currentNamespace = mode === "external" ? undefined : namespace(snapshot.current, SEARCH_MODES[mode].ns);
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
    const targetNs = namespace(current, SEARCH_MODES[targetMode].ns);
    if (!targetNs) return;
    const selectedDraft = draftsRef.current[targetMode];
    const invalid = validateDraft(targetMode, selectedDraft);
    if (invalid) { setError(translation.current("settings.webSearch." + invalid)); return; }
    const ops = configOps(current, targetMode, selectedDraft);
    const selectOps = selectionOps(current, targetMode);
    if (!current.writable && (ops.length || selectOps.length)) {
      setError(translation.current("settings.webSearch.readOnly")); return;
    }
    const ref = targetKeyRef(current, targetMode, selectedDraft.keySource);
    const keyChange = selectedDraft.keySource === "independent" && Boolean(selectedDraft.apiKeyDraft.trim());
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
    availableModes: (["api", "messages"] as const).filter((key) => namespace(snapshot.current, SEARCH_MODES[key].ns)),
    hasExternalConfiguration: Boolean(snapshot.current && selectedMode(snapshot.current) === "external"),
    externalProvider: String(section(namespace(snapshot.current, "web")).searchProvider ?? ""),
    hasKey: Boolean(literalRetained || credential?.configured),
    keyStatusKnown: Boolean(literalRetained || credential?.known),
    keyWritable: Boolean(credential?.known && credential.writable && (writable || !needsBinding)),
    message, error, save, refresh: load, refreshCredentials,
  };
}
export type WebSearchSettingsController = ReturnType<typeof useWebSearchSettings>;
