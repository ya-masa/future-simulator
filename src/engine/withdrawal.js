/**
 * 投資資産の自動取り崩し。
 * 売却は収入ではなく、投資資産から現金への振替として扱う。
 */
export function getMinimumCashReserve(conditions = {}) {
  const configured = conditions.withdrawal?.refillStartBalance ?? conditions.withdrawal?.minimumCashReserve
  const legacy = conditions.cashReserveMinimum
  return Math.max(0, Number(configured ?? legacy ?? 0))
}

export function getScheduledContributions(assets = [], date) {
  return assets.reduce((result, asset) => {
    const contributionStart = asset.contributionStartDate || (asset.assetType === 'savingsInsurance' ? asset.contractDate : '')
    const start = contributionStart ? new Date(`${contributionStart}T00:00:00`) : null
    const end = asset.contributionEndDate ? new Date(`${asset.contributionEndDate}T00:00:00`) : null
    const active = (!start || date >= start) && (!end || date <= end)
    if (asset.assetType === 'savingsInsurance' && asset.premiumMode === 'recurring') {
      const frequency = asset.premiumFrequency || 'monthly'
      const amount = Math.max(0, Number(asset.premiumAmount ?? asset.monthlyContribution ?? 0))
      const due = frequency === 'annual'
        ? active && (!start || date.getMonth() === start.getMonth())
        : active
      result[asset.assetId] = due ? amount : 0
    } else {
      result[asset.assetId] = active ? Math.max(0, Number(asset.monthlyContribution || 0)) : 0
    }
    return result
  }, {})
}

export function limitContributionsToAvailableCash(scheduledByAsset, cashBalance, minimumCashReserve) {
  const entries = Object.entries(scheduledByAsset || {})
  const scheduledTotal = entries.reduce((sum, [, amount]) => sum + Math.max(0, Number(amount || 0)), 0)
  const available = Math.max(0, Number(cashBalance || 0) - Math.max(0, Number(minimumCashReserve || 0)))
  const actualTotal = Math.min(scheduledTotal, available)
  if (scheduledTotal <= 0 || actualTotal >= scheduledTotal) return { contributions: Object.fromEntries(entries), total: scheduledTotal }
  const ratio = actualTotal / scheduledTotal
  const contributions = Object.fromEntries(entries.map(([id, amount]) => [id, Math.max(0, Number(amount || 0)) * ratio]))
  return { contributions, total: actualTotal }
}

function priorityFor(asset) {
  if (Number.isFinite(Number(asset.withdrawalPriority))) return Number(asset.withdrawalPriority)
  if (asset.taxCategory === 'taxable') return 10
  if (asset.taxCategory === 'general') return 20
  if (asset.taxCategory === 'nisa') return 30
  return asset.assetType === 'bond' ? 30 : 10
}

export function withdrawInvestmentAssets(assets, requestedAmount) {
  let remaining = Math.max(0, Number(requestedAmount || 0))
  const withdrawals = []
  const ordered = (assets || [])
    .map((asset, index) => ({ asset, index }))
    .filter(({ asset }) => asset.withdrawalEnabled !== false && Number(asset.balance || 0) > 0)
    .sort((a, b) => priorityFor(a.asset) - priorityFor(b.asset) || a.index - b.index)

  const nextAssets = (assets || []).map((asset) => ({ ...asset }))
  for (const { asset, index } of ordered) {
    if (remaining <= 0.000001) break
    const available = Math.max(0, Number(nextAssets[index].balance || 0))
    const amount = Math.min(available, remaining)
    if (amount <= 0) continue
    nextAssets[index].balance = available - amount
    withdrawals.push({ assetId: asset.assetId, name: asset.name || '投資資産', amount })
    remaining -= amount
  }

  return {
    assets: nextAssets,
    withdrawals,
    withdrawnAmount: withdrawals.reduce((sum, item) => sum + item.amount, 0),
    unfundedAmount: Math.max(0, remaining),
  }
}

/** Spend by configured funding priority: cash, deposits, then eligible investment assets. */
export function applyAutomaticFunding(cashAssets = [], investmentAssets = [], requestedAmount = 0) {
  let remaining = Math.max(0, Number(requestedAmount || 0))
  const details = []
  const nextCash = cashAssets.map((asset) => ({ ...asset }))
  const nextInvestments = investmentAssets.map((asset) => ({ ...asset }))
  for (const type of ['cash', 'deposit']) {
    for (const asset of nextCash.filter((item) => item.assetType === type)) {
      if (remaining <= 0.000001) break
      const available = Math.max(0, Number(asset.balance || 0))
      const amount = Math.min(available, remaining)
      if (!amount) continue
      asset.balance = available - amount
      remaining -= amount
      details.push({ assetId: asset.assetId, name: asset.name || type, amount, assetType: type })
    }
  }
  const eligible = nextInvestments.map((asset, index) => ({ asset, index }))
    .filter(({ asset }) => asset.withdrawalEnabled !== false && Number(asset.balance || 0) > 0)
    .sort((a, b) => priorityFor(a.asset) - priorityFor(b.asset) || a.index - b.index)
  for (const { asset } of eligible) {
    if (remaining <= 0.000001) break
    const amount = Math.min(Math.max(0, Number(asset.balance || 0)), remaining)
    if (!amount) continue
    asset.balance -= amount
    remaining -= amount
    details.push({ assetId: asset.assetId, name: asset.name || '投資資産', amount, assetType: 'investment' })
  }
  return { cashAssets: nextCash, investmentAssets: nextInvestments, details, appliedAmount: details.reduce((sum, item) => sum + item.amount, 0), unfundedAmount: Math.max(0, remaining) }
}
