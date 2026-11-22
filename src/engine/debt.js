import { monthIndex, parseDate } from './dateUtils.js'
import { monthlyRateFromAnnual } from './investment.js'

function monthsInclusive(startValue, endValue) {
  const start = startValue instanceof Date ? startValue : parseDate(startValue)
  const end = endValue instanceof Date ? endValue : parseDate(endValue)
  if (!start || !end || monthIndex(end) < monthIndex(start)) return 0
  return monthIndex(end) - monthIndex(start) + 1
}

export function calculateMonthlyPayment(principal, monthlyRate, months) {
  const amount = Math.max(0, Number(principal) || 0)
  const rate = Number(monthlyRate) || 0
  const count = Math.max(0, Math.floor(Number(months) || 0))
  if (amount === 0 || count === 0) return 0
  if (rate === 0) return amount / count
  const factor = Math.pow(1 + rate, count)
  return amount * rate * factor / (factor - 1)
}

export function prepareLiabilities(liabilities = [], simulationStartDate) {
  const simulationStart = parseDate(simulationStartDate)
  return liabilities.map((source) => {
    const liability = { ...source, balance: Math.max(0, Number(source.balance) || 0) }
    const start = parseDate(liability.startDate) || simulationStart
    const effectiveStart = simulationStart && start && monthIndex(start) < monthIndex(simulationStart)
      ? simulationStart
      : start
    const termMonths = monthsInclusive(effectiveStart, liability.endDate)
    const rate = monthlyRateFromAnnual(liability.annualInterestRate ?? liability.interestRate ?? 0)
    const method = liability.repaymentMethod || 'equalPayment'
    const calculatedPayment = method === 'equalPayment'
      ? calculateMonthlyPayment(liability.balance, rate, termMonths)
      : 0
    return {
      ...liability,
      _startingBalance: liability.balance,
      _termMonths: termMonths,
      _scheduledPayment: Number(liability.monthlyPayment) > 0
        ? Number(liability.monthlyPayment)
        : calculatedPayment,
    }
  })
}

/**
 * 指定月のローン返済を計算する。
 * 返済額は現金流出、利息は費用、元金は負債残高の減少として分けて返す。
 */
export function processMonthlyLiabilities(liabilities = [], date) {
  let totalPayment = 0
  let totalInterest = 0
  let totalPrincipal = 0

  const updatedLiabilities = liabilities.map((liability) => {
    const balance = Math.max(0, Number(liability.balance) || 0)
    if (balance <= 0) return { ...liability, balance: 0 }

    const start = parseDate(liability.startDate)
    const end = parseDate(liability.endDate)
    const currentMonth = monthIndex(date)
    if ((start && currentMonth < monthIndex(start)) || (end && currentMonth > monthIndex(end))) {
      return liability
    }

    const annualRate = Number(liability.annualInterestRate ?? liability.interestRate ?? 0)
    const monthlyRate = monthlyRateFromAnnual(annualRate)
    const interest = balance * monthlyRate
    const method = liability.repaymentMethod || 'equalPayment'
    const isFinalMonth = Boolean(end && currentMonth === monthIndex(end))
    let payment = 0
    let principal = 0

    if (method === 'bullet') {
      payment = interest + (isFinalMonth ? balance : 0)
      principal = isFinalMonth ? balance : 0
    } else if (method === 'equalPrincipal') {
      const principalPerMonth = liability._termMonths > 0
        ? Number(liability._startingBalance || balance) / liability._termMonths
        : 0
      principal = Math.min(balance, principalPerMonth)
      payment = interest + principal
      if (isFinalMonth) {
        principal = balance
        payment = interest + principal
      }
    } else {
      const scheduled = Number(liability._scheduledPayment || liability.monthlyPayment || 0)
      if (scheduled > 0) {
        // 返済額が利息を下回る場合、未払い利息を元本に組み入れる。
        const paidInterest = Math.min(interest, scheduled)
        const unpaidInterest = interest - paidInterest
        principal = Math.min(balance + unpaidInterest, Math.max(0, scheduled - interest))
        payment = Math.min(scheduled, balance + interest)
        if (isFinalMonth) {
          principal = balance
          payment = balance + interest
        }
        const nextBalance = Math.max(0, balance + unpaidInterest - principal)
        totalPayment += payment
        totalInterest += interest
        totalPrincipal += principal
        return { ...liability, balance: isFinalMonth ? 0 : nextBalance }
      }
      // 返済額も返済期限も未設定なら、自動返済は行わず、利息を残高に組み入れる。
      totalInterest += interest
      return { ...liability, balance: balance + interest, accruedInterest: Number(liability.accruedInterest || 0) + interest }
    }

    payment = Math.min(payment, balance + interest)
    principal = Math.min(balance, principal)
    const nextBalance = Math.max(0, balance - principal)
    totalPayment += payment
    totalInterest += interest
    totalPrincipal += principal
    return { ...liability, balance: isFinalMonth ? 0 : nextBalance }
  })

  return {
    liabilities: updatedLiabilities,
    payment: totalPayment,
    interest: totalInterest,
    principal: totalPrincipal,
  }
}

export function sumLiabilityBalances(liabilities = []) {
  return liabilities.reduce((total, item) => total + Math.max(0, Number(item.balance) || 0), 0)
}

export function getLiabilityWarnings(liabilities = []) {
  const warnings = []
  liabilities.forEach((item) => {
    const method = item.repaymentMethod || 'equalPayment'
    const start = parseDate(item.startDate)
    const end = parseDate(item.endDate)
    const label = item.name || '負債'
    if (start && end && monthIndex(end) < monthIndex(start)) {
      warnings.push(`${label}：返済終了年月が返済開始年月より前です。`)
    }
    if (method === 'bullet' && !item.endDate) {
      warnings.push(`${label}：一括返済の返済終了日が未設定です。`)
    }
    if (method === 'equalPrincipal' && !item.endDate) {
      warnings.push(`${label}：元金均等返済には返済終了日の設定が必要です。`)
    }
    if (method === 'equalPayment' && !(Number(item.monthlyPayment) > 0) && !item.endDate) {
      warnings.push(`${label}：返済終了日または毎月返済額を設定してください。`)
    }
    if (method === 'equalPayment' && Number(item.monthlyPayment) > 0) {
      const rate = monthlyRateFromAnnual(item.annualInterestRate ?? item.interestRate ?? 0)
      const firstMonthInterest = Math.max(0, Number(item.balance) || 0) * rate
      if (Number(item.monthlyPayment) < firstMonthInterest) {
        warnings.push(`${label}：毎月返済額が初月の利息を下回るため、負債残高が増える可能性があります。`)
      }
    }
  })
  return warnings
}
