import { getAge, isActiveInMonth, yearsSince } from './dateUtils.js'

function monthlyAmount(record, date) {
  if (record.frequency === 'monthly') return Number(record.amount || 0)
  if (record.frequency === 'annual') return Number(record.amount || 0) / 12
  if (record.frequency === 'once') {
    const start = record.startDate || record.date
    return start && start.slice(0, 7) === `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      ? Number(record.amount || 0)
      : 0
  }
  return 0
}

export function calculateMonthlyIncomeBreakdown(records = [], date, persons = [], defaultIncomeGrowthRate = 0) {
  const personById = new Map(persons.map((person) => [person.personId, person]))
  const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0)
  const totals = { salary: 0, bonus: 0, pension: 0, other: 0 }

  for (const record of records) {
    if (!isActiveInMonth(record, date)) continue
    if (['salary', 'bonus'].includes(record.category) && record.personId && personById.has(record.personId)) {
      const person = personById.get(record.personId)
      const age = getAge(person.birthDate, monthEnd)
      if (age != null && person.retirementAge != null && age >= Number(person.retirementAge)) continue
    }
    const base = monthlyAmount(record, date)
    const growth = record.annualGrowthRate == null
      ? Number(defaultIncomeGrowthRate || 0)
      : Number(record.annualGrowthRate || 0)
    const elapsedYears = yearsSince(record.startDate, date)
    const amount = base * Math.pow(1 + growth, elapsedYears)
    const category = ['salary', 'bonus', 'pension'].includes(record.category) ? record.category : record.category === 'reemployment' ? 'salary' : 'other'
    totals[category] += amount
  }

  return totals
}

export function calculateMonthlyIncome(records = [], date, persons = [], defaultIncomeGrowthRate = 0) {
  const breakdown = calculateMonthlyIncomeBreakdown(records, date, persons, defaultIncomeGrowthRate)
  return breakdown.salary + breakdown.bonus + breakdown.pension + breakdown.other
}

export function calculateMonthlyExpense(records = [], date, defaultInflationRate = 0) {
  return records.reduce((total, record) => {
    if (!isActiveInMonth(record, date)) return total
    const base = monthlyAmount(record, date)
    const inflation = record.annualInflationRate == null
      ? defaultInflationRate
      : Number(record.annualInflationRate)
    const elapsedYears = yearsSince(record.startDate, date)
    return total + base * Math.pow(1 + inflation, elapsedYears)
  }, 0)
}

export function calculateOneTimeEventAmounts(events = [], date) {
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  return events.reduce((totals, event) => {
    const eventDate = event.eventDate || event.date
    if (!eventDate || eventDate.slice(0, 7) !== key) return totals
    totals.income += Number(event.incomeAmount || 0)
    totals.expense += Number(event.expenseAmount || 0)
    return totals
  }, { income: 0, expense: 0 })
}


// 収入レコードを現金・預貯金の入金先区分ごとに集計する。旧データは現金扱い。
export function calculateMonthlyIncomeByAssetType(records = [], date, persons = [], defaultIncomeGrowthRate = 0) {
  const personById = new Map(persons.map((person) => [person.personId, person]))
  const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0)
  const totals = { cash: 0, deposit: 0 }
  for (const record of records) {
    if (!isActiveInMonth(record, date)) continue
    if (['salary', 'bonus'].includes(record.category) && record.personId && personById.has(record.personId)) {
      const person = personById.get(record.personId)
      const age = getAge(person.birthDate, monthEnd)
      if (age != null && person.retirementAge != null && age >= Number(person.retirementAge)) continue
    }
    const base = monthlyAmount(record, date)
    const growth = record.annualGrowthRate == null ? Number(defaultIncomeGrowthRate || 0) : Number(record.annualGrowthRate || 0)
    const amount = base * Math.pow(1 + growth, yearsSince(record.startDate, date))
    const assetType = record.cashflowAssetType === 'deposit' ? 'deposit' : 'cash'
    totals[assetType] += amount
  }
  return totals
}

// 支出レコードを支払元区分ごとに集計する。旧データは現金扱い。
export function calculateMonthlyExpenseByAssetType(records = [], date, defaultInflationRate = 0) {
  const totals = { cash: 0, deposit: 0 }
  for (const record of records) {
    if (!isActiveInMonth(record, date)) continue
    const base = monthlyAmount(record, date)
    const inflation = record.annualInflationRate == null ? defaultInflationRate : Number(record.annualInflationRate)
    const amount = base * Math.pow(1 + inflation, yearsSince(record.startDate, date))
    const assetType = record.cashflowAssetType === 'deposit' ? 'deposit' : 'cash'
    totals[assetType] += amount
  }
  return totals
}

// 旧呼び出しとの互換性を保つため、差額を返す関数も残す。
export function calculateOneTimeEvents(events = [], date) {
  const amounts = calculateOneTimeEventAmounts(events, date)
  return amounts.expense - amounts.income
}
