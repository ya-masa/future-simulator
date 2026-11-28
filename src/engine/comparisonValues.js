/** Comparison-only financial position: assets offset by unresolved cash shortfall. */
export function getComparableFinancialAssets(financialAssets, unresolvedCashShortfall = 0) {
  const assets = Number(financialAssets ?? 0)
  const shortfall = Number(unresolvedCashShortfall ?? 0)
  return (Number.isFinite(assets) ? assets : 0) - Math.max(0, Number.isFinite(shortfall) ? shortfall : 0)
}
