/** Future event asset movements. Legacy individual asset IDs remain supported. */
/** Major asset groups used by event input. Legacy asset IDs remain supported. */
export const EVENT_ASSET_CATEGORIES = [
  { value: 'cash', label: '現金' },
  { value: 'deposit', label: '預貯金' },
  { value: 'investment', label: '投資資産' },
  { value: 'bond', label: '債券' },
  { value: 'other', label: 'その他資産' },
]

export function assetMatchesEventCategory(asset = {}, category = '') {
  const type = asset.assetType || ''
  if (category === 'other') return !['cash', 'deposit', 'investment', 'bond'].includes(type)
  return type === category
}

export function resolveEventAsset(assets = [], category = '', legacyAssetId = '') {
  if (legacyAssetId) {
    const exact = findAsset(assets, legacyAssetId)
    if (exact) return exact
  }
  if (!category) return null
  const matches = (assets || []).filter((asset) => assetMatchesEventCategory(asset, category))
  if (!matches.length) return null
  // Prefer assets with usable balance for withdrawals, then stable priority/order.
  return matches.sort((a, b) =>
    Number(a.withdrawalPriority ?? 50) - Number(b.withdrawalPriority ?? 50)
    || Number(b.balance || 0) - Number(a.balance || 0)
  )[0]
}

export function debitAssetCategory(assets = [], category = '', legacyAssetId = '', amount = 0) {
  const value = Math.max(0, Number(amount || 0))
  if (legacyAssetId) return debitIndividualAsset(assets, legacyAssetId, value)
  const matches = (assets || []).filter((asset) => assetMatchesEventCategory(asset, category))
    .sort((a, b) => Number(a.withdrawalPriority ?? 50) - Number(b.withdrawalPriority ?? 50))
  let remaining = value
  let applied = 0
  for (const asset of matches) {
    const take = Math.min(Math.max(0, Number(asset.balance || 0)), remaining)
    asset.balance = Math.max(0, Number(asset.balance || 0) - take)
    applied += take
    remaining -= take
    if (remaining <= 0) break
  }
  return { ok: remaining <= 0, applied, shortage: remaining, source: matches[0] || null }
}

export function getEventAmount(event = {}) {
  return Math.max(0, Number(event.amount ?? event.incomeAmount ?? event.expenseAmount ?? event.purchaseAmount ?? event.saleAmount ?? event.principalAmount ?? 0))
}

export function findAsset(assets, assetId) {
  return (assets || []).find((asset) => asset.assetId === assetId) || null
}

export function transferBetweenAssets(assets, sourceAssetId, destinationAssetId, amount) {
  const value = Math.max(0, Number(amount || 0))
  const source = findAsset(assets, sourceAssetId)
  const destination = findAsset(assets, destinationAssetId)
  if (!source || !destination || source === destination || value <= 0) {
    return { ok: false, shortage: value, reason: '移動元・移動先の資産を正しく指定してください。' }
  }
  const available = Math.max(0, Number(source.balance || 0))
  const applied = Math.min(available, value)
  source.balance = available - applied
  destination.balance = Number(destination.balance || 0) + applied
  return { ok: applied >= value, applied, shortage: Math.max(0, value - applied), source, destination }
}

export function applyEventIncome(assets, destinationAssetId, amount) {
  const destination = findAsset(assets, destinationAssetId)
  const value = Math.max(0, Number(amount || 0))
  if (!destination) return { ok: false, applied: 0, shortage: value, reason: '入金先資産が未選択です。' }
  destination.balance = Number(destination.balance || 0) + value
  return { ok: true, applied: value, shortage: 0, destination }
}

/** Debit an individual cash/deposit asset. Returns the unpaid amount; never silently creates negative balances. */
export function debitIndividualAsset(assets, sourceAssetId, amount) {
  const source = findAsset(assets, sourceAssetId)
  const value = Math.max(0, Number(amount || 0))
  if (!source) return { ok: false, applied: 0, shortage: value, reason: '支払元資産が未選択です。' }
  const available = Math.max(0, Number(source.balance || 0))
  const applied = Math.min(available, value)
  source.balance = available - applied
  return { ok: applied >= value, applied, shortage: Math.max(0, value - applied), source }
}

export function eventAppliesInMonth(event = {}, monthKey) {
  const start = event.eventDate || event.date || ''
  if (!start || start.slice(0, 7) > monthKey) return false
  const end = event.endDate || ''
  if (end && end.slice(0, 7) < monthKey) return false
  // Recurrence is supported only for income and expense records.
  // Other transaction events are single-date operations even if a stale
  // frequency value remains after changing an event's type in the editor.
  const frequency = ['income', 'expense'].includes(event.type)
    ? (event.frequency || 'once')
    : 'once'
  if (frequency === 'once') return start.slice(0, 7) === monthKey
  if (frequency === 'monthly') return true
  if (frequency === 'yearly') return start.slice(5, 7) === monthKey.slice(5, 7)
  return start.slice(0, 7) === monthKey
}

export function sortEventsForMonth(events = [], monthKey) {
  const order = { income: 1, bondMaturity: 2, contractMaturity: 2, assetSale: 3, autoFunding: 4, expense: 5, assetPurchase: 6, bondPurchase: 7 }
  return events
    .filter((event) => event.enabled !== false && eventAppliesInMonth(event, monthKey))
    .map((event, index) => ({ event, index }))
    .sort((a, b) => (a.event.eventDate || a.event.date || '').localeCompare(b.event.eventDate || b.event.date || '')
      || (order[a.event.type] ?? 99) - (order[b.event.type] ?? 99) || a.index - b.index)
    .map(({ event }) => event)
}
