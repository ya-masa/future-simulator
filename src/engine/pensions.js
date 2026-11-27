/**
 * 年金データの移行と月次受給額計算。
 * 改定率は予測用の仮定値であり、法定改定率を自動取得するものではない。
 */
export function normalizePensionData(input) {
  input.persons ||= []
  input.incomeRecords ||= []
  input.conditions ||= {}
  input.conditions.pensionAdjustmentRates ||= {
    basicAnnualRate: 0,
    employeesAnnualRate: 0,
  }

  const hadPensionCollection = Array.isArray(input.pensions)
  if (!hadPensionCollection) input.pensions = []

  const legacyIncomePensions = input.incomeRecords.filter((record) => record.category === 'pension')
  for (const record of legacyIncomePensions) {
    const frequency = record.frequency || 'annual'
    const annualAmount = Math.max(0, Number(record.amount || 0)) * (frequency === 'monthly' ? 12 : 1)
    input.pensions.push({
      pensionId: record.incomeId || `migrated-pension-${input.pensions.length + 1}`,
      personId: record.personId || '',
      name: record.name || '移行した年金',
      pensionType: 'other',
      annualAmount,
      startDate: record.startDate || input.household?.startDate || '2026-01-01',
      endDate: record.endDate || null,
      adjustmentMode: 'custom',
      annualGrowthRate: Number(record.annualGrowthRate || 0),
      enabled: true,
    })
  }
  if (legacyIncomePensions.length) {
    input.incomeRecords = input.incomeRecords.filter((record) => record.category !== 'pension')
  }

  const legacyPersonPensions = input.persons.filter((person) => Number(person.pensionAnnualAmount || 0) > 0)
  const notices = []
  if (!hadPensionCollection) {
    let duplicateRiskCount = 0
    for (const person of legacyPersonPensions) {
      const age = Number(person.pensionStartAge ?? 65)
      const birthDate = String(person.birthDate || '')
      const match = birthDate.match(/^(\d{4})-(\d{2})-\d{2}$/)
      const startDate = match
        ? `${Number(match[1]) + age}-${match[2]}-01`
        : input.household?.startDate || '2026-01-01'
      const duplicateRisk = legacyIncomePensions.some((record) => !record.personId || record.personId === person.personId)
      if (duplicateRisk) duplicateRiskCount += 1
      input.pensions.push({
        pensionId: `migrated-person-${person.personId || input.pensions.length + 1}`,
        personId: person.personId || '',
        name: `${person.name || '人物'}の年金`,
        pensionType: 'other',
        annualAmount: Math.max(0, Number(person.pensionAnnualAmount || 0)),
        startDate,
        endDate: null,
        adjustmentMode: 'custom',
        annualGrowthRate: Number(person.pensionAnnualGrowthRate || 0),
        enabled: !duplicateRisk,
      })
    }
    if (duplicateRiskCount > 0) {
      notices.push('旧データで同じ人物（または世帯共通）の「収入の年金」と「人物情報の年金額」が重複している可能性があるため、人物情報側から移行した年金を「試算に含めない」に設定しました。別々の年金であれば、年金管理で有効にしてください。')
    }
  }

  // 旧項目を残したままにすると旧ロジックとの二重計上につながるためゼロ化する。
  for (const person of input.persons) {
    person.pensionStartAge = person.pensionStartAge ?? 65
    person.pensionAnnualAmount = 0
    person.pensionAnnualGrowthRate = 0
  }
  input.pensionMigrationNotices = [
    ...(Array.isArray(input.pensionMigrationNotices) ? input.pensionMigrationNotices : []),
    ...notices,
  ]
  return { data: input, notices }
}

function getPersonAge(birthDate, date) {
  if (!birthDate) return null
  const birth = new Date(`${birthDate}T00:00:00`)
  if (Number.isNaN(birth.getTime())) return null
  let age = date.getFullYear() - birth.getFullYear()
  if (date.getMonth() < birth.getMonth() || (date.getMonth() === birth.getMonth() && date.getDate() < birth.getDate())) age -= 1
  return age
}

function isActiveInMonth(record, date) {
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  const start = String(record.startDate || '0000-01-01').slice(0, 7)
  const end = record.endDate ? String(record.endDate).slice(0, 7) : null
  return key >= start && (!end || key <= end)
}

function resolvePensionGrowthRate(pension, conditions = {}) {
  const mode = pension.adjustmentMode || (
    ['basic', 'employees'].includes(pension.pensionType) ? 'public' : 'custom'
  )
  if (mode === 'none') return 0
  if (mode === 'public') {
    const rates = conditions.pensionAdjustmentRates || {}
    if (pension.pensionType === 'basic') return Number(rates.basicAnnualRate || 0)
    if (pension.pensionType === 'employees') return Number(rates.employeesAnnualRate || 0)
    return Number(pension.annualGrowthRate || 0)
  }
  return Number(pension.annualGrowthRate || 0)
}

export function calculateMonthlyPensionIncome(pensions = [], date, conditions = {}, persons = []) {
  const personById = new Map(persons.map((person) => [person.personId, person]))
  const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0)
  return pensions.reduce((total, pension) => {
    if (pension.enabled === false) return total
    if (!isActiveInMonth(pension, date)) return total
    const person = personById.get(pension.personId)
    if (person) {
      const age = getPersonAge(person.birthDate, monthEnd)
      const cutoff = Number(person.calculationEndAge ?? 100)
      if (age != null && age >= cutoff) return total
    }
    const annualAmount = Math.max(0, Number(pension.annualAmount || 0))
    if (!annualAmount) return total
    const startYear = Number(String(pension.startDate || '').slice(0, 4)) || date.getFullYear()
    const elapsedYears = Math.max(0, date.getFullYear() - startYear)
    const growthRate = resolvePensionGrowthRate(pension, conditions)
    return total + annualAmount * Math.pow(1 + growthRate, elapsedYears) / 12
  }, 0)
}
