import { useCallback, useEffect, useState } from "react";
import type { AppSettings } from "../../../shared/types";
import { SettingsRow, SettingsSwitch } from "./settings-ui";
import type { DshSettingsController } from "./useDshSettings";

/** 常规分区：青梧应用级设置（界面、窗口与配置文件入口）。 */
export function GeneralTab({ dsh }: { dsh: DshSettingsController }) {
  const [appSettings, setAppSettings] = useState<AppSettings>({
    closeToTray: true,
    collapseProcess: false,
    chatWidth: "narrow",
  });

  // 读取本地应用设置
  const loadAppSettings = useCallback(async () => {
    try {
      if (window.qingwu?.getAppSettings) {
        const res = await window.qingwu.getAppSettings();
        if (res) setAppSettings(res);
      }
    } catch (e) {
      console.error("[SettingsPage] 读取应用设置失败", e);
    }
  }, []);

  useEffect(() => {
    void loadAppSettings();
  }, [loadAppSettings]);

  // 更新本地应用设置
  const handleUpdateAppSetting = async (patch: Partial<AppSettings>) => {
    try {
      if (window.qingwu?.setAppSettings) {
        const next = await window.qingwu.setAppSettings(patch);
        setAppSettings(next);
      } else {
        setAppSettings((prev) => ({ ...prev, ...patch }));
      }
    } catch (e) {
      console.error("[SettingsPage] 保存应用设置失败", e);
    }
  };

  // 打开青梧本地数据目录
  const handleOpenAppData = async () => {
    if (window.qingwu?.openUserDataFolder) {
      await window.qingwu.openUserDataFolder();
    }
  };

  return (
    <>
      <div className="native-settings-panel-header">
        <h2>常规</h2>
        <p>界面、窗口与配置文件入口等基础选项。</p>
      </div>

      <div className="native-settings-card">
        <SettingsRow
          label="界面语言"
          desc="当前桌面客户端与底层引擎的界面语言。"
        >
          <select className="native-settings-select" defaultValue="zh" disabled>
            <option value="zh">简体中文</option>
            <option value="en">English (跟随系统)</option>
          </select>
        </SettingsRow>

        <SettingsRow
          label="聊天区宽度"
          desc="对话正文与会话输入框的最大列宽，首页输入框固定紧凑档；默认紧凑。"
        >
          <select
            className="native-settings-select"
            value={appSettings.chatWidth ?? "narrow"}
            onChange={(e) =>
              void handleUpdateAppSetting({
                chatWidth: e.target.value as AppSettings["chatWidth"],
              })
            }
          >
            <option value="narrow">紧凑</option>
            <option value="medium">适中</option>
            <option value="wide">宽敞</option>
          </select>
        </SettingsRow>

        <SettingsRow
          label="最小化到系统托盘"
          desc="关闭窗口后应用常驻系统托盘，后台会话不中断；关闭后点击关闭按钮将直接退出青梧。"
        >
          <SettingsSwitch
            checked={appSettings.closeToTray}
            onChange={(next) =>
              void handleUpdateAppSetting({ closeToTray: next })
            }
            label="最小化到系统托盘"
          />
        </SettingsRow>

        <SettingsRow
          label="折叠执行过程与工具调用"
          desc="对话回合完成后，将思考过程与工具调用收起为单行摘要；默认关闭，平铺展开。"
        >
          <SettingsSwitch
            checked={Boolean(appSettings.collapseProcess)}
            onChange={(next) =>
              void handleUpdateAppSetting({ collapseProcess: next })
            }
            label="折叠执行过程与工具调用"
          />
        </SettingsRow>

        <SettingsRow
          label="任务完成时发送桌面通知"
          desc="当青梧在后台运行且任务执行结束时，弹出系统桌面通知；点击通知可快速回到对应会话。"
        >
          <SettingsSwitch
            checked={appSettings.notifyOnTaskFinished ?? true}
            onChange={(next) =>
              void handleUpdateAppSetting({ notifyOnTaskFinished: next })
            }
            label="任务完成时发送桌面通知"
          />
        </SettingsRow>

        <SettingsRow
          label="青梧应用数据目录"
          desc="存放桌面窗口状态、应用配置与运行日志的本地目录 (%APPDATA%/qingwu)。"
        >
          <button
            type="button"
            className="native-btn native-btn-secondary"
            onClick={handleOpenAppData}
          >
            在文件管理器中打开
          </button>
        </SettingsRow>

        <SettingsRow
          label="底层引擎配置文件"
          desc="DSH 引擎的全局配置文件 (~/.dsh/settings.json)，包含所有已注册的扩展参数。"
        >
          <button
            type="button"
            className="native-btn native-btn-secondary"
            onClick={() => void dsh.openDshConfig()}
          >
            在编辑器中打开
          </button>
        </SettingsRow>
      </div>
    </>
  );
}
