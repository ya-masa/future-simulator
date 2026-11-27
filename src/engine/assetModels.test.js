import test from 'node:test'
import assert from 'node:assert/strict'
import { getContractAssetAnnualRate, contractAssetMonthlyGrowth, isContractAsset } from './assetModels.js'
import { growInvestmentAssets } from './investment.js'
import { getScheduledContributions } from './withdrawal.js'

test('term deposit asset model derives an annual compound rate from fixed maturity proceeds', () => {
  const asset = { assetType: 'termDeposit', principalAmount: 1000000, maturityPayoutAmount: 1210000, maturityPayoutMode: 'amount', contractDate: '2026-01-01', maturityDate: '2028-01-01', interestMethod: 'compound' }
  assert.ok(Math.abs(getContractAssetAnnualRate(asset) - 0.1) < 0.001)
  assert.equal(isContractAsset(asset), true)
})

test('term deposit simple interest uses original principal and compound uses balance', () => {
  const simple = { assetType: 'termDeposit', principalAmount: 100000, maturityPayoutMode: 'rate', maturityReturnRate: 0.12, interestMethod: 'simple', contractDate: '2026-01-01', maturityDate: '2030-01-01' }
  assert.equal(contractAssetMonthlyGrowth(simple, new Date('2026-02-01T00:00:00'), 110000, 0), 111000)
  const compound = { ...simple, interestMethod: 'compound', compoundingFrequency: 12 }
  assert.ok(contractAssetMonthlyGrowth(compound, new Date('2026-02-01T00:00:00'), 110000, 0) > 110000)
})

test('contract asset stops accruing after maturity date', () => {
  const asset = { assetType: 'termDeposit', principalAmount: 100000, maturityPayoutMode: 'rate', maturityReturnRate: 0.1, interestMethod: 'compound', maturityDate: '2027-01-15' }
  assert.equal(contractAssetMonthlyGrowth(asset, new Date('2027-02-01T00:00:00'), 125000, 0), 125000)
})

test('savings insurance annual premiums are scheduled once per contract anniversary month', () => {
  const asset = { assetId: 'ins1', assetType: 'savingsInsurance', premiumMode: 'recurring', premiumFrequency: 'annual', premiumAmount: 120000, contractDate: '2026-04-10', contributionStartDate: '2026-04-10', contributionEndDate: '2030-04-10' }
  assert.equal(getScheduledContributions([asset], new Date('2027-04-01T00:00:00')).ins1, 120000)
  assert.equal(getScheduledContributions([asset], new Date('2027-05-01T00:00:00')).ins1, 0)
})

test('growInvestmentAssets applies contract asset maturity model and annual insurance premium', () => {
  const asset = { assetId: 'ins2', assetType: 'savingsInsurance', balance: 100000, principalAmount: 100000, maturityPayoutMode: 'rate', maturityReturnRate: 0.03, interestMethod: 'compound', compoundingFrequency: 12 }
  const grown = growInvestmentAssets([asset], new Date('2026-02-01T00:00:00'), { ins2: 10000 }, 0.05)[0]
  assert.ok(grown.balance > 110000)
})

test('recurring savings insurance derives an annualized return from scheduled premiums and maturity proceeds', () => {
  const asset = {
    assetType: 'savingsInsurance', premiumMode: 'recurring', premiumFrequency: 'monthly', premiumAmount: 10000,
    contractDate: '2026-01-01', contributionStartDate: '2026-01-01', contributionEndDate: '2035-12-01',
    maturityDate: '2036-01-01', maturityPayoutMode: 'amount', maturityPayoutAmount: 1400000, interestMethod: 'compound',
  }
  const rate = getContractAssetAnnualRate(asset)
  assert.ok(rate > 0)
  assert.ok(rate < 0.1)
})

test('contract asset balance is calculated from contract start date, not a manually entered current balance', async () => {
  const { getContractAssetBalanceAtDate } = await import('./assetModels.js')
  const asset = {
    assetType: 'termDeposit', principalAmount: 1000000, balance: 9999999,
    maturityPayoutMode: 'amount', maturityPayoutAmount: 1210000,
    contractDate: '2020-01-01', maturityDate: '2022-01-01', interestMethod: 'compound',
  }
  const value = getContractAssetBalanceAtDate(asset, new Date('2021-01-01T00:00:00'))
  assert.ok(value > 1090000 && value < 1110000)
})

test('contract starting in the simulation start month begins with zero initial balance', async () => {
  const { getContractAssetBalanceAtDate } = await import('./assetModels.js')
  const asset = { assetType: 'termDeposit', principalAmount: 500000, contractDate: '2026-01-01', maturityDate: '2030-01-01', maturityPayoutMode: 'amount', maturityPayoutAmount: 600000, interestMethod: 'compound' }
  assert.equal(getContractAssetBalanceAtDate(asset, new Date('2026-01-01T00:00:00')), 0)
})
