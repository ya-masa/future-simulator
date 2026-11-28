import test from 'node:test'
import assert from 'node:assert/strict'
import { applyAutomaticFunding, withdrawInvestmentAssets } from './withdrawal.js'

const cash = [{ assetId: 'cash', assetType: 'cash', balance: 0 }]

test('V1.11.0 ロック中の定期預金・解約不可保険を自動補充元にしない', () => {
  const investments = [
    { assetId: 'locked-td', assetType: 'termDeposit', balance: 500000, maturityDate: '2030-01-01', earlySurrenderAllowed: true, lockupUntil: '2028-01-01', surrenderValueAmount: 450000 },
    { assetId: 'no-surrender', assetType: 'savingsInsurance', balance: 300000, maturityDate: '2030-01-01', earlySurrenderAllowed: false },
    { assetId: 'free-investment', assetType: 'investment', balance: 200000, withdrawalEnabled: true, withdrawalPriority: 1 },
  ]
  const result = applyAutomaticFunding(cash, investments, 250000, new Date('2027-06-01T00:00:00'))
  assert.deepEqual(result.details.map((item) => item.assetId), ['free-investment'])
  assert.equal(result.details[0].amount, 200000)
  assert.equal(result.unfundedAmount, 50000)
  assert.equal(result.investmentAssets.find((item) => item.assetId === 'locked-td').balance, 500000)
})

test('V1.11.0 ロック終了後に途中解約可能な契約は返戻金を上限に補充できる', () => {
  const investments = [{ assetId: 'surrenderable', assetType: 'savingsInsurance', balance: 500000, maturityDate: '2030-01-01', earlySurrenderAllowed: true, lockupUntil: '2027-01-01', surrenderValueAmount: 400000 }]
  const result = applyAutomaticFunding(cash, investments, 100000, new Date('2027-06-01T00:00:00'))
  assert.equal(result.details[0].amount, 100000)
  assert.equal(result.investmentAssets[0].balance, 375000)
})

test('V1.11.0 満期月の契約資産を満期振替前に自動補充へ二重使用しない', () => {
  const investments = [{ assetId: 'maturing', assetType: 'termDeposit', balance: 500000, maturityDate: '2027-06-20', earlySurrenderAllowed: true, lockupUntil: '2026-01-01', surrenderValueAmount: 450000 }]
  const result = applyAutomaticFunding(cash, investments, 100000, new Date('2027-06-01T00:00:00'))
  assert.equal(result.details.length, 0)
  assert.equal(result.unfundedAmount, 100000)
})

test('V1.11.0 最低現金補充でもロック中の契約資産を売却しない', () => {
  const investments = [{ assetId: 'locked', assetType: 'termDeposit', balance: 600000, maturityDate: '2031-01-01', earlySurrenderAllowed: false }]
  const result = withdrawInvestmentAssets(investments, 200000, new Date('2027-01-01T00:00:00'))
  assert.equal(result.withdrawnAmount, 0)
  assert.equal(result.unfundedAmount, 200000)
  assert.equal(result.assets[0].balance, 600000)
})

test('V1.11.3 自動補充チェックを外した現金・預貯金は保護し、チェックした預貯金を使用する', () => {
  const cashAssets = [
    { assetId: 'protected-cash', assetType: 'cash', balance: 100000, withdrawalEnabled: false },
    { assetId: 'protected-deposit', assetType: 'deposit', balance: 500000, withdrawalEnabled: false },
    { assetId: 'available-deposit', assetType: 'deposit', balance: 300000, withdrawalEnabled: true },
  ]
  const result = applyAutomaticFunding(cashAssets, [], 250000, new Date('2027-01-01T00:00:00'))
  assert.deepEqual(result.details.map((item) => item.assetId), ['available-deposit'])
  assert.equal(result.details[0].amount, 250000)
  assert.equal(result.cashAssets.find((item) => item.assetId === 'protected-cash').balance, 100000)
  assert.equal(result.cashAssets.find((item) => item.assetId === 'protected-deposit').balance, 500000)
  assert.equal(result.cashAssets.find((item) => item.assetId === 'available-deposit').balance, 50000)
  assert.equal(result.unfundedAmount, 0)
})

test('V1.11.3 チェック未設定の既存現金・預貯金は従来どおり自動補充対象', () => {
  const cashAssets = [{ assetId: 'legacy-cash', assetType: 'cash', balance: 100000 }]
  const result = applyAutomaticFunding(cashAssets, [], 60000, new Date('2027-01-01T00:00:00'))
  assert.equal(result.cashAssets[0].balance, 40000)
  assert.equal(result.appliedAmount, 60000)
})
