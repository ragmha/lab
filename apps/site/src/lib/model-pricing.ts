export const pricingDate = '2026-10-11'

export type ModelPrice = {
  id: string
  name: string
  provider: string
  source: string
  context: string
  note?: string
  // USD per million tokens: uncached input, cache read, 5-minute write, output.
  rates: [number, number, number, number]
  write1h?: number
  threshold?: number
  longRates?: [number, number, number, number]
  longWrite1h?: number
  alternativeRates?: [number, number, number, number]
  alternativeWrite1h?: number
  promotionalUntil?: string
}

const openai = 'https://developers.openai.com/api/docs/pricing'
const anthropic = 'https://platform.claude.com/docs/en/about-claude/pricing'
const google = 'https://ai.google.dev/gemini-api/docs/pricing'
const xai = 'https://docs.x.ai/developers/models'
const deepseek = 'https://api-docs.deepseek.com/quick_start/pricing'
const kimi = 'https://platform.kimi.ai/docs/pricing/chat'
const alibaba = 'https://www.alibabacloud.com/help/en/model-studio/model-pricing'
const zai = 'https://docs.z.ai/guides/overview/pricing'

export const modelPrices: ModelPrice[] = [
  { id: 'gpt-6-astra', name: 'GPT-6 Astra', provider: 'OpenAI', source: openai, context: '≤272K', rates: [10, 1, 12.5, 50], threshold: 272000, longRates: [20, 2, 25, 75] },
  { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', provider: 'OpenAI', source: openai, context: '≤272K', rates: [2, 0.1, 2.5, 10], threshold: 272000, longRates: [4, 0.2, 5, 15] },
  { id: 'gpt-6-luna', name: 'GPT-6 Luna', provider: 'OpenAI', source: openai, context: '≤272K', rates: [0.1, 0.01, 0.125, 0.5], threshold: 272000, longRates: [0.2, 0.02, 0.25, 0.75] },
  { id: 'gpt-6-sol', name: 'GPT-6 Sol', provider: 'OpenAI', source: openai, context: '≤272K', rates: [2, 0.2, 2.5, 10], threshold: 272000, longRates: [4, 0.4, 5, 15] },
  { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', provider: 'OpenAI', source: openai, context: '≤272K', note: 'Promotional rates through at least Nov 21, 2026', rates: [4, 0.4, 5, 20], threshold: 272000, longRates: [8, 0.8, 10, 30] },
  { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', provider: 'OpenAI', source: openai, context: '≤272K', rates: [2, 0.2, 2.5, 12], threshold: 272000, longRates: [4, 0.4, 5, 18] },
  { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', provider: 'OpenAI', source: openai, context: '≤272K', rates: [0.2, 0.02, 0.25, 1.2], threshold: 272000, longRates: [0.4, 0.04, 0.5, 1.8] },
  { id: 'gpt-5.5', name: 'GPT-5.5', provider: 'OpenAI', source: openai, context: '≤272K', rates: [5, 0.5, 0, 30], threshold: 272000, longRates: [10, 1, 0, 45] },
  { id: 'gpt-5.4', name: 'GPT-5.4', provider: 'OpenAI', source: openai, context: '≤272K', rates: [2.5, 0.25, 0, 15], threshold: 272000, longRates: [5, 0.5, 0, 22.5] },
  { id: 'gpt-5.4-mini', name: 'GPT-5.4 mini', provider: 'OpenAI', source: openai, context: 'Standard', rates: [0.75, 0.075, 0, 4.5] },
  { id: 'gpt-5.4-nano', name: 'GPT-5.4 nano', provider: 'OpenAI', source: openai, context: 'Standard', rates: [0.2, 0.02, 0, 1.25] },
  { id: 'gpt-5.2', name: 'GPT-5.2', provider: 'OpenAI', source: openai, context: 'Standard', rates: [1.75, 0.175, 0, 14] },
  { id: 'gpt-5.1', name: 'GPT-5.1', provider: 'OpenAI', source: openai, context: 'Standard', rates: [1.25, 0.125, 0, 10] },
  { id: 'gpt-5', name: 'GPT-5', provider: 'OpenAI', source: openai, context: 'Standard', rates: [1.25, 0.125, 0, 10] },
  { id: 'gpt-5-mini', name: 'GPT-5 mini', provider: 'OpenAI', source: openai, context: 'Standard', rates: [0.25, 0.025, 0, 2] },
  { id: 'gpt-5-nano', name: 'GPT-5 nano', provider: 'OpenAI', source: openai, context: 'Standard', rates: [0.05, 0.005, 0, 0.4] },

  { id: 'claude-fable-5.1', name: 'Claude Fable 5.1', provider: 'Anthropic', source: anthropic, context: 'Standard', note: 'Limited availability', rates: [10, 0.25, 12.5, 50], write1h: 20 },
  { id: 'claude-fable-5', name: 'Claude Fable 5', provider: 'Anthropic', source: anthropic, context: 'Standard', note: 'Cache read rate differs from Fable 5.1', rates: [10, 1, 12.5, 50], write1h: 20 },
  { id: 'claude-opus-5.5', name: 'Claude Opus 5.5', provider: 'Anthropic', source: anthropic, context: 'Standard', rates: [4, 0.2, 5, 20], write1h: 8 },
  { id: 'claude-opus-5', name: 'Claude Opus 5', provider: 'Anthropic', source: anthropic, context: 'Standard', rates: [5, 0.5, 6.25, 25], write1h: 10 },
  { id: 'claude-opus-4.8', name: 'Claude Opus 4.8', provider: 'Anthropic', source: anthropic, context: 'Standard', rates: [5, 0.5, 6.25, 25], write1h: 10 },
  { id: 'claude-opus-4.7', name: 'Claude Opus 4.7', provider: 'Anthropic', source: anthropic, context: 'Standard', rates: [5, 0.5, 6.25, 25], write1h: 10 },
  { id: 'claude-opus-4.6', name: 'Claude Opus 4.6', provider: 'Anthropic', source: anthropic, context: 'Standard', rates: [5, 0.5, 6.25, 25], write1h: 10 },
  { id: 'claude-opus-4.5', name: 'Claude Opus 4.5', provider: 'Anthropic', source: anthropic, context: 'Standard', rates: [5, 0.5, 6.25, 25], write1h: 10 },
  { id: 'claude-sonnet-5.5', name: 'Claude Sonnet 5.5', provider: 'Anthropic', source: anthropic, context: 'Standard', rates: [2, 0.1, 2.5, 10], write1h: 4 },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', provider: 'Anthropic', source: anthropic, context: 'Standard', rates: [2, 0.2, 2.5, 10], write1h: 4 },
  { id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6', provider: 'Anthropic', source: anthropic, context: 'Standard', rates: [3, 0.3, 3.75, 15], write1h: 6 },
  { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', provider: 'Anthropic', source: anthropic, context: 'Standard', rates: [3, 0.3, 3.75, 15], write1h: 6 },
  { id: 'claude-haiku-5.5', name: 'Claude Haiku 5.5', provider: 'Anthropic', source: anthropic, context: '≤100K', rates: [0.1, 0.01, 0.125, 0.5], write1h: 0.2, threshold: 100000, longRates: [0.5, 0.05, 0.625, 2.5], longWrite1h: 1 },
  { id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5', provider: 'Anthropic', source: anthropic, context: 'Standard', rates: [1, 0.1, 1.25, 5], write1h: 2 },

  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', provider: 'Google', source: google, context: 'Standard', note: 'Promotional rates through Dec 31, 2026', rates: [0.75, 0.075, 0, 3.75], promotionalUntil: '2026-12-31' },
  { id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash', provider: 'Google', source: google, context: 'Standard', note: 'Promotional rates through Dec 31, 2026', rates: [0.75, 0.075, 0, 3.75], promotionalUntil: '2026-12-31' },

  { id: 'grok-4.7', name: 'Grok 4.7', provider: 'xAI', source: xai, context: '<200K', rates: [2, 0.5, 0, 6], threshold: 199999, longRates: [4, 1, 0, 12] },
  { id: 'grok-4.6', name: 'Grok 4.6', provider: 'xAI', source: xai, context: '<200K', rates: [2, 0.5, 0, 6], threshold: 199999, longRates: [4, 1, 0, 12] },
  { id: 'grok-4.5', name: 'Grok 4.5', provider: 'xAI', source: xai, context: '<200K', rates: [2, 0.3, 0, 6], threshold: 199999, longRates: [4, 0.6, 0, 12] },

  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', provider: 'DeepSeek', source: deepseek, context: '1M', note: 'Off-peak shown; peak rates are 2×. Cache-hit pricing differs by time.', rates: [0.66, 0.022, 0.66, 1.98], alternativeRates: [1.32, 0.044, 1.32, 3.96] },
  { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', provider: 'DeepSeek', source: deepseek, context: '1M', note: 'Off-peak shown; peak rates are 2×. Cache-hit pricing differs by time.', rates: [0.15, 0.003, 0.15, 0.6], alternativeRates: [0.3, 0.006, 0.3, 1.2] },

  { id: 'kimi-k3', name: 'Kimi K3', provider: 'Moonshot AI', source: kimi, context: '1M', rates: [3, 0.3, 3, 15], write1h: 6 },
  { id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code', provider: 'Moonshot AI', source: kimi, context: '262K', rates: [0.95, 0.19, 0, 4] },
  { id: 'kimi-k2.7-code-highspeed', name: 'Kimi K2.7 Code Highspeed', provider: 'Moonshot AI', source: kimi, context: '262K', rates: [1.9, 0.38, 0, 8] },
  { id: 'kimi-k2.6', name: 'Kimi K2.6', provider: 'Moonshot AI', source: kimi, context: '262K', rates: [0.95, 0.16, 0, 4] },

  { id: 'qwen3.8-max', name: 'Qwen 3.8 Max', provider: 'Alibaba Cloud', source: alibaba, context: '1M', note: 'International list price; implicit cache hit rate shown; cache and batch rates vary', rates: [2, 0.4, 0, 6] },
  { id: 'glm-5.3', name: 'GLM-5.3', provider: 'Z.AI', source: zai, context: 'Standard', note: 'Cached-input storage listed as limited-time free', rates: [1.4, 0.26, 0, 4.4] },
  { id: 'glm-5.3-flash', name: 'GLM-5.3 Flash', provider: 'Z.AI', source: zai, context: 'Standard', note: 'Cached input storage currently listed as limited-time free', rates: [0.15, 0.03, 0, 0.5] },
]

export function findModelPrice(model: string) {
  const key = (value: string) => value.toLowerCase().replace(/-\d{8}$|-\d{4}-\d{2}-\d{2}$/, '').replace(/[^a-z0-9]/g, '')
  return modelPrices.find((price) => key(price.id) === key(model) || key(price.name) === key(model))
}
