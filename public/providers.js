// AI providers the app can call. "anthropic" uses the Anthropic SDK; every other
// provider exposes an OpenAI-compatible /chat/completions endpoint.
// Model names change over time, so they are editable in Settings.
export const PROVIDERS = {
  claude: {
    name: "Claude",
    kind: "anthropic",
    baseURL: "https://api.anthropic.com",
    models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
    defaultModel: "claude-opus-5-5",
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
  deepseek: {
    name: "DeepSeek",
    kind: "openai",
    baseURL: "https://api.deepseek.com",
    models: ["deepseek-chat", "deepseek-reasoner"],
    defaultModel: "deepseek-chat",
    keyUrl: "https://platform.deepseek.com/api_keys",
  },
  qwen: {
    name: "通义千问",
    kind: "openai",
    baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    baseHint: "国内账号用 https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: ["qwen-plus", "qwen-turbo", "qwen-max"],
    defaultModel: "qwen-plus",
    keyUrl: "https://bailian.console.alibabacloud.com/",
  },
  kimi: {
    name: "Kimi",
    kind: "openai",
    baseURL: "https://api.moonshot.ai/v1",
    baseHint: "国内账号用 https://api.moonshot.cn/v1",
    models: ["moonshot-v1-32k", "moonshot-v1-8k", "kimi-latest"],
    defaultModel: "moonshot-v1-32k",
    keyUrl: "https://platform.moonshot.ai/console/api-keys",
  },
  glm: {
    name: "智谱 GLM",
    kind: "openai",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    baseHint: "国际版 Z.ai 账号用 https://api.z.ai/api/paas/v4",
    models: ["glm-4-flash", "glm-4-plus", "glm-4-air"],
    defaultModel: "glm-4-flash",
    keyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
  },
  doubao: {
    name: "豆包",
    kind: "openai",
    baseURL: "https://ark.cn-beijing.volces.com/api/v3",
    baseHint: "海外 BytePlus 账号用 https://ark.ap-southeast.bytepluses.com/api/v3",
    models: [],
    defaultModel: "",
    modelHint: "在火山方舟控制台复制模型 ID 或接入点 ID（ep-…）",
    keyUrl: "https://console.volcengine.com/ark",
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS);
