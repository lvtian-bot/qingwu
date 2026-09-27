import type { settings as zhSettings } from "../zh-CN/settings";

export const settings: typeof zhSettings = {
  page: {
    ariaLabel: "Settings",
    back: "Back to app",
    backTitle: "Back to app (Esc)",
    resizeHint: "Drag to resize, double-click to reset",
  },
  nav: {
    basic: "Basics",
    agent: "Agent capabilities",
    archived: "Archived",
    general: "General",
    models: "Model",
    permissions: "Permissions",
    archivedSessions: "Archived sessions",
  },
  connection: {
    lost: "Connection to the DeepSeek Harness engine was lost. Reconnecting…",
    retrying: "Reconnecting…",
    retry: "Retry now",
  },
  general: {
    title: "General",
    uiBadge: "(UI settings)",
    uiBadgeTitle: "Applies to Qingwu only and does not affect other DSH clients.",
    desc: "Basic options for the interface, window, and config files.",
    language: {
      label: "Language",
      desc: "UI language for the desktop client and the underlying engine.",
      auto: "Follow system",
    },
    chatWidth: {
      label: "Chat width",
      desc: "Maximum column width for conversation text and the session input box; the home input always uses the compact width. Compact by default.",
      narrow: "Compact",
      medium: "Medium",
      wide: "Wide",
    },
    closeToTray: {
      label: "Minimize to system tray",
      desc: "Keeps the app in the system tray after closing the window so background sessions continue; when turned off, clicking the close button quits Qingwu.",
    },
    collapseProcess: {
      label: "Collapse process and tool calls",
      desc: "After a conversation turn completes, collapse thinking and tool calls into a one-line summary; off by default, showing everything expanded.",
    },
    notifyOnTaskFinished: {
      label: "Send desktop notifications on task completion",
      desc: "Shows a system desktop notification when Qingwu runs in the background and a task finishes; click the notification to return to the session.",
    },
    appData: {
      label: "Qingwu app config folder",
      desc: "Local folder that stores UI settings, window state, and run logs (%APPDATA%/qingwu).",
      open: "Open in File Explorer",
    },
    dshConfig: {
      label: "Engine config file",
      desc: "The DSH engine's global config file (~/.dsh/settings.json) with all registered extension parameters.",
      open: "Open in editor",
    },
  },
  shared: {
    engineBadge: "(DSH engine settings)",
    engineBadgeTitle:
      "Stored in the DSH engine config folder (~/.dsh) and shared with the DSH desktop app and CLI; changes also affect those clients.",
    apiKey: "API key",
    apiProtocol: "API protocol",
    apiUrl: "API URL",
    modelCount: {
      one: "{count} model",
      other: "{count} models",
    },
    discover: "Fetch available models",
    discovering: "Fetching...",
    reasoning: "Reasoning",
  },
  models: {
    title: "Model",
    desc: "Manage API URLs, protocols, and keys for each provider.",
    refreshTitle: "Refresh providers and model catalog",
    picker: {
      title: "Select models to add ({selected} / {total})",
      close: "Close",
      searchPlaceholder: "Search model ID or name...",
      selectAll: "Select all",
      deselectAll: "Deselect all",
      empty: "No matching models",
    },
    addProvider: "Add provider",
    customBadge: "Custom",
    noProviders: "No providers added yet",
    exitAddFlow: "Exit add flow",
    addCustom: "Add custom provider",
    addCustomHint:
      "Works with OpenAI / Anthropic compatible endpoints, self-hosted gateways, or third-party APIs",
    allBuiltInAdded: "All built-in providers have been added. You can add a custom provider.",
    keyDetected: "Key detected",
    defaultModel: {
      label: "Default model for new sessions",
      desc: "New sessions without a specified model use this one; the choice is saved to engine settings and persists after reopening.",
      followEngine: "Follow engine default",
    },
  },
  permissions: {
    title: "Permissions",
    desc: "Default approval policy for running commands and editing files in new sessions.",
    defaultPreset: {
      label: "Default permission for new sessions",
      desc: "Determines the approval policy for running commands and editing files in new sessions.",
      workspaceWrite: "Workspace edits (recommended)",
      readOnly: "Read-only",
      fullAccess: "Full access",
    },
  },
  provider: {
    notAddedHint:
      "This provider hasn't been added yet; it will appear in the list on the left after saving.",
    apiKeySavedPlaceholder: "●●●●●●●● (key saved; enter a new value to replace it)",
    apiKeyPlaceholder: "Enter API key",
    apiKeyDesc:
      "Keys are stored securely in the engine's credential store and are never displayed.",
    apiUrlDefault: "Provider default",
    apiUrlDesc:
      "Enter an API URL compatible with the current connection settings; leave empty to use the official default.",
    protocolUnset: "Not set (default)",
    save: "Save",
    clearKey: "Clear key",
    deleteProvider: "Delete provider",
    catalog: "Model catalog",
    discoverTitle: "Fetch available models from the provider",
    discoverNeedUrlTitle: "Enter and save the API URL first",
    invalidApiUrl: "Enter a valid API URL first (HTTP/HTTPS URL)",
    emptyDeclared:
      "No models configured. Click \"Fetch available models\" or add them manually below.",
    emptyCatalog: "No model list retrieved for this provider",
    duplicateModelId: "Model ID \"{id}\" is already in the list",
  },
  custom: {
    title: "Add custom provider",
    backToList: "Back to list",
    desc: "Declares a user-configured LLM route; supports self-hosted gateways or OpenAI / Anthropic compatible endpoints.",
    route: {
      label: "Provider ID (Route)",
      placeholder: "e.g. one-api or my-gateway",
      invalid:
        "The provider ID must start with a lowercase letter and contain only lowercase letters, digits, and hyphens (-)",
      taken: "A provider with this ID already exists",
      desc: "Uniquely identifies the provider and addresses it in config and credentials; it cannot be changed after creation.",
    },
    displayName: {
      label: "Display name",
      placeholder: "e.g. My self-hosted gateway (optional)",
    },
    baseUrl: {
      label: "Base URL",
      placeholder: "e.g. https://api.openai-proxy.com/v1",
      invalid: "Enter a valid URL starting with http:// or https://",
    },
    apiKeyPlaceholder: "Enter API key (leave empty if not required)",
    modelsTitle: "Models",
    discoverTitle: "Fetch candidate models from the endpoint",
    discoverNeedUrlTitle: "Enter a valid endpoint URL first",
    invalidApiUrl: "Enter a valid endpoint URL first (HTTP/HTTPS URL)",
    empty:
      "No models added yet. Click \"Fetch available models\" to fetch them from the provider, or add them manually below.",
    saveAndAdd: "Save and add",
    cancel: "Cancel",
  },
  modelRow: {
    idPlaceholder: "Model ID (e.g. gpt-4o)",
    namePlaceholder: "Display name (optional)",
    add: "Add model",
    remove: "Remove this model",
  },
  keyToggle: {
    show: "Show key",
    hide: "Hide key",
  },
  messages: {
    credentialCleared: "Credential {ref} cleared",
    clearFailed: "Failed to clear: {message}",
    customAdded: "Custom provider \"{name}\" added",
    addFailed: "Failed to add: {message}",
    confirmDelete:
      "Delete provider \"{name}\"? Its configuration and credentials will be removed.",
    providerDeleted: "Provider {name} deleted",
    deleteFailed: "Failed to delete: {message}",
    providerSaved: "Provider {name} saved",
    saveFailed: "Failed to save: {message}",
    permissionUpdated: "Default permission updated",
    modelUpdated: "Default model updated",
    updateFailed: "Update failed: {message}",
    openConfigFailed: "Error opening config file: {message}",
    noCandidates:
      "The provider endpoint returned no candidate models. Enter them manually.",
    fetchFailed: "Fetch failed: {message}",
  },
  relative: {
    justNow: "Just now",
    minutesAgo: {
      one: "{count} minute ago",
      other: "{count} minutes ago",
    },
    hoursAgo: {
      one: "{count} hour ago",
      other: "{count} hours ago",
    },
    daysAgo: {
      one: "{count} day ago",
      other: "{count} days ago",
    },
    monthsAgo: {
      one: "{count} month ago",
      other: "{count} months ago",
    },
    yearsAgo: {
      one: "{count} year ago",
      other: "{count} years ago",
    },
  },
};
