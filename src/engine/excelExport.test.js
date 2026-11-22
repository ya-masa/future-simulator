import test from 'node:test'
import assert from 'node:assert/strict'
import { createExcelXml } from './excelExport.js'

const sample = {
  household: {
    household: { name: 'テスト世帯', startDate: '2026-01-01' },
    persons: [{ name: '本人', age: 40 }],
    incomeRecords: [{ name: '給与', amount: 300000 }],
    expenseRecords: [{ name: '生活費', amount: 200000 }],
    assets: [{ name: '預金', balance: 1000000 }],
    liabilities: [{ name: '住宅ローン', balance: 5000000 }],
    futureEvents: [{ name: '車購入', expenseAmount: 2000000 }],
    scenarios: [{ name: '標準' }],
    conditions: { defaultInflationRate: 0.02 },
  },
  simulationResult: { annualResults: [{ year: 2026, income: 3000000, expense: 2400000, netWorth: 1000000, ages: [{ name: '本人', age: 40 }] }] },
  scenarioResults: [{ scenario: { name: '標準' }, result: { summary: { endFinancialAssets: 2000000, endLiabilities: 3000000, endNetWorth: -1000000, totalWithdrawals: 0 } } }],
}

test('Excel XML contains all planned worksheets', () => {
  const xml = createExcelXml(sample)
  for (const name of ['世帯情報', '人物', '収入', '支出', '資産', '負債', '将来イベント', 'シナリオ', '試算条件', '年次試算結果', 'シナリオ比較']) {
    assert.ok(xml.includes(`ss:Name="${name}"`), `${name} worksheet should exist`)
  }
})

test('Excel XML escapes cell text and includes numeric values', () => {
  const xml = createExcelXml(sample)
  assert.ok(xml.includes('テスト世帯'))
  assert.ok(xml.includes('3000000'))
  assert.ok(xml.includes('&amp;') === false)
  const escaped = createExcelXml({ household: { household: { name: 'A&B' } } })
  assert.ok(escaped.includes('A&amp;B'))
})

test('Excel export rejects missing household data', () => {
  assert.throws(() => createExcelXml({}), /世帯データ/)
})
