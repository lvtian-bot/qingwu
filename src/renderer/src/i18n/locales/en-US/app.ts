import type { app as zhApp } from "../zh-CN/app";

export const app: typeof zhApp = {
  errorTitle: "Something went wrong",
  errorHint:
    "The error details have been written to the app log. Reloading usually restores this window; if it keeps happening, keep the timestamp to help with further troubleshooting.",
  reload: "Reload UI",
  rpc: {
    invalidResult: "{endpoint} returned an invalid result",
    failed: "{endpoint} failed: {detail}",
  },
  update: {
    devModeTitle: "Development Mode",
    devModeDesc:
      "You are in development mode. In-app updates only work in packaged Windows builds. Check the releases page for the latest version.",
    openReleases: "Open Releases Page",
    checkingTitle: "Checking for Updates",
    checkingDesc: "Connecting to the server for the latest version info…",
    latestTitle: "Up to Date",
    latestDesc: "Qingwu v{version} is already up to date.",
    close: "Close",
    availableTitle: "New Version v{version} Available",
    availableDesc: "Latest version v{latest}, current version v{current}.",
    remindLater: "Remind Me Later",
    download: "Download Update",
    downloadingTitle: "Downloading v{version}",
    readyTitle: "Update Ready",
    readyDesc: "v{version} downloaded. Restart the app to install it.",
    installLater: "Install Later",
    restartAndInstall: "Restart and Install",
    errorTitle: "Update Problem",
    errorDesc: "Could not get version info. Please try again later.",
    retry: "Retry",
    footer: "Qingwu v{version}",
  },
};
