/**
 * i18n 核心：语言类型、词条结构、插值与语言解析规则。
 * 渲染层与主进程共用，保证「跟随系统」在两端解析一致。
 */

/** 界面语言偏好：auto 跟随系统，其余为强制指定。 */
export type UiLanguage = "auto" | "zh-CN" | "en-US";

export const UI_LANGUAGES: readonly UiLanguage[] = ["auto", "zh-CN", "en-US"];

export type ResolvedLanguage = "zh-CN" | "en-US";

/** 词条值：普通字符串，或带 one/other 变体的数量词条（t 传 count 时按 1 选 one）。 */
export type LocaleValue = string | { one: string; other: string };

/** 词条字典：按域分层的嵌套对象，叶子为 LocaleValue。域内避免使用 one/other 作为词条名。 */
export interface LocaleDict {
  [key: string]: LocaleValue | LocaleDict;
}

/** 词条 key 的点路径类型（如 'tools.runCommand'），由字典结构自动推导。 */
export type DictPath<T> = T extends LocaleValue
  ? never
  : {
      [K in keyof T & string]: T[K] extends LocaleValue
        ? K
        : T[K] extends LocaleDict
          ? K | `${K}.${DictPath<T[K]>}`
          : never;
    }[keyof T & string];

/** 插值：替换 {name} 占位符；未提供的占位符保持原样。 */
export function formatMessage(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (raw, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name)
      ? String(params[name])
      : raw,
  );
}

/** 偏好 → 实际语言：显式指定优先；auto 时 zh 开头视为简体中文，其余一律英文。 */
export function resolveLanguage(
  pref: UiLanguage | undefined,
  systemLocale: string,
): ResolvedLanguage {
  if (pref === "zh-CN" || pref === "en-US") return pref;
  return /^zh/i.test(systemLocale) ? "zh-CN" : "en-US";
}
