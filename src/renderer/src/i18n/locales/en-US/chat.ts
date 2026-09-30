import type { chat as zhChat } from "../zh-CN/chat";

export const chat: typeof zhChat = {
  composer: {
    placeholder: "What should we work on?",
    newSessionPermissionHint: "Default permission for new sessions",
  },
  panel: {
    open: "Open panel",
  },
  workspace: {
    ungrouped: "Ungrouped",
    select: "Select workspace",
  },
  history: {
    loading: "Loading session history…",
    loadingMore: "Loading…",
    loadEarlier: "Load earlier",
  },
  scroll: {
    toBottom: "Back to bottom",
    toBottomGenerating: "Back to bottom (generating…)",
  },
  errors: {
    executeDisconnected:
      "Engine connection lost. Unable to run the command. Wait for reconnection or click retry.",
    sendDisconnected:
      "Engine connection lost. Unable to send the message. Wait for reconnection or click retry.",
    commandNoAttachments: "/{name} does not accept attachments. Remove them first.",
    eventStreamNotReady: "The engine event stream is not ready yet. Try again later.",
    approvalSubmitFailed: "Failed to submit the approval: {message}",
    answerSubmitFailed: "Failed to submit the answer: {message}",
    dismissFailed: "Failed to cancel: {message}",
    streamOpenFailed: "Failed to open the {endpoint} stream: {message}",
    loadHistoryFailed: "Failed to load session history: {message}",
    streamEnded:
      "The session data connection has ended. Reopen the session and try again.",
    clickToClose: " (click to dismiss)",
  },
  notify: {
    title: "Task completed",
    body: "'{title}' has finished running",
  },
  turns: {
    thought: "Thought",
    interrupted: " (interrupted)",
    toolCalls: { one: "{count} tool call", other: "{count} tool calls" },
    messages: { one: "{count} message", other: "{count} messages" },
    time: {
      monthDay: "{month}/{day}",
      withYear: "{monthDay}/{year}",
    },
  },
  metrics: {
    usage: "Usage",
    duration: "Time",
    detailsTitle: "View usage and timing details",
    modelRoute: "Model route",
    routeJoin: "; ",
    turnDuration: "Turn time",
    firstTokenLatency: "Time to first token",
    outputSpeed: "Output speed",
    cacheHitRate: "Cache hit rate",
    tokenBreakdown: "Token breakdown",
    uncachedInput: "Uncached input",
    cacheRead: "Cache read",
    cacheWrite: "Cache write",
    output: "Output",
    inclReasoning: " (incl. reasoning {count})",
    total: "Total",
  },
  actions: {
    copyReply: "Copy reply",
    copyMessage: "Copy message",
    copied: "Copied",
    forkTitle: "Fork a new session from this reply",
  },
  strip: {
    working: "Working",
    elapsedSeconds: "{count}s",
    elapsedMinutes: "{count}m {seconds}s",
    elapsedHours: "{hours}h {minutes}m {seconds}s",
  },
  queue: {
    attachmentAlt: "Queued attachment",
    sending: "Sending",
    steering: "Steering",
    queued: "Queued",
    editPlaceholder: "Edit message text",
    noText: "(no text)",
    sendingStatus: " (sending…)",
    steeringStatus: " (steering)",
    saveTitle: "Save queued message (Enter)",
    save: "Save queued message",
    cancelEditTitle: "Cancel editing (Esc)",
    cancelEdit: "Cancel editing",
    edit: "Edit queued message",
    remove: "Delete queued message",
    sendNow: "Send now",
    sendNowTitle:
      "Send now (interrupts the current turn and runs this immediately)",
  },
  reasoning: {
    thinking: "Thinking",
  },
  context: {
    used: "Context used",
    usedPercent: "Context used: {percent}%",
    systemPrompt: "System prompt",
    toolDefinitions: "Tool definitions",
    messages: "Conversation messages",
  },
  connection: {
    disconnected:
      "Connection to the DeepSeek Harness engine lost. Reconnecting…",
    reconnecting: "Reconnecting…",
    retry: "Retry now",
  },
  markdown: {
    code: {
      copy: "Copy",
      copied: "Copied",
      copyTitle: "Copy code",
      copiedTitle: "Copied",
    },
    image: {
      loading: "Loading image…",
      locate: "Reveal",
      locateTitle: "Show in folder",
      clickToZoom: "{alt} (click to zoom)",
      viewLarge: "Click to view full size",
    },
  },
  images: {
    loadFailed: "Failed to load image",
    loadingTitle: "Loading image...",
    viewOriginal: "Click to view original",
    lightbox: {
      alt: "Image preview",
      closeTitle: "Close (Esc)",
      close: "Close preview",
    },
  },
};
