import test from 'node:test'
import assert from 'node:assert/strict'
import { applyScenario, defaultScenarios, runScenarioComparisons } from './scenarios.js'

const sample = {
  household: { startDate: '2026-01-01', endAge: 30 },
  persons: [{ personId: 'p1', birthDate: '2000-01-01', pensionAnnualGrowthRate: 0 }],
  incomeRecords: [{ category: 'salary', amount: 100000, frequency: 'monthly', startDate: '2026-01-01', annualGrowthRate: 0 }],
  expenseRecords: [{ amount: 50000, frequency: 'monthly', startDate: '2026-01-01', annualInflationRate: 0.01 }],
  assets: [
    { assetId: 'cash', assetType: 'cash', balance: 1000000, annualReturn: 0.001 },
    { assetId: 'fund', assetType: 'investment', balance: 1000000, annualReturn: 0.04 },
  ],
  liabilities: [],
  futureEvents: [],
  conditions: { calculationEndAge: 27, defaultInflationRate: 0.01 },
}

test('標準シナリオは元データの条件を変えない', () => {
  const standard = defaultScenarios.find((item) => item.scenarioId === 'standard')
  const adjusted = applyScenario(sample, standard)
  assert.equal(adjusted.conditions.defaultInflationRate, 0.01)
  assert.equal(adjusted.assets[1].annualReturn, 0.04)
  assert.equal(sample.assets[1].annualReturn, 0.04)
})

test('楽観・悲観シナリオは対象の年率条件を調整する', () => {
  const optimistic = applyScenario(sample, defaultScenarios.find((item) => item.scenarioId === 'optimistic'))
  const pessimistic = applyScenario(sample, defaultScenarios.find((item) => item.scenarioId === 'pessimistic'))
  assert.equal(optimistic.conditions.defaultInflationRate, 0.005)
  assert.equal(optimistic.assets[1].annualReturn, 0.06)
  assert.equal(optimistic.incomeRecords[0].annualGrowthRate, 0.005)
  assert.equal(pessimistic.conditions.defaultInflationRate, 0.02)
  assert.equal(pessimistic.assets[1].annualReturn, 0.02)
  assert.equal(pessimistic.incomeRecords[0].annualGrowthRate, -0.005)
})

test('預金利回りは投資利回り調整の対象外', () => {
  const optimistic = applyScenario(sample, defaultScenarios.find((item) => item.scenarioId === 'optimistic'))
  assert.equal(optimistic.assets[0].annualReturn, 0.001)
})

test('3シナリオの計算結果をまとめて返す', () => {
  const results = runScenarioComparisons(sample)
  assert.equal(results.length, 3)
  assert.equal(results[0].scenario.scenarioId, 'standard')
  assert.equal(results[0].result.annualResults.length, 2)
})


test('Vueのreactiveデータを渡してもシナリオ比較できる', () => {
  // VueのreactiveもProxyを返すため、Proxy入力で同じ問題を再現する。
  const reactiveSample = new Proxy(JSON.parse(JSON.stringify(sample)), {})
  const results = runScenarioComparisons(reactiveSample)
  assert.equal(results.length, 3)
  assert.equal(results[0].scenario.scenarioId, 'standard')
  assert.equal(reactiveSample.assets[1].annualReturn, 0.04)
})


test('年金シナリオ差分は公的年金の共通率と個別年金の改定率に反映する', () => {
  const input = {
    household: { startDate: '2026-01-01', endAge: 80 },
    persons: [],
    incomeRecords: [],
    expenseRecords: [],
    assets: [],
    pensions: [
      { pensionType: 'basic', adjustmentMode: 'public', annualAmount: 600000, startDate: '2026-01-01' },
      { pensionType: 'private', adjustmentMode: 'custom', annualAmount: 300000, annualGrowthRate: 0.01, startDate: '2026-01-01' },
    ],
    conditions: { pensionAdjustmentRates: { basicAnnualRate: 0.01, employeesAnnualRate: 0.02 } },
  }
  const adjusted = applyScenario(input, { pensionGrowthDelta: 0.005 })
  assert.equal(adjusted.conditions.pensionAdjustmentRates.basicAnnualRate, 0.015)
  assert.equal(adjusted.pensions[1].annualGrowthRate, 0.015)
  assert.equal(input.conditions.pensionAdjustmentRates.basicAnnualRate, 0.01)
})


test('標準率を継承する収入・投資資産はシナリオ調整後の標準率を使う', () => {
  const input = {
    ...structuredClone(sample),
    incomeRecords: [{
      category: 'salary', amount: 100000, frequency: 'monthly',
      startDate: '2026-01-01', annualGrowthRate: null,
    }],
    assets: [
      { assetId: 'cash', assetType: 'cash', balance: 1000000, annualReturn: 0 },
      { assetId: 'fund', assetType: 'investment', balance: 1000000, annualReturn: null },
    ],
    conditions: {
      ...structuredClone(sample.conditions),
      defaultIncomeGrowthRate: 0.01,
      defaultInvestmentReturn: 0.04,
    },
  }
  const optimistic = applyScenario(input, defaultScenarios.find((item) => item.scenarioId === 'optimistic'))
  assert.equal(optimistic.conditions.defaultIncomeGrowthRate, 0.015)
  assert.equal(optimistic.conditions.defaultInvestmentReturn, 0.06)
  assert.equal(optimistic.incomeRecords[0].annualGrowthRate, null)
  assert.equal(optimistic.assets[1].annualReturn, null)
})
