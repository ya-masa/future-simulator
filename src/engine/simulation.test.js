import test from 'node:test'
import assert from 'node:assert/strict'
import { runSimulation } from './simulation.js'

const baseInput = {
  household: { startDate: '2026-01-01', endAge: 30 },
  persons: [{ personId: 'p1', name: '本人', birthDate: '2000-01-01' }],
  incomeRecords: [{ amount: 100000, frequency: 'monthly', startDate: '2026-01-01', endDate: '2026-12-31' }],
  expenseRecords: [{ amount: 50000, frequency: 'monthly', startDate: '2026-01-01', endDate: '2026-12-31', annualInflationRate: 0 }],
  assets: [{ assetId: 'cash-1', assetType: 'cash', balance: 1000000, annualReturn: 0 }],
  futureEvents: [],
  conditions: { calculationEndAge: 27, defaultInflationRate: 0 },
}

test('年次収支と金融資産残高を返す', () => {
  const result = runSimulation(baseInput)
  assert.equal(result.annualResults.length, 2)
  assert.equal(result.annualResults[0].income, 1200000)
  assert.equal(result.annualResults[0].expense, 600000)
  assert.equal(result.annualResults[0].netCashflow, 600000)
  assert.ok(result.summary.endFinancialAssets > result.summary.startFinancialAssets)
})


test('将来イベントの臨時収入と臨時支出を正しい区分で集計する', () => {
  const input = structuredClone(baseInput)
  input.futureEvents = [
    { eventId: 'event-1', eventDate: '2026-06-15', incomeAmount: 500000, expenseAmount: 0 },
    { eventId: 'event-2', eventDate: '2026-09-01', incomeAmount: 0, expenseAmount: 1200000 },
  ]
  const result = runSimulation(input)
  assert.equal(result.annualResults[0].income, 1700000)
  assert.equal(result.annualResults[0].expense, 1800000)
  assert.equal(result.annualResults[0].netCashflow, -100000)
})

test('将来イベントは指定月に一度だけ反映する', () => {
  const input = structuredClone(baseInput)
  input.futureEvents = [
    { eventId: 'event-1', eventDate: '2026-06-15', incomeAmount: 500000, expenseAmount: 0 },
  ]
  const result = runSimulation(input)
  assert.equal(result.annualResults[0].income, 1700000)
})

test('元利均等返済で返済期間終了時に負債残高がゼロになる', () => {
  const input = structuredClone(baseInput)
  input.incomeRecords = []
  input.expenseRecords = []
  input.assets = [{ assetId: 'cash-1', assetType: 'cash', balance: 2000000, annualReturn: 0 }]
  input.liabilities = [{
    liabilityId: 'loan-1', name: '住宅ローン', balance: 1200000,
    annualInterestRate: 0, repaymentMethod: 'equalPayment', monthlyPayment: 0,
    startDate: '2026-01-01', endDate: '2026-12-31',
  }]
  const result = runSimulation(input)
  assert.equal(result.annualResults[0].debtPrincipal, 1200000)
  assert.equal(result.annualResults[0].closingLiabilities, 0)
  assert.equal(result.summary.endLiabilities, 0)
  assert.equal(result.annualResults[0].debtPayment, 1200000)
  assert.equal(result.summary.endNetWorth, 800000)
})

test('元金均等返済は元金と利息を分けて集計する', () => {
  const input = structuredClone(baseInput)
  input.incomeRecords = []
  input.expenseRecords = []
  input.assets = [{ assetId: 'cash-1', assetType: 'cash', balance: 3000000, annualReturn: 0 }]
  input.liabilities = [{
    liabilityId: 'loan-2', name: '自動車ローン', balance: 1200000,
    annualInterestRate: 0.12, repaymentMethod: 'equalPrincipal', monthlyPayment: 0,
    startDate: '2026-01-01', endDate: '2026-12-31',
  }]
  const result = runSimulation(input)
  const year = result.annualResults[0]
  assert.equal(year.debtPrincipal, 1200000)
  assert.ok(year.debtInterest > 0)
  assert.equal(year.expense, year.debtInterest)
  assert.equal(year.closingLiabilities, 0)
  assert.equal(year.debtPayment, year.debtPrincipal + year.debtInterest)
})

test('満期一括返済は毎月利息を支払い、最終月に元金を返済する', () => {
  const input = structuredClone(baseInput)
  input.incomeRecords = []
  input.expenseRecords = []
  input.assets = [{ assetId: 'cash-1', assetType: 'cash', balance: 3000000, annualReturn: 0 }]
  input.liabilities = [{
    liabilityId: 'loan-3', name: '一括返済ローン', balance: 1200000,
    annualInterestRate: 0.12, repaymentMethod: 'bullet',
    startDate: '2026-01-01', endDate: '2026-12-31',
  }]
  const result = runSimulation(input)
  const year = result.annualResults[0]
  assert.equal(year.debtPrincipal, 1200000)
  assert.ok(year.debtInterest > 0)
  assert.equal(year.closingLiabilities, 0)
  assert.equal(year.debtPayment, year.debtPrincipal + year.debtInterest)
})


test('年金見込額は受給開始年齢以降に月割りで収入計上する', () => {
  const input = structuredClone(baseInput)
  input.household.startDate = '2026-01-01'
  input.conditions.calculationEndAge = 27
  input.incomeRecords = []
  input.expenseRecords = []
  input.persons[0].birthDate = '2001-01-01'
  input.persons[0].pensionStartAge = 26
  input.persons[0].pensionAnnualAmount = 1200000
  input.assets = [{ assetId: 'cash-1', assetType: 'cash', balance: 0, annualReturn: 0 }]
  const result = runSimulation(input)
  assert.equal(result.annualResults[0].pensionIncome, 0)
  assert.equal(result.annualResults[1].pensionIncome, 1200000)
})

test('退職金は設定年齢に到達した月に一度だけ収入計上する', () => {
  const input = structuredClone(baseInput)
  input.incomeRecords = []
  input.expenseRecords = []
  input.persons[0].birthDate = '2000-06-15'
  input.persons[0].retirementBenefitAge = 26
  input.persons[0].retirementBenefitAmount = 3000000
  input.assets = [{ assetId: 'cash-1', assetType: 'cash', balance: 0, annualReturn: 0 }]
  const result = runSimulation(input)
  assert.equal(result.annualResults[0].retirementBenefit, 3000000)
  assert.equal(result.annualResults[1].retirementBenefit, 0)
  assert.equal(result.annualResults[0].income, 3000000)
})


test('給与・賞与は人物の退職年齢に到達した月から停止する', () => {
  const input = structuredClone(baseInput)
  input.household.startDate = '2026-01-01'
  input.conditions.calculationEndAge = 27
  input.persons[0].birthDate = '2000-06-15'
  input.persons[0].retirementAge = 26
  input.incomeRecords = [{
    incomeId: 'salary-1', personId: 'p1', category: 'salary', amount: 100000,
    frequency: 'monthly', startDate: '2026-01-01', endDate: null, annualGrowthRate: 0,
  }]
  input.expenseRecords = []
  input.assets = [{ assetId: 'cash-1', assetType: 'cash', balance: 0, annualReturn: 0 }]
  const result = runSimulation(input)
  // 2026年は6月の誕生日月から給与停止。1〜5月の5か月分。
  assert.equal(result.annualResults[0].income, 500000)
})

test('給与の実効税率・社会保険料率を月次適用し、年次集計する', () => {
  const input = structuredClone(baseInput)
  input.incomeRecords = [{
    incomeId: 'salary-tax-1', personId: 'p1', category: 'salary', amount: 100000,
    frequency: 'monthly', startDate: '2026-01-01', endDate: '2026-12-31', annualGrowthRate: 0,
  }]
  input.expenseRecords = []
  input.assets = [{ assetId: 'cash-1', assetType: 'cash', balance: 0, annualReturn: 0 }]
  input.conditions.taxInsurance = {
    salaryIncomeTaxRate: 0.05,
    salaryResidentTaxRate: 0.05,
    salarySocialInsuranceRate: 0.15,
  }
  const year = runSimulation(input).annualResults[0]
  assert.equal(year.income, 1200000)
  assert.equal(year.tax, 120000)
  assert.equal(year.socialInsurance, 180000)
  assert.equal(year.totalDeductions, 300000)
  assert.equal(year.netCashflow, 900000)
})

test('人物情報から発生する年金にも年金用の概算率を適用する', () => {
  const input = structuredClone(baseInput)
  input.incomeRecords = []
  input.expenseRecords = []
  input.persons[0].birthDate = '2001-01-01'
  input.persons[0].pensionStartAge = 26
  input.persons[0].pensionAnnualAmount = 1200000
  input.assets = [{ assetId: 'cash-1', assetType: 'cash', balance: 0, annualReturn: 0 }]
  input.conditions.taxInsurance = {
    pensionIncomeTaxRate: 0.05,
    pensionResidentTaxRate: 0.05,
    pensionSocialInsuranceRate: 0.08,
  }
  const year = runSimulation(input).annualResults[1]
  assert.equal(year.pensionIncome, 1200000)
  assert.equal(year.tax, 120000)
  assert.equal(year.socialInsurance, 96000)
})

test('税・社会保険の概算率が未設定なら控除は0円', () => {
  const input = structuredClone(baseInput)
  input.incomeRecords = [{ category: 'salary', amount: 100000, frequency: 'monthly', startDate: '2026-01-01' }]
  input.expenseRecords = []
  input.assets = [{ assetId: 'cash-1', assetType: 'cash', balance: 0, annualReturn: 0 }]
  const year = runSimulation(input).annualResults[0]
  assert.equal(year.tax, 0)
  assert.equal(year.socialInsurance, 0)
})

test('現金が最低確保額を下回ると投資資産を自動取り崩しする', () => {
  const input = structuredClone(baseInput)
  input.conditions.calculationEndAge = 26
  input.incomeRecords = []
  input.expenseRecords = [{ amount: 100000, frequency: 'monthly', startDate: '2026-01-01', endDate: '2026-12-31', annualInflationRate: 0 }]
  input.assets = [
    { assetId: 'cash-1', assetType: 'cash', name: '預金', balance: 50000, annualReturn: 0 },
    { assetId: 'investment-1', assetType: 'investment', name: '投資信託', balance: 500000, annualReturn: 0, monthlyContribution: 0, withdrawalPriority: 10 },
  ]
  input.conditions.withdrawal = { enabled: true, minimumCashReserve: 20000 }
  const year = runSimulation(input).annualResults[0]
  assert.equal(year.withdrawalAmount, 500000)
  assert.equal(year.withdrawalDetails[0].name, '投資信託')
  assert.equal(year.cashShortfall, 650000)
  assert.equal(year.closingFinancialAssets, 0)
})

test('取り崩し優先順位の数値が小さい資産から売却する', () => {
  const input = structuredClone(baseInput)
  input.conditions.calculationEndAge = 26
  input.incomeRecords = []
  input.expenseRecords = [{ amount: 100000, frequency: 'monthly', startDate: '2026-01-01', endDate: '2026-01-31', annualInflationRate: 0 }]
  input.assets = [
    { assetId: 'cash-1', assetType: 'cash', name: '預金', balance: 0, annualReturn: 0 },
    { assetId: 'asset-late', assetType: 'investment', name: 'NISA', balance: 50000, annualReturn: 0, withdrawalPriority: 20 },
    { assetId: 'asset-first', assetType: 'investment', name: '特定口座', balance: 50000, annualReturn: 0, withdrawalPriority: 10 },
  ]
  input.conditions.withdrawal = { enabled: true, minimumCashReserve: 0 }
  const year = runSimulation(input).annualResults[0]
  assert.equal(year.withdrawalDetails[0].name, '特定口座')
  assert.equal(year.withdrawalDetails[1].name, 'NISA')
  assert.equal(year.withdrawalAmount, 100000)
})

test('自動取り崩しを無効にすると投資資産を売却せず現金不足を記録する', () => {
  const input = structuredClone(baseInput)
  input.conditions.calculationEndAge = 26
  input.incomeRecords = []
  input.expenseRecords = [{ amount: 100000, frequency: 'monthly', startDate: '2026-01-01', endDate: '2026-12-31', annualInflationRate: 0 }]
  input.assets = [
    { assetId: 'cash-1', assetType: 'cash', balance: 0, annualReturn: 0 },
    { assetId: 'investment-1', assetType: 'investment', name: '投資信託', balance: 1000000, annualReturn: 0 },
  ]
  input.conditions.withdrawal = { enabled: false, minimumCashReserve: 0 }
  const year = runSimulation(input).annualResults[0]
  assert.equal(year.withdrawalAmount, 0)
  assert.equal(year.cashShortfall, 1200000)
  assert.equal(year.closingFinancialAssets, 1000000)
})

test('積立設定がなくても想定年率による評価額変動を運用益として計上する', () => {
  const input = structuredClone(baseInput)
  input.conditions.calculationEndAge = 26
  input.incomeRecords = []
  input.expenseRecords = []
  input.assets = [
    { assetId: 'cash-1', assetType: 'cash', balance: 0, annualReturn: 0 },
    { assetId: 'investment-1', assetType: 'investment', name: '投資信託', balance: 1000000, annualReturn: 0.06, monthlyContribution: 0 },
  ]
  const year = runSimulation(input).annualResults[0]
  assert.equal(year.investmentContribution, 0)
  assert.ok(year.investmentGain > 0)
  assert.ok(year.closingFinancialAssets > 1000000)
})

test('積立投資は最低確保額を超える余裕資金の範囲内に制限する', () => {
  const input = structuredClone(baseInput)
  input.conditions.calculationEndAge = 26
  input.incomeRecords = [{ amount: 100000, frequency: 'monthly', startDate: '2026-01-01', endDate: '2026-12-31' }]
  input.expenseRecords = [{ amount: 95000, frequency: 'monthly', startDate: '2026-01-01', endDate: '2026-12-31', annualInflationRate: 0 }]
  input.assets = [
    { assetId: 'cash-1', assetType: 'cash', balance: 0, annualReturn: 0 },
    { assetId: 'investment-1', assetType: 'investment', balance: 0, annualReturn: 0, monthlyContribution: 50000 },
  ]
  input.conditions.withdrawal = { enabled: true, minimumCashReserve: 20000 }
  const year = runSimulation(input).annualResults[0]
  assert.equal(year.investmentContribution, 40000)
  assert.equal(year.withdrawalAmount, 0)
  assert.equal(year.cashShortfall, 0)
  assert.equal(year.closingFinancialAssets, 60000)
})


test('税・社会保険の年度別概算率は適用開始年から反映される', () => {
  const input = structuredClone(baseInput)
  input.conditions.calculationEndAge = 27
  input.incomeRecords = [{
    incomeId: 'salary-year-rate', personId: 'p1', category: 'salary', amount: 100000,
    frequency: 'monthly', startDate: '2026-01-01', endDate: '2027-12-31', annualGrowthRate: 0,
  }]
  input.expenseRecords = []
  input.assets = [{ assetId: 'cash-1', assetType: 'cash', balance: 10000000, annualReturn: 0 }]
  input.conditions.taxInsurance = {
    salaryIncomeTaxRate: 0.05, salaryResidentTaxRate: 0, salarySocialInsuranceRate: 0,
    yearlyRates: [{ year: 2027, rates: { salaryIncomeTaxRate: 0.2 } }],
  }
  const result = runSimulation(input)
  assert.equal(result.annualResults[0].incomeTax, 60000)
  assert.equal(result.annualResults[1].incomeTax, 240000)
})


test('独立した年金レコードを収入・年金集計・税計算へ反映する', () => {
  const input = structuredClone(baseInput)
  input.incomeRecords = []
  input.expenseRecords = []
  input.pensions = [{
    pensionId: 'pen-1', pensionType: 'basic', adjustmentMode: 'public',
    annualAmount: 1200000, startDate: '2026-01-01', endDate: null,
  }]
  input.conditions.pensionAdjustmentRates = { basicAnnualRate: 0, employeesAnnualRate: 0 }
  const result = runSimulation(input)
  assert.equal(result.annualResults[0].income, 1200000)
  assert.equal(result.annualResults[0].pensionIncome, 1200000)
})


test('個別増加率が未設定の収入には標準の収入増加率を適用する', () => {
  const input = structuredClone(baseInput)
  input.conditions.calculationEndAge = 27
  input.conditions.defaultIncomeGrowthRate = 0.1
  input.incomeRecords = [{
    incomeId: 'income-default-growth',
    category: 'salary',
    amount: 100000,
    frequency: 'monthly',
    startDate: '2026-01-01',
    endDate: null,
    annualGrowthRate: null,
  }]
  input.expenseRecords = []
  input.assets = [{ assetId: 'cash-growth', assetType: 'cash', balance: 0, annualReturn: 0 }]
  const result = runSimulation(input)
  assert.ok(Math.abs(result.annualResults[0].income - 1254053.66) < 0.01)
  assert.ok(Math.abs(result.annualResults[1].income - 1379459.03) < 0.01)
})

test('個別運用利回りが未設定の投資資産には標準運用利回りを適用する', () => {
  const input = structuredClone(baseInput)
  input.conditions.calculationEndAge = 26
  input.conditions.defaultInvestmentReturn = 0.12
  input.incomeRecords = []
  input.expenseRecords = []
  input.assets = [{
    assetId: 'fund-default-return',
    assetType: 'investment',
    balance: 1000000,
    annualReturn: null,
    monthlyContribution: 0,
  }]
  const result = runSimulation(input)
  assert.ok(Math.abs(result.summary.endFinancialAssets - 1120000) < 0.01)
})

test('個別に0%を指定した収入・投資資産は標準率より個別設定を優先する', () => {
  const input = structuredClone(baseInput)
  input.conditions.calculationEndAge = 26
  input.conditions.defaultIncomeGrowthRate = 0.1
  input.conditions.defaultInvestmentReturn = 0.12
  input.incomeRecords = [{
    category: 'salary', amount: 100000, frequency: 'monthly',
    startDate: '2026-01-01', endDate: null, annualGrowthRate: 0,
  }]
  input.expenseRecords = []
  input.assets = [{
    assetId: 'fund-explicit-zero', assetType: 'investment',
    balance: 1000000, annualReturn: 0, monthlyContribution: 0,
  }]
  const result = runSimulation(input)
  assert.equal(result.annualResults[0].income, 1200000)
  assert.equal(result.summary.endFinancialAssets, 2200000)
})

test('将来購入イベントは購入元から資金を移し、NISA資産区分に計上する', () => {
  const input = structuredClone(baseInput)
  input.incomeRecords = []
  input.expenseRecords = []
  input.conditions.calculationEndAge = 27
  input.assets = [{ assetId: 'cash-1', assetType: 'cash', name: '現金', balance: 1000000, annualReturn: 0 }]
  input.futureEvents = [{
    eventId: 'buy-nisa', type: 'assetPurchase', eventDate: '2026-04-01',
    name: 'NISA追加購入', purchaseAmount: 100000, sourceAssetId: 'cash-1',
    purchaseAssetType: 'investment', purchaseTaxCategory: 'nisa', annualReturn: 0,
  }]
  const result = runSimulation(input)
  const categories = result.annualResults[0].assetCategories
  assert.equal(categories.cash, 900000)
  assert.equal(categories.nisa, 100000)
  assert.equal(result.annualResults[0].closingFinancialAssets, 1000000)
})

test('将来購入した債券の利息を現金に加え、満期に元本を返す', () => {
  const input = structuredClone(baseInput)
  input.incomeRecords = []
  input.expenseRecords = []
  input.conditions.calculationEndAge = 27
  input.assets = [{ assetId: 'cash-1', assetType: 'cash', name: '現金', balance: 1000000, annualReturn: 0 }]
  input.futureEvents = [{
    eventId: 'buy-bond', type: 'assetPurchase', eventDate: '2026-01-01',
    name: '債券購入', purchaseAmount: 200000, sourceAssetId: 'cash-1',
    purchaseAssetType: 'bond', couponRate: 0.06, couponFrequency: 1,
    maturityDate: '2027-01-01',
  }]
  const result = runSimulation(input)
  assert.equal(result.annualResults[1].assetCategories.bond, 0)
  assert.equal(result.annualResults[1].assetCategories.cash, 1012000)
})


test('収入は指定した資産区分へ入金し、支出は指定区分から引き落とす', () => {
  const input = structuredClone(baseInput)
  input.conditions.calculationEndAge = 26
  input.incomeRecords = [{ incomeId: 'income-deposit', category: 'salary', amount: 100000, frequency: 'monthly', startDate: '2026-01-01', endDate: '2026-12-31', annualGrowthRate: 0, cashflowAssetType: 'deposit' }]
  input.expenseRecords = [{ expenseId: 'expense-cash', amount: 20000, frequency: 'monthly', startDate: '2026-01-01', endDate: '2026-12-31', annualInflationRate: 0, cashflowAssetType: 'cash' }]
  input.assets = [
    { assetId: 'cash-flow', assetType: 'cash', name: '現金', balance: 300000, annualReturn: 0 },
    { assetId: 'deposit-flow', assetType: 'deposit', name: '預貯金', balance: 0, annualReturn: 0 },
  ]
  const year = runSimulation(input).annualResults[0]
  assert.equal(year.assetCategories.cash, 60000)
  assert.equal(year.assetCategories.deposit, 1200000)
  assert.equal(year.income, 1200000)
  assert.equal(year.expense, 240000)
})

test('預貯金区分を選んだ支出は預貯金残高から差し引く', () => {
  const input = structuredClone(baseInput)
  input.conditions.calculationEndAge = 26
  input.incomeRecords = []
  input.expenseRecords = [{ expenseId: 'expense-deposit', amount: 10000, frequency: 'monthly', startDate: '2026-01-01', endDate: '2026-12-31', annualInflationRate: 0, cashflowAssetType: 'deposit' }]
  input.assets = [
    { assetId: 'cash-flow', assetType: 'cash', balance: 500000, annualReturn: 0 },
    { assetId: 'deposit-flow', assetType: 'deposit', balance: 200000, annualReturn: 0 },
  ]
  const year = runSimulation(input).annualResults[0]
  assert.equal(year.assetCategories.cash, 500000)
  assert.equal(year.assetCategories.deposit, 80000)
})


test('現金不足累計は各月に新たに増えた不足額を合算し、既存不足を重複計上しない', () => {
  const input = structuredClone(baseInput)
  input.conditions.calculationEndAge = 27
  input.incomeRecords = []
  input.expenseRecords = [{ amount: 100000, frequency: 'monthly', startDate: '2026-01-01', endDate: '2027-12-31', annualInflationRate: 0 }]
  input.assets = [{ assetId: 'cash-1', assetType: 'cash', balance: 0, annualReturn: 0 }]
  input.conditions.withdrawal = { enabled: false, minimumCashReserve: 0 }
  const result = runSimulation(input)
  assert.equal(result.annualResults[0].cashShortfall, 1200000)
  assert.equal(result.annualResults[1].cashShortfall, 1200000)
  assert.equal(result.annualResults[0].cumulativeCashShortfall, 1200000)
  assert.equal(result.annualResults[1].cumulativeCashShortfall, 2400000)
  assert.equal(result.summary.totalCashShortfall, 2400000)
})

test('通常支出で現金が不足しても預貯金から補充し、現金残高をマイナスにしない', () => {
  const input = structuredClone(baseInput)
  input.household = { startDate: '2026-01-01', endAge: 26 }
  input.persons = [{ personId: 'p1', name: '本人', birthDate: '2000-01-01' }]
  input.incomeRecords = []
  input.expenseRecords = [{ amount: 100000, frequency: 'once', startDate: '2026-01-01', endDate: '2026-01-01', cashflowAssetType: 'cash', annualInflationRate: 0 }]
  input.assets = [
    { assetId: 'cash-1', assetType: 'cash', balance: 10000, annualReturn: 0 },
    { assetId: 'deposit-1', assetType: 'deposit', balance: 200000, annualReturn: 0 },
  ]
  input.conditions = { calculationEndAge: 26, defaultInflationRate: 0, withdrawal: { enabled: true, refillStartBalance: 0, refillTargetBalance: 0 } }
  const result = runSimulation(input)
  const cash = result.endingAssets.find((asset) => asset.assetId === 'cash-1')
  const deposit = result.endingAssets.find((asset) => asset.assetId === 'deposit-1')
  assert.equal(cash.balance, 0)
  assert.equal(deposit.balance, 110000)
  assert.equal(result.summary.endCashShortfall, 0)
  assert.equal(result.summary.totalCashShortfall, 0)
})

test('預貯金から積立投資を行い、現金資産をマイナスにしない', () => {
  const input = structuredClone(baseInput)
  input.household = { startDate: '2026-01-01', endAge: 26 }
  input.persons = [{ personId: 'p1', name: '本人', birthDate: '2000-01-01' }]
  input.incomeRecords = []
  input.expenseRecords = []
  input.assets = [
    { assetId: 'cash-1', assetType: 'cash', balance: 0, annualReturn: 0 },
    { assetId: 'deposit-1', assetType: 'deposit', balance: 200000, annualReturn: 0 },
    { assetId: 'fund-1', assetType: 'investment', balance: 0, monthlyContribution: 50000, annualReturn: 0, withdrawalEnabled: true },
  ]
  input.conditions = { calculationEndAge: 26, defaultInflationRate: 0, withdrawal: { enabled: true, refillStartBalance: 0, refillTargetBalance: 0 } }
  const result = runSimulation(input)
  assert.ok(result.endingAssets.every((asset) => Number(asset.balance || 0) >= -0.000001))
  assert.equal(result.endingAssets.find((asset) => asset.assetId === 'deposit-1').balance, 0)
  assert.equal(result.endingAssets.find((asset) => asset.assetId === 'fund-1').balance, 200000)
})


test('適用チェックを外した将来イベントは試算収入に含めない', () => {
  const input = structuredClone(baseInput)
  input.futureEvents = [
    { eventId: 'excluded-event', eventDate: '2026-06-15', incomeAmount: 500000, expenseAmount: 0, enabled: false },
  ]
  const result = runSimulation(input)
  assert.equal(result.annualResults[0].income, 1200000)
})

test('毎月イベントは開始月から終了月まで各月に反映される', () => {
  const input = structuredClone(baseInput)
  input.futureEvents = [{ eventId: 'monthly-income', enabled: true, type: 'income', name: '定期収入', eventDate: '2026-03-01', endDate: '2026-05-31', frequency: 'monthly', amount: 10000, destinationAssetId: 'cash-1' }]
  const result = runSimulation(input)
  assert.equal(result.annualResults[0].income, 1230000)
})

test('旧収入・支出レコードを試算から除外する設定が機能する', () => {
  const input = structuredClone(baseInput)
  input.conditions.useLegacyIncomeExpense = false
  const result = runSimulation(input)
  assert.equal(result.annualResults[0].income, 0)
  assert.equal(result.annualResults[0].expense, 0)
})

test('V1.8.0の資産区分イベントは該当資産へ反映する', () => {
  const input = structuredClone(baseInput)
  input.conditions.calculationEndAge = 26
  input.incomeRecords = []
  input.expenseRecords = []
  input.assets = [
    { assetId: 'cash-group', assetType: 'cash', name: '現金', balance: 50000, annualReturn: 0 },
    { assetId: 'dep-group-a', assetType: 'deposit', name: '預金A', balance: 100000, annualReturn: 0, withdrawalPriority: 1 },
    { assetId: 'dep-group-b', assetType: 'deposit', name: '預金B', balance: 100000, annualReturn: 0, withdrawalPriority: 2 },
  ]
  input.futureEvents = [
    { eventId: 'category-income', enabled: true, type: 'income', name: '区分入金', eventDate: '2026-01-01', frequency: 'monthly', amount: 10000, destinationAssetCategory: 'deposit' },
    { eventId: 'category-expense', enabled: true, type: 'expense', name: '区分支出', eventDate: '2026-01-01', frequency: 'monthly', amount: 5000, sourceAssetCategory: 'deposit' },
  ]
  const year = runSimulation(input).annualResults[0]
  assert.equal(year.income, 120000)
  assert.equal(year.expense, 60000)
  assert.equal(year.assetCategories.deposit, 260000)
})

test('NISA購入イベントはつみたて投資枠と成長投資枠を区別して資産に保存する', () => {
  const makeInput = (nisaType) => {
    const input = structuredClone(baseInput)
    input.conditions.calculationEndAge = 26
    input.incomeRecords = []
    input.expenseRecords = []
    input.assets = [{ assetId: 'deposit-nisa-funding', assetType: 'deposit', name: '預金', balance: 300000, annualReturn: 0 }]
    input.futureEvents = [{
      eventId: `nisa-${nisaType}`, enabled: true, type: 'assetPurchase', name: 'NISA購入',
      eventDate: '2026-01-01', purchaseAmount: 100000,
      sourceAssetCategory: 'deposit', destinationAssetCategory: 'investment',
      purchaseAssetType: 'investment', purchaseTaxCategory: 'nisa',
      purchaseNisaType: nisaType, annualReturn: 0,
    }]
    return input
  }
  for (const nisaType of ['accumulation', 'growth']) {
    const result = runSimulation(makeInput(nisaType))
    const nisaAssets = result.endingAssets.filter((asset) => asset.taxCategory === 'nisa')
    assert.equal(nisaAssets.length, 1)
    assert.equal(nisaAssets[0].nisaType, nisaType)
  }
})


test('将来購入イベントで作成した個別資産を後続の売却イベントから指定できる', () => {
  const input = structuredClone(baseInput)
  input.conditions.calculationEndAge = 26
  input.incomeRecords = []
  input.expenseRecords = []
  input.assets = [{ assetId: 'funding-deposit', assetType: 'deposit', name: '購入資金', balance: 250000, annualReturn: 0 }]
  input.futureEvents = [
    {
      eventId: 'buy-specific-future-asset', enabled: true, type: 'assetPurchase', name: '個別指定ファンド',
      eventDate: '2026-01-01', purchaseAmount: 100000, sourceAssetCategory: 'deposit',
      purchaseAssetType: 'investment', purchaseTaxCategory: 'taxable', annualReturn: 0,
    },
    {
      eventId: 'sell-specific-future-asset', enabled: true, type: 'assetSale', name: '指定ファンド売却',
      eventDate: '2026-02-01', saleAmount: 40000, sourceAssetId: 'future-buy-specific-future-asset',
      destinationAssetCategory: 'cash',
    },
  ]
  const result = runSimulation(input)
  const purchased = result.endingAssets.find((asset) => asset.assetId === 'future-buy-specific-future-asset')
  assert.equal(purchased.balance, 60000)
  assert.equal(result.endingAssets.find((asset) => asset.assetType === 'cash')?.balance, 40000)
})

test('年初金融資産の区分別・個別資産別内訳を返す', () => {
  const input = structuredClone(baseInput)
  input.incomeRecords = []
  input.expenseRecords = []
  input.assets = [
    { assetId: 'cash-1', assetType: 'cash', name: '財布', balance: 120000, annualReturn: 0 },
    { assetId: 'deposit-1', assetType: 'deposit', name: '定期預金', balance: 880000, annualReturn: 0 },
    { assetId: 'nisa-1', assetType: 'investment', name: 'オルカン', balance: 500000, annualReturn: 0, taxCategory: 'nisa' },
    { assetId: 'bond-1', assetType: 'bond', name: '個人向け国債', balance: 300000, annualReturn: 0, taxCategory: 'other' },
    { assetId: 'stock-1', assetType: 'investment', name: 'TOPIX', balance: 200000, annualReturn: 0, taxCategory: 'taxable' },
    { assetId: 'other-1', assetType: 'other', name: 'その他資産', balance: 100000, annualReturn: 0, taxCategory: 'other' },
    { assetId: 'virtual-1', assetType: 'cash', name: '仮想現金', balance: 0, annualReturn: 0, isVirtual: true },
  ]
  const result = runSimulation(input)
  const firstYear = result.annualResults[0]
  assert.equal(firstYear.openingAssetCategories.cash, 120000)
  assert.equal(firstYear.openingAssetCategories.deposit, 880000)
  assert.equal(firstYear.openingAssetCategories.nisa, 500000)
  assert.equal(firstYear.openingAssetCategories.bond, 300000)
  assert.equal(firstYear.openingAssetCategories.taxable, 200000)
  assert.equal(firstYear.openingAssetCategories.other, 100000)
  assert.equal(firstYear.openingAssetDetails.find((asset) => asset.assetId === 'nisa-1').balance, 500000)
  assert.equal(firstYear.openingAssetDetails.some((asset) => asset.assetId === 'virtual-1'), false)
})


test('前年中の将来購入資産を翌年の年初個別資産内訳に含める', () => {
  const input = structuredClone(baseInput)
  input.conditions.calculationEndAge = 27
  input.incomeRecords = []
  input.expenseRecords = []
  input.assets = [{ assetId: 'cash-start', assetType: 'cash', name: '購入資金', balance: 200000, annualReturn: 0 }]
  input.futureEvents = [{ eventId: 'purchase-for-opening-snapshot', enabled: true, type: 'assetPurchase', eventDate: '2026-06-01', purchaseAmount: 50000, sourceAssetCategory: 'cash', purchaseAssetType: 'investment', purchaseName: '将来購入オルカン', annualReturn: 0 }]
  const result = runSimulation(input)
  const secondYear = result.annualResults.find((row) => row.year === 2027)
  assert.equal(secondYear.openingAssetDetails.find((asset) => asset.assetId === 'future-purchase-for-opening-snapshot')?.balance, 50000)
})


test('V1.8.6 債券購入イベントは購入額・額面・利息入力設定を保存して購入処理できる', () => {
  const input = structuredClone(baseInput)
  input.incomeRecords = []
  input.expenseRecords = []
  input.conditions.calculationEndAge = 26
  input.assets = [{ assetId: 'cash-bond', assetType: 'cash', name: '現金', balance: 500000, annualReturn: 0 }]
  input.futureEvents = [{
    eventId: 'bond-details', type: 'bondPurchase', eventDate: '2026-06-01',
    name: '国債', purchaseAmount: 100000, faceAmount: 100000,
    sourceAssetId: 'cash-bond', couponInputMode: 'amount', annualCouponAmount: 3000,
    firstCouponDate: '2026-12-01', couponPaymentFrequency: 2, couponTaxMode: 'gross',
    couponRate: 0.03, maturityDate: '2031-06-01', frequency: 'monthly',
  }]
  const year = runSimulation(input).annualResults[0]
  assert.equal(year.assetCategories.cash, 401500)
  assert.equal(year.assetCategories.bond, 100000)
})


test('V1.8.7 債券利息は初回受取日から年2回、額面金額を基準に計上する', () => {
  const input = structuredClone(baseInput)
  input.incomeRecords = []
  input.expenseRecords = []
  input.conditions.calculationEndAge = 27
  input.assets = [{ assetId: 'cash-coupon', assetType: 'cash', name: '現金', balance: 500000, annualReturn: 0 }]
  input.futureEvents = [{
    eventId: 'bond-coupon', type: 'bondPurchase', eventDate: '2026-01-01',
    name: '債券', purchaseAmount: 100000, faceAmount: 100000,
    sourceAssetId: 'cash-coupon', couponRate: 0.04, couponInputMode: 'rate',
    firstCouponDate: '2026-07-15', couponPaymentFrequency: 2, couponTaxMode: 'gross',
    maturityDate: '2030-01-01',
  }]
  const result = runSimulation(input)
  assert.equal(result.annualResults[0].assetCategories.cash, 402000)
  assert.equal(result.annualResults[0].income, 2000)
  assert.equal(result.annualResults[1].income, 4000)
})

test('V1.8.7 年間利息額入力は受取回数で按分し、税引後設定を反映する', () => {
  const input = structuredClone(baseInput)
  input.incomeRecords = []
  input.expenseRecords = []
  input.conditions.calculationEndAge = 26
  input.assets = [{ assetId: 'cash-net', assetType: 'cash', name: '現金', balance: 500000, annualReturn: 0 }]
  input.futureEvents = [{
    eventId: 'bond-net', type: 'bondPurchase', eventDate: '2026-01-01',
    name: '債券', purchaseAmount: 100000, faceAmount: 100000,
    sourceAssetId: 'cash-net', couponInputMode: 'amount', annualCouponAmount: 12000,
    firstCouponDate: '2026-07-01', couponPaymentFrequency: 2, couponTaxMode: 'net',
    maturityDate: '2030-01-01',
  }]
  const year = runSimulation(input).annualResults[0]
  assert.equal(year.assetCategories.cash, 404781)
  assert.equal(year.income, 4781)
})


test('V1.8.7 初回利息受取日が未入力なら購入日から受取頻度に応じた初回日を設定する', () => {
  const input = structuredClone(baseInput)
  input.incomeRecords = []
  input.expenseRecords = []
  input.conditions.calculationEndAge = 26
  input.assets = [{ assetId: 'cash-default-coupon', assetType: 'cash', name: '現金', balance: 500000, annualReturn: 0 }]
  input.futureEvents = [{
    eventId: 'bond-default-coupon', type: 'bondPurchase', eventDate: '2026-01-31',
    name: '債券', purchaseAmount: 100000, faceAmount: 100000,
    sourceAssetId: 'cash-default-coupon', couponRate: 0.04, couponInputMode: 'rate',
    couponPaymentFrequency: 2, couponTaxMode: 'gross', maturityDate: '2030-01-31',
  }]
  const year = runSimulation(input).annualResults[0]
  // 6か月後の7月末日（年2回設定）。初回分のみ受け取る。
  assert.equal(year.assetCategories.cash, 402000)
  assert.equal(year.income, 2000)
})


test('V1.8.8 満期日に債券の額面元本を指定した預貯金へ自動償還し債券を除去する', () => {
  const input = structuredClone(baseInput)
  input.incomeRecords = []
  input.expenseRecords = []
  input.conditions.calculationEndAge = 27
  input.assets = [
    { assetId: 'cash-188', assetType: 'cash', name: '現金', balance: 100000, annualReturn: 0 },
    { assetId: 'deposit-188', assetType: 'deposit', name: '償還受取口座', balance: 200000, annualReturn: 0 },
    { assetId: 'bond-188', assetType: 'bond', name: '満期債券', balance: 950000, faceAmount: 1000000, purchaseDate: '2026-01-01', maturityDate: '2027-07-20', maturityDestinationAssetId: 'deposit-188', couponRate: 0, couponPaymentFrequency: 2 },
  ]
  const result = runSimulation(input)
  const year = result.annualResults[1]
  assert.equal(year.assetCategories.bond, 0)
  assert.equal(year.assetCategories.deposit, 1200000)
  assert.equal(year.assetCategories.cash, 100000)
})

test('V1.8.8 債券購入イベントの満期償還先設定を購入資産へ引き継ぐ', () => {
  const input = structuredClone(baseInput)
  input.incomeRecords = []
  input.expenseRecords = []
  input.conditions.calculationEndAge = 27
  input.assets = [
    { assetId: 'cash-buy188', assetType: 'cash', name: '現金', balance: 500000, annualReturn: 0 },
    { assetId: 'deposit-buy188', assetType: 'deposit', name: '預貯金', balance: 0, annualReturn: 0 },
  ]
  input.futureEvents = [{
    eventId: 'buy-mature188', type: 'bondPurchase', eventDate: '2026-01-01',
    name: '債券', purchaseAmount: 100000, faceAmount: 100000,
    sourceAssetId: 'cash-buy188', couponRate: 0, maturityDate: '2027-01-01',
    maturityDestinationAssetId: 'deposit-buy188',
  }]
  const result = runSimulation(input)
  assert.equal(result.annualResults[1].assetCategories.bond, 0)
  assert.equal(result.annualResults[1].assetCategories.deposit, 100000)
})

test('V1.8.8 手動満期イベントがある場合は自動償還と重複しない', () => {
  const input = structuredClone(baseInput)
  input.incomeRecords = []
  input.expenseRecords = []
  input.conditions.calculationEndAge = 27
  input.assets = [
    { assetId: 'cash-manual188', assetType: 'cash', name: '現金', balance: 0, annualReturn: 0 },
    { assetId: 'bond-manual188', assetType: 'bond', name: '債券', balance: 100000, faceAmount: 100000, purchaseDate: '2026-01-01', maturityDate: '2027-06-01', couponRate: 0 },
  ]
  input.futureEvents = [{
    eventId: 'manual-maturity188', type: 'bondMaturity', eventDate: '2027-06-01',
    sourceAssetId: 'bond-manual188', destinationAssetId: 'cash-manual188', principalAmount: 100000,
  }]
  const year = runSimulation(input).annualResults[1]
  assert.equal(year.assetCategories.cash, 100000)
  assert.equal(year.assetCategories.bond, 0)
})


test('年間収入の内訳として給与・賞与・年金・その他・金融資産利息を返す', () => {
  const input = structuredClone(baseInput)
  input.incomeRecords = [
    { category: 'salary', amount: 100000, frequency: 'monthly', startDate: '2026-01-01', endDate: '2026-12-31' },
    { category: 'bonus', amount: 200000, frequency: 'once', startDate: '2026-06-01', endDate: '2026-06-01' },
    { category: 'pension', amount: 30000, frequency: 'monthly', startDate: '2026-01-01', endDate: '2026-12-31' },
    { category: 'other', amount: 10000, frequency: 'monthly', startDate: '2026-01-01', endDate: '2026-12-31' },
  ]
  input.assets.push({
    assetId: 'bond-income-test', assetType: 'bond', name: '利息テスト債券',
    balance: 1000000, faceAmount: 1000000, purchaseDate: '2025-01-01',
    couponRate: 0.02, couponInputMode: 'rate', firstCouponDate: '2026-06-01',
    couponPaymentFrequency: 1, couponTaxMode: 'gross', couponDestinationAssetId: 'cash-1',
  })
  const row = runSimulation(input).annualResults[0]
  assert.equal(row.salaryIncome, 1200000)
  assert.equal(row.bonusIncome, 200000)
  assert.equal(row.pensionIncome, 360000)
  assert.equal(row.otherIncome, 120000)
  assert.equal(row.financialAssetIncome, 20000)
  assert.equal(row.retirementBenefit, 0)
  assert.equal(row.income, 1900000)
})


test('預貯金などの設定利回りによる残高増加も金融資産収入に含める', () => {
  const input = structuredClone(baseInput)
  input.incomeRecords = []
  input.expenseRecords = []
  input.assets = [{ assetId: 'deposit-return', assetType: 'deposit', balance: 1000000, annualReturn: 0.12 }]
  const row = runSimulation(input).annualResults[0]
  assert.ok(row.financialAssetIncome > 0)
  assert.equal(row.income, row.financialAssetIncome)
})


test('人物ごとの計算終了年齢で一人の収入だけ停止し、他の人物の収入は継続する', () => {
  const input = structuredClone(baseInput)
  input.household.endAge = 35
  input.conditions.calculationEndAge = 35
  input.persons = [
    { personId: 'p1', name: '人物1', birthDate: '2000-01-01', calculationEndAge: 27 },
    { personId: 'p2', name: '人物2', birthDate: '2005-01-01', calculationEndAge: 30 },
  ]
  input.incomeRecords = [
    { category: 'other', personId: 'p1', amount: 10000, frequency: 'monthly', startDate: '2026-01-01' },
    { category: 'other', personId: 'p2', amount: 20000, frequency: 'monthly', startDate: '2026-01-01' },
  ]
  input.expenseRecords = []
  const result = runSimulation(input)
  assert.equal(result.annualResults[0].otherIncome, 360000)
  assert.equal(result.annualResults[1].otherIncome, 240000)
  assert.equal(result.annualResults[2].otherIncome, 240000)
})


test('V1.10.0 定期預金は満期に指定受取口座へ満期額を振り替えて資産から除く', () => {
  const input = structuredClone(baseInput)
  input.incomeRecords = []
  input.expenseRecords = []
  input.assets = [
    { assetId: 'cash-maturity', assetType: 'cash', name: '現金', balance: 200000, annualReturn: 0 },
    { assetId: 'deposit-maturity', assetType: 'deposit', name: '満期受取口座', balance: 0, annualReturn: 0 },
    { assetId: 'td-maturity', assetType: 'termDeposit', name: '定期預金', principalAmount: 100000, contractDate: '2026-01-01', maturityDate: '2026-12-01', maturityPayoutMode: 'amount', maturityPayoutAmount: 120000, interestMethod: 'compound', compoundingFrequency: 12, purchaseSourceAssetCategory: 'cash', maturityDestinationAssetId: 'deposit-maturity' },
  ]
  const result = runSimulation(input)
  assert.equal(result.endingAssets.find((asset) => asset.assetId === 'deposit-maturity')?.balance, 120000)
  assert.equal(result.endingAssets.some((asset) => asset.assetId === 'td-maturity'), false)
})

test('V1.10.0 契約満期イベントは指定月に指定口座へ払い出し、契約資産を除く', () => {
  const input = structuredClone(baseInput)
  input.incomeRecords = []
  input.expenseRecords = []
  input.assets = [
    { assetId: 'cash-event-maturity', assetType: 'cash', name: '現金', balance: 200000, annualReturn: 0 },
    { assetId: 'deposit-event-maturity', assetType: 'deposit', name: '受取口座', balance: 0, annualReturn: 0 },
    { assetId: 'insurance-event-maturity', assetType: 'savingsInsurance', name: '貯蓄保険', principalAmount: 100000, contractDate: '2026-01-01', maturityDate: '2030-01-01', maturityPayoutMode: 'amount', maturityPayoutAmount: 125000, interestMethod: 'compound', compoundingFrequency: 12, earlySurrenderAllowed: true, purchaseSourceAssetCategory: 'cash' },
  ]
  input.futureEvents = [{ eventId: 'contract-maturity-event', enabled: true, type: 'contractMaturity', eventDate: '2026-06-01', sourceAssetId: 'insurance-event-maturity', destinationAssetId: 'deposit-event-maturity', payoutAmount: 110000 }]
  const result = runSimulation(input)
  assert.equal(result.endingAssets.find((asset) => asset.assetId === 'deposit-event-maturity')?.balance, 110000)
  assert.equal(result.endingAssets.some((asset) => asset.assetId === 'insurance-event-maturity'), false)
})


test('V1.10.0 契約満期イベントは解約不可またはロック期間中の早期払い出しを行わない', () => {
  const input = structuredClone(baseInput)
  input.incomeRecords = []
  input.expenseRecords = []
  input.assets = [
    { assetId: 'cash-lock', assetType: 'cash', name: '現金', balance: 200000, annualReturn: 0 },
    { assetId: 'dep-lock', assetType: 'deposit', name: '受取口座', balance: 0, annualReturn: 0 },
    { assetId: 'locked-contract', assetType: 'termDeposit', name: 'ロック中の定期', principalAmount: 100000, contractDate: '2026-01-01', maturityDate: '2030-01-01', maturityPayoutMode: 'amount', maturityPayoutAmount: 130000, interestMethod: 'compound', compoundingFrequency: 12, earlySurrenderAllowed: true, lockupUntil: '2027-01-01', surrenderValueAmount: 105000, purchaseSourceAssetCategory: 'cash' },
  ]
  input.futureEvents = [{ eventId: 'early-contract-maturity', enabled: true, type: 'contractMaturity', eventDate: '2026-06-01', sourceAssetId: 'locked-contract', destinationAssetId: 'dep-lock' }]
  const result = runSimulation(input)
  assert.equal(result.endingAssets.some((asset) => asset.assetId === 'locked-contract'), true)
  assert.equal(result.endingAssets.find((asset) => asset.assetId === 'dep-lock')?.balance, 0)
})
