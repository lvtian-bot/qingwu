import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { CHAT_WIDTHS, type AppSettings, type ChatWidth } from '../shared/types';

export type { AppSettings };

type SettingsListener = (
  key: keyof AppSettings,
  value: AppSettings[keyof AppSettings],
  all: AppSettings
) => void;

class SettingsManager {
  private configPath: string | null = null;
  private settings: AppSettings;
  private listeners = new Set<SettingsListener>();
  private loaded = false;

  constructor() {
    this.settings = {
      closeToTray: true,
      collapseProcess: false,
      chatWidth: 'narrow',
      notifyOnTaskFinished: true,
    };
    this.listeners = new Set();
    this.loaded = false;
  }

  /** 惰性求值：等 paths.ts 完成 userData 重定向后再取目录。 */
  private getConfigPath(): string {
    if (!this.configPath) {
      this.configPath = path.join(app.getPath('userData'), 'settings.json');
    }
    return this.configPath;
  }

  load() {
    if (this.loaded) return;
    const configPath = this.getConfigPath();
    try {
      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, 'utf-8');
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          this.settings = { ...this.settings, ...(parsed as Partial<AppSettings>) };
          if (!CHAT_WIDTHS.includes(this.settings.chatWidth as ChatWidth)) {
            this.settings.chatWidth = 'narrow';
          }
          if (typeof this.settings.notifyOnTaskFinished !== 'boolean') {
            this.settings.notifyOnTaskFinished = true;
          }
        }
      }
    } catch (err) {
      console.error('[Settings] 读取配置失败:', err);
    } finally {
      this.loaded = true;
    }
  }

  save() {
    try {
      const configPath = this.getConfigPath();
      const dir = path.dirname(configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(configPath, JSON.stringify(this.settings, null, 2), 'utf-8');
    } catch (err) {
      console.error('[Settings] 保存配置失败:', err);
    }
  }

  getAll(): AppSettings {
    this.load();
    return { ...this.settings };
  }

  get<K extends keyof AppSettings>(key: K): AppSettings[K] {
    this.load();
    return this.settings[key];
  }

  update(patch: Partial<AppSettings>): AppSettings {
    this.load();
    let changed = false;
    for (const [k, v] of Object.entries(patch)) {
      const key = k as keyof AppSettings;
      if (this.settings[key] !== v && v !== undefined) {
        (this.settings as unknown as Record<string, unknown>)[key] = v;
        changed = true;
        for (const listener of this.listeners) {
          try {
            listener(key, v, this.settings);
          } catch (err) {
            console.error('[Settings] 触发配置变更回调异常:', err);
          }
        }
      }
    }
    if (changed) {
      this.save();
    }
    return { ...this.settings };
  }

  set<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    this.load();
    if (this.settings[key] === value) return;
    this.settings[key] = value;
    this.save();
    for (const listener of this.listeners) {
      try {
        listener(key, value, this.settings);
      } catch (err) {
        console.error('[Settings] 触发配置变更回调异常:', err);
      }
    }
  }

  onChange(listener: SettingsListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const settings = new SettingsManager();
