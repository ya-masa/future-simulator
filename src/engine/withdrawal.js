import { isContractAsset } from './assetModels.js'

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

function asDate(value) {
  if (value instanceof Date) return value
  if (!value) return null
  const date = new Date(`${value}T00:00:00`)
  return Number.isFinite(date.getTime()) ? date : null
}

/** Returns the amount available from an investment asset without violating contract lockups. */
export function isAssetEligibleForAutomaticFunding(asset, date = null) {
  if (asset?.assetType === 'cash' || asset?.assetType === 'deposit') return true
  return availableInvestmentFunding(asset, date) > 0
}

function availableInvestmentFunding(asset, date) {
  if (asset.withdrawalEnabled === false) return 0
  const balance = Math.max(0, Number(asset.balance || 0))
  if (!isContractAsset(asset)) return balance
  const currentDate = asDate(date)
  const maturityDate = asDate(asset.maturityDate)
  // Maturity proceeds are transferred by the maturity handler; do not fund from the
  // contract earlier in the same simulation month or the payout could be counted twice.
  if (maturityDate && currentDate && maturityDate.getFullYear() * 12 + maturityDate.getMonth() <= currentDate.getFullYear() * 12 + currentDate.getMonth()) return 0
  if (!asset.earlySurrenderAllowed) return 0
  const lockupUntil = asDate(asset.lockupUntil)
  if (lockupUntil && currentDate && currentDate < lockupUntil) return 0
  const surrenderValue = Math.max(0, Number(asset.surrenderValueAmount || 0))
  return surrenderValue > 0 ? Math.min(balance, surrenderValue) : 0
}

function debitInvestmentFunding(asset, requested, available) {
  const amount = Math.min(Math.max(0, Number(requested || 0)), Math.max(0, Number(available || 0)))
  if (isContractAsset(asset)) {
    const balance = Math.max(0, Number(asset.balance || 0))
    const fundingValue = Math.max(0, Number(available || 0))
    const balanceReduction = fundingValue > 0 ? balance * (amount / fundingValue) : 0
    asset.balance = Math.max(0, balance - balanceReduction)
  } else {
    asset.balance = Math.max(0, Number(asset.balance || 0) - amount)
  }
  return amount
}

export function withdrawInvestmentAssets(assets, requestedAmount, date = null) {
  let remaining = Math.max(0, Number(requestedAmount || 0))
  const withdrawals = []
  const ordered = (assets || [])
    .map((asset, index) => ({ asset, index }))
    .filter(({ asset }) => availableInvestmentFunding(asset, date) > 0)
    .sort((a, b) => priorityFor(a.asset) - priorityFor(b.asset) || a.index - b.index)

  const nextAssets = (assets || []).map((asset) => ({ ...asset }))
  for (const { asset, index } of ordered) {
    if (remaining <= 0.000001) break
    const available = availableInvestmentFunding(nextAssets[index], date)
    const amount = Math.min(available, remaining)
    if (amount <= 0) continue
    debitInvestmentFunding(nextAssets[index], amount, available)
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
export function applyAutomaticFunding(cashAssets = [], investmentAssets = [], requestedAmount = 0, date = null) {
  let remaining = Math.max(0, Number(requestedAmount || 0))
  const details = []
  const nextCash = cashAssets.map((asset) => ({ ...asset }))
  const nextInvestments = investmentAssets.map((asset) => ({ ...asset }))
  for (const type of ['cash', 'deposit']) {
    for (const asset of nextCash.filter((item) => item.assetType === type && item.withdrawalEnabled !== false)) {
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
    .filter(({ asset }) => availableInvestmentFunding(asset, date) > 0)
    .sort((a, b) => priorityFor(a.asset) - priorityFor(b.asset) || a.index - b.index)
  for (const { asset } of eligible) {
    if (remaining <= 0.000001) break
    const available = availableInvestmentFunding(asset, date)
    const amount = Math.min(available, remaining)
    if (!amount) continue
    debitInvestmentFunding(asset, amount, available)
    remaining -= amount
    details.push({ assetId: asset.assetId, name: asset.name || '投資資産', amount, assetType: 'investment' })
  }
  return { cashAssets: nextCash, investmentAssets: nextInvestments, details, appliedAmount: details.reduce((sum, item) => sum + item.amount, 0), unfundedAmount: Math.max(0, remaining) }
}
