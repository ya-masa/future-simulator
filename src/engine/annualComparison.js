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

/** Resolve the display cutoff from the person's and household's configured limits. */
export function getAnnualAgeDisplayCutoff(personCutoff, householdCutoff) {
  const personLimit = Number(personCutoff ?? 100)
  const householdLimit = Number(householdCutoff ?? 100)
  const validPersonLimit = Number.isFinite(personLimit) ? personLimit : 100
  const validHouseholdLimit = Number.isFinite(householdLimit) ? householdLimit : 100
  return Math.min(validPersonLimit, validHouseholdLimit)
}

/** Display a person's age only through the effective configured cutoff. */
export function formatAnnualTableAge(age, calculationEndAge) {
  if (age == null || age === '') return '—'
  const numericAge = Number(age)
  const cutoff = Number(calculationEndAge ?? 100)
  if (!Number.isFinite(numericAge)) return '—'
  if (Number.isFinite(cutoff) && numericAge > cutoff) return ''
  return `${numericAge}歳`
}
