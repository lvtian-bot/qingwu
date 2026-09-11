import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import type { UiMode } from '../shared/types';

export interface AppSettings {
  closeToTray: boolean;
  /** 界面模式：official = 官方 dsh web UI（默认），native = 自研界面。 */
  uiMode: UiMode;
}

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
      uiMode: 'official',
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
          if (this.settings.uiMode !== 'official' && this.settings.uiMode !== 'native') {
            this.settings.uiMode = 'official';
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

  get<K extends keyof AppSettings>(key: K): AppSettings[K] {
    this.load();
    return this.settings[key];
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
