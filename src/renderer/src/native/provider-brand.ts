import type { IconType } from "@lobehub/icons";
// 只导入用到的单件组件（Color=品牌彩标、Mono=单色标），品牌入口会连带打包
// Avatar/Text/Combine 等不会用到的变体
import Anthropic from "@lobehub/icons/es/Anthropic/components/Mono";
import AntGroup from "@lobehub/icons/es/AntGroup/components/Color";
import Azure from "@lobehub/icons/es/Azure/components/Color";
import Bedrock from "@lobehub/icons/es/Bedrock/components/Color";
import Cerebras from "@lobehub/icons/es/Cerebras/components/Color";
import Cloudflare from "@lobehub/icons/es/Cloudflare/components/Color";
import DeepSeek from "@lobehub/icons/es/DeepSeek/components/Color";
import Doubao from "@lobehub/icons/es/Doubao/components/Color";
import Fireworks from "@lobehub/icons/es/Fireworks/components/Color";
import Gemini from "@lobehub/icons/es/Gemini/components/Color";
import GithubCopilot from "@lobehub/icons/es/GithubCopilot/components/Mono";
import Groq from "@lobehub/icons/es/Groq/components/Mono";
import HuggingFace from "@lobehub/icons/es/HuggingFace/components/Color";
import Kimi from "@lobehub/icons/es/Kimi/components/Color";
import Minimax from "@lobehub/icons/es/Minimax/components/Color";
import Mistral from "@lobehub/icons/es/Mistral/components/Color";
import Moonshot from "@lobehub/icons/es/Moonshot/components/Mono";
import OpenAI from "@lobehub/icons/es/OpenAI/components/Mono";
import Qwen from "@lobehub/icons/es/Qwen/components/Color";
import VertexAI from "@lobehub/icons/es/VertexAI/components/Color";
import WorkersAI from "@lobehub/icons/es/WorkersAI/components/Color";
import XAI from "@lobehub/icons/es/XAI/components/Mono";
import Zhipu from "@lobehub/icons/es/Zhipu/components/Color";

/** 供应商品牌条目：展示名 + 品牌图标（无图标时界面回退到字母图标）。 */
export interface ProviderBrand {
  name: string;
  Icon?: IconType;
}

/**
 * 引擎目录 ID → 展示名与品牌图标。
 * 引擎目录只有小写 ID 与工程化的 displayName，这里补充面向用户的名称与品牌标识；
 * 未收录的 ID 由 providerDisplayName 与字母图标兜底。
 */
export const PROVIDER_BRANDS: Record<string, ProviderBrand> = {
  deepseek: { name: "DeepSeek", Icon: DeepSeek },
  "deepseek-official": { name: "DeepSeek", Icon: DeepSeek },
  anthropic: { name: "Anthropic", Icon: Anthropic },
  google: { name: "Google Gemini", Icon: Gemini },
  "google-vertex": { name: "Google Vertex AI", Icon: VertexAI },
  "amazon-bedrock": { name: "Amazon Bedrock", Icon: Bedrock },
  "azure-openai-responses": { name: "Azure OpenAI", Icon: Azure },
  openai: { name: "OpenAI", Icon: OpenAI },
  "openai-codex": { name: "OpenAI Codex", Icon: OpenAI },
  "openai-codex-responses": { name: "OpenAI Codex", Icon: OpenAI },
  "github-copilot": { name: "GitHub Copilot", Icon: GithubCopilot },
  groq: { name: "Groq", Icon: Groq },
  mistral: { name: "Mistral AI", Icon: Mistral },
  xai: { name: "xAI", Icon: XAI },
  huggingface: { name: "Hugging Face", Icon: HuggingFace },
  minimax: { name: "MiniMax", Icon: Minimax },
  "minimax-cn": { name: "MiniMax（中国）", Icon: Minimax },
  moonshotai: { name: "Moonshot AI", Icon: Moonshot },
  "moonshotai-cn": { name: "Moonshot AI（中国）", Icon: Moonshot },
  "kimi-coding": { name: "Kimi", Icon: Kimi },
  "cloudflare-ai-gateway": {
    name: "Cloudflare AI Gateway",
    Icon: Cloudflare,
  },
  "cloudflare-workers-ai": {
    name: "Cloudflare Workers AI",
    Icon: WorkersAI,
  },
  fireworks: { name: "Fireworks AI", Icon: Fireworks },
  cerebras: { name: "Cerebras", Icon: Cerebras },
  baseten: { name: "Baseten" },
  "ant-ling": { name: "蚂蚁百灵", Icon: AntGroup },
  "zai-coding": { name: "Z.ai Coding", Icon: Zhipu },
  "zai-coding-cn": { name: "Z.ai Coding（中国）", Icon: Zhipu },
  qwen: { name: "Qwen", Icon: Qwen },
  "qwen-coding": { name: "Qwen Coding", Icon: Qwen },
  doubao: { name: "豆包", Icon: Doubao },
};

/**
 * 供应商展示名：品牌表优先；未收录时若引擎 displayName 有别于 ID 则沿用，
 * 否则把 kebab-case ID 各段首字母大写兜底。
 */
export function providerDisplayName(
  provider: string,
  engineDisplayName?: string,
): string {
  const known = PROVIDER_BRANDS[provider];
  if (known) return known.name;
  if (
    engineDisplayName &&
    engineDisplayName.trim().length > 0 &&
    engineDisplayName !== provider
  ) {
    return engineDisplayName;
  }
  return provider
    .split("-")
    .map((segment) =>
      segment ? segment[0].toUpperCase() + segment.slice(1) : segment,
    )
    .join(" ");
}
