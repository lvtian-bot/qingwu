/**
 * Markdown 渲染：react-markdown + remark-gfm，代码块经 Shiki（JS 引擎，无 wasm）
 * 双主题高亮。高亮器懒加载单例，就绪前代码块回退纯文本。
 */
import { createContext, memo, useContext, useEffect, useMemo, useState } from 'react';
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
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用时静默忽略
    }
  };

  const displayLang = lang && lang !== 'text' ? lang : 'text';

  return (
    <div className="native-codeblock">
      <div className="native-codeblock-banner">
        <span className="native-codeblock-lang">{displayLang}</span>
        <button
          className={`native-codeblock-copy ${copied ? 'copied' : ''}`}
          onClick={() => void handleCopy()}
          title={copied ? '已复制' : '复制代码'}
        >
          {copied ? (
            <>
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>已复制</span>
            </>
          ) : (
            <>
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              <span>复制</span>
            </>
          )}
        </button>
      </div>
      <div className="native-codeblock-body">
        {html !== null ? (
          <div className="shiki-host" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <pre className="plain">
            <code>{code}</code>
          </pre>
        )}
      </div>
    </div>
  );
}

// ---------- 图片渲染 ----------

interface ResolvedImageTarget {
  isRemote: boolean;
  target: string;
}

function resolveImageTarget(
  rawSrc: string | undefined,
  cwd?: string | null,
): ResolvedImageTarget | null {
  if (!rawSrc) return null;
  let clean = rawSrc.trim();
  if (clean.startsWith('<') && clean.endsWith('>')) {
    clean = clean.slice(1, -1).trim();
  }
  const queryIndex = clean.indexOf('?');
  if (queryIndex !== -1) clean = clean.slice(0, queryIndex);
  const hashIndex = clean.indexOf('#');
  if (hashIndex !== -1) clean = clean.slice(0, hashIndex);

  try {
    clean = decodeURIComponent(clean);
  } catch {
    // 忽略解码错误
  }

  if (/^(https?:|data:|blob:)/i.test(clean)) {
    return { isRemote: true, target: clean };
  }

  if (clean.startsWith('file:///')) {
    clean = clean.slice(8);
  } else if (clean.startsWith('file://')) {
    clean = clean.slice(7);
  }

  if (/^\/[a-zA-Z]:/.test(clean)) {
    clean = clean.slice(1);
  }

  const isAbsolute =
    /^[a-zA-Z]:[/\\]/.test(clean) || clean.startsWith('/') || clean.startsWith('\\');
  if (!isAbsolute && cwd) {
    const sep = cwd.includes('\\') ? '\\' : '/';
    const trimmedCwd = cwd.replace(/[/\\]+$/, '');
    const trimmedRelative = clean.replace(/^[/\\]+/, '');
    clean = `${trimmedCwd}${sep}${trimmedRelative}`;
  }

  return { isRemote: false, target: clean };
}

interface MarkdownContextValue {
  cwd?: string | null;
  onPreviewImage?: (url: string) => void;
}

const MarkdownContext = createContext<MarkdownContextValue>({});

const localImageCache = new Map<string, string>();

function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  const { cwd, onPreviewImage } = useContext(MarkdownContext);
  const resolved = useMemo(() => resolveImageTarget(src, cwd), [src, cwd]);
  const cachedDataUrl =
    resolved && !resolved.isRemote ? localImageCache.get(resolved.target) : null;

  const [displaySrc, setDisplaySrc] = useState<string | null>(
    () => (resolved?.isRemote ? resolved.target : cachedDataUrl ?? null),
  );
  const [loading, setLoading] = useState<boolean>(
    () => !resolved?.isRemote && !!resolved?.target && !cachedDataUrl,
  );
  const [failed, setFailed] = useState<boolean>(!resolved?.target);

  useEffect(() => {
    if (!resolved?.target) {
      setFailed(true);
      setLoading(false);
      return;
    }
    if (resolved.isRemote) {
      setDisplaySrc(resolved.target);
      setLoading(false);
      setFailed(false);
      return;
    }

    const hit = localImageCache.get(resolved.target);
    if (hit) {
      setDisplaySrc(hit);
      setLoading(false);
      setFailed(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setFailed(false);

    window.qingwu
      ?.readLocalImage?.(resolved.target)
      .then((res) => {
        if (cancelled) return;
        if (res?.dataUrl) {
          localImageCache.set(resolved.target, res.dataUrl);
          setDisplaySrc(res.dataUrl);
          setLoading(false);
        } else {
          setFailed(true);
          setLoading(false);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [resolved]);

  if (failed) {
    const rawTarget = resolved?.target || src || '';
    return (
      <span className="native-md-image-fallback" title={rawTarget}>
        <svg
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
        <span className="native-md-image-fallback-text">{alt || rawTarget}</span>
        {rawTarget && window.qingwu?.showItemInFolder && (
          <button
            type="button"
            className="native-md-image-fallback-btn"
            onClick={(e) => {
              e.preventDefault();
              void window.qingwu?.showItemInFolder?.(rawTarget);
            }}
            title="在文件夹中定位"
          >
            定位
          </button>
        )}
      </span>
    );
  }

  if (loading || !displaySrc) {
    return (
      <span className="native-md-image-loading">
        <span className="native-spinner" />
        <span>加载图片中…</span>
      </span>
    );
  }

  const handleClick = () => {
    onPreviewImage?.(displaySrc);
  };

  return (
    <figure className="native-md-image-wrap">
      <button
        type="button"
        className="native-md-image-btn"
        onClick={handleClick}
        title={alt ? `${alt}（点击放大）` : '点击查看大图'}
      >
        <img
          src={displaySrc}
          alt={alt ?? ''}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      </button>
      {alt && <figcaption className="native-md-image-caption">{alt}</figcaption>}
    </figure>
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
  img: ({ src, alt }) => (
    <MarkdownImage
      src={typeof src === 'string' ? src : undefined}
      alt={typeof alt === 'string' ? alt : undefined}
    />
  ),
};

export interface MarkdownProps {
  text: string;
  cwd?: string | null;
  onPreviewImage?: (url: string) => void;
}

function safeUrlTransform(url: string): string {
  if (!url) return '';
  const trimmed = url.trim();
  // 阻止危险脚本协议，放行 http/https/data/blob/file/以及本地绝对路径与相对路径
  if (/^(javascript|vbscript):/i.test(trimmed)) {
    return '';
  }
  return url;
}

export const Markdown = memo(function Markdown({
  text,
  cwd,
  onPreviewImage,
}: MarkdownProps) {
  const contextValue = useMemo(
    () => ({ cwd, onPreviewImage }),
    [cwd, onPreviewImage],
  );

  return (
    <MarkdownContext.Provider value={contextValue}>
      <div className="native-md">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={mdComponents}
          urlTransform={safeUrlTransform}
        >
          {text}
        </ReactMarkdown>
      </div>
    </MarkdownContext.Provider>
  );
});
