/**
 * 聊天区滚动管理：贴底跟随、切换会话初次沉底、「加载更早」前插锚定
 * 与「回到底部」悬浮按钮，全部围绕同一个滚动容器自闭环。
 *
 * 拆成两段调用：控制器（refs/回调/复位）不依赖视图数据，可先建再把复位回调
 * 交给引擎流 hook；跟随 effects 需要对话视图状态，在数据源之后绑定。
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { QueuedItem, TurnView } from "./events";
import type { PendingApproval, PendingQuestion } from "./PendingInteraction";

/** 滚动控制器：refs、事件回调、会话切换复位与前插锚点记录。 */
export function useChatScroll() {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickBottomRef = useRef(true);
  /** 切换会话标志：新会话快照上屏初次沉底前置为 true，屏蔽高度剧变引发的 onScroll 误关贴底。 */
  const initialScrollNeededRef = useRef(false);
  /** 平滑滚动至底部进行中：忽略中间帧触发的 onScroll，避免平滑滚动途中误判定为脱离底部。 */
  const scrollingToBottomRef = useRef(false);
  /** 视口脱离底部指示：控制「回到底部」悬浮按钮的显隐。 */
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  /** 「加载更早」前插后的视口锚定：记下前插前的滚动几何，DOM 提交后按高度差复位。 */
  const restoreScrollRef = useRef<{ height: number; top: number } | null>(null);

  /** 滚动到底部：重置贴底锁定状态并隐藏悬浮按钮，支持平滑或瞬间沉底。 */
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    stickBottomRef.current = true;
    setShowScrollToBottom(false);
    scrollingToBottomRef.current = behavior === "smooth";
    const el = scrollRef.current;
    if (el) {
      if (behavior === "smooth") {
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      } else {
        el.scrollTop = el.scrollHeight;
      }
    }
  }, []);

  // 滚轮事件：用户手动滑动滚轮时，立即解除程序化平滑滚动锁定，恢复用户自主控制
  const handleWheel = useCallback(() => {
    scrollingToBottomRef.current = false;
  }, []);

  // 自动滚动：仅当用户位于底部附近时贴底跟随；会话切换初次沉底与程序化滚动期间忽略，避免误判关闭贴底
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || initialScrollNeededRef.current) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceToBottom < 80;

    if (scrollingToBottomRef.current) {
      if (atBottom) {
        scrollingToBottomRef.current = false;
      }
      return;
    }

    stickBottomRef.current = atBottom;
    setShowScrollToBottom(!atBottom && el.scrollHeight > el.clientHeight + 100);
  }, []);

  /** 切换会话：重置贴底锁定并标记需要初次沉底（新会话快照上屏时无条件拉至最新）。 */
  const resetForSessionSwitch = useCallback(() => {
    restoreScrollRef.current = null;
    stickBottomRef.current = true;
    initialScrollNeededRef.current = true;
    scrollingToBottomRef.current = false;
    setShowScrollToBottom(false);
  }, []);

  /** 「加载更早」翻页前记录视口锚点：前插旧内容后按高度差复位，用户看到的那条消息保持原地。 */
  const capturePrependAnchor = useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      restoreScrollRef.current = { height: el.scrollHeight, top: el.scrollTop };
    }
  }, []);

  return {
    scrollRef,
    stickBottomRef,
    initialScrollNeededRef,
    restoreScrollRef,
    scrollToBottom,
    handleWheel,
    handleScroll,
    showScrollToBottom,
    resetForSessionSwitch,
    capturePrependAnchor,
  };
}

/** 滚动管理控制器类型（含跟随 effects 需要读写的内部 refs）。 */
export type ChatScrollController = ReturnType<typeof useChatScroll>;

/** 视图内容签名：这些变化会改变内容高度，需要跟随或复核贴底。 */
interface ChatScrollView {
  items: TurnView[];
  echoes: QueuedItem[];
  queue: QueuedItem[];
  draft: string;
  liveReasoning: string;
  toolCalling: boolean;
  approvals: PendingApproval[];
  questions: PendingQuestion[];
  loadingHistory: boolean;
}

/** 绑定滚动跟随 effects：内容变化时的贴底跟随、初次沉底与前插锚定复位。 */
export function useChatScrollFollow(
  scroll: ChatScrollController,
  view: ChatScrollView,
) {
  const {
    items,
    echoes,
    queue,
    draft,
    liveReasoning,
    toolCalling,
    approvals,
    questions,
    loadingHistory,
  } = view;
  const {
    scrollRef,
    stickBottomRef,
    initialScrollNeededRef,
    restoreScrollRef,
  } = scroll;

  // 「加载更早」前插旧内容后按高度差复位视口：用户看到的那条消息保持原地，不跳屏
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const anchor = restoreScrollRef.current;
    if (!el || !anchor) return;
    restoreScrollRef.current = null;
    el.scrollTop = anchor.top + (el.scrollHeight - anchor.height);
  }, [items, scrollRef, restoreScrollRef]);

  // 切换会话快照载入后初次沉底：无条件拉至最新消息，并在下一帧复核校准，避开图片/代码块首次渲染撑高时停在顶部
  useLayoutEffect(() => {
    if (!initialScrollNeededRef.current || loadingHistory) return;
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
    const rafId = requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
      initialScrollNeededRef.current = false;
    });
    return () => cancelAnimationFrame(rafId);
  }, [items, loadingHistory, scrollRef, initialScrollNeededRef]);

  // 贴底模式下的自动跟随：当会话内容（流式正文/思考/工具/回显等）变化时，持续保持视口贴底
  useLayoutEffect(() => {
    if (
      stickBottomRef.current &&
      !initialScrollNeededRef.current &&
      !restoreScrollRef.current
    ) {
      const el = scrollRef.current;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    }
  }, [
    items,
    echoes,
    queue,
    draft,
    liveReasoning,
    toolCalling,
    approvals,
    questions,
    scrollRef,
    stickBottomRef,
    initialScrollNeededRef,
    restoreScrollRef,
  ]);

  // 当新消息落库或回显上屏后，下一帧复核校准高度（防止 Markdown、代码高亮、折叠区高度异步撑开造成视口上移）
  useEffect(() => {
    if (
      stickBottomRef.current &&
      !initialScrollNeededRef.current &&
      !restoreScrollRef.current
    ) {
      const rafId = requestAnimationFrame(() => {
        if (stickBottomRef.current && scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      });
      return () => cancelAnimationFrame(rafId);
    }
  }, [
    items,
    echoes,
    scrollRef,
    stickBottomRef,
    initialScrollNeededRef,
    restoreScrollRef,
  ]);
}
