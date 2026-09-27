import type { tools as zhTools } from "../zh-CN/tools";

export const tools: typeof zhTools = {
  status: {
    running: "Running",
    failed: "Failed",
    done: "Done",
  },
  cards: {
    runCommand: "Run command",
    read: "Read",
    readImage: "Read image",
    search: "Search",
    match: "Match",
    edit: "Edit",
    write: "Write",
    deliverable: "Deliverable",
    webSearch: "Web search",
    webFetch: "Web fetch",
    updateTodo: "Update task list",
    readRange: {
      fromLine: "from line {offset}",
      starting: ", ",
      takeLines: "take {limit} lines",
    },
  },
  diff: {
    moreLines: {
      one: "… 1 more line not shown",
      other: "… {count} more lines not shown",
    },
  },
  todo: {
    title: "Tasks",
    items: {
      one: "{count} item",
      other: "{count} items",
    },
    done: "{count} done",
    inProgress: "{count} in progress",
    progress: {
      done: "{count} completed",
      active: "{count} in progress",
      pending: "{count} pending",
    },
  },
  deliverables: {
    collapse: "Collapse deliverables",
    expand: {
      one: "Show all deliverables ({count} item)",
      other: "Show all deliverables ({count} items)",
    },
    open: "Open",
    opened: "Opened",
    reveal: "Reveal",
    revealed: "Revealed",
    openTooltip: "Open with the system default app",
    revealTooltip: "Reveal in File Explorer",
  },
};
