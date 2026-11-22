import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizePensionData, calculateMonthlyPensionIncome } from './pensions.js'

test('旧人物情報の年金を年金管理レコードへ移行する', () => {
  const data = {
    household: { startDate: '2026-01-01' },
    persons: [{ personId: 'p1', name: '本人', birthDate: '1960-04-15', pensionStartAge: 65, pensionAnnualAmount: 1200000, pensionAnnualGrowthRate: 0.01 }],
    incomeRecords: [],
    conditions: {},
  }
  normalizePensionData(data)
  assert.equal(data.pensions.length, 1)
  assert.equal(data.pensions[0].personId, 'p1')
  assert.equal(data.pensions[0].annualAmount, 1200000)
  assert.equal(data.pensions[0].startDate, '2025-04-01')
  assert.equal(data.persons[0].pensionAnnualAmount, 0)
})

test('旧収入レコードの年金を年金管理へ移行し月額を年額換算する', () => {
  const data = {
    household: { startDate: '2026-01-01' },
    persons: [{ personId: 'p1', name: '本人', pensionAnnualAmount: 0 }],
    incomeRecords: [{ incomeId: 'i1', personId: 'p1', category: 'pension', name: '年金', amount: 100000, frequency: 'monthly', startDate: '2030-04-01', endDate: null, annualGrowthRate: 0.005 }],
    conditions: {},
  }
  normalizePensionData(data)
  assert.equal(data.pensions.length, 1)
  assert.equal(data.pensions[0].annualAmount, 1200000)
  assert.equal(data.incomeRecords.length, 0)
})

test('人物情報と収入レコードの両方に旧年金がある場合は二重移行しない', () => {
  const data = {
    household: { startDate: '2026-01-01' },
    persons: [{ personId: 'p1', name: '本人', birthDate: '1960-01-01', pensionStartAge: 65, pensionAnnualAmount: 900000 }],
    incomeRecords: [{ incomeId: 'i1', personId: 'p1', category: 'pension', amount: 100000, frequency: 'monthly', startDate: '2025-01-01' }],
    conditions: {},
  }
  normalizePensionData(data)
  assert.equal(data.pensions.length, 2)
  assert.equal(data.pensions[0].annualAmount, 1200000)
  assert.equal(data.pensions[1].annualAmount, 900000)
  assert.equal(data.pensions[1].enabled, false)
  assert.equal(data.pensionMigrationNotices.length, 1)
})

test('公的年金は基礎年金・厚生年金の共通改定率を使う', () => {
  const pensions = [
    { pensionType: 'basic', adjustmentMode: 'public', annualAmount: 600000, startDate: '2026-01-01' },
    { pensionType: 'employees', adjustmentMode: 'public', annualAmount: 1200000, startDate: '2026-01-01' },
  ]
  const monthly = calculateMonthlyPensionIncome(pensions, new Date(2027, 0, 1), {
    pensionAdjustmentRates: { basicAnnualRate: 0.01, employeesAnnualRate: 0.02 },
  })
  assert.equal(Math.round(monthly), Math.round((600000 * 1.01 + 1200000 * 1.02) / 12))
})

test('個別年金は個別改定率を使い、受給期間外は計上しない', () => {
  const pension = { pensionType: 'private', adjustmentMode: 'custom', annualAmount: 120000, annualGrowthRate: 0.1, startDate: '2026-07-01', endDate: '2026-12-31' }
  assert.equal(calculateMonthlyPensionIncome([pension], new Date(2026, 5, 1)), 0)
  assert.equal(calculateMonthlyPensionIncome([pension], new Date(2026, 6, 1)), 10000)
  assert.equal(calculateMonthlyPensionIncome([pension], new Date(2027, 0, 1)), 0)
})


test('人物情報の旧年金を移行しても同じ条件の年金収入額を維持する', async () => {
  const { runSimulation } = await import('./simulation.js')
  const oldData = {
    household: { startDate: '2026-01-01', endAge: 70 },
    persons: [{ personId: 'p1', name: '本人', birthDate: '1960-04-15', pensionStartAge: 65, pensionAnnualAmount: 1200000, pensionAnnualGrowthRate: 0.01, retirementAge: 65 }],
    incomeRecords: [],
    expenseRecords: [],
    assets: [{ assetId: 'cash', assetType: 'cash', balance: 10000000, annualReturn: 0 }],
    conditions: { calculationEndAge: 70, defaultInflationRate: 0 },
  }
  const oldResult = runSimulation(structuredClone(oldData))
  const migrated = structuredClone(oldData)
  normalizePensionData(migrated)
  const newResult = runSimulation(migrated)
  assert.equal(newResult.annualResults[0].pensionIncome, oldResult.annualResults[0].pensionIncome)
})


test('試算対象外の年金は収入に含めない', () => {
  const pension = { pensionType: 'private', adjustmentMode: 'custom', annualAmount: 1200000, startDate: '2026-01-01', enabled: false }
  assert.equal(calculateMonthlyPensionIncome([pension], new Date(2026, 0, 1)), 0)
})
