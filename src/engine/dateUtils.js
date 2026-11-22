export function parseDate(value) {
  if (!value) return null
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

export function monthIndex(date) {
  return date.getFullYear() * 12 + date.getMonth()
}

export function isActiveInMonth(record, date) {
  const start = parseDate(record.startDate)
  const end = parseDate(record.endDate)
  const current = monthIndex(date)
  if (start && current < monthIndex(start)) return false
  if (end && current > monthIndex(end)) return false
  return true
}

export function yearsSince(startValue, date) {
  const start = parseDate(startValue)
  if (!start) return 0
  return Math.max(0, (monthIndex(date) - monthIndex(start)) / 12)
}

export function getAge(birthDate, date) {
  const birth = parseDate(birthDate)
  if (!birth) return null
  let age = date.getFullYear() - birth.getFullYear()
  const beforeBirthday = date.getMonth() < birth.getMonth()
    || (date.getMonth() === birth.getMonth() && date.getDate() < birth.getDate())
  if (beforeBirthday) age -= 1
  return age
}
