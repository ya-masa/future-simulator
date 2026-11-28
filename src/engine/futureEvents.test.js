import test from 'node:test'
import assert from 'node:assert/strict'
import { applyEventIncome, debitIndividualAsset, debitAssetCategory, resolveEventAsset, eventAppliesInMonth, sortEventsForMonth, transferBetweenAssets } from './futureEvents.js'
import { applyAutomaticFunding } from './withdrawal.js'

const assets = () => [
  { assetId: 'cash', assetType: 'cash', name: '現金', balance: 100 },
  { assetId: 'dep', assetType: 'deposit', name: '預貯金', balance: 200 },
  { assetId: 'nisa', assetType: 'investment', name: 'NISA', balance: 500, taxCategory: 'nisa', withdrawalEnabled: true, withdrawalPriority: 10 },
  { assetId: 'tax', assetType: 'investment', name: '特定口座', balance: 400, taxCategory: 'taxable', withdrawalEnabled: false, withdrawalPriority: 1 },
]

test('イベント収入は指定した個別資産に入金する', () => {
  const data = assets()
  const result = applyEventIncome(data, 'nisa', 50)
  assert.equal(result.ok, true)
  assert.equal(data[2].balance, 550)
})

test('イベント支出は指定資産残高を超えてマイナスにしない', () => {
  const data = assets()
  const result = debitIndividualAsset(data, 'cash', 150)
  assert.equal(result.applied, 100)
  assert.equal(result.shortage, 50)
  assert.equal(data[0].balance, 0)
})

test('資産移動は個別資産間で残高を移す', () => {
  const data = assets()
  const result = transferBetweenAssets(data, 'dep', 'nisa', 125)
  assert.equal(result.ok, true)
  assert.equal(data[1].balance, 75)
  assert.equal(data[2].balance, 625)
})

test('自動資金補充は現金、預貯金、対象投資資産の順に充当する', () => {
  const data = assets()
  const result = applyAutomaticFunding(data.filter((a) => ['cash','deposit'].includes(a.assetType)), data.filter((a) => !['cash','deposit'].includes(a.assetType)), 450)
  assert.deepEqual(result.details.map((x) => [x.assetId, x.amount]), [['cash',100],['dep',200],['nisa',150]])
  assert.equal(result.unfundedAmount, 0)
})

test('イベントの同日処理順は収入・満期・売却・補充・支出・購入', () => {
  const events = ['assetPurchase','expense','income','autoFunding','bondMaturity','assetSale'].map((type, i) => ({ type, eventDate: '2027-01-10', eventId: String(i) }))
  assert.deepEqual(sortEventsForMonth(events, '2027-01').map((e) => e.type), ['income','bondMaturity','assetSale','autoFunding','expense','assetPurchase'])
})


test('適用除外イベントは月次イベント一覧から除外し、未設定は従来どおり適用する', () => {
  const events = [
    { type: 'income', eventDate: '2027-01-10', eventId: 'on', enabled: true },
    { type: 'expense', eventDate: '2027-01-10', eventId: 'off', enabled: false },
    { type: 'assetSale', eventDate: '2027-01-10', eventId: 'legacy' },
  ]
  assert.deepEqual(sortEventsForMonth(events, '2027-01').map((event) => event.eventId), ['on', 'legacy'])
})


test('収入・支出イベントの繰り返し頻度と期間を判定する', () => {
  const monthly = { type: 'income', eventDate: '2027-04-15', endDate: '2028-04-30', frequency: 'monthly' }
  assert.equal(eventAppliesInMonth(monthly, '2027-04'), true)
  assert.equal(eventAppliesInMonth(monthly, '2027-12'), true)
  assert.equal(eventAppliesInMonth(monthly, '2028-05'), false)
  const yearly = { ...monthly, frequency: 'yearly' }
  assert.equal(eventAppliesInMonth(yearly, '2028-04'), true)
  assert.equal(eventAppliesInMonth(yearly, '2028-05'), false)
  const once = { ...monthly, frequency: 'once' }
  assert.equal(eventAppliesInMonth(once, '2027-05'), false)
})

test('資産区分は個別資産を自動選択し、旧assetIdも互換利用できる', () => {
  const data = assets()
  assert.equal(resolveEventAsset(data, 'deposit').assetId, 'dep')
  assert.equal(resolveEventAsset(data, 'investment', 'nisa').assetId, 'nisa')
})

test('資産区分による支出は同じ区分の複数資産から順に引き落とす', () => {
  const data = assets()
  const result = debitAssetCategory(data, 'deposit', '', 250)
  assert.equal(result.applied, 200)
  assert.equal(result.shortage, 50)
  assert.equal(data[1].balance, 0)
})


test('債券購入イベントは古い毎月頻度が残っていても購入日に一度だけ適用する', () => {
  const event = {
    eventId: 'bond-once',
    type: 'bondPurchase',
    eventDate: '2027-04-15',
    frequency: 'monthly',
    purchaseAmount: 1000000,
  }
  assert.equal(eventAppliesInMonth(event, '2027-04'), true)
  assert.equal(eventAppliesInMonth(event, '2027-05'), false)
  assert.equal(eventAppliesInMonth(event, '2028-04'), false)
})

test('資産購入・売却・満期イベントは頻度値にかかわらず指定月だけ適用する', () => {
  for (const type of ['assetPurchase', 'assetSale', 'bondMaturity', 'autoFunding']) {
    const event = { type, eventDate: '2027-06-01', frequency: 'yearly' }
    assert.equal(eventAppliesInMonth(event, '2027-06'), true, type)
    assert.equal(eventAppliesInMonth(event, '2028-06'), false, type)
  }
})


test('V1.11.0 ロック中の契約資産を指定したイベント支出は直接引き落とさない', () => {
  const data = [{ assetId: 'locked-event', assetType: 'termDeposit', balance: 100000, maturityDate: '2030-01-01', earlySurrenderAllowed: false }]
  const result = debitAssetCategory(data, '', 'locked-event', 50000, { forFunding: true, date: new Date('2027-01-01T00:00:00') })
  assert.equal(result.applied, 0)
  assert.equal(result.shortage, 50000)
  assert.equal(data[0].balance, 100000)
})
