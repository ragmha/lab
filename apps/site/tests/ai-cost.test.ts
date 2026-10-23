import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { MIN_COHORT, aggregate, assertPublishable, publicModel } from '../scripts/ai-cost/aggregate'
import type { AiCost, Billing, OrgReport } from '../scripts/ai-cost/aggregate'
import { combine, niceScale, topN, windowDelta } from '../src/lib/ai-cost'

const item = (sku: string, model: string, grossQuantity: number) => ({
  product: 'Copilot', sku, model, unitType: 'ai-credits', pricePerUnit: 0.01,
  grossQuantity, grossAmount: grossQuantity / 100, netAmount: 0,
})
const billings: Billing[] = [
  { organization: 'secret-org', timePeriod: { year: 2026, month: 10 }, usageItems: [item('Copilot AI Credits', 'Claude Sonnet 5', 50)] },
  {
    organization: 'secret-org',
    timePeriod: { year: 2026, month: 9 },
    usageItems: [
      item('Copilot AI Credits', 'Claude Sonnet 5', 300),
      item('Code Quality AI Credits', 'GPT-5.5', 100),
      item('Copilot AI Credits', 'GPT-5.5', 600),
    ],
  },
]
const surface = (requests: number) => ({
  session_count: 1, request_count: requests, prompt_count: 2,
  token_usage: { prompt_tokens_sum: requests * 100, output_tokens_sum: requests },
})
const day = (date: string, phase1: number) => ({
  day: date, daily_active_users: 9, weekly_active_users: 9, monthly_active_users: 9,
  daily_active_cli_users: 6, daily_active_copilot_app_users: 5,
  totals_by_cli: surface(10), totals_by_copilot_app: surface(4),
  totals_by_ai_adoption_phase: [
    { phase: 'Phase 2', phase_number: 2, users_in_phase_28d: 3 },
    { phase: 'Phase 1', phase_number: 1, users_in_phase_28d: phase1 },
  ],
  totals_by_3rd_party_agent: [{ session_count: 2 }],
})
const org: OrgReport = {
  organization_id: '424242',
  enterprise_id: '535353',
  report_start_day: '2026-09-30',
  report_end_day: '2026-10-01',
  day_totals: [day('2026-10-01', 7), day('2026-09-30', 1)],
  copilot_feature_engagement: {
    active_user_count: 9,
    totals_by_feature: [{ feature: 'agent_edit', engaged_user_count: 2 }, { feature: 'copilot_cli', engaged_user_count: 6 }],
  },
}
const row = (user: number, date: string, credits: number) =>
  JSON.stringify({ day: date, user_id: 9000 + user, user_login: `person-${user}`, ai_credits_used: credits })
const users = [
  ...[1, 2, 3, 4, 5, 6].map((user) => row(user, '2026-09-30', 10)),
  ...[1, 2, 3, 4, 5].map((user) => row(user, '2026-10-01', 20)),
  row(7, '2026-09-30', 0),
  '',
]

describe('ai cost aggregation', () => {
  const result = aggregate(billings, org, users)

  test('rolls billing up by month, SKU, and model', () => {
    assert.deepEqual(result.billing.map(({ month, credits, gross, net }) => ({ month, credits, gross, net })), [
      { month: '2026-09', credits: 1000, gross: 10, net: 0 },
      { month: '2026-10', credits: 50, gross: 0.5, net: 0 },
    ])
    assert.deepEqual(result.billing[0].bySku, [{ name: 'Copilot AI Credits', credits: 900 }, { name: 'Code Quality AI Credits', credits: 100 }])
    assert.deepEqual(result.billing[0].byModel, [{ name: 'GPT-5.5', credits: 700 }, { name: 'Claude Sonnet 5', credits: 300 }])
  })

  test('publishes unlisted models only as Other, keeping totals', () => {
    const secret = billings.map((b) => ({ ...b, usageItems: b.usageItems.map((item) => ({ ...item, model: `Secret ${item.model}` })) }))
    const hidden = aggregate(secret, org, users)
    for (const [i, month] of hidden.billing.entries()) {
      assert.deepEqual(month.byModel, [{ name: 'Other', credits: result.billing[i].credits }])
      assert.equal(month.credits, result.billing[i].credits)
    }
  })

  test('sorts days, sums surfaces, and keeps only monthly per-user credit totals', () => {
    assert.deepEqual(result.days.map((d) => d.day), ['2026-09-30', '2026-10-01'])
    assert.deepEqual(result.days[0].app, { requests: 4, prompts: 2, promptTokens: 400, outputTokens: 4 })
    assert.deepEqual(result.users, {
      count: 7,
      withCredits: 6,
      byMonth: [{ month: '2026-09', credits: 60, users: 6 }, { month: '2026-10', credits: 100, users: 5 }],
    })
    assert.deepEqual(result.phases, [{ phase: 'Phase 1', users: 7 }, { phase: 'Phase 2', users: 3 }])
    assert.deepEqual(result.features.engaged.map((f) => f.feature), ['copilot_cli', 'agent_edit'])
    assert.equal(result.thirdPartySessions, 4)
  })

  test('rejects inputs that are inconsistent or would expose a small cohort', () => {
    assert.throws(() => aggregate(billings, org, [...users, row(8, '2026-10-02', 1)]), /outside/)
    assert.throws(() => aggregate(billings, org, users.slice(2)), /2026-09: only 4/)
    assert.throws(() => aggregate(billings, org, users.filter((line) => !line.includes('"person-5"'))), /2026-10: only 4/)
    const mixed = [{ ...billings[0], usageItems: [...billings[0].usageItems, { ...item('X', 'Y', 1), pricePerUnit: 0.02 }] }]
    assert.throws(() => aggregate(mixed, org, users), /one credit price/)
    const tiny = { ...org, day_totals: [{ ...day('2026-09-30', 1), daily_active_copilot_app_users: MIN_COHORT - 1 }] }
    assert.throws(() => aggregate(billings, tiny, users.filter((line) => !line.includes('10-01'))), /app usage from fewer/)
  })

  test('refuses to publish raw identifiers', () => {
    const json = JSON.stringify(result)
    assert.doesNotThrow(() => assertPublishable(json, billings, org, users))
    assert.throws(() => assertPublishable(`${json}"person-3"`, billings, org, users), /raw identifier/)
    assert.throws(() => assertPublishable(`${json}"secret-org"`, billings, org, users), /raw identifier/)
    assert.throws(() => assertPublishable(`${json}{"user_login":1}`, billings, org, users), /user_login/)
  })
})

describe('ai cost chart helpers', () => {
  const sep = [{ name: 'A', credits: 70 }, { name: 'B', credits: 20 }, { name: 'C', credits: 10 }]
  const oct = [{ name: 'B', credits: 50 }, { name: 'D', credits: 40 }, { name: 'A', credits: 10 }]

  test('combine adds credits per name, largest first', () => {
    assert.deepEqual(combine(sep, oct), [
      { name: 'A', credits: 80 }, { name: 'B', credits: 70 }, { name: 'D', credits: 40 }, { name: 'C', credits: 10 },
    ])
  })

  test('topN keeps the largest used rows and counts the ones left out', () => {
    assert.deepEqual(topN(sep, 2), { top: [sep[0], sep[1]], hidden: 1 })
    assert.deepEqual(topN([...sep, { name: 'Idle', credits: 0 }], 5), { top: sep, hidden: 0 })
  })

  test('niceScale returns round steps that cover the maximum', () => {
    assert.deepEqual(niceScale(6464.21), { max: 8000, ticks: [0, 2000, 4000, 6000, 8000] })
    assert.deepEqual(niceScale(1176), { max: 1500, ticks: [0, 500, 1000, 1500] })
    assert.deepEqual(niceScale(77.1e9), { max: 80e9, ticks: [0, 20e9, 40e9, 60e9, 80e9] })
    assert.deepEqual(niceScale(4000), { max: 4000, ticks: [0, 1000, 2000, 3000, 4000] })
    assert.deepEqual(niceScale(0), { max: 1, ticks: [0, 1] })
  })

  test('windowDelta compares the last window with the one before it', () => {
    const values = [...Array(7).fill(10), ...Array(7).fill(15)]
    assert.deepEqual(windowDelta(values), { current: 15, previous: 10, change: 0.5 })
    assert.equal(windowDelta(values.slice(1)), undefined)
    assert.equal(windowDelta(Array(14).fill(0))?.change, undefined)
  })
})

describe('published ai cost data', () => {
  const raw = readFileSync(new URL('../src/data/ai-cost.json', import.meta.url), 'utf8')
  const data = JSON.parse(raw) as AiCost

  test('holds only aggregate fields', () => {
    for (const leak of ['user_login', 'user_id', 'organization_id', 'enterprise_id', '/Users/', 'gho_', 'ghp_', 'github_pat_']) {
      assert.equal(raw.includes(leak), false, leak)
    }
    assert.deepEqual(Object.keys(data).sort(), ['billing', 'days', 'features', 'phases', 'thirdPartySessions', 'users', 'window'])
    assert.ok(data.users.byMonth.every((month) => month.users >= MIN_COHORT))
    for (const { byModel } of data.billing) for (const { name } of byModel) assert.ok(publicModel(name) === name || name === 'Other', name)
  })

  test('stays internally consistent', () => {
    const { start, end } = data.window
    assert.equal(data.days.length, 28)
    assert.ok(data.days.every((d, i) => d.day >= start && d.day <= end && (i === 0 || d.day > data.days[i - 1].day)))
    for (const month of data.billing) {
      const skus = month.bySku.reduce((sum, row) => sum + row.credits, 0)
      assert.ok(Math.abs(skus - month.credits) < 0.05, month.month)
      assert.ok(Math.abs(month.credits * month.pricePerUnit - month.gross) < 0.05, month.month)
    }
  })
})
