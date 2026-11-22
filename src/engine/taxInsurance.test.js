import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateMonthlyTaxAndInsurance, resolveTaxInsuranceRates } from './taxInsurance.js'

const baseConditions = {
  taxInsurance: {
    salaryIncomeTaxRate: 0.05,
    salaryResidentTaxRate: 0.05,
    salarySocialInsuranceRate: 0.15,
    pensionIncomeTaxRate: 0.03,
    pensionResidentTaxRate: 0.05,
    pensionSocialInsuranceRate: 0.08,
    otherIncomeTaxRate: 0.04,
    otherResidentTaxRate: 0.05,
    yearlyRates: [
      { year: 2030, rates: { salaryIncomeTaxRate: 0.06, salaryResidentTaxRate: 0.06 } },
      { year: 2040, rates: { salaryIncomeTaxRate: 0.07 } },
    ],
  },
}

test('年度別設定より前の年は基本概算率を使用する', () => {
  const resolved = resolveTaxInsuranceRates(baseConditions, 2029)
  assert.equal(resolved.rates.salaryIncomeTaxRate, 0.05)
  assert.equal(resolved.effectiveYear, null)
})

test('年度別設定は適用開始年から次の設定年の前まで有効', () => {
  const at2035 = resolveTaxInsuranceRates(baseConditions, 2035)
  assert.equal(at2035.rates.salaryIncomeTaxRate, 0.06)
  assert.equal(at2035.rates.salaryResidentTaxRate, 0.06)
  assert.equal(at2035.rates.salarySocialInsuranceRate, 0.15)
  assert.equal(at2035.effectiveYear, 2030)
  const at2040 = resolveTaxInsuranceRates(baseConditions, 2040)
  assert.equal(at2040.rates.salaryIncomeTaxRate, 0.07)
  assert.equal(at2040.rates.salaryResidentTaxRate, 0.05)
  assert.equal(at2040.effectiveYear, 2040)
})

test('年度別概算率を月次収入に適用して内訳を返す', () => {
  const result = calculateMonthlyTaxAndInsurance({
    salaryIncome: 100000,
    pensionIncome: 50000,
    otherIncome: 10000,
    conditions: baseConditions,
    year: 2030,
  })
  assert.equal(result.incomeTax, 6000 + 1500 + 400)
  assert.equal(result.residentTax, 6000 + 2500 + 500)
  assert.equal(result.socialInsurance, 15000 + 4000)
  assert.equal(result.effectiveRateYear, 2030)
})

test('年度別設定が空なら従来の基本概算率で計算する', () => {
  const result = calculateMonthlyTaxAndInsurance({
    salaryIncome: 100000,
    conditions: { taxInsurance: { salaryIncomeTaxRate: 0.1, yearlyRates: [] } },
    year: 2035,
  })
  assert.equal(result.incomeTax, 10000)
  assert.equal(result.effectiveRateYear, null)
})
