/**
 * 聊天输入框包装：Composer + 上下文占用环 + 模型/权限选择器的固定组合。
 * 空态问候页与底部停靠输入框共用一份装配，两处仅在弹出方位与插话手势上有差异。
 */
import type { RefObject } from "react";
import { Composer } from "./Composer";
import { ComposerControls } from "./ComposerControls";
import { ContextMeter } from "./ContextMeter";
import type { FileReferenceCandidate } from "./file-mentions";
import type { DraftImage } from "./images";
import type {
  ContextBreakdownProjection,
  ContextPressureProjection,
  ModelCatalog,
  ModelSelection,
  PermissionSelect,
} from "./protocol";
import type { SlashCommandItem } from "./slash-commands";

interface ChatComposerProps {
  /** 弹出菜单展示方位：问候页居中卡片向下展开，底部停靠输入框向上浮出。 */
  menuPlacement: "top" | "bottom";
  input: string;
  onInputChange: (value: string) => void;
  onSend: (options?: { mode?: "queue" | "steer" }) => void;
  running: boolean;
  onStop: () => void;
  /** 是否允许快捷批量插话发送全部排队消息（运行中且有排队项）。 */
  canSteerQueue?: boolean;
  onSteerQueue?: () => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  draftImages: DraftImage[];
  onRemoveDraftImage: (id: string) => void;
  onAddImages: (files: File[]) => void;
  onPreviewImage: (url: string) => void;
  commands: SlashCommandItem[];
  onExecuteCommand: (line: string, options?: { preserveInput?: boolean }) => void;
  onQueryFileReferences: (
    query: string,
    signal: AbortSignal,
  ) => Promise<FileReferenceCandidate[]>;
  /** 上下文占用环数据（引擎未报采样时环自身不渲染）。 */
  contextPressure?: ContextPressureProjection;
  contextBreakdown?: ContextBreakdownProjection;
  catalog: ModelCatalog | null;
  selection: ModelSelection | null;
  permission: PermissionSelect | null;
  /** 权限控件标题补充（空态标明「新会话默认权限」）。 */
  permissionHint?: string;
  onModelPick: (selection: ModelSelection) => void;
  onEffortPick: (effortId: string | undefined) => void;
  onPermissionPick: (value: string) => void;
}

export function ChatComposer({
  menuPlacement,
  input,
  onInputChange,
  onSend,
  running,
  onStop,
  canSteerQueue,
  onSteerQueue,
  textareaRef,
  draftImages,
  onRemoveDraftImage,
  onAddImages,
  onPreviewImage,
  commands,
  onExecuteCommand,
  onQueryFileReferences,
  contextPressure,
  contextBreakdown,
  catalog,
  selection,
  permission,
  permissionHint,
  onModelPick,
  onEffortPick,
  onPermissionPick,
}: ChatComposerProps) {
  return (
    <Composer
      menuPlacement={menuPlacement}
      input={input}
      onInputChange={onInputChange}
      onSend={onSend}
      canSteerQueue={canSteerQueue}
      onSteerQueue={onSteerQueue}
      running={running}
      onStop={onStop}
      textareaRef={textareaRef}
      draftImages={draftImages}
      onRemoveDraftImage={onRemoveDraftImage}
      onAddImages={onAddImages}
      onPreviewImage={onPreviewImage}
      commands={commands}
      onExecuteCommand={onExecuteCommand}
      onQueryFileReferences={onQueryFileReferences}
      meter={
        <ContextMeter pressure={contextPressure} breakdown={contextBreakdown} />
      }
      controls={
        <ComposerControls
          catalog={catalog}
          selection={selection}
          permission={permission}
          permissionHint={permissionHint}
          onModelPick={onModelPick}
          onEffortPick={onEffortPick}
          onPermissionPick={onPermissionPick}
        />
      }
    />
  );
}
