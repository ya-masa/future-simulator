import test from 'node:test'
import assert from 'node:assert/strict'
import { clonePlanData, initializeSavedPlanLibrary, summarizePlanResult } from './planManagement.js'

test('V1.5.9 data migrates to one saved plan without losing the household data', () => {
  const source = { household: { householdId: 'family-1', householdName: 'My household' }, assets: [{ balance: 123 }], scenarios: [{ scenarioId: 'standard' }] }
  initializeSavedPlanLibrary(source)
  assert.equal(source.household.householdId, 'family-1')
  assert.equal(source.savedPlans.length, 1)
  assert.equal(source.savedPlans[0].data.assets[0].balance, 123)
  assert.equal(source.savedPlans[0].data.savedPlans, undefined)
  assert.equal(source.activeSavedPlanId, source.savedPlans[0].planId)
})

test('clonePlanData excludes plan-library metadata', () => {
  const copy = clonePlanData({ household: {}, savedPlans: [{ planId: 'x' }], activeSavedPlanId: 'x' })
  assert.deepEqual(copy, { household: {} })
})

test('summary finds minimum and final financial assets with age information', () => {
  const summary = summarizePlanResult({
    summary: { startYear: 2026, startFinancialAssets: 1000, endFinancialAssets: 250, endYear: 2028 },
    annualResults: [
      { year: 2026, closingFinancialAssets: 800, ages: [{ name: 'Person', age: 46 }] },
      { year: 2027, closingFinancialAssets: 200, ages: [{ name: 'Person', age: 47 }] },
      { year: 2028, closingFinancialAssets: 250, ages: [{ name: 'Person', age: 48 }] },
    ],
  })
  assert.equal(summary.minimumAssets, 200)
  assert.equal(summary.minimumYear, 2027)
  assert.deepEqual(summary.minimumAges, [{ name: 'Person', age: 47 }])
  assert.equal(summary.finalAssets, 250)
})

test('existing plan library retains inactive snapshots and refreshes the active one', () => {
  const data = {
    household: { householdId: 'family-2' },
    assets: [{ balance: 900 }],
    savedPlans: [
      { planId: 'p1', name: 'Current', data: { household: { householdId: 'family-2' }, assets: [{ balance: 1 }] } },
      { planId: 'p2', name: 'Other', data: { household: { householdId: 'family-2' }, assets: [{ balance: 2 }] } },
    ],
    activeSavedPlanId: 'p1',
  }
  initializeSavedPlanLibrary(data)
  assert.equal(data.savedPlans.find((plan) => plan.planId === 'p1').data.assets[0].balance, 900)
  assert.equal(data.savedPlans.find((plan) => plan.planId === 'p2').data.assets[0].balance, 2)
})
