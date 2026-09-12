import { useState } from "react";
import { createRoot } from "react-dom/client";
import { UpdateWindow } from "./UpdateWindow";
import { TitleBar } from "./TitleBar";
import { NativeApp } from "./native/NativeApp";
import "./update.css";

const params = new URLSearchParams(window.location.search);
const view = params.get("view") || window.location.hash.replace(/^#/, "");
const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("未找到 #root 挂载节点");
}

if (view === "update") {
  createRoot(rootElement).render(<UpdateWindow />);
} else {
  /** 侧栏折叠态提到入口层：开关按钮在标题栏（对齐 ChatGPT 桌面版），状态由标题栏与侧栏共用。 */
  function MainWindow() {
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    return (
      <>
        <TitleBar
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
        />
        <NativeApp sidebarCollapsed={sidebarCollapsed} />
      </>
    );
  }
  createRoot(rootElement).render(<MainWindow />);
}
