import test from 'node:test'
import assert from 'node:assert/strict'
import { getYearOverYearAssetChange, formatAnnualTableAge, getAnnualAgeDisplayCutoff } from './annualComparison.js'

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


test('annual table age stays visible at the cutoff and is blank after it', () => {
  assert.equal(formatAnnualTableAge(99, 100), '99歳')
  assert.equal(formatAnnualTableAge(100, 100), '100歳')
  assert.equal(formatAnnualTableAge(101, 100), '')
})

test('annual table age uses default cutoff and keeps unknown ages as dash', () => {
  assert.equal(formatAnnualTableAge(101, undefined), '')
  assert.equal(formatAnnualTableAge(null, 100), '—')
})

test('annual age display cutoff uses the lower person or household limit', () => {
  assert.equal(getAnnualAgeDisplayCutoff(110, 100), 100)
  assert.equal(getAnnualAgeDisplayCutoff(100, 110), 100)
  assert.equal(getAnnualAgeDisplayCutoff(100, 100), 100)
})
