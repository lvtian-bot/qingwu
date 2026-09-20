/** 引擎目录 ID → 面向用户的展示名。 */
const PROVIDER_NAMES: Record<string, string> = {
  deepseek: "DeepSeek",
  "deepseek-official": "DeepSeek",
  anthropic: "Anthropic",
  google: "Google Gemini",
  "google-vertex": "Google Vertex AI",
  "amazon-bedrock": "Amazon Bedrock",
  "azure-openai-responses": "Azure OpenAI",
  openai: "OpenAI",
  "openai-codex": "OpenAI Codex",
  "openai-codex-responses": "OpenAI Codex",
  "github-copilot": "GitHub Copilot",
  groq: "Groq",
  mistral: "Mistral AI",
  xai: "xAI",
  huggingface: "Hugging Face",
  minimax: "MiniMax",
  "minimax-cn": "MiniMax（中国）",
  moonshotai: "Moonshot AI",
  "moonshotai-cn": "Moonshot AI（中国）",
  "kimi-coding": "Kimi",
  "cloudflare-ai-gateway": "Cloudflare AI Gateway",
  "cloudflare-workers-ai": "Cloudflare Workers AI",
  fireworks: "Fireworks AI",
  cerebras: "Cerebras",
  baseten: "Baseten",
  "ant-ling": "蚂蚁百灵",
  "zai-coding": "Z.ai Coding",
  "zai-coding-cn": "Z.ai Coding（中国）",
  qwen: "Qwen",
  "qwen-coding": "Qwen Coding",
  doubao: "豆包",
};

/**
 * 供应商展示名：名称表优先；未收录时若引擎 displayName 有别于 ID 则沿用，
 * 否则把 kebab-case ID 各段首字母大写兜底。
 */
export function providerDisplayName(
  provider: string,
  engineDisplayName?: string,
): string {
  const known = PROVIDER_NAMES[provider];
  if (known) return known;
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
