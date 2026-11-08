// Turns private GitHub exports into the aggregate src/data/ai-cost.json for /ai-cost/.
// Usage: bun scripts/ai-cost/aggregate.ts <dir>
// <dir> holds ai-credit-YYYY-MM.json (GET /organizations/{org}/settings/billing/ai_credit/usage?year=&month=)
// plus organization-28-day.ndjson and users-28-day.ndjson (downloads linked from
// GET /orgs/{org}/copilot/metrics/reports/{organization,users}-28-day/latest). Keep <dir> outside the repository.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

type UsageItem = {
  product: string
  sku: string
  model: string
  unitType: string
  pricePerUnit: number
  grossQuantity: number
  grossAmount: number
  netAmount: number
}
export type Billing = { organization?: string; timePeriod: { year: number; month: number }; usageItems: UsageItem[] }
type Surface = { session_count: number; request_count: number; prompt_count: number; token_usage: { prompt_tokens_sum: number; output_tokens_sum: number } }
type OrgDay = {
  day: string
  daily_active_users: number
  weekly_active_users: number
  monthly_active_users: number
  daily_active_cli_users?: number
  daily_active_copilot_app_users?: number
  totals_by_cli?: Surface
  totals_by_copilot_app?: Surface
  totals_by_ai_adoption_phase?: { phase: string; phase_number: number; users_in_phase_28d: number }[]
  totals_by_3rd_party_agent?: { session_count: number }[]
}
export type OrgReport = {
  organization_id?: string
  enterprise_id?: string
  report_start_day: string
  report_end_day: string
  day_totals: OrgDay[]
  copilot_feature_engagement?: { active_user_count: number; totals_by_feature: { feature: string; engaged_user_count: number }[] }
}

export const MIN_COHORT = 5
// Generally available model names. Anything else (internal or preview labels) is published as "Other".
// ponytail: hand-kept list; add a model here once it is publicly listed.
export const PUBLIC_MODELS = new Set([
  'Claude Haiku 4.5',
  'Claude Haiku 5.5',
  'Claude Opus 4.6',
  'Claude Opus 4.7',
  'Claude Opus 4.8',
  'Claude Opus 5',
  'Claude Opus 5.5',
  'Claude Sonnet 4.6',
  'Claude Sonnet 5',
  'Claude Sonnet 5.5',
  'Code Review model',
  'GPT-5 mini',
  'GPT-5.2',
  'GPT-5.3-Codex',
  'GPT-5.4',
  'GPT-5.4 mini',
  'GPT-5.5',
  'GPT-5.6 Luna',
  'GPT-5.6 Sol',
  'GPT-5.6 Terra',
  'GPT-6 Astra',
  'GPT-6 Luna',
  'GPT-6 Sol',
  'GPT-6.1 Sol',
  'Gemini 3.7 Flash',
  'Gemini 3.8 Flash',
  'Grok 4.7',
  'Kimi K3',
  'MAI-Code-1.1-Flash',
])
export const publicModel = (name: string) => (PUBLIC_MODELS.has(name.replace(/^Auto: /, '')) ? name : 'Other')
const check = (ok: unknown, message: string) => {
  if (!ok) throw new Error(message)
}
const cents = (value: number) => Math.round(value * 100) / 100
const add = (into: Record<string, number>, key: string, value: number) => {
  into[key] = (into[key] ?? 0) + value
}
const rounded = (record: Record<string, number>) =>
  Object.entries(record).sort(([, a], [, b]) => b - a).map(([name, value]) => ({ name, credits: cents(value) }))
const surface = (s?: Surface) => ({
  requests: s?.request_count ?? 0,
  prompts: s?.prompt_count ?? 0,
  promptTokens: s?.token_usage.prompt_tokens_sum ?? 0,
  outputTokens: s?.token_usage.output_tokens_sum ?? 0,
})

export function aggregate(billings: Billing[], org: OrgReport, userLines: Iterable<string>) {
  const { report_start_day: start, report_end_day: end } = org
  const billing = billings
    .map(({ timePeriod: { year, month }, usageItems }) => {
      const bySku: Record<string, number> = {}
      const byModel: Record<string, number> = {}
      let credits = 0
      let gross = 0
      let net = 0
      for (const item of usageItems) {
        check(item.unitType === 'ai-credits', `unexpected unit ${item.unitType}`)
        check(Number.isFinite(item.grossQuantity) && item.grossQuantity >= 0, `bad quantity for ${item.model}`)
        add(bySku, item.sku, item.grossQuantity)
        add(byModel, publicModel(item.model), item.grossQuantity)
        credits += item.grossQuantity
        gross += item.grossAmount
        net += item.netAmount
      }
      const prices = new Set(usageItems.map((item) => item.pricePerUnit))
      check(prices.size === 1, `${year}-${month}: expected one credit price`)
      return {
        month: `${year}-${String(month).padStart(2, '0')}`,
        pricePerUnit: [...prices][0],
        credits: cents(credits),
        gross: cents(gross),
        net: cents(net),
        bySku: rounded(bySku),
        byModel: rounded(byModel),
      }
    })
    .sort((a, b) => a.month.localeCompare(b.month))

  // Per-user credits are published only as monthly cohort totals: daily sums can expose one person.
  const creditsByMonth: Record<string, number> = {}
  const creditUsersByMonth: Record<string, Set<unknown>> = {}
  const creditsByUser = new Map<unknown, number>()
  for (const line of userLines) {
    if (!line.trim()) continue
    const { day, user_id: id, ai_credits_used: credits } = JSON.parse(line)
    check(day >= start && day <= end, `user row outside ${start}…${end}: ${day}`)
    check(Number.isFinite(credits) && credits >= 0, `bad ai_credits_used on ${day}`)
    const month = day.slice(0, 7)
    add(creditsByMonth, month, credits)
    if (credits > 0) (creditUsersByMonth[month] ??= new Set()).add(id)
    creditsByUser.set(id, (creditsByUser.get(id) ?? 0) + credits)
  }
  // ponytail: fixed cohort floor; a proper disclosure-control policy if this ever publishes smaller orgs.
  const userCredits = Object.keys(creditsByMonth)
    .sort()
    .map((month) => {
      const users = creditUsersByMonth[month]?.size ?? 0
      check(users === 0 || users >= MIN_COHORT, `${month}: only ${users} users have credits; too few to publish`)
      return { month, credits: cents(creditsByMonth[month]), users }
    })

  const orgDays = [...org.day_totals].sort((a, b) => a.day.localeCompare(b.day))
  check(new Set(orgDays.map((d) => d.day)).size === orgDays.length, 'duplicate organization days')
  const days = orgDays.map((d) => {
    const cliDau = d.daily_active_cli_users ?? 0
    const appDau = d.daily_active_copilot_app_users ?? 0
    for (const [name, users, s] of [['CLI', cliDau, d.totals_by_cli], ['app', appDau, d.totals_by_copilot_app]] as const) {
      check(!s?.request_count || users >= MIN_COHORT, `${d.day}: ${name} usage from fewer than ${MIN_COHORT} users`)
    }
    return {
      day: d.day,
      dau: d.daily_active_users,
      wau: d.weekly_active_users,
      mau: d.monthly_active_users,
      cliDau,
      appDau,
      cli: surface(d.totals_by_cli),
      app: surface(d.totals_by_copilot_app),
    }
  })
  const last = orgDays.at(-1)

  return {
    window: { start, end },
    billing,
    days,
    users: {
      count: creditsByUser.size,
      withCredits: [...creditsByUser.values()].filter((value) => value > 0).length,
      byMonth: userCredits,
    },
    phases: [...(last?.totals_by_ai_adoption_phase ?? [])]
      .sort((a, b) => a.phase_number - b.phase_number)
      .map(({ phase, users_in_phase_28d }) => ({ phase, users: users_in_phase_28d })),
    features: {
      activeUsers: org.copilot_feature_engagement?.active_user_count ?? 0,
      engaged: (org.copilot_feature_engagement?.totals_by_feature ?? [])
        .map(({ feature, engaged_user_count }) => ({ feature, users: engaged_user_count }))
        .sort((a, b) => b.users - a.users),
    },
    thirdPartySessions: orgDays.reduce(
      (sum, d) => sum + (d.totals_by_3rd_party_agent ?? []).reduce((agents, agent) => agents + agent.session_count, 0),
      0,
    ),
  }
}

export type AiCost = ReturnType<typeof aggregate>

// Fails if any raw identifier would appear as a JSON string in the published aggregate.
export function assertPublishable(json: string, billings: Billing[], org: OrgReport, userLines: Iterable<string>) {
  const secrets = new Set<string>()
  for (const value of [org.organization_id, org.enterprise_id, ...billings.map((b) => b.organization)]) if (value) secrets.add(value)
  for (const line of userLines) {
    if (!line.trim()) continue
    const { user_login, user_id } = JSON.parse(line)
    secrets.add(String(user_login))
    secrets.add(String(user_id))
  }
  for (const secret of secrets) check(!json.includes(JSON.stringify(secret)), 'aggregate would publish a raw identifier')
  for (const leak of ['user_login', 'user_id', 'organization_id', 'enterprise_id', '/Users/', 'gho_', 'ghp_', 'github_pat_']) {
    check(!json.includes(leak), `aggregate would publish ${leak}`)
  }
}

if (import.meta.main) {
  const dir = process.argv[2]
  check(dir, 'usage: bun scripts/ai-cost/aggregate.ts <dir with the raw exports>')
  const billings = readdirSync(dir)
    .filter((file) => /^ai-credit-\d{4}-\d{2}\.json$/.test(file))
    .map((file) => JSON.parse(readFileSync(join(dir, file), 'utf8')) as Billing)
  check(billings.length, 'no ai-credit-YYYY-MM.json files found')
  const org = JSON.parse(readFileSync(join(dir, 'organization-28-day.ndjson'), 'utf8').trim()) as OrgReport
  const users = readFileSync(join(dir, 'users-28-day.ndjson'), 'utf8').split('\n')
  const json = `${JSON.stringify(aggregate(billings, org, users), null, 2)}\n`
  assertPublishable(json, billings, org, users)
  writeFileSync(new URL('../../src/data/ai-cost.json', import.meta.url), json)
  console.log(`wrote ${json.length} bytes to src/data/ai-cost.json`)
}
