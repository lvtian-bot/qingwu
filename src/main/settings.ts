import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

export interface AppSettings {
  closeToTray: boolean;
}

type SettingsListener = (
  key: keyof AppSettings,
  value: AppSettings[keyof AppSettings],
  all: AppSettings
) => void;

class SettingsManager {
  private configPath: string;
  private settings: AppSettings;
  private listeners = new Set<SettingsListener>();
  private loaded = false;

  constructor() {
    this.configPath = path.join(app.getPath('userData'), 'settings.json');
    this.settings = {
      closeToTray: true,
    };
    this.listeners = new Set();
    this.loaded = false;
  }

  load() {
    if (this.loaded) return;
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf-8');
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          this.settings = { ...this.settings, ...(parsed as Partial<AppSettings>) };
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
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.configPath, JSON.stringify(this.settings, null, 2), 'utf-8');
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
