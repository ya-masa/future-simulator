import { isActiveInMonth } from './dateUtils.js'

export function monthlyRateFromAnnual(annualRate) {
  return Math.pow(1 + Number(annualRate || 0), 1 / 12) - 1
}

export function isContributionActive(asset, date) {
  return isActiveInMonth({
    startDate: asset.contributionStartDate,
    endDate: asset.contributionEndDate,
  }, date)
}

export function growInvestmentAssets(assets, date, contributionOverrides = null, defaultAnnualReturn = 0) {
  return assets.map((asset) => {
    const contribution = contributionOverrides
      ? Math.max(0, Number(contributionOverrides[asset.assetId] || 0))
      : isContributionActive(asset, date)
        ? Number(asset.monthlyContribution || 0)
        : 0
    const annualReturn = asset.annualReturn == null ? Number(defaultAnnualReturn || 0) : Number(asset.annualReturn || 0)
    const rate = monthlyRateFromAnnual(annualReturn)
    const balance = (Number(asset.balance || 0) + contribution) * (1 + rate)
    return { ...asset, balance, contributionThisMonth: contribution }
  })
}

export function growCashAssets(assets) {
  return assets.map((asset) => {
    const rate = monthlyRateFromAnnual(asset.annualReturn)
    const currentBalance = Number(asset.balance || 0)
    const balance = currentBalance >= 0
      ? currentBalance * (1 + rate)
      : currentBalance
    return { ...asset, balance }
  })
}
