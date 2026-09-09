/**
 * Markdown 渲染：react-markdown + remark-gfm，代码块经 Shiki（JS 引擎，无 wasm）
 * 双主题高亮。高亮器懒加载单例，就绪前代码块回退纯文本。
 */
import { memo, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import type { LanguageInput } from 'shiki/core';

// ---------- Shiki 高亮器单例 ----------

/** 最小结构类型，避免直接耦合 shiki 内部类型导出。 */
interface ShikiHighlighter {
  codeToHtml(code: string, options: { themes: { light: string; dark: string }; lang: string }): string;
}

/** 语言别名 → 细粒度语言模块（vite 动态分包，按需加载）。 */
const LANG_LOADERS: Record<string, () => LanguageInput> = {
  bash: () => import('@shikijs/langs/bash'),
  c: () => import('@shikijs/langs/c'),
  cpp: () => import('@shikijs/langs/cpp'),
  csharp: () => import('@shikijs/langs/csharp'),
  css: () => import('@shikijs/langs/css'),
  diff: () => import('@shikijs/langs/diff'),
  go: () => import('@shikijs/langs/go'),
  html: () => import('@shikijs/langs/html'),
  java: () => import('@shikijs/langs/java'),
  javascript: () => import('@shikijs/langs/javascript'),
  json: () => import('@shikijs/langs/json'),
  jsx: () => import('@shikijs/langs/jsx'),
  markdown: () => import('@shikijs/langs/markdown'),
  powershell: () => import('@shikijs/langs/powershell'),
  python: () => import('@shikijs/langs/python'),
  rust: () => import('@shikijs/langs/rust'),
  tsx: () => import('@shikijs/langs/tsx'),
  typescript: () => import('@shikijs/langs/typescript'),
  yaml: () => import('@shikijs/langs/yaml'),
};

const LANG_ALIASES: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  cts: 'typescript',
  mts: 'typescript',
  md: 'markdown',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  ps1: 'powershell',
  pwsh: 'powershell',
  py: 'python',
  yml: 'yaml',
  cs: 'csharp',
  'c++': 'cpp',
  rs: 'rust',
  htm: 'html',
};

/** 语言标识归一：返回注册表内的语言名；纯文本/未知返回 'text'。 */
export function normalizeLang(raw: string): string {
  const lang = raw.trim().toLowerCase();
  if (!lang || lang === 'text' || lang === 'plaintext' || lang === 'plain' || lang === 'txt') return 'text';
  const mapped = LANG_ALIASES[lang] ?? lang;
  return LANG_LOADERS[mapped] ? mapped : 'text';
}

let highlighterPromise: Promise<ShikiHighlighter | null> | null = null;
let highlighter: ShikiHighlighter | null = null;

function getHighlighter(): Promise<ShikiHighlighter | null> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      try {
        const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
          import('shiki/core'),
          import('shiki/engine/javascript'),
        ]);
        const core = await createHighlighterCore({
          themes: [import('@shikijs/themes/github-light'), import('@shikijs/themes/github-dark')],
          langs: Array.from(new Set(Object.values(LANG_LOADERS))).map((load) => load()),
          engine: createJavaScriptRegexEngine(),
        });
        highlighter = core as unknown as ShikiHighlighter;
        return highlighter;
      } catch (err) {
        console.error('[Markdown] Shiki 初始化失败，代码块回退纯文本', err);
        highlighterPromise = null;
        return null;
      }
    })();
  }
  return highlighterPromise;
}

const htmlCache = new Map<string, string>();

function highlight(code: string, lang: string): string | null {
  if (!highlighter || lang === 'text') return null;
  const key = `${lang}\u0000${code}`;
  const hit = htmlCache.get(key);
  if (hit !== undefined) return hit;
  const html = highlighter.codeToHtml(code, {
    themes: { light: 'github-light', dark: 'github-dark' },
    lang,
  });
  if (htmlCache.size > 200) htmlCache.clear();
  htmlCache.set(key, html);
  return html;
}

// ---------- 代码块 ----------

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [html, setHtml] = useState<string | null>(() => highlight(code, lang));
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (highlight(code, lang) !== null) {
      setHtml(highlight(code, lang));
      return () => {
        cancelled = true;
      };
    }
    setHtml(null);
    void getHighlighter().then((h) => {
      if (!cancelled && h) setHtml(highlight(code, lang));
    });
    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // 剪贴板不可用时静默忽略
    }
  };

  return (
    <div className="native-codeblock">
      <div className="native-codeblock-banner">
        <span className="native-codeblock-lang">{lang === 'text' ? '' : lang}</span>
        <button className="native-codeblock-copy" onClick={() => void handleCopy()}>
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      {html !== null ? (
        <div className="native-codeblock-body shiki-host" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="native-codeblock-body plain">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}

// ---------- Markdown ----------

const mdComponents: Components = {
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children }) => {
    const text = String(children ?? '');
    const match = /language-([\w+-]+)/.exec(className ?? '');
    if (match) {
      return <CodeBlock code={text.replace(/\n$/, '')} lang={normalizeLang(match[1])} />;
    }
    if (text.includes('\n')) {
      return <CodeBlock code={text.replace(/\n$/, '')} lang="text" />;
    }
    return <code className="native-md-code">{text}</code>;
  },
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
};

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="native-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
