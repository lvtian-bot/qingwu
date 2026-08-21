import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

class SettingsManager {
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
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          this.settings = { ...this.settings, ...parsed };
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

  get(key) {
    this.load();
    return this.settings[key];
  }

  set(key, value) {
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

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const settings = new SettingsManager();
