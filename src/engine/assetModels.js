const CONTRACT_ASSET_TYPES = new Set(['termDeposit', 'savingsInsurance'])

export function isContractAsset(asset) {
  return CONTRACT_ASSET_TYPES.has(asset?.assetType)
}

function dateYearsBetween(startDate, endDate) {
  if (!startDate || !endDate) return 0
  const start = new Date(`${startDate}T00:00:00`)
  const end = new Date(`${endDate}T00:00:00`)
  const years = (end.getTime() - start.getTime()) / (365.2425 * 86400000)
  return Number.isFinite(years) && years > 0 ? years : 0
}


function getRecurringInsuranceYield(asset, payout) {
  const premium = Math.max(0, Number(asset.premiumAmount || 0))
  const startDate = asset.contributionStartDate || asset.contractDate
  const endDate = asset.contributionEndDate || asset.maturityDate
  const years = dateYearsBetween(startDate, asset.maturityDate)
  if (premium <= 0 || !startDate || !endDate || years <= 0) return null
  const start = new Date(`${startDate}T00:00:00`)
  const end = new Date(`${endDate}T00:00:00`)
  const maturity = new Date(`${asset.maturityDate}T00:00:00`)
  const payments = []
  const monthIndex = (date) => date.getFullYear() * 12 + date.getMonth()
  if ((asset.premiumFrequency || 'monthly') === 'annual') {
    for (let year = start.getFullYear(); year <= end.getFullYear(); year += 1) {
      const paymentDate = new Date(year, start.getMonth(), 1)
      if (paymentDate >= new Date(start.getFullYear(), start.getMonth(), 1) && paymentDate <= new Date(end.getFullYear(), end.getMonth(), 1)) {
        payments.push({ amount: premium, months: Math.max(0, monthIndex(maturity) - monthIndex(paymentDate)) })
      }
    }
  } else {
    for (let index = monthIndex(start); index <= monthIndex(end); index += 1) {
      payments.push({ amount: premium, months: Math.max(0, monthIndex(maturity) - index) })
    }
  }
  if (!payments.length) return null
  const totalPremiums = payments.reduce((sum, item) => sum + item.amount, 0)
  if (asset.interestMethod === 'simple') {
    const weightedYears = payments.reduce((sum, item) => sum + item.amount * item.months / 12, 0)
    return weightedYears > 0 ? (payout - totalPremiums) / weightedYears : null
  }
  let low = -0.08
  let high = 1
  const futureValue = (monthlyRate) => payments.reduce((sum, item) => sum + item.amount * Math.pow(1 + monthlyRate, item.months), 0)
  if (payout < futureValue(low) || payout > futureValue(high)) return null
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const middle = (low + high) / 2
    if (futureValue(middle) < payout) low = middle
    else high = middle
  }
  return Math.pow(1 + (low + high) / 2, 12) - 1
}

/** Annual nominal rate derived from fixed maturity proceeds, if supplied. */
export function getContractAssetAnnualRate(asset) {
  if (!isContractAsset(asset)) return null
  if (asset.maturityPayoutMode === 'rate') {
    return Math.max(-0.99, Number(asset.maturityReturnRate || 0))
  }
  const payout = Math.max(0, Number(asset.maturityPayoutAmount || 0))
  if (asset.assetType === 'savingsInsurance' && asset.premiumMode === 'recurring') {
    const recurringRate = getRecurringInsuranceYield(asset, payout)
    if (recurringRate != null) return recurringRate
    return null
  }
  const principal = Math.max(0, Number(asset.principalAmount ?? asset.balance ?? 0))
  const years = dateYearsBetween(asset.contractDate, asset.maturityDate)
  if (principal <= 0 || payout <= 0 || years <= 0) return null
  const ratio = payout / principal
  if (asset.interestMethod === 'simple') return (ratio - 1) / years
  return Math.pow(ratio, 1 / years) - 1
}

export function contractAssetMonthlyGrowth(asset, date, balance, contribution = 0) {
  if (!isContractAsset(asset)) return null
  const maturity = asset.maturityDate ? new Date(`${asset.maturityDate}T00:00:00`) : null
  if (maturity && date >= maturity) return Number(balance || 0) + Math.max(0, Number(contribution || 0))

  const annualRate = getContractAssetAnnualRate(asset)
  if (annualRate == null) return Number(balance || 0) + Math.max(0, Number(contribution || 0))
  const principal = Math.max(0, Number(asset.contributedPrincipal ?? asset.principalAmount ?? balance ?? 0))
  const base = Number(balance || 0) + Math.max(0, Number(contribution || 0))
  if (asset.interestMethod === 'simple') {
    return base + principal * annualRate / 12
  }
  const frequency = Math.max(1, Number(asset.compoundingFrequency || 12))
  const monthlyRate = asset.maturityPayoutMode === 'amount'
    ? Math.pow(Math.max(0, 1 + annualRate), 1 / 12) - 1
    : Math.pow(Math.max(0, 1 + annualRate / frequency), frequency / 12) - 1
  return base * (1 + monthlyRate)
}

export function getContractAssetModelSummary(asset) {
  if (!isContractAsset(asset)) return null
  return {
    principalAmount: Math.max(0, Number(asset.principalAmount ?? asset.balance ?? 0)),
    contractDate: asset.contractDate || '',
    maturityDate: asset.maturityDate || '',
    maturityPayoutMode: asset.maturityPayoutMode || 'amount',
    maturityPayoutAmount: Math.max(0, Number(asset.maturityPayoutAmount || 0)),
    maturityReturnRate: Number(asset.maturityReturnRate || 0),
    interestMethod: asset.interestMethod || 'compound',
    compoundingFrequency: Math.max(1, Number(asset.compoundingFrequency || 12)),
  }
}
