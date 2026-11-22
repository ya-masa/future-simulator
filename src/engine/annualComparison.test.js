import test from 'node:test'
import assert from 'node:assert/strict'
import { getYearOverYearAssetChange } from './annualComparison.js'

test('year-on-year opening asset change and rate are calculated from adjacent annual rows', () => {
  const rows = [
    { year: 2036, openingFinancialAssets: 10000000 },
    { year: 2037, openingFinancialAssets: 12000000 },
  ]
  assert.deepEqual(getYearOverYearAssetChange(rows, 1), { amount: 2000000, rate: 20 })
})

test('first year has no prior-year comparison', () => {
  assert.deepEqual(getYearOverYearAssetChange([{ openingFinancialAssets: 100 }], 0), { amount: null, rate: null })
})

test('percentage is unavailable when previous opening assets are zero', () => {
  const rows = [{ openingFinancialAssets: 0 }, { openingFinancialAssets: 100 }]
  assert.deepEqual(getYearOverYearAssetChange(rows, 1), { amount: 100, rate: null })
})
