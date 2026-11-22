import { getAge, parseDate } from './dateUtils.js'

/** 保存プランのデータ管理。既存の世帯データ本体を変更せず、スナップショットを扱う。 */
export function clonePlanData(data) {
  const copy = JSON.parse(JSON.stringify(data || {}))
  delete copy.savedPlans
  delete copy.activeSavedPlanId
  return copy
}

function createInitialPlanId() {
  return 'plan-current'
}

/** V1.5.9以前のデータを、既存内容を保持したまま保存プラン形式へ移行する。 */
export function initializeSavedPlanLibrary(data) {
  if (!data || typeof data !== 'object') throw new Error('世帯データがありません。')

  if (!Array.isArray(data.savedPlans) || data.savedPlans.length === 0) {
    const planId = createInitialPlanId()
    data.savedPlans = [{
      planId,
      name: '現在のプラン',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      data: clonePlanData(data),
    }]
    data.activeSavedPlanId = planId
    return data
  }

  data.savedPlans = data.savedPlans
    .filter((plan) => plan && typeof plan.planId === 'string' && plan.data && typeof plan.data === 'object')
    .map((plan) => ({
      planId: plan.planId,
      name: String(plan.name || '保存プラン'),
      createdAt: plan.createdAt || null,
      updatedAt: plan.updatedAt || null,
      data: clonePlanData(plan.data),
    }))

  if (data.savedPlans.length === 0) {
    const planId = createInitialPlanId()
    data.savedPlans = [{ planId, name: '現在のプラン', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), data: clonePlanData(data) }]
    data.activeSavedPlanId = planId
    return data
  }

  if (!data.savedPlans.some((plan) => plan.planId === data.activeSavedPlanId)) {
    data.activeSavedPlanId = data.savedPlans[0].planId
  }
  // 現在開いているデータは最新状態として、アクティブプランのスナップショットへ同期する。
  const active = data.savedPlans.find((plan) => plan.planId === data.activeSavedPlanId)
  if (active) {
    active.data = clonePlanData(data)
    active.updatedAt = new Date().toISOString()
  }
  return data
}

/** 試算結果から比較用の最低資産・最低時点・最終資産を抽出する。 */
export function summarizePlanResult(result, input = null) {
  if (!result || !Array.isArray(result.annualResults)) throw new Error('試算結果が正しくありません。')
  const annual = result.annualResults
  const first = annual[0]
  const startDate = input?.household?.startDate ? parseDate(input.household.startDate) : null
  const startAges = startDate && Array.isArray(input?.persons)
    ? input.persons.map((person) => ({ name: person.name, age: getAge(person.birthDate, startDate) }))
    : (first?.ages || [])
  const candidates = [{
    year: result.summary.startYear,
    amount: Number(result.summary.startFinancialAssets || 0),
    ages: startAges,
  }, ...annual.map((row) => ({
    year: row.year,
    amount: Number(row.closingFinancialAssets || 0),
    ages: row.ages || [],
  }))]
  let minimum = candidates[0]
  for (const candidate of candidates.slice(1)) {
    if (candidate.amount < minimum.amount) minimum = candidate
  }
  return {
    minimumAssets: minimum.amount,
    minimumYear: minimum.year,
    minimumAges: minimum.ages.map((person) => ({ name: person.name, age: person.age })),
    finalAssets: Number(result.summary.endFinancialAssets || 0),
    finalYear: result.summary.endYear,
  }
}
