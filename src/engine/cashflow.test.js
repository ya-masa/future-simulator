import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateMonthlyIncomeBreakdown, calculateMonthlyIncomeByAssetType } from './cashflow.js'

const person = { personId: 'p1', birthDate: '1960-04-01', retirementAge: 65 }

test('再雇用収入は退職予定年齢以降も給与収入として計上する', () => {
  const records = [
    { category: 'salary', personId: 'p1', amount: 300000, frequency: 'monthly', startDate: '2020-04-01' },
    { category: 'reemployment', personId: 'p1', amount: 120000, frequency: 'monthly', startDate: '2025-04-01', endDate: '2030-03-31', cashflowAssetType: 'deposit' },
  ]
  const date = new Date(2026, 3, 1)
  const breakdown = calculateMonthlyIncomeBreakdown(records, date, [person])
  assert.equal(breakdown.salary, 120000)
  assert.equal(breakdown.bonus, 0)
  assert.equal(breakdown.other, 0)
  assert.deepEqual(calculateMonthlyIncomeByAssetType(records, date, [person]), { cash: 0, deposit: 120000 })
})

test('再雇用収入は設定した終了月の後は計上しない', () => {
  const records = [
    { category: 'reemployment', personId: 'p1', amount: 120000, frequency: 'monthly', startDate: '2025-04-01', endDate: '2026-03-31' },
  ]
  const date = new Date(2026, 3, 1)
  const breakdown = calculateMonthlyIncomeBreakdown(records, date, [person])
  assert.equal(breakdown.salary, 0)
})

test('通常給与・賞与は退職予定年齢で停止する', () => {
  const records = [
    { category: 'salary', personId: 'p1', amount: 300000, frequency: 'monthly', startDate: '2020-04-01' },
    { category: 'bonus', personId: 'p1', amount: 600000, frequency: 'annual', startDate: '2020-04-01' },
  ]
  const date = new Date(2026, 3, 1)
  const breakdown = calculateMonthlyIncomeBreakdown(records, date, [person])
  assert.equal(breakdown.salary, 0)
  assert.equal(breakdown.bonus, 0)
})
