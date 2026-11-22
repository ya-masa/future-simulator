import { runSimulation } from './simulation.js'

export const defaultScenarios = [
  {
    scenarioId: 'standard',
    name: '標準',
    description: '現在登録している条件をそのまま使用します。',
    inflationDelta: 0,
    investmentReturnDelta: 0,
    incomeGrowthDelta: 0,
    pensionGrowthDelta: 0,
  },
  {
    scenarioId: 'optimistic',
    name: '楽観',
    description: '物価上昇が抑えられ、運用・収入が標準より良好な場合。',
    inflationDelta: -0.005,
    investmentReturnDelta: 0.02,
    incomeGrowthDelta: 0.005,
    pensionGrowthDelta: 0.002,
  },
  {
    scenarioId: 'pessimistic',
    name: '悲観',
    description: '物価上昇が高く、運用・収入が標準より低調な場合。',
    inflationDelta: 0.01,
    investmentReturnDelta: -0.02,
    incomeGrowthDelta: -0.005,
    pensionGrowthDelta: -0.005,
  },
]

function adjustedRate(value, delta) {
  return Math.max(-0.99, Number(value || 0) + Number(delta || 0))
}

/**
 * シナリオ条件を入力データのコピーに適用する。
 * 元データは変更しない。各deltaは年率の加算値（例: 0.01 = +1%pt）。
 */
export function applyScenario(input, scenario) {
  // Vueのreactive/refから渡されるProxyはstructuredCloneできないため、
  // localStorageと同じJSON互換データとして複製する。
  const scenarioInput = JSON.parse(JSON.stringify(input))
  const inflationDelta = Number(scenario.inflationDelta || 0)
  const investmentReturnDelta = Number(scenario.investmentReturnDelta || 0)
  const incomeGrowthDelta = Number(scenario.incomeGrowthDelta || 0)
  const pensionGrowthDelta = Number(scenario.pensionGrowthDelta || 0)

  scenarioInput.conditions ||= {}
  scenarioInput.conditions.defaultInflationRate = adjustedRate(
    scenarioInput.conditions.defaultInflationRate,
    inflationDelta,
  )

  scenarioInput.conditions.defaultIncomeGrowthRate = adjustedRate(
    scenarioInput.conditions.defaultIncomeGrowthRate,
    incomeGrowthDelta,
  )
  scenarioInput.conditions.defaultInvestmentReturn = adjustedRate(
    scenarioInput.conditions.defaultInvestmentReturn,
    investmentReturnDelta,
  )

  scenarioInput.expenseRecords = (scenarioInput.expenseRecords || []).map((record) => ({
    ...record,
    ...(record.annualInflationRate == null
      ? {}
      : { annualInflationRate: adjustedRate(record.annualInflationRate, inflationDelta) }),
  }))

  scenarioInput.assets = (scenarioInput.assets || []).map((asset) => {
    if (['cash', 'deposit'].includes(asset.assetType) || asset.annualReturn == null) return { ...asset }
    return { ...asset, annualReturn: adjustedRate(asset.annualReturn, investmentReturnDelta) }
  })

  scenarioInput.incomeRecords = (scenarioInput.incomeRecords || []).map((record) => {
    const isPension = record.category === 'pension'
    const delta = isPension ? pensionGrowthDelta : incomeGrowthDelta
    return record.annualGrowthRate == null
      ? { ...record }
      : { ...record, annualGrowthRate: adjustedRate(record.annualGrowthRate, delta) }
  })

  scenarioInput.persons = (scenarioInput.persons || []).map((person) => ({
    ...person,
    pensionAnnualGrowthRate: adjustedRate(person.pensionAnnualGrowthRate, pensionGrowthDelta),
  }))

  scenarioInput.pensions = (scenarioInput.pensions || []).map((pension) => {
    const mode = pension.adjustmentMode || (['basic', 'employees'].includes(pension.pensionType) ? 'public' : 'custom')
    if (mode === 'none') return { ...pension }
    if (mode === 'public') return { ...pension }
    return { ...pension, annualGrowthRate: adjustedRate(pension.annualGrowthRate, pensionGrowthDelta) }
  })
  if (scenarioInput.conditions?.pensionAdjustmentRates) {
    scenarioInput.conditions.pensionAdjustmentRates = {
      ...scenarioInput.conditions.pensionAdjustmentRates,
      basicAnnualRate: adjustedRate(scenarioInput.conditions.pensionAdjustmentRates.basicAnnualRate, pensionGrowthDelta),
      employeesAnnualRate: adjustedRate(scenarioInput.conditions.pensionAdjustmentRates.employeesAnnualRate, pensionGrowthDelta),
    }
  }

  return scenarioInput
}

export function runScenarioComparisons(input, scenarios = defaultScenarios) {
  return scenarios.map((scenario) => ({
    scenario: { ...scenario },
    result: runSimulation(applyScenario(input, scenario)),
  }))
}
