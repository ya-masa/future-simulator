import { calculateMonthlyExpense, calculateMonthlyIncomeBreakdown, calculateMonthlyIncomeByAssetType, calculateMonthlyExpenseByAssetType, calculateOneTimeEventAmounts } from './cashflow.js'
import { calculateMonthlyTaxAndInsurance } from './taxInsurance.js'
import { calculateMonthlyPensionIncome } from './pensions.js'
import { getAge, parseDate } from './dateUtils.js'
import { growCashAssets, growInvestmentAssets } from './investment.js'
import { getMinimumCashReserve, getScheduledContributions, limitContributionsToAvailableCash, withdrawInvestmentAssets, applyAutomaticFunding } from './withdrawal.js'
import { applyEventIncome, debitIndividualAsset, debitAssetCategory, assetMatchesEventCategory, resolveEventAsset, transferBetweenAssets, sortEventsForMonth } from './futureEvents.js'
import { getLiabilityWarnings, prepareLiabilities, processMonthlyLiabilities, sumLiabilityBalances } from './debt.js'

function monthStart(year, month) {
  return new Date(year, month, 1)
}

function defaultFirstCouponDate(purchaseDate, frequency) {
  if (!purchaseDate) return null
  const parts = purchaseDate.split('-').map(Number)
  if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) return null
  const months = Math.max(1, Math.round(12 / Math.max(1, Number(frequency || 2))))
  const year = parts[0]
  const monthIndex = parts[1] - 1 + months
  const targetYear = year + Math.floor(monthIndex / 12)
  const targetMonth = monthIndex % 12
  const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate()
  const day = Math.min(parts[2], lastDay)
  return `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}


function ensureCashAsset(cashAssets, assetType) {
  let asset = cashAssets.find((item) => item.assetType === assetType)
  if (!asset) {
    asset = { assetId: `__cashflow_${assetType}__`, assetType, name: assetType === 'deposit' ? '預貯金（計算用）' : '現金（計算用）', balance: 0, annualReturn: 0, isVirtual: true }
    cashAssets.push(asset)
  }
  return asset
}

function applyCashflowToAssetType(cashAssets, assetType, amount) {
  const type = assetType === 'deposit' ? 'deposit' : 'cash'
  const matching = cashAssets.filter((asset) => asset.assetType === type)
  if (amount >= 0) {
    const target = ensureCashAsset(cashAssets, type)
    target.balance = Number(target.balance || 0) + amount
    return 0
  }
  let remaining = -amount
  for (const asset of matching) {
    const available = Math.max(0, Number(asset.balance || 0))
    const debit = Math.min(available, remaining)
    asset.balance = available - debit
    remaining -= debit
    if (remaining <= 0.000001) break
  }
  // Never write an unfunded expense as a negative asset balance.
  return Math.max(0, remaining)
}

function debitCashPool(cashAssets, amount) {
  let remaining = Math.max(0, Number(amount || 0))
  for (const type of ['cash', 'deposit']) {
    for (const asset of cashAssets.filter((item) => item.assetType === type)) {
      if (remaining <= 0.000001) break
      const available = Math.max(0, Number(asset.balance || 0))
      const debit = Math.min(available, remaining)
      asset.balance = available - debit
      remaining -= debit
    }
  }
  return Math.max(0, remaining)
}

function sumBalances(assets) {
  return assets.reduce((sum, asset) => sum + Number(asset.balance || 0), 0)
}

function summarizeAssetCategories(cashAssets, investmentAssets) {
  const totals = { cash: 0, deposit: 0, nisa: 0, taxable: 0, bond: 0, other: 0 }
  for (const asset of [...cashAssets, ...investmentAssets]) {
    let key = 'other'
    if (asset.assetType === 'cash') key = 'cash'
    else if (asset.assetType === 'deposit') key = 'deposit'
    else if (asset.assetType === 'bond') key = 'bond'
    else if (asset.taxCategory === 'nisa') key = 'nisa'
    else if (['taxable', 'general'].includes(asset.taxCategory)) key = 'taxable'
    totals[key] += Number(asset.balance || 0)
  }
  for (const key of Object.keys(totals)) totals[key] = round(totals[key])
  return totals
}

function snapshotAssetDetails(cashAssets, investmentAssets) {
  return [...cashAssets, ...investmentAssets]
    .filter((asset) => !asset.isVirtual || Number(asset.balance || 0) !== 0)
    .map((asset) => ({
      assetId: asset.assetId,
      name: asset.name || '名称未設定',
      assetType: asset.assetType || 'other',
      taxCategory: asset.taxCategory || 'other',
      balance: round(Number(asset.balance || 0)),
    }))
}

function summarizeOpeningAssetDetails(details = []) {
  const totals = { cash: 0, deposit: 0, nisa: 0, taxable: 0, bond: 0, other: 0 }
  for (const asset of details) {
    let key = 'other'
    if (asset.assetType === 'cash') key = 'cash'
    else if (asset.assetType === 'deposit') key = 'deposit'
    else if (asset.assetType === 'bond') key = 'bond'
    else if (asset.taxCategory === 'nisa') key = 'nisa'
    else if (['taxable', 'general'].includes(asset.taxCategory)) key = 'taxable'
    totals[key] += Number(asset.balance || 0)
  }
  for (const key of Object.keys(totals)) totals[key] = round(totals[key])
  return totals
}

function sumFinancialAssets(cashAssets, investmentAssets) {
  const availableCash = Math.max(0, sumBalances(cashAssets))
  return availableCash + sumBalances(investmentAssets)
}

/**
 * 月次で収支・税金・社会保険・資産・負債を更新し、年次結果を返すシミュレーション。
 * 税金・社会保険はユーザー設定の実効率による概算。法定税額の再現ではない。
 */
export function runSimulation(input) {
  const startDate = parseDate(input.household?.startDate)
  if (!startDate) throw new Error('世帯の startDate を YYYY-MM-DD 形式で指定してください。')

  const endAge = Number(input.conditions?.calculationEndAge ?? input.household?.endAge ?? 100)
  const referencePerson = input.persons?.[0]
  const firstYearEndAge = referencePerson
    ? getAge(referencePerson.birthDate, new Date(startDate.getFullYear(), 11, 31))
    : 0
  const yearsToRun = Math.max(1, endAge - (firstYearEndAge ?? 0) + 1)
  const totalMonths = yearsToRun * 12

  let cashAssets = (input.assets || [])
    .filter((asset) => asset.assetType === 'cash' || asset.assetType === 'deposit')
    .map((asset) => ({ ...asset, balance: Number(asset.balance || 0) }))
  if (cashAssets.length === 0) {
    cashAssets = [{ assetId: '__calculated_cash__', assetType: 'cash', name: '計算上の現金', balance: 0, annualReturn: 0, isVirtual: true }]
  }
  let investmentAssets = (input.assets || [])
    .filter((asset) => !['cash', 'deposit'].includes(asset.assetType))
    .map((asset) => ({ ...asset, balance: Number(asset.balance || 0) }))
  let liabilities = prepareLiabilities(input.liabilities || [], startDate)

  const processedPurchaseEvents = new Set()
  const annualResults = []
  let currentYear = startDate.getFullYear()
  let yearIncome = 0
  let yearSalaryIncome = 0
  let yearBonusIncome = 0
  let yearOtherIncome = 0
  let yearFinancialAssetIncome = 0
  let yearPensionIncome = 0
  let yearRetirementBenefit = 0
  let yearTax = 0
  let yearIncomeTax = 0
  let yearResidentTax = 0
  let yearSocialInsurance = 0
  let yearExpense = 0
  let yearInvestmentGain = 0
  let yearContribution = 0
  let yearDebtPayment = 0
  let yearDebtPrincipal = 0
  let yearDebtInterest = 0
  let yearWithdrawals = []
  let yearCashShortfall = 0
  let yearOpeningAssets = sumFinancialAssets(cashAssets, investmentAssets)
  let yearOpeningAssetDetails = snapshotAssetDetails(cashAssets, investmentAssets)
  let yearOpeningAssetCategories = summarizeOpeningAssetDetails(yearOpeningAssetDetails)
  let yearOpeningLiabilities = sumLiabilityBalances(liabilities)

  for (let offset = 0; offset < totalMonths; offset += 1) {
    const date = monthStart(startDate.getFullYear(), startDate.getMonth() + offset)
    const year = date.getFullYear()

    if (year !== currentYear) {
      annualResults.push(buildAnnualResult({
        year: currentYear, input, income: yearIncome, salaryIncome: yearSalaryIncome, bonusIncome: yearBonusIncome, otherIncome: yearOtherIncome, financialAssetIncome: yearFinancialAssetIncome, pensionIncome: yearPensionIncome, retirementBenefit: yearRetirementBenefit, tax: yearTax, incomeTax: yearIncomeTax, residentTax: yearResidentTax, socialInsurance: yearSocialInsurance, expense: yearExpense,
        investmentGain: yearInvestmentGain, contribution: yearContribution,
        debtPayment: yearDebtPayment, debtPrincipal: yearDebtPrincipal, debtInterest: yearDebtInterest,
        withdrawals: yearWithdrawals, cashShortfall: yearCashShortfall,
        openingAssets: yearOpeningAssets, closingAssets: sumFinancialAssets(cashAssets, investmentAssets), assetCategories: summarizeAssetCategories(cashAssets, investmentAssets),
        openingAssetDetails: yearOpeningAssetDetails, openingAssetCategories: yearOpeningAssetCategories,
        openingLiabilities: yearOpeningLiabilities, closingLiabilities: sumLiabilityBalances(liabilities),
        date: new Date(currentYear, 11, 31),
      }))
      currentYear = year
      yearIncome = 0
      yearSalaryIncome = 0
      yearBonusIncome = 0
      yearOtherIncome = 0
      yearFinancialAssetIncome = 0
      yearPensionIncome = 0
      yearRetirementBenefit = 0
      yearTax = 0
      yearIncomeTax = 0
      yearResidentTax = 0
      yearSocialInsurance = 0
      yearExpense = 0
      yearInvestmentGain = 0
      yearContribution = 0
      yearDebtPayment = 0
      yearDebtPrincipal = 0
      yearDebtInterest = 0
      yearWithdrawals = []
      yearCashShortfall = 0
      yearOpeningAssets = sumFinancialAssets(cashAssets, investmentAssets)
      yearOpeningAssetDetails = snapshotAssetDetails(cashAssets, investmentAssets)
      yearOpeningAssetCategories = summarizeOpeningAssetDetails(yearOpeningAssetDetails)
      yearOpeningLiabilities = sumLiabilityBalances(liabilities)
    }

    const monthKey = `${year}-${String(date.getMonth() + 1).padStart(2, '0')}`
    // 月初時点ですでに存在する現金不足を記録し、今月新たに増えた不足分だけを集計する。
    const cashDeficitAtMonthStart = Math.max(0, -sumBalances(cashAssets))
    // 債券利息は登録された初回受取日を起点に、年1回／年2回の周期で計上する。
    // 満期償還処理は既存の動作を維持し、別バージョンで改修する。
    const maturedBondIds = []
    const manualMaturityEvents = (input.futureEvents || []).filter((event) => event.enabled !== false && event.type === 'bondMaturity' && (event.eventDate || event.date || '').slice(0, 7) === monthKey)
    const manualMaturityAssetIds = new Set(manualMaturityEvents.map((event) => resolveEventAsset(investmentAssets, event.sourceAssetCategory, event.sourceAssetId)?.assetId).filter(Boolean))
    for (const asset of investmentAssets) {
      if (asset.assetType !== 'bond' || !asset.purchaseDate) continue
      const firstCouponDate = asset.firstCouponDate || null
      let couponDue = false
      let couponCount = 0
      const couponFrequency = Math.max(1, Number(asset.couponPaymentFrequency || 2))
      const monthsPerCoupon = Math.max(1, Math.round(12 / couponFrequency))
      if (firstCouponDate && firstCouponDate >= asset.purchaseDate) {
        const firstMonth = firstCouponDate.slice(0, 7)
        const firstYear = Number(firstCouponDate.slice(0, 4))
        const firstMonthNum = Number(firstCouponDate.slice(5, 7))
        const currentMonthNum = year * 12 + date.getMonth()
        const firstMonthIndex = firstYear * 12 + firstMonthNum - 1
        const monthDifference = currentMonthNum - firstMonthIndex
        couponDue = monthKey >= firstMonth && monthDifference >= 0 && monthDifference % monthsPerCoupon === 0
      } else {
        // 旧データは従来の購入月起点の利息計算を維持する。
        const elapsedMonths = (year - Number(asset.purchaseDate.slice(0, 4))) * 12 + (date.getMonth() + 1 - Number(asset.purchaseDate.slice(5, 7)))
        const legacyFrequency = Math.max(1, Number(asset.couponFrequency || 12))
        const legacyMonthsPerCoupon = Math.max(1, Math.round(12 / legacyFrequency))
        couponDue = elapsedMonths > 0 && elapsedMonths % legacyMonthsPerCoupon === 0
        couponCount = legacyFrequency
      }
      if (couponDue) {
        let annualInterest = 0
        if (asset.couponInputMode === 'amount') {
          annualInterest = Math.max(0, Number(asset.annualCouponAmount || 0))
        } else {
          const rate = Math.max(0, Number(asset.couponRate || 0))
          const faceAmount = Math.max(0, Number(asset.faceAmount || asset.balance || 0))
          annualInterest = faceAmount * rate
        }
        const paymentsPerYear = Math.max(1, Number(asset.firstCouponDate ? asset.couponPaymentFrequency || 2 : couponCount || 1))
        let interestPayment = annualInterest / paymentsPerYear
        if (asset.couponTaxMode === 'net') interestPayment *= 0.79685
        interestPayment = Math.round(interestPayment)
        if (interestPayment > 0) {
          const cashTarget = cashAssets.find((cash) => cash.assetId === asset.couponDestinationAssetId) || cashAssets[0]
          if (cashTarget) cashTarget.balance = Number(cashTarget.balance || 0) + interestPayment
          yearIncome += interestPayment
          yearFinancialAssetIncome += interestPayment
        }
      }
      if (asset.maturityDate && asset.maturityDate.slice(0, 7) === monthKey && !manualMaturityAssetIds.has(asset.assetId)) {
        // 自動満期償還：額面元本を登録された受取先へ移し、債券資産を除去する。
        const principal = Math.max(0, Number(asset.faceAmount || asset.balance || 0))
        const cashTarget = cashAssets.find((cash) => cash.assetId === asset.maturityDestinationAssetId)
          || cashAssets.find((cash) => cash.assetType === 'cash')
          || cashAssets[0]
          || ensureCashAsset(cashAssets, 'cash')
        cashTarget.balance = Number(cashTarget.balance || 0) + principal
        asset.balance = 0
        maturedBondIds.push(asset.assetId)
      }
    }
    if (maturedBondIds.length) investmentAssets = investmentAssets.filter((asset) => !maturedBondIds.includes(asset.assetId))

    // 旧来の収入・支出レコードは互換性のため保持。イベントへ移行後は設定で試算対象から外せる。
    const useLegacyRecords = input.conditions?.useLegacyIncomeExpense !== false
    const legacyIncomeRecords = useLegacyRecords ? input.incomeRecords : []
    const legacyExpenseRecords = useLegacyRecords ? input.expenseRecords : []
    const incomeBreakdown = calculateMonthlyIncomeBreakdown(
      legacyIncomeRecords, date, input.persons || [], input.conditions?.defaultIncomeGrowthRate ?? 0,
    )
    const incomeByAssetType = calculateMonthlyIncomeByAssetType(
      legacyIncomeRecords, date, input.persons || [], input.conditions?.defaultIncomeGrowthRate ?? 0,
    )
    const regularIncome = incomeBreakdown.salary + incomeBreakdown.bonus + incomeBreakdown.pension + incomeBreakdown.other
    const regularExpense = calculateMonthlyExpense(
      legacyExpenseRecords, date, Number(input.conditions?.defaultInflationRate || 0),
    )
    const expenseByAssetType = calculateMonthlyExpenseByAssetType(
      legacyExpenseRecords, date, Number(input.conditions?.defaultInflationRate || 0),
    )
    const monthEvents = sortEventsForMonth(input.futureEvents || [], monthKey)
    const legacyEvents = monthEvents.filter((event) => !['income', 'expense', 'assetPurchase', 'assetSale', 'bondPurchase', 'bondMaturity', 'autoFunding'].includes(event.type))
    const eventAmounts = calculateOneTimeEventAmounts(legacyEvents, date)
    let individualEventIncome = 0
    let individualEventExpense = 0
    let eventFundingShortfall = 0
    // 個別資産を指定するイベントは、月内の統一順序で資産残高に直接反映する。
    for (const event of monthEvents) {
      const amount = Math.max(0, Number(event.amount ?? event.incomeAmount ?? event.expenseAmount ?? event.purchaseAmount ?? event.saleAmount ?? event.principalAmount ?? 0))
      if (['assetPurchase', 'bondPurchase'].includes(event.type)) {
        const purchaseAmount = Math.max(0, Number(event.purchaseAmount || 0))
        const allAssetsForPurchase = [...cashAssets, ...investmentAssets]
        const source = resolveEventAsset(allAssetsForPurchase, event.sourceAssetCategory, event.sourceAssetId)
        const destination = resolveEventAsset(allAssetsForPurchase, event.destinationAssetCategory, event.destinationAssetId)
        const categorySourceAssets = event.sourceAssetCategory
          ? allAssetsForPurchase.filter((asset) => assetMatchesEventCategory(asset, event.sourceAssetCategory))
          : []
        const sourceAvailable = event.sourceAssetCategory
          ? categorySourceAssets.reduce((sum, asset) => sum + Math.max(0, Number(asset.balance || 0)), 0)
          : Number(source?.balance || 0)
        if (!source || (destination && source.assetId === destination.assetId) || purchaseAmount <= 0 || sourceAvailable < purchaseAmount) { eventFundingShortfall += purchaseAmount; continue }
        if (event.sourceAssetCategory) debitAssetCategory(allAssetsForPurchase, event.sourceAssetCategory, '', purchaseAmount)
        else source.balance = Number(source.balance || 0) - purchaseAmount
        if (destination) {
          destination.balance = Number(destination.balance || 0) + purchaseAmount
          if (event.type === 'bondPurchase') {
            destination.assetType = 'bond'
            destination.couponRate = event.couponInputMode === 'amount' ? 0 : Number(event.couponRate || 0)
            destination.couponInputMode = event.couponInputMode || 'rate'
            destination.annualCouponAmount = Number(event.annualCouponAmount || 0)
            destination.faceAmount = Number(event.faceAmount || event.purchaseAmount || 0)
            destination.firstCouponDate = event.firstCouponDate || defaultFirstCouponDate(event.eventDate, event.couponPaymentFrequency)
            destination.couponPaymentFrequency = Number(event.couponPaymentFrequency || 2)
            destination.couponTaxMode = event.couponTaxMode || 'gross'
            destination.couponDestinationAssetId = event.couponDestinationAssetId || ''
            destination.maturityDestinationAssetId = event.maturityDestinationAssetId || ''
            destination.maturityDate = event.maturityDate || null
            destination.purchaseDate = event.eventDate
          }
        } else {
          const assetType = event.type === 'bondPurchase' ? 'bond' : (['cash','deposit','investment','bond'].includes(event.destinationAssetCategory) ? event.destinationAssetCategory : event.purchaseAssetType || 'investment')
          const purchasedAsset = { assetId: `future-${event.eventId}`, assetType: ['cash','deposit'].includes(assetType) ? assetType : assetType === 'bond' ? 'bond' : 'investment', name: event.purchaseName || event.name || '将来購入資産', balance: purchaseAmount, annualReturn: assetType === 'bond' ? 0 : Number(event.annualReturn || 0), monthlyContribution: 0, taxCategory: event.purchaseTaxCategory || 'other', nisaType: event.purchaseTaxCategory === 'nisa' ? (['accumulation','growth'].includes(event.purchaseNisaType) ? event.purchaseNisaType : '') : '', withdrawalPriority: 50, withdrawalEnabled: true, purchaseDate: event.eventDate, couponRate: event.couponInputMode === 'amount' ? 0 : Number(event.couponRate || 0), couponInputMode: event.couponInputMode || 'rate', annualCouponAmount: Number(event.annualCouponAmount || 0), faceAmount: Number(event.faceAmount || purchaseAmount), firstCouponDate: event.firstCouponDate || defaultFirstCouponDate(event.eventDate, event.couponPaymentFrequency), couponPaymentFrequency: Number(event.couponPaymentFrequency || 2), couponTaxMode: event.couponTaxMode || 'gross', couponDestinationAssetId: event.couponDestinationAssetId || '', maturityDestinationAssetId: event.maturityDestinationAssetId || '', maturityDate: event.maturityDate || null, maturityDestinationAssetId: event.maturityDestinationAssetId || '', couponFrequency: Number(event.couponFrequency || 12) }
          if (['cash','deposit'].includes(purchasedAsset.assetType)) cashAssets.push(purchasedAsset); else investmentAssets.push(purchasedAsset)
        }
        processedPurchaseEvents.add(event.eventId)
      } else if (event.type === 'income') {
        const destination = resolveEventAsset([...cashAssets, ...investmentAssets], event.destinationAssetCategory, event.destinationAssetId)
        const result = applyEventIncome([...cashAssets, ...investmentAssets], destination?.assetId || '', amount)
        if (result.ok) individualEventIncome += amount
        else eventFundingShortfall += result.shortage
      } else if (event.type === 'expense') {
        const allAssets = [...cashAssets, ...investmentAssets]
        const result = event.sourceAssetCategory
          ? debitAssetCategory(allAssets, event.sourceAssetCategory, event.sourceAssetId, amount)
          : debitIndividualAsset(allAssets, event.sourceAssetId, amount)
        individualEventExpense += amount
        if (result.shortage > 0) {
          const funding = applyAutomaticFunding(cashAssets, investmentAssets, result.shortage)
          cashAssets = funding.cashAssets
          investmentAssets = funding.investmentAssets
          eventFundingShortfall += funding.unfundedAmount
        }
      } else if (event.type === 'assetSale') {
        const allAssets = [...cashAssets, ...investmentAssets]
        const source = resolveEventAsset(allAssets, event.sourceAssetCategory, event.sourceAssetId)
        const destination = resolveEventAsset(allAssets, event.destinationAssetCategory, event.destinationAssetId)
        const result = transferBetweenAssets(allAssets, source?.assetId || '', destination?.assetId || '', amount)
        if (result.shortage > 0) eventFundingShortfall += result.shortage
      } else if (event.type === 'autoFunding') {
        const funding = applyAutomaticFunding(cashAssets, investmentAssets, amount)
        cashAssets = funding.cashAssets
        investmentAssets = funding.investmentAssets
        eventFundingShortfall += funding.unfundedAmount
      } else if (event.type === 'bondMaturity') {
        const source = resolveEventAsset([...cashAssets, ...investmentAssets], event.sourceAssetCategory, event.sourceAssetId)
        const destination = resolveEventAsset([...cashAssets, ...investmentAssets], event.destinationAssetCategory, event.destinationAssetId)
        if (source && destination && source !== destination) {
          const principal = Math.min(Math.max(0, Number(source.balance || 0)), amount || Number(source.balance || 0))
          source.balance -= principal
          destination.balance = Number(destination.balance || 0) + principal
        } else eventFundingShortfall += amount || Math.max(0, Number(source?.balance || 0))
      }
    }
    const personBenefits = calculatePersonBenefits(input.persons || [], date)
    const registeredPensionIncome = calculateMonthlyPensionIncome(input.pensions || [], date, input.conditions || {})
    const monthlyPensionIncome = incomeBreakdown.pension + personBenefits.pensionIncome + registeredPensionIncome
    const monthlyIncome = incomeBreakdown.salary + incomeBreakdown.bonus + incomeBreakdown.other + eventAmounts.income + individualEventIncome + monthlyPensionIncome + personBenefits.retirementBenefit
    const monthlyExpense = regularExpense + eventAmounts.expense + individualEventExpense
    // 退職金・臨時イベント収入は、個別の課税計算を実装するまで概算率の対象外。
    const deductions = calculateMonthlyTaxAndInsurance({
      salaryIncome: incomeBreakdown.salary + incomeBreakdown.bonus,
      pensionIncome: monthlyPensionIncome,
      otherIncome: incomeBreakdown.other,
      conditions: input.conditions,
      year,
    })

    const scheduledContributions = getScheduledContributions(investmentAssets, date)

    const debtResult = processMonthlyLiabilities(liabilities, date)
    liabilities = debtResult.liabilities

    const investmentBefore = sumBalances(investmentAssets)
    let monthlyWithdrawals = []
    let monthlyFundingWithdrawals = []
    // 収入・支出は指定した資産区分へ反映。税・ローン・臨時イベント等は現金扱い。
    const generatedCashIncome = eventAmounts.income + personBenefits.pensionIncome + registeredPensionIncome + personBenefits.retirementBenefit
    const cashIncome = incomeByAssetType.cash + generatedCashIncome
    const depositIncome = incomeByAssetType.deposit
    const cashExpense = expenseByAssetType.cash + eventAmounts.expense + deductions.total + debtResult.payment
    const depositExpense = expenseByAssetType.deposit
    // 収入を先に入金し、支出を資産区分ごとに非負残高まで引き落とす。
    // 指定資産で不足した分は、自動資金補充ルール（現金→預貯金→対象投資資産）へ渡す。
    applyCashflowToAssetType(cashAssets, 'cash', cashIncome)
    applyCashflowToAssetType(cashAssets, 'deposit', depositIncome)
    let cashflowFundingShortfall = 0
    const cashExpenseShortage = applyCashflowToAssetType(cashAssets, 'cash', -cashExpense)
    const depositExpenseShortage = applyCashflowToAssetType(cashAssets, 'deposit', -depositExpense)
    if (input.conditions?.withdrawal?.enabled !== false) {
      const funding = applyAutomaticFunding(cashAssets, investmentAssets, cashExpenseShortage + depositExpenseShortage)
      cashAssets = funding.cashAssets
      investmentAssets = funding.investmentAssets
      cashflowFundingShortfall = funding.unfundedAmount
      monthlyFundingWithdrawals = funding.details
        .filter((item) => item.assetType === 'investment')
        .map((item) => ({ assetId: item.assetId, name: item.name, amount: item.amount }))
    } else {
      cashflowFundingShortfall = cashExpenseShortage + depositExpenseShortage
    }
    const cashBeforeGrowth = sumBalances(cashAssets)
    cashAssets = growCashAssets(cashAssets)
    const cashAssetReturn = sumBalances(cashAssets) - cashBeforeGrowth
    yearIncome += cashAssetReturn
    yearFinancialAssetIncome += cashAssetReturn

    const minimumCashReserve = getMinimumCashReserve(input.conditions || {})
    const refillStart = Math.max(0, Number(input.conditions?.withdrawal?.refillStartBalance ?? minimumCashReserve))
    const refillTarget = Math.max(refillStart, Number(input.conditions?.withdrawal?.refillTargetBalance ?? minimumCashReserve))
    const cashBeforeContribution = sumBalances(cashAssets)
    const contributionPlan = limitContributionsToAvailableCash(
      scheduledContributions,
      cashBeforeContribution,
      minimumCashReserve,
    )
    const contribution = contributionPlan.total
    debitCashPool(cashAssets, contribution)
    investmentAssets = growInvestmentAssets(
      investmentAssets,
      date,
      contributionPlan.contributions,
      input.conditions?.defaultInvestmentReturn ?? 0,
    )

    const investmentAfterGrowth = sumBalances(investmentAssets)
    const fundingInvestmentWithdrawal = monthlyFundingWithdrawals.reduce((sum, item) => sum + Number(item.amount || 0), 0)
    const investmentGain = investmentAfterGrowth - investmentBefore - contribution + fundingInvestmentWithdrawal

    // 現金が最低確保額を下回った場合、優先順位に従って投資資産を売却する。
    const withdrawalsEnabled = input.conditions?.withdrawal?.enabled !== false
    if (withdrawalsEnabled) {
      const cashBeforeWithdrawal = sumBalances(cashAssets)
      const requestedWithdrawal = cashBeforeWithdrawal < refillStart ? Math.max(0, refillTarget - cashBeforeWithdrawal) : 0
      if (requestedWithdrawal > 0) {
        const withdrawalResult = withdrawInvestmentAssets(investmentAssets, requestedWithdrawal)
        investmentAssets = withdrawalResult.assets
        monthlyWithdrawals = withdrawalResult.withdrawals
        const refillCashAsset = ensureCashAsset(cashAssets, 'cash')
        refillCashAsset.balance = Number(refillCashAsset.balance || 0) + withdrawalResult.withdrawnAmount
      }
    }
    monthlyWithdrawals.push(...monthlyFundingWithdrawals)
    const endingCashThisMonth = sumBalances(cashAssets)
    const endingCashDeficit = Math.max(0, -endingCashThisMonth)
    // 既存の不足残高を翌月に再加算しない。月内に増加した不足分のみを新規不足として計上。
    const monthlyCashShortfall = Math.max(0, endingCashDeficit - cashDeficitAtMonthStart)
    yearIncome += monthlyIncome
    yearSalaryIncome += incomeBreakdown.salary
    yearBonusIncome += incomeBreakdown.bonus
    yearOtherIncome += incomeBreakdown.other + eventAmounts.income + individualEventIncome
    yearPensionIncome += monthlyPensionIncome
    yearRetirementBenefit += personBenefits.retirementBenefit
    yearTax += deductions.tax
    yearIncomeTax += deductions.incomeTax
    yearResidentTax += deductions.residentTax
    yearSocialInsurance += deductions.socialInsurance
    // 支出には生活費等とローン利息を含め、元金返済は別項目で管理する。
    yearExpense += monthlyExpense + debtResult.interest
    yearInvestmentGain += investmentGain
    yearContribution += contribution
    yearDebtPayment += debtResult.payment
    yearDebtPrincipal += debtResult.principal
    yearDebtInterest += debtResult.interest
    yearWithdrawals.push(...monthlyWithdrawals)
    // 年間の現金不足は、その年に新たに発生した不足額の合計。最大不足残高ではない。
    yearCashShortfall += monthlyCashShortfall + eventFundingShortfall + cashflowFundingShortfall
  }

  annualResults.push(buildAnnualResult({
    year: currentYear, input, income: yearIncome, salaryIncome: yearSalaryIncome, bonusIncome: yearBonusIncome, otherIncome: yearOtherIncome, financialAssetIncome: yearFinancialAssetIncome, pensionIncome: yearPensionIncome, retirementBenefit: yearRetirementBenefit, tax: yearTax, incomeTax: yearIncomeTax, residentTax: yearResidentTax, socialInsurance: yearSocialInsurance, expense: yearExpense,
    investmentGain: yearInvestmentGain, contribution: yearContribution,
    debtPayment: yearDebtPayment, debtPrincipal: yearDebtPrincipal, debtInterest: yearDebtInterest,
    withdrawals: yearWithdrawals, cashShortfall: yearCashShortfall,
    openingAssets: yearOpeningAssets, closingAssets: sumFinancialAssets(cashAssets, investmentAssets), assetCategories: summarizeAssetCategories(cashAssets, investmentAssets),
    openingAssetDetails: yearOpeningAssetDetails, openingAssetCategories: yearOpeningAssetCategories,
    openingLiabilities: yearOpeningLiabilities, closingLiabilities: sumLiabilityBalances(liabilities),
    date: new Date(currentYear, 11, 31),
  }))

  // 年ごとの新規不足額と、開始年からの累計不足額を別フィールドで保持する。
  // UI・グラフ・シナリオ比較は同じ cumulativeCashShortfall を参照する。
  let cumulativeCashShortfall = 0
  for (const row of annualResults) {
    cumulativeCashShortfall += Math.max(0, Number(row.cashShortfall || 0))
    row.cumulativeCashShortfall = round(cumulativeCashShortfall)
  }

  const endFinancialAssets = sumFinancialAssets(cashAssets, investmentAssets)
  const endCashShortfall = Math.max(0, -sumBalances(cashAssets))
  const endLiabilities = sumLiabilityBalances(liabilities)
  const totalWithdrawals = annualResults.reduce((sum, row) => sum + row.withdrawalAmount, 0)
  const firstCashShortfall = annualResults.find((row) => row.cashShortfall > 0)
  return {
    summary: {
      startYear: startDate.getFullYear(),
      endYear: currentYear,
      startFinancialAssets: Number(input.assets?.reduce((sum, asset) => sum + Number(asset.balance || 0), 0) || 0),
      endFinancialAssets,
      startLiabilities: Number((input.liabilities || []).reduce((sum, item) => sum + Number(item.balance || 0), 0)),
      endLiabilities,
      endNetWorth: endFinancialAssets - endLiabilities,
      totalWithdrawals: round(totalWithdrawals),
      // 各年の新規不足額を合算。過年度の不足残高を重複計上しない。
      totalCashShortfall: round(annualResults.at(-1)?.cumulativeCashShortfall || 0),
      firstCashShortfallYear: firstCashShortfall?.year ?? null,
      endCashBalance: round(Math.max(0, sumBalances(cashAssets))),
      endCashShortfall: round(endCashShortfall),
      annualResultCount: annualResults.length,
    },
    annualResults,
    endingAssets: [...cashAssets, ...investmentAssets],
    endingLiabilities: liabilities.map(({ _startingBalance, _termMonths, _scheduledPayment, ...item }) => item),
    warnings: [
      '税金・社会保険料は入力した実効率による概算です。法定税額・保険料の自動計算ではありません。',
      '投資資産の取り崩しは売却手数料・譲渡益課税を考慮していません。税制区分は取り崩し優先順位の初期値にのみ使用します。',
      ...(firstCashShortfall ? [`${firstCashShortfall.year}年に現金不足が発生する予測です。年次結果の現金不足額を確認してください。`] : []),
      ...(input.conditions?.withdrawal?.enabled === false ? ['自動取り崩しは無効です。現金不足が発生しても投資資産を売却しません。'] : []),
      '退職金と将来イベントの臨時収入は、現段階では税金・社会保険料の概算率の対象外です。',
      '退職金は人物情報に登録した予定額を、設定した受取年齢に到達した月に一度だけ計上します。',
      ...((input.conditions?.useLegacyIncomeExpense !== false && (input.incomeRecords || []).some((record) => record.category === 'pension')) && (input.persons || []).some((person) => Number(person.pensionAnnualAmount || 0) > 0) ? ['年金収入レコードと人物情報の年金年額が両方設定されています。二重計上を避けるため、どちらか一方を使用してください。'] : []),
      ...(cashAssets.some((asset) => asset.isVirtual) ? ['現金口座が未登録のため、計算上の現金残高を内部で使用しています。実際の現金・預金残高を登録してください。'] : []),
      ...getLiabilityWarnings(input.liabilities || []),
    ],
  }
}

function calculatePersonBenefits(persons, date) {
  let pensionIncome = 0
  let retirementBenefit = 0
  const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0)
  const previousMonthEnd = new Date(date.getFullYear(), date.getMonth(), 0)

  for (const person of persons) {
    const ageAtMonthEnd = getAge(person.birthDate, monthEnd)
    if (ageAtMonthEnd == null) continue

    const pensionStartAge = Number(person.pensionStartAge ?? 65)
    const annualPension = Math.max(0, Number(person.pensionAnnualAmount || 0))
    if (annualPension > 0 && ageAtMonthEnd >= pensionStartAge) {
      const startYear = new Date(person.birthDate).getFullYear() + pensionStartAge
      const elapsedYears = Math.max(0, date.getFullYear() - startYear)
      const growthRate = Number(person.pensionAnnualGrowthRate || 0)
      pensionIncome += annualPension * Math.pow(1 + growthRate, elapsedYears) / 12
    }

    const benefitAmount = Math.max(0, Number(person.retirementBenefitAmount || 0))
    const benefitAge = Number(person.retirementBenefitAge ?? person.retirementAge ?? 65)
    const previousAge = getAge(person.birthDate, previousMonthEnd)
    if (benefitAmount > 0 && ageAtMonthEnd >= benefitAge && (previousAge == null || previousAge < benefitAge)) {
      retirementBenefit += benefitAmount
    }
  }

  return { pensionIncome, retirementBenefit }
}

function buildAnnualResult({ year, input, income, salaryIncome = 0, bonusIncome = 0, otherIncome = 0, financialAssetIncome = 0, pensionIncome = 0, retirementBenefit = 0, tax = 0, incomeTax = 0, residentTax = 0, socialInsurance = 0, expense, investmentGain, contribution, debtPayment, debtPrincipal, debtInterest, withdrawals = [], cashShortfall = 0, openingAssets, closingAssets, assetCategories = null, openingAssetDetails = [], openingAssetCategories = null, openingLiabilities, closingLiabilities, date }) {
  const ages = (input.persons || []).map((person) => ({
    personId: person.personId,
    name: person.name,
    age: getAge(person.birthDate, date),
  }))
  return {
    year,
    ages,
    income: round(income),
    salaryIncome: round(salaryIncome),
    bonusIncome: round(bonusIncome),
    otherIncome: round(otherIncome),
    financialAssetIncome: round(financialAssetIncome),
    pensionIncome: round(pensionIncome),
    retirementBenefit: round(retirementBenefit),
    tax: round(tax),
    incomeTax: round(incomeTax),
    residentTax: round(residentTax),
    socialInsurance: round(socialInsurance),
    totalDeductions: round(tax + socialInsurance),
    expense: round(expense),
    debtPayment: round(debtPayment),
    debtPrincipal: round(debtPrincipal),
    debtInterest: round(debtInterest),
    netCashflow: round(income - expense - debtPrincipal - tax - socialInsurance),
    investmentContribution: round(contribution),
    investmentGain: round(investmentGain),
    withdrawalAmount: round(withdrawals.reduce((sum, item) => sum + item.amount, 0)),
    withdrawalDetails: Object.values(withdrawals.reduce((map, item) => {
      const key = item.assetId || item.name
      if (!map[key]) map[key] = { assetId: item.assetId, name: item.name, amount: 0 }
      map[key].amount += item.amount
      return map
    }, {})).map((item) => ({ ...item, amount: round(item.amount) })),
    cashShortfall: round(cashShortfall),
    openingFinancialAssets: round(openingAssets),
    closingFinancialAssets: round(closingAssets),
    assetCategories: assetCategories || { cash: 0, deposit: 0, nisa: 0, taxable: 0, bond: 0, other: 0 },
    openingAssetCategories: openingAssetCategories || summarizeOpeningAssetDetails(openingAssetDetails),
    openingAssetDetails: openingAssetDetails.map((asset) => ({ ...asset })),
    openingLiabilities: round(openingLiabilities),
    closingLiabilities: round(closingLiabilities),
    netWorth: round(closingAssets - closingLiabilities),
  }
}

function round(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100
}
