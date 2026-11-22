/**
 * 税金・社会保険料の概算計算。
 * 法定税額の再現ではなく、ユーザーが設定した実効率を収入に適用する。
 * 率は 0.05 = 5% の小数で指定する。
 * yearlyRates は「その年から次の設定年の前まで」適用する年度別上書き。
 */
const RATE_FIELDS = [
  'salaryIncomeTaxRate',
  'salaryResidentTaxRate',
  'salarySocialInsuranceRate',
  'pensionIncomeTaxRate',
  'pensionResidentTaxRate',
  'pensionSocialInsuranceRate',
  'otherIncomeTaxRate',
  'otherResidentTaxRate',
]

function safeRate(value) {
  const rate = Number(value ?? 0)
  if (!Number.isFinite(rate)) return 0
  return Math.min(1, Math.max(0, rate))
}

export function resolveTaxInsuranceRates(conditions = {}, year = null) {
  const settings = conditions.taxInsurance || {}
  const baseRates = Object.fromEntries(RATE_FIELDS.map((key) => [key, safeRate(settings[key])]))
  const targetYear = Number(year)
  const yearlyRates = (Array.isArray(settings.yearlyRates) ? settings.yearlyRates : [])
    .map((rule) => ({ ...rule, year: Number(rule.year) }))
    .filter((rule) => Number.isInteger(rule.year) && rule.year >= 1900 && rule.year <= 2200)
    .sort((a, b) => a.year - b.year)

  if (!Number.isFinite(targetYear)) return { rates: baseRates, effectiveYear: null }
  const applicable = yearlyRates.filter((rule) => rule.year <= targetYear).at(-1)
  if (!applicable) return { rates: baseRates, effectiveYear: null }

  const override = applicable.rates || {}
  return {
    rates: Object.fromEntries(RATE_FIELDS.map((key) => [key, safeRate(override[key] ?? baseRates[key])])),
    effectiveYear: applicable.year,
  }
}

export function calculateMonthlyTaxAndInsurance({
  salaryIncome = 0,
  pensionIncome = 0,
  otherIncome = 0,
  conditions = {},
  year = null,
} = {}) {
  const { rates, effectiveYear } = resolveTaxInsuranceRates(conditions, year)
  const salary = Math.max(0, Number(salaryIncome) || 0)
  const pension = Math.max(0, Number(pensionIncome) || 0)
  const other = Math.max(0, Number(otherIncome) || 0)

  const incomeTax = salary * rates.salaryIncomeTaxRate
    + pension * rates.pensionIncomeTaxRate
    + other * rates.otherIncomeTaxRate
  const residentTax = salary * rates.salaryResidentTaxRate
    + pension * rates.pensionResidentTaxRate
    + other * rates.otherResidentTaxRate
  const socialInsurance = salary * rates.salarySocialInsuranceRate
    + pension * rates.pensionSocialInsuranceRate

  return {
    incomeTax,
    residentTax,
    tax: incomeTax + residentTax,
    socialInsurance,
    total: incomeTax + residentTax + socialInsurance,
    effectiveRateYear: effectiveYear,
  }
}

export const TAX_INSURANCE_RATE_FIELDS = RATE_FIELDS
