import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { Endpoints, type CredentialInfo, type SettingsDescribeValue } from "./protocol";
import { rpc } from "./rpc";
import {
  SEARCH_SERVICES, SEARCH_SERVICES_LIST, LEGACY_SEARCH_PROVIDER, LEGACY_FETCH_PROVIDER,
  configOps, draftFrom, hasLiteralKey, legacyCredentialOps, modelKeyRef, namespace,
  rebaseDraft, searchKeyRef, section, selectedMode, selectionOps, targetKeyRef, validateDraft,
  type SearchDraft, type SearchMode, type SearchService,
} from "./web-search-settings";

interface CredentialState extends Partial<CredentialInfo> { known: boolean }
export interface WebSearchSettingsOptions { onRefreshCredentials?: () => void }
const emptyDraft = (): SearchDraft => ({ limit: "", keySource: "model", apiKeyDraft: "" });
const emptyDrafts = (): Record<SearchService, SearchDraft> => ({ api: emptyDraft(), exa: emptyDraft() });
/** 本次界面会话内已写入 Exa 密钥且引擎尚未重启：后续保存成功仍提示"重启生效"，
 * 覆盖密钥已写入但服务切换失败后的重试。应用重启（引擎随之重启）后自然清零。 */
let exaKeyWritten = false;
/** 服务是否具备引擎设置命名空间；Exa 无运行时配置面，只参与切换与凭据。 */
function serviceNamespace(snapshot: SettingsDescribeValue | null, service: SearchService) {
  const config = SEARCH_SERVICES[service];
  return "ns" in config ? namespace(snapshot, config.ns) : undefined;
}

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
      searchKeyRef(serviceNamespace(current, service)),
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
      // 旧版搜索已下线：检测到旧版默认组合（旧版搜索 + 官方匿名抓取）且可写时静默迁移
      // 到新版，普通用户无感；失败或其他非标准搭配按外部配置兜底，不自动改写。
      const webSection = section(namespace(result, "web"));
      const legacyPair = webSection.searchProvider === LEGACY_SEARCH_PROVIDER
        && webSection.fetchProvider === LEGACY_FETCH_PROVIDER;
      if (result.writable === true && legacyPair) {
        const webNs = namespace(result, "web");
        const credOps = legacyCredentialOps(result);
        const selectOps = selectionOps(result, "api");
        const targets: Array<[string, typeof credOps]> = [];
        if (credOps.length) targets.push([SEARCH_SERVICES.api.ns, credOps]);
        if (webNs && selectOps.length) targets.push(["web", selectOps]);
        if (targets.length) {
          try {
            // 与保存一致：先把独立凭据绑定落到目标服务，最后切换服务选择。
            for (const [nsName, ops] of targets) {
              const ns = namespace(result, nsName)!;
              await rpc(Endpoints.settingsMutate, { ns: nsName, ops, expectedRevision: ns.revision });
            }
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

  const currentNamespace = mode === "external" ? undefined : serviceNamespace(snapshot.current, mode);
  const draft = mode === "external" ? emptyDraft() : drafts[mode];
  const activeRef = snapshot.current && mode !== "external" ? targetKeyRef(snapshot.current, mode, draft.keySource) : "";
  const credential = credentials[activeRef];
  const baseline = snapshot.current && mode !== "external" ? draftFrom(snapshot.current, mode) : emptyDraft();
  const literalRetained = hasLiteralKey(currentNamespace) && draft.keySource === baseline.keySource && !draft.apiKeyDraft.trim();
  const needsBinding = Boolean(currentNamespace && (searchKeyRef(currentNamespace) !== activeRef || hasLiteralKey(currentNamespace)));
  const formAvailable = mode === "exa" || Boolean(currentNamespace);

  const save = async () => {
    if (savingRef.current) return;
    setMessage(null);
    setError(null);
    const current = snapshot.current;
    const targetMode = modeRef.current;
    if (!loaded || !current || targetMode === "external") return;
    const targetNs = serviceNamespace(current, targetMode);
    if (targetMode !== "exa" && !targetNs) return;
    const selectedDraft = draftsRef.current[targetMode];
    const invalid = validateDraft(selectedDraft);
    if (invalid) { setError(translation.current("settings.webSearch." + invalid)); return; }
    const keyChange = selectedDraft.keySource === "independent" && Boolean(selectedDraft.apiKeyDraft.trim());
    if (targetMode === "exa" && keyChange && modelKeyRef(current) === SEARCH_SERVICES.exa.keyRef) {
      setError(translation.current("settings.webSearch.exaKeyConflict")); return;
    }
    const ops = configOps(current, targetMode, selectedDraft);
    const selectOps = selectionOps(current, targetMode);
    if (!current.writable && (ops.length || selectOps.length)) {
      setError(translation.current("settings.webSearch.readOnly")); return;
    }
    const ref = targetKeyRef(current, targetMode, selectedDraft.keySource);
    const literalKept = hasLiteralKey(targetNs) && !ops.some((op) => op.path[0] === "apiKey");
    // Exa 的已配置状态以本地写入为准：引擎凭据查询读启动快照，看不到运行期写入。
    const keyReady = keyChange || credentials[ref]?.configured
      || (targetMode === "exa" && exaKeyWritten);
    if (selectedDraft.keySource === "independent" && !literalKept && !keyReady) {
      setError(translation.current("settings.webSearch.keyRequired")); return;
    }
    // 引擎凭据库的可写性只约束凭据库写入；Exa 走主进程用户环境层，不依赖该状态。
    if (keyChange && targetMode !== "exa" && (!credentials[ref]?.known || credentials[ref]?.writable !== true)) {
      setError(translation.current("settings.webSearch.apiKey.statusErrorDesc")); return;
    }
    savingRef.current = true;
    setSaving(true);
    let serviceSaved = false;
    try {
      if (keyChange) {
        if (targetMode === "exa") {
          // Exa 插件只读启动环境、不接凭据体系；密钥由主进程写入用户环境层
          // （$DSH_HOME/.env）。写成功即已持久化，不向运行中的引擎确认——引擎的
          // 凭据查询读启动时快照，运行期写入它永远看不到，重启后才可见。
          await window.qingwu.setExaSearchKey(selectedDraft.apiKeyDraft.trim());
          exaKeyWritten = true;
        } else {
          await rpc(Endpoints.credentialsSet, { ref, value: selectedDraft.apiKeyDraft.trim() });
          const verified = await rpc<Record<string, CredentialInfo>>(Endpoints.credentialsDescribe, { refs: [ref] });
          if (!verified?.[ref]?.configured) throw new Error("凭据未保存");
        }
        publishDrafts({ ...draftsRef.current, [targetMode]: { ...draftsRef.current[targetMode], apiKeyDraft: "" } });
        callbacks.current?.onRefreshCredentials?.();
      }
      // 与 dsh 官方一致：目标服务设置先落盘，最后才启用它。
      if (ops.length && targetNs) {
        await rpc(Endpoints.settingsMutate, { ns: targetNs.ns, ops, expectedRevision: targetNs.revision });
        serviceSaved = true;
      }
      if (selectOps.length) await rpc(Endpoints.settingsMutate, {
        ns: "web", ops: selectOps, expectedRevision: namespace(current, "web")!.revision,
      });
      if (await load(targetMode) && alive.current) setMessage(translation.current(
        targetMode === "exa" && (keyChange || exaKeyWritten)
          ? "settings.webSearch.exaSavedRestart" : "settings.webSearch.savedSuccess",
      ));
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
    availableModes: SEARCH_SERVICES_LIST.filter((service) => service === "exa" || namespace(snapshot.current, SEARCH_SERVICES[service].ns)),
    hasExternalConfiguration: Boolean(snapshot.current && selectedMode(snapshot.current) === "external"),
    externalProvider: String(section(namespace(snapshot.current, "web")).searchProvider ?? ""),
    // Exa 的密钥写入走主进程用户环境层，不依赖运行中引擎的凭据观察；
    // 写入成功后界面按本地状态显示已配置，重启后与引擎快照自然一致。
    hasKey: Boolean(literalRetained || credential?.configured || (mode === "exa" && exaKeyWritten)),
    keyStatusKnown: Boolean(literalRetained || credential?.known || mode === "exa"),
    keyWritable: mode === "exa" ? true
      : Boolean(credential?.known && credential.writable && (writable || !needsBinding)),
    message, error: error ?? loadError, save, refresh: load, refreshCredentials,
  };
}
export type WebSearchSettingsController = ReturnType<typeof useWebSearchSettings>;
