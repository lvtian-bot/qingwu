import type { composer as zhComposer } from "../zh-CN/composer";

export const composer: typeof zhComposer = {
  placeholder: "Ask anything",
  send: "Send",
  stopTitle: "Stop (press Esc twice)",
  queueSendTitle: "Queue message ({key}+Enter to send now)",
  steerQueueHint: "{key}+Enter to send all queued messages",

  addImage: "Add image",
  removeImage: "Remove image",
  previewImage: "Click to preview the image",
  imageReadFailed: "Failed to read image",
  unsupportedImageType:
    "Unsupported image format: {name}. Only PNG, JPEG, WebP, and GIF are supported.",
  imageTooLarge: "Image {name} exceeds the 20MB limit",
  tooManyImages: "Add up to {count} images per message",

  cancel: "Cancel",
  selectModel: "Select model",
  modelCatalogUnavailable: "Model catalog unavailable",
  reasoningEffort: "Reasoning effort",
  effortDefault: "Default",
  providerEffortTitle: "Use the provider's default reasoning behavior",

  fullAccessWarning:
    "Full access reduces confirmation steps: sensitive operations, file changes, and external commands run directly. Only use it when you trust the upcoming tasks.",
  enableFullAccess: "I understand, enable",
  permissionMode: "Permission mode",

  permission: {
    labels: {
      readOnly: "Read-only",
      workspaceWrite: "Workspace write",
      fullAccess: "Full access",
      custom: "Custom",
    },
    descriptions: {
      readOnly: "Safe read-only mode; file changes and writes are disabled.",
      workspaceWrite:
        "Only allows changes inside the workspace; anything outside requires approval.",
      fullAccess:
        "Removes read/write and command restrictions; no approval prompts.",
    },
  },

  effort: {
    labels: {
      off: "Off",
      minimal: "Minimal",
      low: "Low",
      medium: "Medium",
      high: "High",
      max: "Max",
    },
  },

  fileMenu: {
    ariaLabel: "File and folder references",
    header: "Files and folders",
    noMatch: "No files matching \"{query}\"",
    emptyWorkspace: "No files in the workspace yet",
    drillTitle: "Press Tab to enter this folder",
    move: "Move",
    reference: "Reference",
    drill: "Enter folder",
    close: "Close",
  },

  slash: {
    ariaLabel: "Slash commands and skills",
    noMatch: "No matching slash commands or skills",
    skillUserOnly: "User only · {desc}",
    sections: {
      add: "Common",
      commands: "Commands",
      skills: "Skills",
    },
    labels: {
      goal: "Goal",
      plan: "Plan",
      feedback: "Feedback",
      compact: "Compact",
      permission: "Permission",
      model: "Model",
      export: "Download logs",
    },
    descriptions: {
      goal: "Set or view long-term task goals",
      plan: "Enter or exit plan mode",
      feedback: "Send feedback about the current session",
      compact: "Compact the conversation above",
      permission:
        "Switch permission presets (sandbox mode and approval policy)",
      model: "Switch the model for this session or the default",
      export: "Export the current session as a ZIP",
    },
    hints: {
      goal: "Goal description",
    },
  },
};
