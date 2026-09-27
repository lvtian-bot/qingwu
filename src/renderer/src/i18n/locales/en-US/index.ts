import { app } from "./app";
import { chat } from "./chat";
import { composer } from "./composer";
import { menu } from "./menu";
import { panel } from "./panel";
import { pending } from "./pending";
import { settings } from "./settings";
import { sidebar } from "./sidebar";
import { tools } from "./tools";

import zhDict from "../zh-CN";

/** 英文词条：与中文词典同构，缺词条/多词条由 typecheck 报错。 */
export default { app, chat, composer, menu, panel, pending, settings, sidebar, tools } satisfies typeof zhDict;
