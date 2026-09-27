import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Context,
  type ReactNode,
} from "react";
import { resolveLanguage } from "../../../shared/i18n-core";
import { createTranslate, type Translate } from "./core";
import enDict from "./locales/en-US";
import zhDict from "./locales/zh-CN";

const zhTranslate = createTranslate(zhDict, zhDict);
const enTranslate = createTranslate(zhDict, enDict);

function systemLocale(): string {
  try {
    return typeof navigator !== "undefined" ? navigator.language || "zh-CN" : "zh-CN";
  } catch {
    return "zh-CN";
  }
}

/**
 * Provider 外的兜底取词（错误边界自渲染、无 Context 的测试环境等）：
 * 直接按系统语言解析，不读取应用设置，保证最坏情况下界面仍有可用文案。
 */
export const fallbackTranslate =
  resolveLanguage(undefined, systemLocale()) === "zh-CN"
    ? zhTranslate
    : enTranslate;

/**
 * Context 惰性创建：测试环境以简化 React 替身运行（无 Context API），
 * 模块加载与 useT 都不能触碰 createContext/useContext；真实应用中
 * I18nProvider 先于子组件渲染，此处首次渲染即完成创建。
 */
let I18nContext: Context<Translate | null> | null = null;

/** 语言上下文：偏好来自应用设置 uiLanguage（auto 跟随系统），设置到达前按系统语言渲染。 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [pref, setPref] = useState<"auto" | "zh-CN" | "en-US">("auto");

  useEffect(() => {
    let alive = true;
    void window.qingwu
      ?.getAppSettings?.()
      .then((s) => {
        if (alive && s) setPref(s.uiLanguage ?? "auto");
      })
      .catch(() => {});
    const off = window.qingwu?.onAppSettingsChanged?.((s) => {
      setPref(s.uiLanguage ?? "auto");
    });
    return () => {
      alive = false;
      off?.();
    };
  }, []);

  const t = useMemo(() => {
    return resolveLanguage(pref, systemLocale()) === "zh-CN"
      ? zhTranslate
      : enTranslate;
  }, [pref]);

  I18nContext ??= createContext<Translate | null>(null);
  const Ctx = I18nContext;
  return <Ctx.Provider value={t}>{children}</Ctx.Provider>;
}

/** 界面取词：组件内统一入口。无语言上下文时回退到系统语言的静态词条。 */
export function useT(): Translate {
  return (I18nContext && useContext(I18nContext)) ?? fallbackTranslate;
}
