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

test('人物の計算終了年齢に到達すると、その人物に紐づく給与・年金・その他収入を停止する', () => {
  const limitedPerson = { ...person, calculationEndAge: 66 }
  const records = [
    { category: 'salary', personId: 'p1', amount: 300000, frequency: 'monthly', startDate: '2020-04-01' },
    { category: 'pension', personId: 'p1', amount: 1200000, frequency: 'annual', startDate: '2025-01-01' },
    { category: 'other', personId: 'p1', amount: 50000, frequency: 'monthly', startDate: '2025-01-01' },
  ]
  const beforeCutoff = calculateMonthlyIncomeBreakdown(records, new Date(2025, 2, 1), [limitedPerson])
  const atCutoff = calculateMonthlyIncomeBreakdown(records, new Date(2026, 3, 1), [limitedPerson])
  assert.ok(beforeCutoff.salary > 0 || beforeCutoff.pension > 0 || beforeCutoff.other > 0)
  assert.deepEqual(atCutoff, { salary: 0, bonus: 0, pension: 0, other: 0 })
})


