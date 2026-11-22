/**
 * Compare the opening financial assets of a year with the previous annual row.
 * Returns null values when a prior year or a positive prior-year base is unavailable.
 */
export function getYearOverYearAssetChange(annualResults, index) {
  const current = annualResults?.[index]
  const previous = annualResults?.[index - 1]
  if (!current || !previous) return { amount: null, rate: null }
  const amount = Number(current.openingFinancialAssets || 0) - Number(previous.openingFinancialAssets || 0)
  const previousOpening = Number(previous.openingFinancialAssets || 0)
  const rate = previousOpening > 0 ? amount / previousOpening * 100 : null
  return { amount, rate }
}
