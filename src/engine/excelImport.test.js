import test from 'node:test'
import assert from 'node:assert/strict'
import { createExcelXml } from './excelExport.js'
import { parseExcelWorkbook } from './excelImport.js'

const sample = {
  household: {
    household: { householdId: 'hh-1', householdName: 'テスト世帯', currency: 'JPY', endAge: 100 },
    persons: [{ personId: 'p-1', name: '本人', birthDate: '1980-01-01' }],
    incomeRecords: [{ incomeId: 'i-1', name: '給与', amount: 300000, frequency: 'monthly' }],
    pensions: [{ pensionId: 'pen-1', name: '基礎年金', pensionType: 'basic', annualAmount: 800000 }],
    expenseRecords: [{ expenseId: 'e-1', name: '生活費', amount: 200000 }],
    assets: [{ assetId: 'a-1', name: '預金', balance: 1000000, withdrawalEnabled: true, metadata: { bank: 'A&B' } }],
    liabilities: [{ liabilityId: 'l-1', name: '住宅ローン', balance: 5000000 }],
    futureEvents: [{ eventId: 'f-1', name: '車購入', expenseAmount: 2000000 }],
    scenarios: [{ scenarioId: 's-1', name: '標準', investmentReturnAdjustment: 0 }],
    conditions: { calculationEndAge: 100, defaultInflationRate: 0.02, withdrawal: { enabled: true } },
  },
  simulationResult: { annualResults: [] },
  scenarioResults: [],
}

test('v1.1 XMLブックをアプリの世帯データに復元できる', () => {
  const xml = createExcelXml(sample)
  const restored = parseExcelWorkbook(xml)
  assert.equal(restored.household.householdName, 'テスト世帯')
  assert.equal(restored.persons[0].name, '本人')
  assert.equal(restored.incomeRecords[0].amount, 300000)
  assert.equal(restored.pensions[0].pensionType, 'basic')
  assert.equal(restored.pensions[0].annualAmount, 800000)
  assert.deepEqual(restored.assets[0].metadata, { bank: 'A&B' })
  assert.equal(restored.assets[0].withdrawalEnabled, true)
  assert.deepEqual(restored.conditions.withdrawal, { enabled: true })
})

test('未対応形式や不足シートを拒否する', () => {
  assert.throws(() => parseExcelWorkbook('not xml'), /対応しているExcel XMLブックではありません/)
  assert.throws(() => parseExcelWorkbook('<?xml version="1.0"?><Workbook></Workbook>'), /必要なシートが見つかりません/)
})

test('不正な世帯情報を拒否する', () => {
  const xml = createExcelXml(sample).replace('テスト世帯', '')
  assert.throws(() => parseExcelWorkbook(xml), /世帯IDまたは世帯名/)
})


test('年金シートのない旧Excel XMLも読み込める', () => {
  const xml = createExcelXml(sample).replace(/<Worksheet ss:Name="年金">[\s\S]*?<\/Worksheet>/, '')
  const restored = parseExcelWorkbook(xml)
  assert.equal(restored.pensions, undefined)
})
