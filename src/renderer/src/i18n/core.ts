import { formatMessage, type LocaleDict, type LocaleValue } from "../../../shared/i18n-core";

/** 插值参数：字符串或数字（数字用于数量词条 count 与普通占位符）。 */
export type TranslateParams = Record<string, string | number>;

/**
 * 翻译函数。key 通常为词条点路径（类型自动推导），动态拼接的 key
 * （如菜单数据里的 labelKey）也允许传入，缺失时由回退链兜底。
 */
export type Translate = (
  key: string,
  params?: TranslateParams,
) => string;

function isPluralEntry(value: LocaleValue | LocaleDict | undefined): value is { one: string; other: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "one" in value &&
    "other" in value
  );
}

/** 按点路径逐层取词条；路径中途遇到叶子或缺失时返回 undefined。命中中间层时返回子字典。 */
function pick(
  dict: LocaleDict,
  path: string,
): LocaleValue | LocaleDict | undefined {
  let node: LocaleValue | LocaleDict | undefined = dict;
  for (const part of path.split(".")) {
    if (typeof node === "string" || isPluralEntry(node)) return undefined;
    node = node[part];
    if (node === undefined) return undefined;
  }
  return node;
}

/**
 * t 工厂：先查当前语言，缺失回退中文；数量词条按 one/other 变体选取；
 * 全部缺失时开发告警并回显 key，避免界面出现空白。
 */
export function createTranslate(fallback: LocaleDict, primary: LocaleDict): Translate {
  return (key, params) => {
    const value = pick(primary, key) ?? pick(fallback, key);
    let text: string;
    if (typeof value === "string") {
      text = value;
    } else if (isPluralEntry(value)) {
      text = params?.count === 1 ? value.one : value.other;
    } else {
      console.warn(`[i18n] 缺少词条: ${key}`);
      text = key;
    }
    return formatMessage(text, params);
  };
}
