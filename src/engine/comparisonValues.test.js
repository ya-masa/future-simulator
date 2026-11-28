import test from 'node:test'
import assert from 'node:assert/strict'
import { getComparableFinancialAssets } from './comparisonValues.js'

test('comparison preserves negative financial position after unresolved shortfall', () => {
  assert.equal(getComparableFinancialAssets(0, 72000000), -72000000)
})

test('comparison offsets shortfall against remaining financial assets', () => {
  assert.equal(getComparableFinancialAssets(25000000, 30000000), -5000000)
  assert.equal(getComparableFinancialAssets(50000000, 30000000), 20000000)
})

test('comparison handles missing or invalid values safely', () => {
  assert.equal(getComparableFinancialAssets(100), 100)
  assert.equal(getComparableFinancialAssets(undefined, 20), -20)
  assert.equal(getComparableFinancialAssets(NaN, -5), 0)
})
