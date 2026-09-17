import { StringDecoder } from "node:string_decoder";
import fs from "node:fs";
import path from "node:path";

/** 日志和错误提示仅保留定位信息，鉴权地址中的凭据不进入输出。 */
export function redactSecrets(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value);
  return text.replace(
    /([?&](?:token|access_token|api_key|key|secret)=)[^\s&#"'<>]*/gi,
    "$1[REDACTED]",
  );
}

/** 单个日志文件上限 2MB，超出后滚动为 app.old.log。 */
const MAX_LOG_SIZE_BYTES = 2 * 1024 * 1024;

function formatTimestamp(): string {
  const d = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

let fileLoggingInitialized = false;

/**
 * 启用主进程脱敏日志落盘。
 * 劫持 console.log / info / warn / error，以格式化时间戳追加至 logs/app.log。
 */
export function setupFileLogging(logDirectory: string): void {
  if (fileLoggingInitialized) return;
  fileLoggingInitialized = true;

  try {
    fs.mkdirSync(logDirectory, { recursive: true });
  } catch {
    return;
  }

  const logFile = path.join(logDirectory, "app.log");
  const oldLogFile = path.join(logDirectory, "app.old.log");

  const rotateIfNeeded = () => {
    try {
      if (fs.existsSync(logFile)) {
        const stat = fs.statSync(logFile);
        if (stat.size >= MAX_LOG_SIZE_BYTES) {
          if (fs.existsSync(oldLogFile)) {
            fs.unlinkSync(oldLogFile);
          }
          fs.renameSync(logFile, oldLogFile);
        }
      }
    } catch {
      // 忽略日志滚动失败
    }
  };

  const writeToFile = (level: string, message: string) => {
    try {
      rotateIfNeeded();
      const line = `[${formatTimestamp()}] [${level}] ${message}\n`;
      fs.appendFileSync(logFile, line, "utf8");
    } catch {
      // 保证写入日志失败不中断主业务
    }
  };

  const origLog = console.log.bind(console);
  const origInfo = console.info.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);

  const formatArgs = (args: unknown[]): string => {
    return args
      .map((arg) => {
        if (arg instanceof Error) {
          return arg.stack ? redactSecrets(arg.stack) : redactSecrets(arg.message);
        }
        if (typeof arg === "object" && arg !== null) {
          try {
            return redactSecrets(JSON.stringify(arg));
          } catch {
            return redactSecrets(String(arg));
          }
        }
        return redactSecrets(String(arg));
      })
      .join(" ");
  };

  console.log = (...args: unknown[]) => {
    origLog(...args);
    writeToFile("INFO", formatArgs(args));
  };
  console.info = (...args: unknown[]) => {
    origInfo(...args);
    writeToFile("INFO", formatArgs(args));
  };
  console.warn = (...args: unknown[]) => {
    origWarn(...args);
    writeToFile("WARN", formatArgs(args));
  };
  console.error = (...args: unknown[]) => {
    origError(...args);
    writeToFile("ERROR", formatArgs(args));
  };

  console.log(`[Logging] 文件日志已启用: ${logFile}`);
}

/** stdout/stderr 的 chunk 不是行边界；先拼完整行，再解析和脱敏。 */
export function createLineReader(onLine: (line: string) => void): {
  write: (chunk: Buffer | string) => void;
  end: () => void;
} {
  const decoder = new StringDecoder("utf8");
  let pending = "";
  let discarding = false;
  const consume = (text: string) => {
    pending += text;
    let end: number;
    while ((end = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, end).replace(/\r$/, "");
      pending = pending.slice(end + 1);
      if (!discarding) onLine(line);
      discarding = false;
    }
    // 异常超长日志不无限占用内存，也不输出被截断的凭据后半段。
    if (pending.length > 64 * 1024) {
      pending = "";
      discarding = true;
    }
  };
  return {
    write: (chunk) =>
      consume(typeof chunk === "string" ? chunk : decoder.write(chunk)),
    end: () => {
      consume(decoder.end());
      if (pending && !discarding) onLine(pending.replace(/\r$/, ""));
      pending = "";
    },
  };
}
