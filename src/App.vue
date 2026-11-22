<script setup>
import { computed, ref, watch } from 'vue'
import { Line, Bar } from 'vue-chartjs'
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend, Filler } from 'chart.js'
import { defaultHousehold } from './data/defaultHousehold.js'
import { runSimulation } from './engine/simulation.js'
import { getYearOverYearAssetChange } from './engine/annualComparison.js'
import { normalizePensionData } from './engine/pensions.js'
import { defaultScenarios, runScenarioComparisons } from './engine/scenarios.js'
import { clonePlanData, initializeSavedPlanLibrary, summarizePlanResult } from './engine/planManagement.js'
import { createBackup, parseBackup } from './engine/backup.js'
import { downloadExcelWorkbook } from './engine/excelExport.js'
import { parseExcelWorkbook } from './engine/excelImport.js'
import { sendGasRequest, validateCloudConfig } from './engine/cloudStorage.js'
import { saveLocalStore, getLatestLocalBackup } from './engine/localStore.js'

const assetSegmentLabels = {
  id: 'assetSegmentLabels',
  afterDatasetsDraw(chart) {
    if (chart.options.plugins?.assetSegmentLabels === false) return
    if (!chart.data.datasets.some((dataset) => dataset.stack === 'assets')) return
    const { ctx } = chart
    ctx.save()
    ctx.font = 'bold 10px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    chart.data.datasets.forEach((dataset, datasetIndex) => {
      if (dataset.stack !== 'assets' || !chart.isDatasetVisible(datasetIndex)) return
      const meta = chart.getDatasetMeta(datasetIndex)
      meta.data.forEach((bar, index) => {
        const value = Number(dataset.data[index] || 0)
        const height = Math.abs(bar.base - bar.y)
        if (value <= 0 || height < 20) return
        const label = `${Math.round(value / 10000).toLocaleString('ja-JP')}万`
        const centerY = (bar.base + bar.y) / 2
        const textWidth = ctx.measureText(label).width
        ctx.fillStyle = 'rgba(255,255,255,0.88)'
        ctx.fillRect(bar.x - textWidth / 2 - 3, centerY - 7, textWidth + 6, 14)
        ctx.fillStyle = '#30271f'
        ctx.fillText(label, bar.x, centerY, Math.max(24, bar.width - 2))
      })
    })
    const yScale = chart.scales.y
    const firstMeta = chart.getDatasetMeta(0)
    firstMeta.data.forEach((bar, index) => {
      const total = chart.data.datasets.reduce((sum, dataset, datasetIndex) => sum + (chart.isDatasetVisible(datasetIndex) ? Number(dataset.data[index] || 0) : 0), 0)
      if (total <= 0) return
      const label = `${Math.round(total / 10000).toLocaleString('ja-JP')}万`
      const y = yScale.getPixelForValue(total) - 9
      ctx.font = 'bold 10px sans-serif'
      ctx.fillStyle = '#30271f'
      ctx.fillText(label, bar.x, Math.max(8, y))
    })
    ctx.restore()
  },
}
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend, Filler, assetSegmentLabels)

const STORAGE_KEY = 'future-simulator-household-v02'
function loadHousehold() {
  const indexedDbData = window.__FUTURE_SIMULATOR_INITIAL_DATA__
  if (indexedDbData && typeof indexedDbData === 'object') {
    return structuredClone(indexedDbData)
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? JSON.parse(saved) : structuredClone(defaultHousehold)
  } catch {
    return structuredClone(defaultHousehold)
  }
}

function normalizeLegacyIncomeExpenseSetting(data) {
  if (!data.conditions) data.conditions = {}
  if (data.conditions.useLegacyIncomeExpense == null) data.conditions.useLegacyIncomeExpense = true
  return data
}

const householdData = ref(normalizeLegacyIncomeExpenseSetting(loadHousehold()))
normalizePensionData(householdData.value)
try { localStorage.setItem(STORAGE_KEY, JSON.stringify(householdData.value)) } catch { /* IndexedDBを主保存先として継続 */ }
if (!Array.isArray(householdData.value.scenarios) || householdData.value.scenarios.length === 0) {
  householdData.value.scenarios = structuredClone(defaultScenarios)
}
if (!Array.isArray(householdData.value.liabilities)) householdData.value.liabilities = []
if (!householdData.value.conditions) householdData.value.conditions = {}
if (householdData.value.conditions.defaultIncomeGrowthRate == null) {
  householdData.value.conditions.defaultIncomeGrowthRate = defaultHousehold.conditions.defaultIncomeGrowthRate
}
if (householdData.value.conditions.defaultInvestmentReturn == null) {
  householdData.value.conditions.defaultInvestmentReturn = defaultHousehold.conditions.defaultInvestmentReturn
}
if (!householdData.value.conditions.taxInsurance) householdData.value.conditions.taxInsurance = structuredClone(defaultHousehold.conditions.taxInsurance)
if (!Array.isArray(householdData.value.conditions.taxInsurance.yearlyRates)) householdData.value.conditions.taxInsurance.yearlyRates = []
if (!householdData.value.conditions.withdrawal) householdData.value.conditions.withdrawal = structuredClone(defaultHousehold.conditions.withdrawal)
else {
  if (householdData.value.conditions.withdrawal.enabled == null) householdData.value.conditions.withdrawal.enabled = true
  if (householdData.value.conditions.withdrawal.minimumCashReserve == null) householdData.value.conditions.withdrawal.minimumCashReserve = 0
  if (householdData.value.conditions.withdrawal.refillStartBalance == null) householdData.value.conditions.withdrawal.refillStartBalance = householdData.value.conditions.withdrawal.minimumCashReserve
  if (householdData.value.conditions.withdrawal.refillTargetBalance == null) householdData.value.conditions.withdrawal.refillTargetBalance = householdData.value.conditions.withdrawal.minimumCashReserve
}
if (!Array.isArray(householdData.value.assets)) householdData.value.assets = []
const legacyCashflowAssetType = householdData.value.assets.find((asset) => ['cash', 'deposit'].includes(asset.assetType))?.assetType || 'cash'
for (const record of householdData.value.incomeRecords || []) { if (!['cash', 'deposit'].includes(record.cashflowAssetType)) record.cashflowAssetType = legacyCashflowAssetType }
for (const record of householdData.value.expenseRecords || []) { if (!['cash', 'deposit'].includes(record.cashflowAssetType)) record.cashflowAssetType = legacyCashflowAssetType }
for (const asset of householdData.value.assets) {
  if (asset.withdrawalEnabled == null) asset.withdrawalEnabled = true
  if (!asset.taxCategory) asset.taxCategory = 'other'
  if (asset.nisaType == null) asset.nisaType = ''
  if (!Number.isFinite(Number(asset.withdrawalPriority))) asset.withdrawalPriority = asset.assetType === 'bond' ? 30 : 10
}
if (!Array.isArray(householdData.value.futureEvents)) householdData.value.futureEvents = []
for (const event of householdData.value.futureEvents) { if (!event.type) event.type = 'cashflow' }
initializeSavedPlanLibrary(householdData.value)
try { localStorage.setItem(STORAGE_KEY, JSON.stringify(householdData.value)) } catch { /* IndexedDBを主保存先として継続 */ }
const activeTab = ref('overview')
const compareMode = ref('scenarios')
const settingsSection = ref('settings')
const activeDataCategory = ref('household')
const dataCategories = [
  { id: 'household', number: '01', title: '世帯・人物', description: '世帯情報・家族構成・退職金' },
  { id: 'income', number: '02', title: '収入', description: '給与・賞与・年金・その他収入' },
  { id: 'expense', number: '03', title: '支出', description: '生活費・住居費・医療費など' },
  { id: 'assets', number: '04', title: '金融資産', description: '現金・預貯金・投資・債券' },
  { id: 'liabilities', number: '05', title: '負債・ローン', description: '住宅・自動車・教育ローンなど' },
  { id: 'events', number: '06', title: '将来イベント', description: '臨時収入・臨時支出' },
  { id: 'tax', number: '07', title: '税金・社会保険', description: '税・社会保険料の概算率' },
  { id: 'conditions', number: '08', title: '運用・試算条件', description: '物価上昇・取り崩し・シナリオ' },
  { id: 'pensions', number: '09', title: '年金管理', description: '公的年金・企業年金・個人年金' },
]
const backupInput = ref(null)
const excelImportInput = ref(null)
const backupMessage = ref('')
const backupError = ref('')
const excelMessage = ref('')
const excelError = ref('')
const excelImportMessage = ref('')
const excelImportError = ref('')
const cloudWebAppUrl = ref(localStorage.getItem('future-simulator-gas-url') || '')
const cloudAccessToken = ref(localStorage.getItem('future-simulator-gas-token') || '')
const cloudMessage = ref('')
const cloudError = ref('')
const cloudBusy = ref(false)
const cloudStatus = ref(null)
const cloudConflict = ref(false)
const cloudNeedsBaseline = ref(false)
const cloudStatusLabel = ref('未確認')
const cloudSyncPending = ref(false)
const cloudAutoSyncEnabled = ref(localStorage.getItem('future-simulator-auto-cloud-sync') === 'true')
let cloudAutoSyncTimer = null
let skipNextAutoSync = false

const isRunning = ref(false)
const saveMessage = ref(window.__FUTURE_SIMULATOR_SAVED_AT__ ? `保存済み · ${formatDateTime(window.__FUTURE_SIMULATOR_SAVED_AT__)}` : '初回保存待ち')
const localStoreMode = ref(localStorage.getItem('future-simulator-storage-mode') || 'IndexedDB')
const lastSavedAt = ref(window.__FUTURE_SIMULATOR_SAVED_AT__ || null)
const lastBackupAt = ref(window.__FUTURE_SIMULATOR_LAST_BACKUP_AT__ || null)
const saveStatus = ref('saved')
const latestAutoBackupAt = ref(lastBackupAt.value)
const simulationError = ref('')
const simulationResult = ref(runSimulation(householdData.value))
const scenarioResults = ref(runScenarioComparisons(householdData.value, householdData.value.scenarios))
const selectedPlanIds = ref([householdData.value.activeSavedPlanId])
const selectedResultYear = ref(simulationResult.value.annualResults[0]?.year ?? new Date().getFullYear())
const resultAssetScroll = ref(null)
const resultCashflowScroll = ref(null)
const resultTableScroll = ref(null)

watch(householdData, (value) => {
  if (skipNextAutoSync) {
    skipNextAutoSync = false
  } else {
    scheduleAutoCloudSync()
  }
  saveStatus.value = 'saving'
  saveMessage.value = '保存中…'
  saveLocalStore(STORAGE_KEY, value)
    .then((result) => {
      lastSavedAt.value = result.savedAt
      lastBackupAt.value = result.lastBackupAt
      latestAutoBackupAt.value = result.lastBackupAt
      saveStatus.value = 'saved'
      saveMessage.value = `保存済み · ${formatDateTime(result.savedAt)}`
    })
    .catch(() => {
      localStoreMode.value = 'localStorage（代替保存）'
      saveStatus.value = 'error'
      saveMessage.value = '保存エラー · ブラウザ内の代替保存のみ'
    })
}, { deep: true })

const assetCategoryLabels = [
  { key: 'cash', label: '現金', color: '#8b6848' },
  { key: 'deposit', label: '預貯金', color: '#c6a06a' },
  { key: 'nisa', label: 'NISA', color: '#78936a' },
  { key: 'taxable', label: '特定口座', color: '#6c8da5' },
  { key: 'bond', label: '債券', color: '#a58a57' },
  { key: 'other', label: 'その他', color: '#9a8a9c' },
]
const chartData = computed(() => ({
  labels: simulationResult.value.annualResults.map((item) => `${item.year}年`),
  datasets: [
    ...assetCategoryLabels.map((category) => ({
      label: category.label,
      data: simulationResult.value.annualResults.map((item) => Number(item.assetCategories?.[category.key] || 0)),
      backgroundColor: category.color,
      borderColor: category.color,
      borderWidth: 1,
      stack: 'assets',
    })),
    {
      label: '現金不足累計',
      data: simulationResult.value.annualResults.map((item) => -Math.abs(Number(item.cumulativeCashShortfall || 0))),
      backgroundColor: '#b34d4d',
      borderColor: '#b34d4d',
      borderWidth: 1,
      stack: 'shortfall',
    },
  ],
}))
const selectedAnnualResult = computed(() => simulationResult.value.annualResults.find((row) => row.year === Number(selectedResultYear.value)) || simulationResult.value.annualResults[0] || null)
const annualCashflowChartData = computed(() => ({
  labels: simulationResult.value.annualResults.map((item) => `${item.year}年`),
  datasets: [{
    label: '収入', data: simulationResult.value.annualResults.map((item) => item.income),
    borderColor: '#78936a', backgroundColor: 'rgba(120, 147, 106, 0.08)', tension: 0.22,
  }, {
    label: '支出', data: simulationResult.value.annualResults.map((item) => item.expense),
    borderColor: '#b36b54', backgroundColor: 'rgba(179, 107, 84, 0.06)', tension: 0.22,
  }, {
    label: '年間収支', data: simulationResult.value.annualResults.map((item) => item.netCashflow),
    borderColor: '#8b6848', backgroundColor: 'transparent', borderDash: [5, 3], tension: 0.22,
  }],
}))
const nisaChartData = computed(() => ({
  labels: simulationResult.value.annualResults.map((item) => `${item.year}年`),
  datasets: [{
    label: 'NISA評価額',
    data: simulationResult.value.annualResults.map((item) => Number(item.assetCategories?.nisa || 0)),
    borderColor: '#78936a',
    backgroundColor: 'rgba(120, 147, 106, 0.12)',
    pointBackgroundColor: '#78936a',
    pointRadius: 2,
    fill: true,
    tension: 0.22,
  }],
}))
const scenarioChartData = computed(() => ({
  labels: scenarioResults.value[0]?.result.annualResults.map((item) => `${item.year}年`) || [],
  datasets: scenarioResults.value.map((entry, index) => ({
    label: `${entry.scenario.name}：金融資産`,
    data: entry.result.annualResults.map((item) => item.closingFinancialAssets),
    borderColor: ['#8b6848', '#78936a', '#b36b54'][index % 3],
    backgroundColor: 'transparent',
    borderDash: index === 0 ? [] : index === 1 ? [5, 3] : [2, 3],
    fill: false,
    tension: 0.22,
  })),
}))
const planComparisonEntries = computed(() => {
  const selected = householdData.value.savedPlans.filter((plan) => selectedPlanIds.value.includes(plan.planId))
  return selected.map((plan) => {
    try {
      const result = runSimulation(plan.data)
      return { plan, result, summary: summarizePlanResult(result, plan.data), error: '' }
    } catch (error) {
      return { plan, result: null, summary: null, error: error instanceof Error ? error.message : '試算に失敗しました。' }
    }
  })
})
const planComparisonChartData = computed(() => {
  const validEntries = planComparisonEntries.value.filter((entry) => entry.result)
  const years = [...new Set(validEntries.flatMap((entry) => entry.result.annualResults.map((row) => row.year)))].sort((a, b) => a - b)
  const palette = ['#8b6848', '#78936a', '#b36b54', '#6c8da5', '#a58a57', '#8a789c', '#568c83', '#c17c55']
  return {
    labels: years.map((year) => `${year}年`),
    datasets: validEntries.map((entry, index) => {
      const byYear = new Map(entry.result.annualResults.map((row) => [row.year, row.closingFinancialAssets]))
      return {
        label: entry.plan.name,
        data: years.map((year) => byYear.has(year) ? byYear.get(year) : null),
        borderColor: palette[index % palette.length],
        backgroundColor: 'transparent',
        borderDash: index === 0 ? [] : index % 2 ? [5, 3] : [2, 3],
        fill: false,
        tension: 0.22,
      }
    }),
  }
})
const planComparisonYearRows = computed(() => {
  const validEntries = planComparisonEntries.value.filter((entry) => entry.result)
  const years = [...new Set(validEntries.flatMap((entry) => entry.result.annualResults.map((row) => row.year)))].sort((a, b) => a - b)
  return years.map((year) => {
    const values = validEntries.map((entry) => {
      const row = entry.result.annualResults.find((item) => item.year === year)
      return { planId: entry.plan.planId, assets: row?.closingFinancialAssets ?? null, ages: row?.ages || [] }
    })
    const referenceAge = values[0]?.ages?.[0]?.age
    return { year, referenceAge, values }
  })
})
const chartOptions = {
  responsive: true, maintainAspectRatio: false,
  plugins: {
    legend: { display: true, position: 'bottom' },
    tooltip: { callbacks: { label: (context) => `${context.dataset.label}: ${new Intl.NumberFormat('ja-JP').format(context.raw)}円` } },
  },
  scales: { y: { ticks: { callback: (value) => `${Math.round(value / 10000).toLocaleString('ja-JP')}万円` } } },
}
const assetChartOptions = {
  ...chartOptions,
  scales: {
    x: { stacked: true },
    y: { stacked: true, beginAtZero: true, grace: '10%', ticks: { callback: (value) => `${Math.round(value / 10000).toLocaleString('ja-JP')}万円` } },
  },
}
const homeAssetChartOptions = {
  ...assetChartOptions,
  plugins: {
    ...assetChartOptions.plugins,
    assetSegmentLabels: false,
  },
}
const yearlyChartOptions = {
  ...chartOptions,
  scales: {
    x: { ticks: { autoSkip: false, maxRotation: 0, minRotation: 0 } },
    y: { ticks: { callback: (value) => `${Math.round(value / 10000).toLocaleString('ja-JP')}万円` } },
  },
}
const yearlyAssetChartOptions = {
  ...assetChartOptions,
  scales: {
    x: { stacked: true, ticks: { autoSkip: false, maxRotation: 0, minRotation: 0 } },
    y: { stacked: true, beginAtZero: true, grace: '10%', ticks: { callback: (value) => `${Math.round(value / 10000).toLocaleString('ja-JP')}万円` } },
  },
}
const resultTimelineWidth = computed(() => `${Math.max(simulationResult.value.annualResults.length * 108, 648)}px`)
const resultChartWidth = computed(() => `${40 + Math.max(simulationResult.value.annualResults.length * 108, 648)}px`)
const resultContentWidth = computed(() => `${168 + Math.max(simulationResult.value.annualResults.length * 108, 648)}px`)
const annualTableRows = computed(() => {
  const results = simulationResult.value.annualResults
  const definitions = [
    ...(results[0]?.ages || []).map((person) => ({
      label: `${person.name}の年齢`,
      get: (row) => {
        const matchedPerson = person.personId != null
          ? row.ages.find((item) => item.personId === person.personId)
          : row.ages.find((item) => item.name === person.name)
        return matchedPerson?.age == null ? '—' : `${matchedPerson.age}歳`
      },
    })),
    { label: '年初金融資産', get: (row) => formatYen(row.openingFinancialAssets) },
    {
      label: '年初資産内訳',
      get: (row) => formatAnnualAssetBreakdown(row.openingAssetCategories),
      classFor: () => 'annual-breakdown-cell',
    },
    {
      label: '前年比金融資産増減',
      get: (row, index) => {
        const change = getYearOverYearAssetChange(results, index)
        return change.amount == null ? '—' : formatYen(change.amount)
      },
      classFor: (row, index) => {
        const change = getYearOverYearAssetChange(results, index)
        return change.amount == null ? '' : change.amount >= 0 ? 'positive' : 'negative'
      },
    },
    {
      label: '前年比金融資産増減率',
      get: (row, index) => {
        const change = getYearOverYearAssetChange(results, index)
        if (change.rate == null) return '—'
        return `${change.rate > 0 ? '+' : ''}${change.rate.toFixed(1)}%`
      },
      classFor: (row, index) => {
        const change = getYearOverYearAssetChange(results, index)
        return change.amount == null ? '' : change.amount >= 0 ? 'positive' : 'negative'
      },
    },
    { label: '年間収入', get: (row) => formatYen(row.income) },
    { label: '給与・再雇用収入', get: (row) => formatYen(row.salaryIncome) },
    { label: '賞与収入', get: (row) => formatYen(row.bonusIncome) },
    { label: '年金収入', get: (row) => formatYen(row.pensionIncome) },
    { label: '退職金収入', get: (row) => formatYen(row.retirementBenefit) },
    { label: 'その他・臨時収入', get: (row) => formatYen(row.otherIncome) },
    { label: '金融資産収入', get: (row) => formatYen(row.financialAssetIncome) },
    { label: '年間支出', get: (row) => formatYen(row.expense) },
    { label: '所得税', get: (row) => formatYen(row.incomeTax) },
    { label: '住民税', get: (row) => formatYen(row.residentTax) },
    { label: '社会保険料', get: (row) => formatYen(row.socialInsurance) },
    { label: '年間収支', get: (row) => formatYen(row.netCashflow), classFor: (row) => row.netCashflow >= 0 ? 'positive' : 'negative' },
    { label: '資産取り崩し', get: (row) => formatYen(row.withdrawalAmount) },
    { label: '取り崩し内訳', get: (row) => withdrawalSummary(row) },
    { label: '年間現金不足（新規）', get: (row) => formatYen(row.cashShortfall), classFor: (row) => row.cashShortfall > 0 ? 'negative' : 'positive' },
    { label: '現金不足累計', get: (row) => formatYen(row.cumulativeCashShortfall), classFor: (row) => row.cumulativeCashShortfall > 0 ? 'negative' : 'positive' },
    { label: 'ローン利息', get: (row) => formatYen(row.debtInterest) },
    { label: 'ローン返済額', get: (row) => formatYen(row.debtPayment) },
    { label: 'うち元金返済', get: (row) => formatYen(row.debtPrincipal) },
    { label: '年末負債', get: (row) => formatYen(row.closingLiabilities) },
    { label: '年末純資産', get: (row) => formatYen(row.netWorth) },
    { label: '年末金融資産', get: (row) => formatYen(row.closingFinancialAssets) },
    {
      label: '年間の金融資産増減',
      get: (row) => formatYen(row.closingFinancialAssets - row.openingFinancialAssets),
      classFor: (row) => row.closingFinancialAssets - row.openingFinancialAssets >= 0 ? 'positive' : 'negative',
    },
  ]
  return definitions.map((definition) => ({
    label: definition.label,
    cells: results.map((result, index) => ({
      year: result.year,
      value: definition.get(result, index),
      className: definition.classFor ? definition.classFor(result, index) : '',
    })),
  }))
})
function syncResultScroll(source) {
  const scrollElements = {
    assets: resultAssetScroll.value,
    cashflow: resultCashflowScroll.value,
    nisa: resultNisaScroll.value,
    table: resultTableScroll.value,
  }
  const sourceElement = scrollElements[source]
  if (!sourceElement) return
  for (const [key, targetElement] of Object.entries(scrollElements)) {
    if (key !== source && targetElement && Math.abs(targetElement.scrollLeft - sourceElement.scrollLeft) > 1) {
      targetElement.scrollLeft = sourceElement.scrollLeft
    }
  }
}
const formatYen = (value) => new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 }).format(value || 0)
const openingAssetCategoryLabels = { cash: '現金', deposit: '預貯金', nisa: 'NISA', taxable: '課税口座・一般口座', bond: '債券', other: 'その他' }
function formatAnnualAssetBreakdown(categories = {}) {
  const rows = Object.entries(categories || {})
    .filter(([, amount]) => Number(amount || 0) !== 0)
    .map(([key, amount]) => `${openingAssetCategoryLabels[key] || key} ${formatYen(amount)}`)
  return rows.length ? rows.join('\n') : '内訳なし'
}
const openingAssetCategoryRows = computed(() => Object.entries(selectedAnnualResult.value?.openingAssetCategories || {})
  .map(([key, amount]) => ({ key, label: openingAssetCategoryLabels[key] || key, amount: Number(amount || 0) }))
  .filter((row) => row.amount !== 0))
const ratePercent = (value) => Number(value || 0) * 100
const optionalRatePercent = (value) => value == null ? '' : Number(value) * 100
function setOptionalRate(record, key, value) {
  record[key] = value === '' ? null : Number(value) / 100
}
function setConditionRate(key, value, minimum = -99) {
  householdData.value.conditions[key] = Math.min(100, Math.max(minimum, Number(value || 0))) / 100
}
function onAssetTypeChange(asset) {
  if (['cash', 'deposit'].includes(asset.assetType) && asset.annualReturn == null) {
    asset.annualReturn = 0
  } else if (!['cash', 'deposit'].includes(asset.assetType) && asset.annualReturn === 0) {
    asset.annualReturn = null
  }
}
function assetReturnPlaceholder(asset) {
  return ['cash', 'deposit'].includes(asset.assetType)
    ? '0%'
    : `標準 ${ratePercent(householdData.value.conditions.defaultInvestmentReturn)}%`
}
function withdrawalSummary(row) {
  return (row.withdrawalDetails || []).map((item) => `${item.name}: ${formatYen(item.amount)}`).join(' / ') || '—'
}
function setTaxRate(key, value) { householdData.value.conditions.taxInsurance[key] = Math.min(100, Math.max(0, Number(value || 0))) / 100 }
function setPensionAdjustmentRate(key, value) {
  householdData.value.conditions.pensionAdjustmentRates ||= { basicAnnualRate: 0, employeesAnnualRate: 0 }
  householdData.value.conditions.pensionAdjustmentRates[key] = Math.min(100, Math.max(-99, Number(value || 0))) / 100
}
function addTaxYearRule() {
  const rules = householdData.value.conditions.taxInsurance.yearlyRates
  const nextYear = Math.max(new Date().getFullYear() + 1, ...rules.map((rule) => Number(rule.year) + 1))
  rules.push({ year: nextYear, rates: {} })
  rules.sort((a, b) => Number(a.year) - Number(b.year))
}
function removeTaxYearRule(index) { householdData.value.conditions.taxInsurance.yearlyRates.splice(index, 1) }
function setYearTaxRate(rule, key, value) { rule.rates[key] = Math.min(100, Math.max(0, Number(value || 0))) / 100 }
function setScenarioRate(scenario, key, value) { scenario[key] = Math.min(100, Math.max(-99, Number(value || 0))) / 100 }
function scenarioRatePercent(value) { return Number(value || 0) * 100 }

function syncCurrentPlanSnapshot() {
  const plan = householdData.value.savedPlans?.find((item) => item.planId === householdData.value.activeSavedPlanId)
  if (!plan) return
  plan.data = clonePlanData(householdData.value)
  plan.updatedAt = new Date().toISOString()
}
function saveCurrentPlanSnapshot() {
  syncCurrentPlanSnapshot()
  planMessage.value = `「${currentSavedPlanName.value}」を保存しました。`
}
const planMessage = ref('')
const currentSavedPlanName = computed(() => householdData.value.savedPlans?.find((item) => item.planId === householdData.value.activeSavedPlanId)?.name || '未選択')
function createSavedPlan() {
  const suggested = `${currentSavedPlanName.value}のコピー`
  const name = window.prompt('新しいプラン名を入力してください。', suggested)
  if (name == null || !name.trim()) return
  syncCurrentPlanSnapshot()
  const planId = makeId('plan')
  householdData.value.savedPlans.push({
    planId,
    name: name.trim(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    data: clonePlanData(householdData.value),
  })
  householdData.value.activeSavedPlanId = planId
  if (!selectedPlanIds.value.includes(planId)) selectedPlanIds.value.push(planId)
  planMessage.value = `「${name.trim()}」を作成しました。`
}
function renameSavedPlan(plan) {
  const name = window.prompt('プラン名を変更してください。', plan.name)
  if (name == null || !name.trim()) return
  plan.name = name.trim()
  plan.updatedAt = new Date().toISOString()
  planMessage.value = `プラン名を「${name.trim()}」に変更しました。`
}
function activateSavedPlan(planId, saveCurrent = true) {
  if (planId === householdData.value.activeSavedPlanId) return
  if (saveCurrent) syncCurrentPlanSnapshot()
  const target = householdData.value.savedPlans.find((item) => item.planId === planId)
  if (!target) return
  const library = householdData.value.savedPlans
  const next = clonePlanData(target.data)
  next.savedPlans = library
  next.activeSavedPlanId = planId
  if (!Array.isArray(next.scenarios) || !next.scenarios.length) next.scenarios = structuredClone(defaultScenarios)
  normalizePensionData(next)
  householdData.value = next
  simulationResult.value = runSimulation(next)
  scenarioResults.value = runScenarioComparisons(next, next.scenarios)
  selectedResultYear.value = simulationResult.value.annualResults[0]?.year ?? new Date().getFullYear()
  simulationError.value = ''
  planMessage.value = `「${target.name}」に切り替えました。`
}
function deleteSavedPlan(plan) {
  if (householdData.value.savedPlans.length <= 1) {
    window.alert('保存プランは最低1件必要です。')
    return
  }
  if (!window.confirm(`「${plan.name}」を削除します。削除したプランは元に戻せません。よろしいですか？`)) return
  const wasActive = plan.planId === householdData.value.activeSavedPlanId
  syncCurrentPlanSnapshot()
  householdData.value.savedPlans = householdData.value.savedPlans.filter((item) => item.planId !== plan.planId)
  selectedPlanIds.value = selectedPlanIds.value.filter((id) => id !== plan.planId)
  if (wasActive) {
    const nextPlan = householdData.value.savedPlans[0]
    activateSavedPlan(nextPlan.planId, false)
  }
  planMessage.value = `「${plan.name}」を削除しました。`
}
function togglePlanComparison(planId, checked) {
  if (checked) {
    if (!selectedPlanIds.value.includes(planId)) selectedPlanIds.value.push(planId)
  } else {
    selectedPlanIds.value = selectedPlanIds.value.filter((id) => id !== planId)
  }
}
function makeId(prefix) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }
function addPerson() {
  householdData.value.persons.push({ personId: makeId('person'), name: '新しい人物', relationship: 'family', birthDate: '1990-01-01', retirementAge: 65, retirementBenefitAge: 65, retirementBenefitAmount: 0 })
}
function addPension() {
  const person = householdData.value.persons[0]
  householdData.value.pensions ||= []
  householdData.value.pensions.push({
    pensionId: makeId('pension'),
    personId: person?.personId || '',
    name: '新しい年金',
    pensionType: 'basic',
    annualAmount: 0,
    startDate: householdData.value.household.startDate,
    endDate: null,
    adjustmentMode: 'public',
    annualGrowthRate: 0,
    enabled: true,
  })
}
function onPensionTypeChange(pension) {
  pension.adjustmentMode = ['basic', 'employees'].includes(pension.pensionType) ? 'public' : 'custom'
}
function addIncome() {
  householdData.value.incomeRecords.push({ incomeId: makeId('income'), personId: householdData.value.persons[0]?.personId || '', category: 'salary', name: '新しい収入', amount: 0, frequency: 'monthly', cashflowAssetType: 'cash', startDate: householdData.value.household.startDate, endDate: null, annualGrowthRate: null })
}
function addExpense() {
  householdData.value.expenseRecords.push({ expenseId: makeId('expense'), category: 'living', name: '新しい支出', amount: 0, frequency: 'monthly', cashflowAssetType: 'cash', startDate: householdData.value.household.startDate, endDate: null, annualInflationRate: null })
}
function addAsset() {
  householdData.value.assets.push({ assetId: makeId('asset'), assetType: 'cash', name: '新しい資産', balance: 0, annualReturn: 0, monthlyContribution: 0, contributionStartDate: null, contributionEndDate: null, taxCategory: 'taxable', withdrawalPriority: 10, withdrawalEnabled: true })
}
function addFutureEvent() {
  householdData.value.futureEvents.push({ eventId: makeId('event'), enabled: true, type: 'income', name: '新しいイベント', eventDate: householdData.value.household.startDate, endDate: '', frequency: 'monthly', amount: 0, sourceAssetId: '', destinationAssetId: '', sourceAssetCategory: '', destinationAssetCategory: '', purchaseAssetType: 'investment', purchaseTaxCategory: 'nisa', purchaseNisaType: 'growth', annualReturn: 0.04, couponRate: 0.02, faceAmount: 0, couponInputMode: 'rate', annualCouponAmount: 0, firstCouponDate: '', couponPaymentFrequency: 2, couponTaxMode: 'gross', maturityDate: '', maturityDestinationAssetId: '', description: '' })
}
function assetName(assetId) {
  const current = householdData.value.assets.find((asset) => asset.assetId === assetId)
  if (current) return current.name
  const future = householdData.value.futureEvents.find((event) => `future-${event.eventId}` === assetId && ['assetPurchase','bondPurchase'].includes(event.type))
  return future?.name || '未選択'
}
const eventAssetOptions = computed(() => householdData.value.assets.map((asset) => ({ assetId: asset.assetId, name: asset.name, assetType: asset.assetType, balance: asset.balance })))
function eventAssetOptionsFor(event) {
  const base = eventAssetOptions.value.slice()
  const eventDate = event.eventDate || ''
  const currentIndex = householdData.value.futureEvents.findIndex((candidate) => candidate.eventId === event.eventId)
  const earlierPurchases = householdData.value.futureEvents.filter((candidate, index) =>
    candidate.eventId !== event.eventId && ['assetPurchase','bondPurchase'].includes(candidate.type) && !candidate.destinationAssetId && candidate.eventDate && candidate.eventDate <= eventDate && (candidate.eventDate < eventDate || (['assetPurchase','bondPurchase'].includes(event.type) && index < currentIndex))
  ).map((candidate) => ({
    assetId: `future-${candidate.eventId}`,
    name: candidate.name || (candidate.type === 'bondPurchase' ? '将来購入債券' : '将来購入資産'),
    assetType: candidate.type === 'bondPurchase' ? 'bond' : candidate.purchaseAssetType || 'investment',
    balance: 0,
    future: true,
  }))
  return [...base, ...earlierPurchases]
}
function eventCategoryLabel(category) {
  return ({ cash: '現金', deposit: '預貯金', investment: '投資資産', bond: '債券', other: 'その他資産' })[category] || '未指定'
}
function eventCategory(event, field) {
  const categoryField = field === 'sourceAssetId' ? 'sourceAssetCategory' : 'destinationAssetCategory'
  if (event[categoryField]) return event[categoryField]
  const asset = householdData.value.assets.find((item) => item.assetId === event[field])
  if (asset?.assetType) return ['cash','deposit','investment','bond'].includes(asset.assetType) ? asset.assetType : 'other'
  const future = householdData.value.futureEvents.find((item) => `future-${item.eventId}` === event[field])
  if (future) return future.type === 'bondPurchase' ? 'bond' : future.purchaseAssetType || 'investment'
  return ''
}
function eventAssetSelection(event, field, allowNew = false) {
  const categoryField = field === 'sourceAssetId' ? 'sourceAssetCategory' : 'destinationAssetCategory'
  if (event[field]) return event[field]
  if (event[categoryField]) return `category:${event[categoryField]}`
  return allowNew ? 'new' : ''
}
function setEventAssetSelection(event, field, value) {
  const categoryField = field === 'sourceAssetId' ? 'sourceAssetCategory' : 'destinationAssetCategory'
  if (value.startsWith('category:')) {
    event[field] = ''
    event[categoryField] = value.slice(9)
  } else if (value === 'new' || value === '') {
    event[field] = ''
    event[categoryField] = ''
  } else {
    event[field] = value
    event[categoryField] = ''
  }
}
function setEventAssetCategory(event, field, category) {
  const categoryField = field === 'sourceAssetId' ? 'sourceAssetCategory' : 'destinationAssetCategory'
  event[categoryField] = category
  event[field] = ''
}
function eventTypeLabel(type) { return ({ income: '収入', expense: '支出', assetPurchase: '資産購入', assetSale: '資産売却', bondPurchase: '債券購入', bondMaturity: '債券満期', autoFunding: '自動資金補充', cashflow: '旧形式イベント' })[type] || type || '未設定' }
function ensureBondPurchaseFields(event) {
  if (event.type !== 'bondPurchase') return
  if (event.faceAmount == null) event.faceAmount = Number(event.purchaseAmount || 0)
  if (!event.couponInputMode) event.couponInputMode = 'rate'
  if (event.annualCouponAmount == null) event.annualCouponAmount = 0
  if (event.firstCouponDate == null) event.firstCouponDate = ''
  if (event.couponPaymentFrequency == null) event.couponPaymentFrequency = 2
  if (!event.couponTaxMode) event.couponTaxMode = 'gross'
  if (event.maturityDestinationAssetId == null) event.maturityDestinationAssetId = ''
}
function eventAssetSummary(event) {
  ensureBondPurchaseFields(event)
  if (event.type === 'income') return `入金先：${event.destinationAssetCategory ? eventCategoryLabel(event.destinationAssetCategory) : assetName(event.destinationAssetId)}`
  if (event.type === 'expense') return `支払元：${event.sourceAssetCategory ? eventCategoryLabel(event.sourceAssetCategory) : event.sourceAssetId ? assetName(event.sourceAssetId) : '自動資金補充ルール'}`
  if (['assetPurchase','bondPurchase'].includes(event.type)) return `購入元：${event.sourceAssetCategory ? eventCategoryLabel(event.sourceAssetCategory) : assetName(event.sourceAssetId)} ／ 購入先：${event.destinationAssetCategory ? eventCategoryLabel(event.destinationAssetCategory) : assetName(event.destinationAssetId)}`
  if (event.type === 'assetSale') return `売却元：${event.sourceAssetCategory ? eventCategoryLabel(event.sourceAssetCategory) : assetName(event.sourceAssetId)} ／ 売却先：${event.destinationAssetCategory ? eventCategoryLabel(event.destinationAssetCategory) : assetName(event.destinationAssetId)}`
  if (event.type === 'bondMaturity') return `償還元：${event.sourceAssetCategory ? eventCategoryLabel(event.sourceAssetCategory) : assetName(event.sourceAssetId)} ／ 償還先：${event.destinationAssetCategory ? eventCategoryLabel(event.destinationAssetCategory) : assetName(event.destinationAssetId)}`
  if (event.type === 'autoFunding') return '補充元：資金補充ルール'
  return '資産区分：旧形式イベント'
}
function addLiability() {
  householdData.value.liabilities.push({
    liabilityId: makeId('liability'),
    liabilityType: 'mortgage',
    name: '住宅ローン',
    balance: 0,
    annualInterestRate: 0.01,
    repaymentMethod: 'equalPayment',
    monthlyPayment: 0,
    startDate: householdData.value.household.startDate,
    endDate: '',
  })
}
function removeItem(list, index) { list.splice(index, 1) }
function executeSimulation() {
  isRunning.value = true
  simulationError.value = ''
  try {
    simulationResult.value = runSimulation(householdData.value)
    scenarioResults.value = runScenarioComparisons(householdData.value, householdData.value.scenarios)
    syncCurrentPlanSnapshot()
    selectedResultYear.value = simulationResult.value.annualResults[0]?.year ?? new Date().getFullYear()
    activeTab.value = 'overview'
  } catch (error) {
    simulationError.value = error instanceof Error ? error.message : '計算に失敗しました。入力内容を確認してください。'
  } finally {
    isRunning.value = false
  }
}
function formatDateTime(value) {
  if (!value) return '未保存'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '日時不明'
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(date)
}

async function restoreLatestAutoBackup() {
  backupError.value = ''
  backupMessage.value = ''
  try {
    const latest = await getLatestLocalBackup(STORAGE_KEY)
    if (!latest) {
      backupError.value = '自動バックアップはまだありません。'
      return
    }
    if (!window.confirm(`自動バックアップ（${formatDateTime(latest.savedAt)}）から復元します。現在のデータは置き換わります。続けますか？`)) return
    const restored = normalizeLegacyIncomeExpenseSetting(structuredClone(latest.data))
    normalizePensionData(restored)
    const nextResult = runSimulation(restored)
    const nextScenarios = Array.isArray(restored.scenarios) && restored.scenarios.length
      ? restored.scenarios
      : structuredClone(defaultScenarios)
    const nextScenarioResults = runScenarioComparisons(restored, nextScenarios)
    restored.scenarios = nextScenarios
    initializeSavedPlanLibrary(restored)
    householdData.value = restored
    selectedPlanIds.value = [restored.activeSavedPlanId]
    simulationResult.value = nextResult
    scenarioResults.value = nextScenarioResults
    selectedResultYear.value = nextResult.annualResults[0]?.year ?? new Date().getFullYear()
    backupMessage.value = `自動バックアップ（${formatDateTime(latest.savedAt)}）から復元しました。`
    activeTab.value = 'overview'
  } catch (error) {
    backupError.value = error instanceof Error ? error.message : '自動バックアップの復元に失敗しました。'
  }
}

function downloadBackup() {
  backupError.value = ''
  backupMessage.value = ''
  try {
    const backup = createBackup(householdData.value)
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const date = new Date().toISOString().slice(0, 10)
    link.href = url
    link.download = `future-simulator-backup-${date}.json`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    backupMessage.value = 'バックアップファイルを書き出しました。'
  } catch (error) {
    backupError.value = error instanceof Error ? error.message : 'バックアップの作成に失敗しました。'
  }
}

function exportExcel() {
  excelError.value = ''
  excelMessage.value = ''
  try {
    downloadExcelWorkbook({
      household: householdData.value,
      simulationResult: simulationResult.value,
      scenarioResults: scenarioResults.value,
    })
    excelMessage.value = 'Excelで開けるブックを書き出しました。'
  } catch (error) {
    excelError.value = error instanceof Error ? error.message : 'Excelファイルの書き出しに失敗しました。'
  }
}

function chooseBackupFile() {
  backupError.value = ''
  backupMessage.value = ''
  backupInput.value?.click()
}

function chooseExcelImportFile() {
  excelImportError.value = ''
  excelImportMessage.value = ''
  excelImportInput.value?.click()
}

async function importExcel(event) {
  const file = event.target.files?.[0]
  if (!file) return
  excelImportError.value = ''
  excelImportMessage.value = ''
  try {
    const xml = await file.text()
    const imported = normalizeLegacyIncomeExpenseSetting(parseExcelWorkbook(xml))
    normalizePensionData(imported)
    const nextScenarios = Array.isArray(imported.scenarios) && imported.scenarios.length
      ? imported.scenarios
      : structuredClone(defaultScenarios)
    imported.scenarios = nextScenarios
    // 置き換え前に計算できることを確認する。
    const nextResult = runSimulation(imported)
    const nextScenarioResults = runScenarioComparisons(imported, nextScenarios)
    initializeSavedPlanLibrary(imported)
    const counts = [
      `人物 ${imported.persons.length}件`,
      `収入 ${imported.incomeRecords.length}件`,
      `支出 ${imported.expenseRecords.length}件`,
      `資産 ${imported.assets.length}件`,
      `負債 ${imported.liabilities.length}件`,
      `イベント ${imported.futureEvents.length}件`,
    ].join('／')
    if (!window.confirm(`Excelファイル「${file.name}」を読み込みます。\n${counts}\n\n現在のデータは読み込んだ内容に置き換わります。事前にJSONバックアップを取ることをおすすめします。\n続けますか？`)) return

    imported.scenarios = nextScenarios
    householdData.value = imported
    selectedPlanIds.value = [imported.activeSavedPlanId]
    simulationResult.value = nextResult
    scenarioResults.value = nextScenarioResults
    selectedResultYear.value = nextResult.annualResults[0]?.year ?? new Date().getFullYear()
    simulationError.value = ''
    activeTab.value = 'overview'
    excelImportMessage.value = `「${file.name}」からデータを読み込みました。`
  } catch (error) {
    excelImportError.value = error instanceof Error ? error.message : 'Excelデータの読み込みに失敗しました。'
  } finally {
    event.target.value = ''
  }
}

async function restoreBackup(event) {
  const file = event.target.files?.[0]
  if (!file) return
  backupError.value = ''
  backupMessage.value = ''
  try {
    const text = await file.text()
    const restored = normalizeLegacyIncomeExpenseSetting(parseBackup(text))
    normalizePensionData(restored)
    if (!window.confirm('バックアップの内容で現在のデータを置き換えます。\n念のため、現在のデータも先にバックアップすることをおすすめします。\n復元を続けますか？')) return

    // 計算可能性を先に確認してから、現在のデータを置き換える。
    const nextScenarios = Array.isArray(restored.scenarios) && restored.scenarios.length
      ? restored.scenarios
      : defaultScenarios
    const nextResult = runSimulation(restored)
    const nextScenarioResults = runScenarioComparisons(restored, nextScenarios)
    restored.scenarios = nextScenarios
    initializeSavedPlanLibrary(restored)

    householdData.value = restored
    selectedPlanIds.value = [restored.activeSavedPlanId]
    if (!Array.isArray(householdData.value.scenarios) || householdData.value.scenarios.length === 0) {
      householdData.value.scenarios = JSON.parse(JSON.stringify(defaultScenarios))
    }
    simulationResult.value = nextResult
    scenarioResults.value = nextScenarioResults
    selectedResultYear.value = nextResult.annualResults[0]?.year ?? new Date().getFullYear()
    simulationError.value = ''
    activeTab.value = 'overview'
    backupMessage.value = `「${file.name}」からデータを復元しました。`
  } catch (error) {
    backupError.value = error instanceof Error ? error.message : 'バックアップの復元に失敗しました。'
  } finally {
    // 同じファイルを再選択した場合もchangeイベントが発生するようにする。
    event.target.value = ''
  }
}

function scheduleAutoCloudSync(delay = 1400) {
  if (!cloudAutoSyncEnabled.value) return
  cloudSyncPending.value = true
  if (cloudAutoSyncTimer) window.clearTimeout(cloudAutoSyncTimer)
  cloudAutoSyncTimer = window.setTimeout(() => {
    cloudAutoSyncTimer = null
    if (!cloudAutoSyncEnabled.value) return
    if (!cloudWebAppUrl.value.trim() || !cloudAccessToken.value.trim()) {
      cloudSyncPending.value = false
      cloudStatusLabel.value = '自動同期：設定待ち'
      return
    }
    saveToCloud(false, true)
  }, delay)
}

async function onAutoSyncChange(enabled) {
  cloudAutoSyncEnabled.value = Boolean(enabled)
  localStorage.setItem('future-simulator-auto-cloud-sync', String(cloudAutoSyncEnabled.value))
  if (!cloudAutoSyncEnabled.value) {
    if (cloudAutoSyncTimer) window.clearTimeout(cloudAutoSyncTimer)
    cloudAutoSyncTimer = null
    cloudSyncPending.value = false
    cloudMessage.value = '自動クラウド同期を停止しました。ローカル保存は継続します。'
    return
  }
  cloudError.value = ''
  cloudMessage.value = '自動同期を有効にしました。初回接続時はクラウドデータの確認が必要です。'
  if (!cloudWebAppUrl.value.trim() || !cloudAccessToken.value.trim()) {
    cloudStatusLabel.value = '自動同期：設定待ち'
    return
  }
  const checkedStatus = await checkCloudStatus()
  if (checkedStatus && !cloudConflict.value && !cloudNeedsBaseline.value) scheduleAutoCloudSync(250)
}

function saveCloudSettings() {
  cloudError.value = ''
  cloudMessage.value = ''
  try {
    const config = validateCloudConfig({ webAppUrl: cloudWebAppUrl.value, accessToken: cloudAccessToken.value })
    localStorage.setItem('future-simulator-gas-url', config.webAppUrl)
    localStorage.setItem('future-simulator-gas-token', config.accessToken)
    cloudWebAppUrl.value = config.webAppUrl
    cloudMessage.value = 'GAS接続設定をこのブラウザに保存しました。'
    if (cloudAutoSyncEnabled.value) scheduleAutoCloudSync(250)
  } catch (error) {
    cloudError.value = error instanceof Error ? error.message : '設定を保存できませんでした。'
  }
}

function currentHouseholdId() {
  const id = householdData.value?.household?.householdId
  if (!id) throw new Error('世帯IDがありません。世帯情報を確認してください。')
  return String(id)
}

function cloudRevisionStorageKey() {
  return `future-simulator-cloud-revision:${currentHouseholdId()}`
}

function getKnownCloudRevision() {
  try {
    const raw = localStorage.getItem(cloudRevisionStorageKey())
    if (raw == null || raw === '') return null
    const revision = Number(raw)
    return Number.isInteger(revision) && revision >= 0 ? revision : null
  } catch {
    return null
  }
}

function setKnownCloudRevision(revision) {
  localStorage.setItem(cloudRevisionStorageKey(), String(revision))
}

function applyCloudStatus(status) {
  cloudStatus.value = status
  cloudConflict.value = false
  cloudNeedsBaseline.value = false
  const knownRevision = getKnownCloudRevision()

  if (!status || !status.exists) {
    cloudStatusLabel.value = 'クラウド未保存'
    if (knownRevision != null && knownRevision > 0) {
      cloudConflict.value = true
      cloudStatusLabel.value = 'クラウドデータ消失の可能性'
    }
    return
  }
  if (knownRevision == null) {
    cloudNeedsBaseline.value = true
    cloudStatusLabel.value = '初回確認が必要'
  } else if (knownRevision !== status.revision) {
    cloudConflict.value = true
    cloudStatusLabel.value = '更新競合あり'
  } else {
    cloudStatusLabel.value = '同期基準と一致'
  }
}

async function checkCloudStatus() {
  cloudError.value = ''
  cloudMessage.value = ''
  cloudBusy.value = true
  try {
    const config = validateCloudConfig({ webAppUrl: cloudWebAppUrl.value, accessToken: cloudAccessToken.value })
    localStorage.setItem('future-simulator-gas-url', config.webAppUrl)
    localStorage.setItem('future-simulator-gas-token', config.accessToken)
    const status = await sendGasRequest(config, 'status', currentHouseholdId())
    applyCloudStatus(status)
    if (!status.exists) {
      cloudMessage.value = 'クラウドにはまだ保存データがありません。ローカルデータを初回保存できます。'
    } else {
      cloudMessage.value = `クラウド版 ${status.revision} · 更新日時 ${formatDateTime(status.savedAt)}`
      if (cloudConflict.value) {
        cloudError.value = '最後に確認した版からクラウドが更新されています。通常保存は停止しました。'
      } else if (cloudNeedsBaseline.value) {
        cloudMessage.value += '。初回接続です。先に読み込むか、ローカル優先の上書きを明示してください。'
      }
    }
    return status
  } catch (error) {
    cloudError.value = error instanceof Error ? error.message : 'クラウド状態を確認できませんでした。'
    return null
  } finally {
    cloudBusy.value = false
  }
}

async function saveToCloud(forceOverwrite = false, automatic = false) {
  if (!automatic && cloudAutoSyncTimer) {
    window.clearTimeout(cloudAutoSyncTimer)
    cloudAutoSyncTimer = null
  }
  if (cloudBusy.value) {
    if (automatic) scheduleAutoCloudSync(1800)
    return
  }
  cloudError.value = ''
  cloudMessage.value = ''
  cloudBusy.value = true
  try {
    const config = validateCloudConfig({ webAppUrl: cloudWebAppUrl.value, accessToken: cloudAccessToken.value })
    localStorage.setItem('future-simulator-gas-url', config.webAppUrl)
    localStorage.setItem('future-simulator-gas-token', config.accessToken)

    // 保存直前にクラウド版を取得し、版番号の不一致を検出する。
    const status = await sendGasRequest(config, 'status', currentHouseholdId())
    applyCloudStatus(status)
    const knownRevision = getKnownCloudRevision()

    if (status.exists && knownRevision == null && !forceOverwrite) {
      cloudNeedsBaseline.value = true
      cloudStatusLabel.value = '初回確認が必要'
      cloudSyncPending.value = false
      cloudError.value = 'クラウドに既存データがあります。先にクラウドから読み込むか、ローカル優先の上書きを明示してください。'
      return
    }
    if (!forceOverwrite && status.exists && knownRevision !== status.revision) {
      cloudConflict.value = true
      cloudStatusLabel.value = '更新競合あり'
      cloudSyncPending.value = false
      cloudError.value = `クラウド版が ${knownRevision ?? '未確認'} から ${status.revision} に変わっています。通常保存を停止しました。`
      return
    }
    if (!forceOverwrite && !status.exists && knownRevision != null && knownRevision > 0) {
      cloudConflict.value = true
      cloudStatusLabel.value = 'クラウドデータ消失の可能性'
      cloudSyncPending.value = false
      cloudError.value = '以前確認したクラウドデータが見つかりません。誤削除の可能性があるため保存を停止しました。'
      return
    }

    if (forceOverwrite) {
      const description = status.exists
        ? `現在のクラウド版 ${status.revision}（${formatDateTime(status.savedAt)}）を履歴へ退避したうえで、ローカルデータを上書きします。`
        : 'クラウドにデータがありません。ローカルデータを新規保存します。'
      if (!window.confirm(`${description}\n\n続行しますか？`)) return
    }

    const expectedRevision = status.exists ? status.revision : 0
    const result = await sendGasRequest(
      config,
      'save',
      currentHouseholdId(),
      JSON.parse(JSON.stringify(householdData.value)),
      { expectedRevision }
    )
    setKnownCloudRevision(result.revision)
    cloudStatus.value = {
      householdId: result.householdId,
      exists: true,
      revision: result.revision,
      savedAt: result.savedAt
    }
    cloudConflict.value = false
    cloudNeedsBaseline.value = false
    cloudStatusLabel.value = '同期済み'
    cloudSyncPending.value = false
    cloudMessage.value = automatic
      ? `自動同期済み · クラウド版 ${result.revision}（${formatDateTime(result.savedAt)}）`
      : `クラウド版 ${result.revision} として保存しました（${formatDateTime(result.savedAt)}）。上書き前のデータは履歴に退避されています。`
  } catch (error) {
    if (error?.code === 'CLOUD_CONFLICT') {
      cloudConflict.value = true
      cloudStatusLabel.value = '更新競合あり'
      cloudError.value = `${error.message}${error.details?.currentRevision != null ? `（現在のクラウド版：${error.details.currentRevision}）` : ''}`
    } else {
      cloudError.value = error instanceof Error ? error.message : 'クラウド保存に失敗しました。'
      if (automatic) { cloudStatusLabel.value = '自動同期エラー'; cloudSyncPending.value = false }
    }
  } finally {
    cloudBusy.value = false
  }
}

async function loadFromCloud() {
  cloudError.value = ''
  cloudMessage.value = ''
  cloudBusy.value = true
  try {
    const config = validateCloudConfig({ webAppUrl: cloudWebAppUrl.value, accessToken: cloudAccessToken.value })
    const result = await sendGasRequest(config, 'load', currentHouseholdId())
    if (!result || !result.data) {
      setKnownCloudRevision(0)
      applyCloudStatus({ exists: false, revision: 0, savedAt: null })
      cloudMessage.value = 'この世帯IDの保存データは見つかりませんでした。ローカルデータを初回保存できます。'
      return
    }
    const imported = normalizeLegacyIncomeExpenseSetting(result.data)
    normalizePensionData(imported)
    const nextScenarios = Array.isArray(imported.scenarios) && imported.scenarios.length
      ? imported.scenarios
      : structuredClone(defaultScenarios)
    imported.scenarios = nextScenarios
    const nextResult = runSimulation(imported)
    const nextScenarioResults = runScenarioComparisons(imported, nextScenarios)
    initializeSavedPlanLibrary(imported)
    const counts = [`人物 ${imported.persons.length}件`, `収入 ${imported.incomeRecords.length}件`, `支出 ${imported.expenseRecords.length}件`, `資産 ${imported.assets.length}件`].join('／')
    if (!window.confirm(`スプレッドシートからデータを読み込みます。\nクラウド版 ${result.revision} · ${formatDateTime(result.savedAt)}\n${counts}\n\n現在のブラウザ内データは読み込んだ内容に置き換わります。続行しますか？`)) return
    imported.scenarios = nextScenarios
    skipNextAutoSync = true
    householdData.value = imported
    selectedPlanIds.value = [imported.activeSavedPlanId]
    simulationResult.value = nextResult
    scenarioResults.value = nextScenarioResults
    selectedResultYear.value = nextResult.annualResults[0]?.year ?? new Date().getFullYear()
    simulationError.value = ''
    setKnownCloudRevision(result.revision)
    applyCloudStatus({
      householdId: result.householdId,
      exists: true,
      revision: result.revision,
      savedAt: result.savedAt
    })
    activeTab.value = 'overview'
    cloudMessage.value = `クラウド版 ${result.revision} を読み込みました。`
  } catch (error) {
    cloudError.value = error instanceof Error ? error.message : 'クラウド読み込みに失敗しました。'
  } finally {
    cloudBusy.value = false
  }
}

function resetSample() {
  if (!window.confirm('入力内容をサンプルデータに戻します。現在の変更は失われます。よろしいですか？')) return
  householdData.value = normalizeLegacyIncomeExpenseSetting(structuredClone(defaultHousehold))
  householdData.value.scenarios = structuredClone(defaultScenarios)
  if (!Array.isArray(householdData.value.futureEvents)) householdData.value.futureEvents = []
for (const event of householdData.value.futureEvents) { if (!event.type) event.type = 'cashflow' }
initializeSavedPlanLibrary(householdData.value)
  selectedPlanIds.value = [householdData.value.activeSavedPlanId]
  simulationResult.value = runSimulation(householdData.value)
  scenarioResults.value = runScenarioComparisons(householdData.value, householdData.value.scenarios)
  selectedResultYear.value = simulationResult.value.annualResults[0]?.year ?? new Date().getFullYear()
  simulationError.value = ''
}
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand-mark">未</div>
      <div class="brand-copy"><strong>未来シミュレーター</strong><span>FUTURE PLANNER</span></div>
      <nav class="side-nav" aria-label="メインメニュー">
        <button :class="{ active: activeTab === 'overview' }" :aria-current="activeTab === 'overview' ? 'page' : undefined" @click="activeTab = 'overview'"><span class="nav-icon">⌂</span><span class="nav-label">ホーム</span></button>
        <button :class="{ active: activeTab === 'data' }" :aria-current="activeTab === 'data' ? 'page' : undefined" @click="activeTab = 'data'"><span class="nav-icon">▤</span><span class="nav-label">データ入力</span></button>
        <button :class="{ active: activeTab === 'results' }" :aria-current="activeTab === 'results' ? 'page' : undefined" @click="activeTab = 'results'"><span class="nav-icon">▥</span><span class="nav-label">詳細結果</span></button>
        <button :class="{ active: activeTab === 'compare' }" :aria-current="activeTab === 'compare' ? 'page' : undefined" @click="activeTab = 'compare'"><span class="nav-icon">⇄</span><span class="nav-label">比較</span></button>
        <button :class="{ active: activeTab === 'settings' }" :aria-current="activeTab === 'settings' ? 'page' : undefined" @click="activeTab = 'settings'; settingsSection = 'settings'"><span class="nav-icon">⚙</span><span class="nav-label">設定</span></button>
      </nav>
      <div class="sidebar-footer"><span class="status-dot"></span> 基本シミュレーション</div>
    </aside>

    <main class="main-content">
      <header class="topbar">
        <div><p class="eyebrow">HOUSEHOLD FUTURE PLANNING</p><h1>{{ activeTab === 'data' ? 'データ入力' : activeTab === 'results' ? '詳細結果' : activeTab === 'compare' ? '比較' : activeTab === 'settings' ? (settingsSection === 'data' ? 'データ管理' : '設定') : 'ホーム' }}</h1></div>
        <div class="topbar-actions">
          <span class="demo-label" :class="{ 'save-error': saveStatus === 'error' }">{{ saveMessage || 'ローカル保存対応' }}</span>
          <span v-if="cloudAutoSyncEnabled" class="cloud-header-sync" :class="{ pending: cloudSyncPending || cloudBusy, error: cloudConflict || cloudError }" :title="cloudMessage || cloudStatusLabel">
            <span class="cloud-sync-dot"></span>{{ cloudConflict || cloudError ? 'クラウド同期エラー' : cloudBusy ? 'クラウド同期中…' : cloudSyncPending ? 'クラウド同期待ち…' : cloudStatus?.exists ? `クラウド同期済み v${cloudStatus.revision}` : 'クラウド未保存' }}
          </span>
          <button class="primary-button" :disabled="isRunning" @click="executeSimulation">{{ isRunning ? '計算中…' : '再計算する' }}</button>
        </div>
      </header>

      <div v-if="simulationError" class="error-message">{{ simulationError }}</div>

      <section v-if="activeTab === 'compare'" class="compare-mode-switch" aria-label="比較の種類">
        <button type="button" :class="{ active: compareMode === 'scenarios' }" :aria-pressed="compareMode === 'scenarios'" @click="compareMode = 'scenarios'">シナリオ比較</button>
        <button type="button" :class="{ active: compareMode === 'plans' }" :aria-pressed="compareMode === 'plans'" @click="compareMode = 'plans'">保存プラン比較</button>
      </section>

      <template v-if="activeTab === 'overview'">
        <section class="intro-row">
          <div><h2>{{ householdData.household.householdName }}の将来予測</h2><p>入力した条件をもとに、将来の収支と金融資産を試算します。</p></div>
          <div class="horizon-chip">{{ simulationResult.summary.startYear }}年〜{{ simulationResult.summary.endYear }}年</div>
        </section>



        <section class="metric-grid">
          <article class="metric-card"><span>現在の金融資産</span><strong>{{ formatYen(simulationResult.summary.startFinancialAssets) }}</strong><small>シミュレーション開始時点</small></article>
          <article class="metric-card highlight-card"><span>最終年の金融資産</span><strong>{{ formatYen(simulationResult.summary.endFinancialAssets) }}</strong><small>{{ simulationResult.summary.endYear }}年末時点</small></article>
          <article class="metric-card"><span>計算対象年数</span><strong>{{ simulationResult.summary.annualResultCount }}<em>年</em></strong><small>月次計算・年次集計</small></article>
          <article class="metric-card"><span>最終年の負債残高</span><strong>{{ formatYen(simulationResult.summary.endLiabilities) }}</strong><small>ローン・借入の残高</small></article>
          <article class="metric-card"><span>最終年の純資産</span><strong>{{ formatYen(simulationResult.summary.endNetWorth) }}</strong><small>金融資産 − 負債（実物資産を除く）</small></article>
          <article class="metric-card"><span>累計取り崩し額</span><strong>{{ formatYen(simulationResult.summary.totalWithdrawals) }}</strong><small>シミュレーション期間全体</small></article>
          <article class="metric-card"><span>現金不足累計</span><strong class="negative">{{ formatYen(simulationResult.summary.totalCashShortfall) }}</strong><small>各年の新規不足額を開始年から累積した合計</small></article>
          <article class="metric-card"><span>最終時点の現金不足</span><strong>{{ formatYen(simulationResult.summary.endCashShortfall) }}</strong><small>最終時点で残っている不足額</small></article>
        </section>
        <section class="content-card chart-card"><div class="section-heading"><div><p class="eyebrow">ASSET PROJECTION</p><h3>資産構成の推移</h3></div><span class="unit-label">円</span></div><div class="chart-wrap"><Bar :data="chartData" :options="homeAssetChartOptions" /></div></section>
        <section class="content-card notice-card"><div class="section-heading"><div><p class="eyebrow">ENGINE STATUS</p><h3>計算エンジンの状態</h3></div><span class="status-pill">v0.7 自動取り崩し対応</span></div><ul><li v-for="warning in simulationResult.warnings" :key="warning">{{ warning }}</li></ul></section>
      </template>

      <template v-else-if="activeTab === 'data'">
        <section class="intro-row data-intro-row">
          <div>
            <h2>試算に使うデータをカテゴリ別に管理</h2>
            <p>カテゴリを選択して入力・編集できます。変更内容はこのブラウザに自動保存されます。試算結果への反映には再計算が必要です。</p>
          </div>
          <button class="secondary-button" @click="resetSample">サンプルに戻す</button>
        </section>

        <nav class="data-category-grid" aria-label="データ入力カテゴリ">
          <button
            v-for="category in dataCategories"
            :key="category.id"
            type="button"
            class="data-category-button"
            :class="{ active: activeDataCategory === category.id }"
            :aria-pressed="activeDataCategory === category.id"
            @click="activeDataCategory = category.id"
          >
            <span class="data-category-number">{{ category.number }}</span>
            <span class="data-category-copy">
              <strong>{{ category.title }}</strong>
              <small>{{ category.description }}</small>
            </span>
            <span class="data-category-arrow" aria-hidden="true">›</span>
          </button>
        </nav>

        <section v-if="activeDataCategory === 'household'" class="content-card editor-card">
          <div class="section-heading"><div><p class="eyebrow">HOUSEHOLD</p><h3>世帯情報</h3></div></div>
          <div class="form-grid">
            <label>世帯名<input v-model.trim="householdData.household.householdName" /></label>
            <label>計算開始日<input v-model="householdData.household.startDate" type="date" /></label>
            <label>計算終了年齢<input v-model.number="householdData.household.endAge" type="number" min="1" max="120" /></label>
          </div>
        </section>

        <section v-if="activeDataCategory === 'tax'" class="content-card editor-card">
          <div class="section-heading"><div><p class="eyebrow">TAX & INSURANCE</p><h3>税金・社会保険料の概算率</h3></div></div>
          <p class="helper-note">設定した実効率を月々の給与・年金・その他収入に掛けて概算します。日本の所得税・住民税・健康保険料等の法定額を自動計算するものではありません。初期値はすべて0%です。</p>
          <div class="form-grid">
            <label>給与・賞与：所得税率（%）<input type="number" min="0" max="100" step="0.1" :value="ratePercent(householdData.conditions.taxInsurance.salaryIncomeTaxRate)" @input="setTaxRate('salaryIncomeTaxRate', $event.target.value)" /></label>
            <label>給与・賞与：住民税率（%）<input type="number" min="0" max="100" step="0.1" :value="ratePercent(householdData.conditions.taxInsurance.salaryResidentTaxRate)" @input="setTaxRate('salaryResidentTaxRate', $event.target.value)" /></label>
            <label>給与・賞与：社会保険料率（%）<input type="number" min="0" max="100" step="0.1" :value="ratePercent(householdData.conditions.taxInsurance.salarySocialInsuranceRate)" @input="setTaxRate('salarySocialInsuranceRate', $event.target.value)" /></label>
            <label>年金：所得税率（%）<input type="number" min="0" max="100" step="0.1" :value="ratePercent(householdData.conditions.taxInsurance.pensionIncomeTaxRate)" @input="setTaxRate('pensionIncomeTaxRate', $event.target.value)" /></label>
            <label>年金：住民税率（%）<input type="number" min="0" max="100" step="0.1" :value="ratePercent(householdData.conditions.taxInsurance.pensionResidentTaxRate)" @input="setTaxRate('pensionResidentTaxRate', $event.target.value)" /></label>
            <label>年金：医療・介護保険料率（%）<input type="number" min="0" max="100" step="0.1" :value="ratePercent(householdData.conditions.taxInsurance.pensionSocialInsuranceRate)" @input="setTaxRate('pensionSocialInsuranceRate', $event.target.value)" /></label>
            <label>その他収入：所得税率（%）<input type="number" min="0" max="100" step="0.1" :value="ratePercent(householdData.conditions.taxInsurance.otherIncomeTaxRate)" @input="setTaxRate('otherIncomeTaxRate', $event.target.value)" /></label>
            <label>その他収入：住民税率（%）<input type="number" min="0" max="100" step="0.1" :value="ratePercent(householdData.conditions.taxInsurance.otherResidentTaxRate)" @input="setTaxRate('otherResidentTaxRate', $event.target.value)" /></label>
          </div>
          <div class="section-heading subsection-heading"><div><p class="eyebrow">YEARLY RATE OVERRIDES</p><h3>年度別の概算率</h3></div><button class="small-button" @click="addTaxYearRule">＋ 年度を追加</button></div>
          <p class="helper-note">年度別設定は、その年から次の設定年度の前まで適用します。未入力の項目は基本の概算率を引き継ぎます。ここで設定する率も法定税率ではなく、任意の概算率です。</p>
          <div v-for="(rule, ruleIndex) in householdData.conditions.taxInsurance.yearlyRates" :key="`tax-year-${ruleIndex}`" class="record-editor">
            <div class="record-title"><label>適用開始年<input v-model.number="rule.year" type="number" min="1900" max="2200" /></label><button class="delete-button" @click="removeTaxYearRule(ruleIndex)">年度設定を削除</button></div>
            <div class="form-grid">
              <label>給与・賞与：所得税率（%）<input type="number" min="0" max="100" step="0.1" :value="ratePercent(rule.rates.salaryIncomeTaxRate ?? householdData.conditions.taxInsurance.salaryIncomeTaxRate)" @input="setYearTaxRate(rule, 'salaryIncomeTaxRate', $event.target.value)" /></label>
              <label>給与・賞与：住民税率（%）<input type="number" min="0" max="100" step="0.1" :value="ratePercent(rule.rates.salaryResidentTaxRate ?? householdData.conditions.taxInsurance.salaryResidentTaxRate)" @input="setYearTaxRate(rule, 'salaryResidentTaxRate', $event.target.value)" /></label>
              <label>給与・賞与：社会保険料率（%）<input type="number" min="0" max="100" step="0.1" :value="ratePercent(rule.rates.salarySocialInsuranceRate ?? householdData.conditions.taxInsurance.salarySocialInsuranceRate)" @input="setYearTaxRate(rule, 'salarySocialInsuranceRate', $event.target.value)" /></label>
              <label>年金：所得税率（%）<input type="number" min="0" max="100" step="0.1" :value="ratePercent(rule.rates.pensionIncomeTaxRate ?? householdData.conditions.taxInsurance.pensionIncomeTaxRate)" @input="setYearTaxRate(rule, 'pensionIncomeTaxRate', $event.target.value)" /></label>
              <label>年金：住民税率（%）<input type="number" min="0" max="100" step="0.1" :value="ratePercent(rule.rates.pensionResidentTaxRate ?? householdData.conditions.taxInsurance.pensionResidentTaxRate)" @input="setYearTaxRate(rule, 'pensionResidentTaxRate', $event.target.value)" /></label>
              <label>年金：医療・介護保険料率（%）<input type="number" min="0" max="100" step="0.1" :value="ratePercent(rule.rates.pensionSocialInsuranceRate ?? householdData.conditions.taxInsurance.pensionSocialInsuranceRate)" @input="setYearTaxRate(rule, 'pensionSocialInsuranceRate', $event.target.value)" /></label>
              <label>その他収入：所得税率（%）<input type="number" min="0" max="100" step="0.1" :value="ratePercent(rule.rates.otherIncomeTaxRate ?? householdData.conditions.taxInsurance.otherIncomeTaxRate)" @input="setYearTaxRate(rule, 'otherIncomeTaxRate', $event.target.value)" /></label>
              <label>その他収入：住民税率（%）<input type="number" min="0" max="100" step="0.1" :value="ratePercent(rule.rates.otherResidentTaxRate ?? householdData.conditions.taxInsurance.otherResidentTaxRate)" @input="setYearTaxRate(rule, 'otherResidentTaxRate', $event.target.value)" /></label>
            </div>
          </div>
          <p v-if="!householdData.conditions.taxInsurance.yearlyRates.length" class="empty-note">年度別の上書きはまだありません。基本の概算率が全期間に適用されます。</p>
        </section>

        <section v-if="activeDataCategory === 'conditions'" class="content-card editor-card">
          <div class="section-heading"><div><p class="eyebrow">GENERAL ASSUMPTIONS</p><h3>基本の試算条件</h3></div></div>
          <p class="helper-note">ここで設定した標準値は、各収入・支出・投資資産の個別設定が空欄の場合に使用します。個別に数値を入力した項目は、その値を優先します。</p>
          <div class="form-grid">
            <label>標準の物価上昇率（%）<input type="number" min="-99" step="0.1" :value="ratePercent(householdData.conditions.defaultInflationRate)" @input="setConditionRate('defaultInflationRate', $event.target.value)" /></label>
            <label>標準の収入増加率（%）<input type="number" min="-99" step="0.1" :value="ratePercent(householdData.conditions.defaultIncomeGrowthRate)" @input="setConditionRate('defaultIncomeGrowthRate', $event.target.value)" /></label>
            <label>標準の投資運用利回り（%）<input type="number" min="-99" step="0.1" :value="ratePercent(householdData.conditions.defaultInvestmentReturn)" @input="setConditionRate('defaultInvestmentReturn', $event.target.value)" /></label>
          </div>
          <p class="helper-note">支出・収入・投資資産の個別欄を空欄にすると、ここで設定した標準値が適用されます。0%を指定したい場合は、個別欄に「0」と入力してください。</p>
        </section>

        <section v-if="activeDataCategory === 'conditions'" class="content-card editor-card">
          <div class="section-heading"><div><p class="eyebrow">WITHDRAWAL</p><h3>自動資金補充</h3></div></div>
          <p class="helper-note">資金残高が補充開始基準を下回ったとき、現金・預貯金・取り崩しOKの投資資産の順で補充します。イベント支出時の不足にも同じルールを適用します。</p>
          <div class="form-grid">
            <label class="toggle-label"><input v-model="householdData.conditions.withdrawal.enabled" type="checkbox" /> 自動資金補充を有効にする</label>
            <label>補充開始残高（円）<input v-model.number="householdData.conditions.withdrawal.refillStartBalance" type="number" min="0" step="10000" /></label>
            <label>補充後の目標残高（円）<input v-model.number="householdData.conditions.withdrawal.refillTargetBalance" type="number" min="0" step="10000" /></label>
          </div>
          <p class="helper-note">補充優先順位は、現金 → 預貯金 → 「自動取り崩しの対象にする」にチェックした投資資産です。投資資産内では優先順位の数字が小さいものから充当します。</p>
        </section>

        <section v-if="activeDataCategory === 'conditions'" class="content-card editor-card">
          <div class="section-heading"><div><p class="eyebrow">SCENARIO SETTINGS</p><h3>シナリオ条件</h3></div></div>
          <p class="helper-note">標準条件を基準に、楽観・悲観シナリオの年率差を設定します。入力値は標準条件に加算するパーセントポイントです。変更後は再計算してください。</p>
          <div v-for="scenario in householdData.scenarios" :key="scenario.scenarioId" class="record-editor">
            <div class="record-title"><strong>{{ scenario.name }}シナリオ</strong><span class="demo-label">{{ scenario.description }}</span></div>
            <div class="form-grid">
              <label>物価上昇率の差（%）<input type="number" step="0.1" :value="scenarioRatePercent(scenario.inflationDelta)" @input="setScenarioRate(scenario, 'inflationDelta', $event.target.value)" /></label>
              <label>投資利回りの差（%）<input type="number" step="0.1" :value="scenarioRatePercent(scenario.investmentReturnDelta)" @input="setScenarioRate(scenario, 'investmentReturnDelta', $event.target.value)" /></label>
              <label>給与等の増加率の差（%）<input type="number" step="0.1" :value="scenarioRatePercent(scenario.incomeGrowthDelta)" @input="setScenarioRate(scenario, 'incomeGrowthDelta', $event.target.value)" /></label>
              <label>年金改定率の差（%）<input type="number" step="0.1" :value="scenarioRatePercent(scenario.pensionGrowthDelta)" @input="setScenarioRate(scenario, 'pensionGrowthDelta', $event.target.value)" /></label>
            </div>
          </div>
        </section>

        <section v-if="activeDataCategory === 'household'" class="content-card editor-card">
          <div class="section-heading"><div><p class="eyebrow">PEOPLE</p><h3>人物情報</h3></div><button class="small-button" @click="addPerson">＋ 人物を追加</button></div>
          <div v-for="(person, index) in householdData.persons" :key="person.personId" class="record-editor">
            <div class="record-title"><strong>人物 {{ index + 1 }}</strong><button class="delete-button" @click="removeItem(householdData.persons, index)">削除</button></div>
            <div class="form-grid">
              <label>名前<input v-model.trim="person.name" /></label>
              <label>続柄<select v-model="person.relationship"><option value="self">本人</option><option value="spouse">配偶者</option><option value="child">子</option><option value="parent">親</option><option value="family">その他</option></select></label>
              <label>生年月日<input v-model="person.birthDate" type="date" /></label>
              <label>退職予定年齢<input v-model.number="person.retirementAge" type="number" min="1" max="120" /></label>
              <label>退職金の受取年齢<input v-model.number="person.retirementBenefitAge" type="number" min="1" max="120" /></label>
              <label>退職金見込額（円）<input v-model.number="person.retirementBenefitAmount" type="number" min="0" step="10000" /></label>
            </div>
          </div>
        </section>

        <section v-if="activeDataCategory === 'pensions'" class="content-card editor-card">
          <div class="section-heading"><div><p class="eyebrow">PENSION MANAGEMENT</p><h3>年金管理</h3></div><button class="small-button" @click="addPension">＋ 年金を追加</button></div>
          <p class="helper-note">年金は人物情報や通常の収入とは独立して登録します。年金額は額面の年額で入力してください。公的年金の改定率は予測用の共通仮定であり、実際の法定改定率を自動取得するものではありません。</p>
          <div v-if="householdData.pensionMigrationNotices?.length" class="notice-card migration-notice">
            <strong>旧データの移行時の確認事項</strong>
            <p v-for="(notice, index) in householdData.pensionMigrationNotices" :key="index">{{ notice }}</p>
          </div>
          <div class="record-editor">
            <div class="record-title"><strong>公的年金の共通改定率（年率）</strong></div>
            <p class="helper-note">基礎年金・厚生年金の将来予測に使う仮定値です。実際の年度ごとの改定率とは異なる場合があります。</p>
            <div class="form-grid">
              <label>基礎年金の改定率（%）<input type="number" step="0.1" :value="ratePercent(householdData.conditions.pensionAdjustmentRates?.basicAnnualRate)" @input="setPensionAdjustmentRate('basicAnnualRate', $event.target.value)" /></label>
              <label>厚生年金の改定率（%）<input type="number" step="0.1" :value="ratePercent(householdData.conditions.pensionAdjustmentRates?.employeesAnnualRate)" @input="setPensionAdjustmentRate('employeesAnnualRate', $event.target.value)" /></label>
            </div>
          </div>
          <div v-for="(pension, index) in householdData.pensions" :key="pension.pensionId" class="record-editor">
            <div class="record-title"><strong>年金 {{ index + 1 }}</strong><button class="delete-button" @click="removeItem(householdData.pensions, index)">削除</button></div>
            <div class="form-grid">
              <label>年金名称<input v-model.trim="pension.name" placeholder="例：老齢基礎年金" /></label>
              <label>年金の種類
                <select v-model="pension.pensionType" @change="onPensionTypeChange(pension)">
                  <option value="basic">基礎年金</option>
                  <option value="employees">厚生年金</option>
                  <option value="corporate">企業年金</option>
                  <option value="private">個人年金</option>
                  <option value="other">その他</option>
                </select>
              </label>
              <label>受給する人物
                <select v-model="pension.personId">
                  <option value="">世帯共通</option>
                  <option v-for="person in householdData.persons" :key="person.personId" :value="person.personId">{{ person.name }}</option>
                </select>
              </label>
              <label>年金年額（額面・円）<input v-model.number="pension.annualAmount" type="number" min="0" step="10000" /></label>
              <label>受給開始日<input v-model="pension.startDate" type="date" /></label>
              <label>受給終了日<input v-model="pension.endDate" type="date" /></label>
              <label class="toggle-label"><input v-model="pension.enabled" type="checkbox" /> 試算に含める</label>
              <label>改定方式
                <select v-model="pension.adjustmentMode">
                  <option value="public" :disabled="!['basic', 'employees'].includes(pension.pensionType)">公的年金の共通改定率</option>
                  <option value="custom">個別の改定率</option>
                  <option value="none">改定なし</option>
                </select>
              </label>
              <label v-if="pension.adjustmentMode === 'custom'">個別改定率（年率・%）<input type="number" step="0.1" :value="ratePercent(pension.annualGrowthRate)" @input="pension.annualGrowthRate = Number($event.target.value || 0) / 100" /></label>
            </div>
            <p class="helper-note" v-if="pension.adjustmentMode === 'public'">基礎年金は基礎年金の共通改定率、厚生年金は厚生年金の共通改定率を使用します。</p>
            <p class="helper-note" v-else-if="pension.adjustmentMode === 'none'">受給開始後の年金額は一定として試算します。</p>
          </div>
          <p v-if="!householdData.pensions?.length" class="empty-note">年金データがありません。「年金を追加」から登録できます。</p>
        </section>

        <section v-if="activeDataCategory === 'income'" class="content-card editor-card">
          <div class="section-heading"><div><p class="eyebrow">INCOME</p><h3>収入情報</h3></div><button class="small-button" @click="addIncome">＋ 収入を追加</button></div>
          <p class="helper-note">再雇用・継続雇用は退職予定年齢以降も給与収入として計上します。開始日・終了日で期間を設定してください。通常の給与・賞与は退職予定年齢で停止します。</p>
          <div v-for="(record, index) in householdData.incomeRecords" :key="record.incomeId" class="record-editor">
            <div class="record-title"><strong>収入 {{ index + 1 }}</strong><button class="delete-button" @click="removeItem(householdData.incomeRecords, index)">削除</button></div>
            <div class="form-grid">
              <label>名称<input v-model.trim="record.name" /></label>
              <label>分類<select v-model="record.category"><option value="salary">給与</option><option value="bonus">賞与</option><option value="reemployment">再雇用・継続雇用</option><option value="other">その他</option></select></label>
              <label>金額（円）<input v-model.number="record.amount" type="number" min="0" /></label>
              <label>入金先資産区分<select v-model="record.cashflowAssetType"><option value="cash">現金</option><option value="deposit">預貯金</option></select></label>
              <label>発生単位<select v-model="record.frequency"><option value="monthly">月額</option><option value="annual">年額</option></select></label>
              <label>開始日<input v-model="record.startDate" type="date" /></label>
              <label>終了日<input v-model="record.endDate" type="date" /></label>
              <label>年間増加率（%）<input type="number" step="0.1" :value="optionalRatePercent(record.annualGrowthRate)" placeholder="標準を使用" @input="setOptionalRate(record, 'annualGrowthRate', $event.target.value)" /></label>
              <label>対象人物<select v-model="record.personId"><option value="">世帯共通</option><option v-for="person in householdData.persons" :key="person.personId" :value="person.personId">{{ person.name }}</option></select></label>
            </div>
          </div>
          <p v-if="!householdData.incomeRecords.length" class="empty-note">収入データがありません。「収入を追加」から登録できます。</p>
        </section>

        <section v-if="activeDataCategory === 'expense'" class="content-card editor-card">
          <div class="section-heading"><div><p class="eyebrow">EXPENSE</p><h3>支出情報</h3></div><button class="small-button" @click="addExpense">＋ 支出を追加</button></div>
          <div v-for="(record, index) in householdData.expenseRecords" :key="record.expenseId" class="record-editor">
            <div class="record-title"><strong>支出 {{ index + 1 }}</strong><button class="delete-button" @click="removeItem(householdData.expenseRecords, index)">削除</button></div>
            <div class="form-grid">
              <label>名称<input v-model.trim="record.name" /></label>
              <label>分類<select v-model="record.category"><option value="living">生活費</option><option value="housing">住居費</option><option value="food">食費</option><option value="utility">光熱費</option><option value="medical">医療費</option><option value="other">その他</option></select></label>
              <label>金額（円）<input v-model.number="record.amount" type="number" min="0" /></label>
              <label>支払元資産区分<select v-model="record.cashflowAssetType"><option value="cash">現金</option><option value="deposit">預貯金</option></select></label>
              <label>発生単位<select v-model="record.frequency"><option value="monthly">月額</option><option value="annual">年額</option></select></label>
              <label>開始日<input v-model="record.startDate" type="date" /></label>
              <label>終了日<input v-model="record.endDate" type="date" /></label>
              <label>年間物価上昇率（%）<input type="number" step="0.1" :value="optionalRatePercent(record.annualInflationRate)" placeholder="標準を使用" @input="setOptionalRate(record, 'annualInflationRate', $event.target.value)" /></label>
            </div>
          </div>
          <p v-if="!householdData.expenseRecords.length" class="empty-note">支出データがありません。「支出を追加」から登録できます。</p>
        </section>

        <section v-if="activeDataCategory === 'assets'" class="content-card editor-card">
          <div class="section-heading"><div><p class="eyebrow">ASSETS</p><h3>資産情報</h3></div><button class="small-button" @click="addAsset">＋ 資産を追加</button></div>
          <div v-for="(asset, index) in householdData.assets" :key="asset.assetId" class="record-editor">
            <div class="record-title"><strong>資産 {{ index + 1 }}</strong><button class="delete-button" @click="removeItem(householdData.assets, index)">削除</button></div>
            <div class="form-grid">
              <label>名称<input v-model.trim="asset.name" /></label>
              <label>資産種類<select v-model="asset.assetType" @change="onAssetTypeChange(asset)"><option value="cash">現金</option><option value="deposit">預貯金</option><option value="investment">投資信託・株式等</option><option value="bond">債券</option><option value="other">その他</option></select></label>
              <label>現在残高（円）<input v-model.number="asset.balance" type="number" min="0" /></label>
              <label>想定年率（%）<input type="number" step="0.1" :value="optionalRatePercent(asset.annualReturn)" :placeholder="assetReturnPlaceholder(asset)" @input="setOptionalRate(asset, 'annualReturn', $event.target.value)" /></label>
              <label>毎月積立額（円）<input v-model.number="asset.monthlyContribution" type="number" min="0" /></label>
              <label>積立開始日<input v-model="asset.contributionStartDate" type="date" /></label>
              <label>積立終了日<input v-model="asset.contributionEndDate" type="date" /></label>
              <label v-if="!['cash', 'deposit'].includes(asset.assetType)">税制区分<select v-model="asset.taxCategory"><option value="taxable">特定口座・課税口座</option><option value="nisa">NISA</option><option value="general">一般口座</option><option value="other">その他</option></select></label>
              <label v-if="!['cash', 'deposit'].includes(asset.assetType) && asset.taxCategory === 'nisa'">NISA枠<select v-model="asset.nisaType"><option value="">未分類・旧データ</option><option value="accumulation">つみたて投資枠</option><option value="growth">成長投資枠</option></select></label>
              <label v-if="!['cash', 'deposit'].includes(asset.assetType)">取り崩し優先順位（小さいほど先）<input v-model.number="asset.withdrawalPriority" type="number" min="1" max="999" /></label>
              <label v-if="!['cash', 'deposit'].includes(asset.assetType)" class="toggle-label"><input v-model="asset.withdrawalEnabled" type="checkbox" /> 自動取り崩しの対象にする</label>
            </div>
          </div>
          <p v-if="!householdData.assets.length" class="empty-note">資産データがありません。「資産を追加」から登録できます。</p>
        </section>
        <section v-if="activeDataCategory === 'liabilities'" class="content-card editor-card">
          <div class="section-heading"><div><p class="eyebrow">LIABILITIES</p><h3>負債・ローン情報</h3></div><button class="small-button" @click="addLiability">＋ 負債を追加</button></div>
          <p class="helper-note">住宅ローンなどの残高・金利・返済期間を登録します。毎月返済額を0円にすると、元利均等返済では残高・金利・返済期間から自動計算します。</p>
          <div v-for="(item, index) in householdData.liabilities" :key="item.liabilityId" class="record-editor">
            <div class="record-title"><strong>負債 {{ index + 1 }}</strong><button class="delete-button" @click="removeItem(householdData.liabilities, index)">削除</button></div>
            <div class="form-grid">
              <label>名称<input v-model.trim="item.name" placeholder="例：住宅ローン" /></label>
              <label>負債種類<select v-model="item.liabilityType"><option value="mortgage">住宅ローン</option><option value="auto">自動車ローン</option><option value="education">教育ローン</option><option value="other">その他借入</option></select></label>
              <label>現在残高（円）<input v-model.number="item.balance" type="number" min="0" /></label>
              <label>年利（%）<input :value="(Number(item.annualInterestRate || 0) * 100)" type="number" min="0" step="0.01" @input="item.annualInterestRate = Number($event.target.value || 0) / 100" /></label>
              <label>返済方式<select v-model="item.repaymentMethod"><option value="equalPayment">元利均等返済</option><option value="equalPrincipal">元金均等返済</option><option value="bullet">満期一括返済</option></select></label>
              <label>毎月返済額（円）<input v-model.number="item.monthlyPayment" type="number" min="0" :disabled="item.repaymentMethod !== 'equalPayment'" /></label>
              <label>返済開始年月<input v-model="item.startDate" type="date" /></label>
              <label>返済終了年月<input v-model="item.endDate" type="date" /></label>
            </div>
            <p class="helper-note">{{ item.repaymentMethod === 'equalPayment' ? (Number(item.monthlyPayment) > 0 ? '入力した毎月返済額で計算します。' : '返済終了年月を設定すると、毎月返済額を自動計算します。') : item.repaymentMethod === 'equalPrincipal' ? '元金を返済期間で均等に返し、利息を加算します。' : '毎月利息を支払い、返済終了月に元金を一括返済します。' }}</p>
          </div>
          <p v-if="!householdData.liabilities.length" class="empty-note">負債データはありません。「負債を追加」から登録できます。</p>
        </section>

        <section v-if="activeDataCategory === 'events'" class="content-card editor-card">
          <div class="section-heading"><div><p class="eyebrow">FUTURE EVENTS</p><h3>将来イベント</h3></div><button class="small-button" @click="addFutureEvent">＋ イベントを追加</button></div>
          <p class="helper-note">将来の収入・支出はイベントで一元管理できます。収入・支出イベントは1回・毎月・毎年の繰り返しと終了日を設定できます。旧「収入」「支出」データは残したまま、下の設定で試算への反映を切り替えられます。資産移動は現在、個別資産を指定します。</p>
          <label class="legacy-record-toggle"><input type="checkbox" v-model="householdData.conditions.useLegacyIncomeExpense" /> 旧収入・支出データを試算に含める（イベントへ移行後はオフ）</label>
          <div v-for="(event, index) in householdData.futureEvents" :key="event.eventId" class="record-editor">
            <div class="record-title">
              <strong>イベント {{ index + 1 }}</strong>
              <div class="event-row-actions">
                <label class="event-enabled-toggle"><input type="checkbox" :checked="event.enabled !== false" @change="event.enabled = $event.target.checked" /> 試算に適用</label>
                <button class="delete-button" @click="removeItem(householdData.futureEvents, index)">削除</button>
              </div>
            </div>
            <p class="helper-note">{{ event.enabled === false ? '【適用除外】' : '【適用】' }} {{ eventTypeLabel(event.type) }} ／ {{ event.eventDate || '日付未設定' }} ／ {{ eventAssetSummary(event) }}</p>
            <p v-if="['assetPurchase','bondPurchase','assetSale','bondMaturity'].includes(event.type)" class="helper-note">大区分は区分全体の資金移動、個別資産は投資商品など資産ごとの指定に使用します。</p>
            <div class="form-grid">
              <label>イベント種類<select v-model="event.type">
                <option value="income">収入</option><option value="expense">支出</option><option value="assetPurchase">資産購入</option><option value="assetSale">資産売却</option><option value="bondPurchase">債券購入</option><option value="bondMaturity">債券満期</option><option value="autoFunding">自動資金補充</option><option value="cashflow">旧形式（臨時収入・支出）</option>
              </select></label>
              <label>名称<input v-model.trim="event.name" placeholder="イベント名" /></label>
              <label>開始日<input v-model="event.eventDate" type="date" /></label>
              <label v-if="['income','expense'].includes(event.type)">繰り返し<select v-model="event.frequency"><option value="once">1回のみ</option><option value="monthly">毎月</option><option value="yearly">毎年</option></select></label>
              <label v-if="['income','expense'].includes(event.type) && event.frequency !== 'once'">終了日（任意）<input v-model="event.endDate" type="date" /></label>
              <label v-if="event.type === 'income'">入金額（円）<input v-model.number="event.amount" type="number" min="0" /></label>
              <label v-if="event.type === 'income'">入金先の資産区分<select :value="eventCategory(event, 'destinationAssetId')" @change="setEventAssetCategory(event, 'destinationAssetId', $event.target.value)"><option value="">選択してください</option><option value="cash">現金</option><option value="deposit">預貯金</option><option value="investment">投資資産</option><option value="bond">債券</option><option value="other">その他資産</option></select></label>
              <label v-if="event.type === 'expense'">支出額（円）<input v-model.number="event.amount" type="number" min="0" /></label>
              <label v-if="event.type === 'expense'">支払元の資産区分<select :value="eventCategory(event, 'sourceAssetId')" @change="setEventAssetCategory(event, 'sourceAssetId', $event.target.value)"><option value="">自動資金補充ルールを使用</option><option value="cash">現金</option><option value="deposit">預貯金</option><option value="investment">投資資産</option><option value="bond">債券</option><option value="other">その他資産</option></select></label>
              <label v-if="['assetPurchase','bondPurchase'].includes(event.type)">購入額（円）<input v-model.number="event.purchaseAmount" type="number" min="0" /></label>
              <label v-if="['assetPurchase','bondPurchase'].includes(event.type)">購入元の資産区分<select :value="eventAssetSelection(event, 'sourceAssetId')" @change="setEventAssetSelection(event, 'sourceAssetId', $event.target.value)"><option value="">選択してください</option><optgroup label="大区分（区分全体）"><option value="category:cash">現金全体</option><option value="category:deposit">預貯金全体</option><option value="category:investment">投資資産全体</option><option value="category:bond">債券全体</option><option value="category:other">その他資産全体</option></optgroup><optgroup label="個別資産（商品単位）"><option v-for="asset in eventAssetOptionsFor(event)" :key="asset.assetId" :value="asset.assetId">{{ asset.name }}{{ asset.future ? "（将来購入）" : "" }}</option></optgroup></select></label>
              <label v-if="['assetPurchase','bondPurchase'].includes(event.type)">購入先（区分全体／個別資産）<select :value="eventAssetSelection(event, 'destinationAssetId', true)" @change="setEventAssetSelection(event, 'destinationAssetId', $event.target.value)"><option value="new">新しい個別資産を作成（商品単位）</option><optgroup label="大区分（区分全体）"><option value="category:cash">現金全体</option><option value="category:deposit">預貯金全体</option><option value="category:investment">投資資産全体</option><option value="category:bond">債券全体</option><option value="category:other">その他資産全体</option></optgroup><optgroup label="個別資産（商品単位）"><option v-for="asset in eventAssetOptionsFor(event)" :key="asset.assetId" :value="asset.assetId">{{ asset.name }}{{ asset.future ? "（将来購入）" : "" }}</option></optgroup></select></label>
              <label v-if="event.type === 'assetPurchase' && !event.destinationAssetId">新規資産種類<select v-model="event.purchaseAssetType"><option value="cash">現金</option><option value="deposit">預貯金</option><option value="investment">投資信託・株式等</option></select></label>
              <label v-if="event.type === 'assetPurchase' && !event.destinationAssetId && event.purchaseAssetType === 'investment'">新規資産の税制区分<select v-model="event.purchaseTaxCategory"><option value="nisa">NISA</option><option value="taxable">特定口座・課税口座</option><option value="general">一般口座</option><option value="other">その他</option></select></label>
              <label v-if="event.type === 'assetPurchase' && !event.destinationAssetId && event.purchaseAssetType === 'investment' && event.purchaseTaxCategory === 'nisa'">NISA枠<select v-model="event.purchaseNisaType"><option value="accumulation">つみたて投資枠</option><option value="growth">成長投資枠</option></select></label>
              <label v-if="event.type === 'assetSale'">売却額（円）<input v-model.number="event.saleAmount" type="number" min="0" /></label>
              <label v-if="event.type === 'assetSale'">売却元の資産区分<select :value="eventAssetSelection(event, 'sourceAssetId')" @change="setEventAssetSelection(event, 'sourceAssetId', $event.target.value)"><option value="">選択してください</option><optgroup label="大区分（区分全体）"><option value="category:cash">現金全体</option><option value="category:deposit">預貯金全体</option><option value="category:investment">投資資産全体</option><option value="category:bond">債券全体</option><option value="category:other">その他資産全体</option></optgroup><optgroup label="個別資産（商品単位）"><option v-for="asset in eventAssetOptionsFor(event)" :key="asset.assetId" :value="asset.assetId">{{ asset.name }}{{ asset.future ? "（将来購入）" : "" }}</option></optgroup></select></label>
              <label v-if="event.type === 'assetSale'">売却先の資産区分<select :value="eventAssetSelection(event, 'destinationAssetId')" @change="setEventAssetSelection(event, 'destinationAssetId', $event.target.value)"><option value="">選択してください</option><optgroup label="大区分（区分全体）"><option value="category:cash">現金全体</option><option value="category:deposit">預貯金全体</option><option value="category:investment">投資資産全体</option><option value="category:bond">債券全体</option><option value="category:other">その他資産全体</option></optgroup><optgroup label="個別資産（商品単位）"><option v-for="asset in eventAssetOptionsFor(event)" :key="asset.assetId" :value="asset.assetId">{{ asset.name }}{{ asset.future ? "（将来購入）" : "" }}</option></optgroup></select></label>
              <template v-if="event.type === 'bondPurchase'">
                <label>額面金額（円）<input v-model.number="event.faceAmount" type="number" min="0" /></label>
                <label>利息の入力方法<select v-model="event.couponInputMode"><option value="rate">年利率で入力</option><option value="amount">年間利息額で入力</option></select></label>
                <label v-if="event.couponInputMode !== 'amount'">年利率（%）<input type="number" min="0" step="0.01" :value="optionalRatePercent(event.couponRate)" @input="setOptionalRate(event, 'couponRate', $event.target.value)" /></label>
                <label v-if="event.couponInputMode === 'amount'">年間利息額（税引前・円）<input v-model.number="event.annualCouponAmount" type="number" min="0" /></label>
                <label>初回利息受取日<input v-model="event.firstCouponDate" type="date" /></label>
                <label>利息受取回数<select v-model.number="event.couponPaymentFrequency"><option :value="1">年1回</option><option :value="2">年2回（半年ごと）</option></select></label>
                <label>利息金額の扱い<select v-model="event.couponTaxMode"><option value="gross">税引前</option><option value="net">税引後</option></select></label>
                <label>満期日<input v-model="event.maturityDate" type="date" /></label>
                <label>満期償還の受取先<select v-model="event.maturityDestinationAssetId"><option value="">現金（既定）</option><option v-for="asset in householdData.assets.filter(item => ['cash','deposit'].includes(item.assetType))" :key="asset.assetId" :value="asset.assetId">{{ asset.name }}</option></select></label>
              </template>
              <label v-if="event.type === 'bondMaturity'">償還元の資産区分<select :value="eventAssetSelection(event, 'sourceAssetId')" @change="setEventAssetSelection(event, 'sourceAssetId', $event.target.value)"><option value="">選択してください</option><optgroup label="大区分（区分全体）"><option value="category:cash">現金全体</option><option value="category:deposit">預貯金全体</option><option value="category:investment">投資資産全体</option><option value="category:bond">債券全体</option><option value="category:other">その他資産全体</option></optgroup><optgroup label="個別資産（商品単位）"><option v-for="asset in eventAssetOptionsFor(event)" :key="asset.assetId" :value="asset.assetId">{{ asset.name }}{{ asset.future ? "（将来購入）" : "" }}</option></optgroup></select></label>
              <label v-if="event.type === 'bondMaturity'">償還先の資産区分<select :value="eventAssetSelection(event, 'destinationAssetId')" @change="setEventAssetSelection(event, 'destinationAssetId', $event.target.value)"><option value="">選択してください</option><optgroup label="大区分（区分全体）"><option value="category:cash">現金全体</option><option value="category:deposit">預貯金全体</option><option value="category:investment">投資資産全体</option><option value="category:bond">債券全体</option><option value="category:other">その他資産全体</option></optgroup><optgroup label="個別資産（商品単位）"><option v-for="asset in eventAssetOptionsFor(event)" :key="asset.assetId" :value="asset.assetId">{{ asset.name }}{{ asset.future ? "（将来購入）" : "" }}</option></optgroup></select></label>
              <label v-if="event.type === 'bondMaturity'">元本（円）<input v-model.number="event.principalAmount" type="number" min="0" /></label>
              <label v-if="event.type === 'autoFunding'">補充額（円）<input v-model.number="event.amount" type="number" min="0" /></label>
              <label v-if="event.type === 'cashflow'">臨時収入（円）<input v-model.number="event.incomeAmount" type="number" min="0" /></label>
              <label v-if="event.type === 'cashflow'">臨時支出（円）<input v-model.number="event.expenseAmount" type="number" min="0" /></label>
              <label class="wide-label">メモ<input v-model.trim="event.description" placeholder="イベントの内容" /></label>
            </div>
            <p v-if="event.sourceAssetId || event.destinationAssetId" class="helper-note">資産移動：{{ assetName(event.sourceAssetId) }} → {{ assetName(event.destinationAssetId) }}</p>
          </div>
          <p v-if="!householdData.futureEvents.length" class="empty-note">将来イベントはまだ登録されていません。「イベントを追加」から登録できます。</p>
        </section>
        <div class="bottom-action"><span>入力内容は自動保存されています。</span><button class="primary-button" @click="executeSimulation">保存内容で再計算する</button></div>
      </template>

      <template v-else-if="activeTab === 'settings' && settingsSection === 'data'">
        <section class="intro-row">
          <div><h2>大切な試算データを保管</h2><p>JSON・Excelでの入出力に加え、Googleスプレッドシートへの保存・読み込みができます。</p></div>
          <button class="secondary-button" @click="settingsSection = 'settings'">設定へ戻る</button>
        </section>
        <section class="content-card editor-card backup-card">
          <div class="section-heading"><div><p class="eyebrow">EXPORT BACKUP</p><h3>バックアップを書き出す</h3></div><span class="status-pill">JSON形式</span></div>
          <p class="helper-note">書き出したファイルはパソコンなど安全な場所に保管してください。ファイル名には書き出し日が入ります。</p>
          <button class="primary-button" @click="downloadBackup">JSONバックアップをダウンロード</button>
        </section>
        <section class="content-card editor-card backup-card">
          <div class="section-heading"><div><p class="eyebrow">LOCAL SAVE STATUS</p><h3>ローカル保存の状態</h3></div><span class="status-pill">自動保存</span></div>
          <p class="helper-note">評価額の運用増減は、投資資産に設定した想定年率による評価額の変動です。積立額とは別に資産残高へ反映されます。配当・分配金の現金受取や再投資を個別に選択する機能ではありません。</p>
          <div class="year-detail-list">
            <div><span>保存方式</span><strong>{{ localStoreMode }}</strong></div>
            <div><span>最終保存日時</span><strong>{{ formatDateTime(lastSavedAt) }}</strong></div>
            <div><span>最新の自動バックアップ</span><strong>{{ formatDateTime(latestAutoBackupAt) }}</strong></div>
            <div><span>自動バックアップ保持</span><strong>直近7日分（このブラウザ内）</strong></div>
          </div>
          <p class="helper-note">データを変更した日の最初の保存時に、IndexedDB内へ日次スナップショットを作成します。自動バックアップはこのブラウザ内に保存され、別端末やブラウザの外には自動転送されません。</p>
          <button class="secondary-button" @click="restoreLatestAutoBackup">最新の自動バックアップから復元</button>
        </section>
        <section class="content-card editor-card backup-card">
          <div class="section-heading"><div><p class="eyebrow">EXCEL EXPORT</p><h3>Excel形式で書き出す</h3></div><span class="status-pill">複数シート</span></div>
          <p class="helper-note">世帯情報・人物・収入・支出・資産・負債・将来イベント・シナリオ・試算条件・年次試算結果・シナリオ比較を、1つのブックにまとめます。Excelで開いて編集・分析できます。</p>
          <button class="primary-button" @click="exportExcel">Excelブックをダウンロード</button>
          <p class="helper-note">出力形式はExcel 2003 XML（.xml）です。Microsoft ExcelおよびLibreOffice Calcで開けます。</p>
          <div v-if="excelMessage" class="success-message" role="status">{{ excelMessage }}</div>
          <div v-if="excelError" class="error-message" role="alert">{{ excelError }}</div>
        </section>
        <section class="content-card editor-card backup-card">
          <div class="section-heading"><div><p class="eyebrow">EXCEL IMPORT</p><h3>Excelからデータを読み込む</h3></div><span class="status-pill">上書き確認あり</span></div>
          <p class="helper-note">v1.1で書き出したExcel XML（.xml）ブックを読み込みます。世帯情報・人物・収入・支出・資産・負債・将来イベント・シナリオ・試算条件を取り込みます。Excel上で編集した値も反映できます。</p>
          <input ref="excelImportInput" class="visually-hidden" type="file" accept=".xml,application/xml,text/xml" @change="importExcel" />
          <button class="secondary-button" @click="chooseExcelImportFile">Excel XMLファイルを選択して読み込む</button>
          <p class="helper-note">読み込み前に必須シートとデータ形式を検証し、シミュレーションが実行できることを確認します。年次試算結果・シナリオ比較は読み込み後に再計算します。</p>
          <div v-if="excelImportMessage" class="success-message" role="status">{{ excelImportMessage }}</div>
          <div v-if="excelImportError" class="error-message" role="alert">{{ excelImportError }}</div>
        </section>
        <section class="content-card editor-card backup-card">
          <div class="section-heading"><div><p class="eyebrow">RESTORE BACKUP</p><h3>バックアップから復元</h3></div><span class="status-pill">上書き確認あり</span></div>
          <p class="helper-note">このアプリで作成したJSONバックアップを選択します。復元すると、現在のブラウザ内データはバックアップの内容に置き換わります。復元前に現在のデータもバックアップしてください。</p>
          <input ref="backupInput" class="visually-hidden" type="file" accept=".json,application/json" @change="restoreBackup" />
          <button class="secondary-button" @click="chooseBackupFile">JSONファイルを選択して復元</button>
        </section>
        <div v-if="backupMessage" class="success-message" role="status">{{ backupMessage }}</div>
        <div v-if="backupError" class="error-message" role="alert">{{ backupError }}</div>
        <section class="content-card editor-card backup-card">
          <div class="section-heading"><div><p class="eyebrow">GOOGLE SHEETS CLOUD</p><h3>Googleスプレッドシートと連携</h3></div><span class="status-pill">GAS連携</span></div>
          <p class="helper-note">GASウェブアプリのURLとアクセスキーを登録します。ローカル保存を優先し、入力変更後にクラウドへ自動送信できます。別端末の更新を自動で取り込む双方向同期ではありません。</p>
          <div class="form-grid">
            <label class="wide-label">GASウェブアプリURL
              <input v-model.trim="cloudWebAppUrl" type="url" placeholder="https://script.google.com/macros/s/.../exec" autocomplete="url" />
            </label>
            <label class="wide-label">アクセスキー
              <input v-model="cloudAccessToken" type="password" placeholder="GASのCode.gsに設定したアクセスキー" autocomplete="off" />
            </label>
          </div>
          <label class="cloud-auto-sync-toggle">
            <input type="checkbox" :checked="cloudAutoSyncEnabled" @change="onAutoSyncChange($event.target.checked)" />
            <span><strong>自動クラウド同期を有効にする</strong><small>データ変更後、少し待ってからクラウドへ保存します。初回接続で既存データがある場合は、先にクラウドから読み込んでください。</small></span>
          </label>
          <div class="button-row">
            <button class="secondary-button" @click="saveCloudSettings">接続設定を保存</button>
            <button class="secondary-button" :disabled="cloudBusy" @click="checkCloudStatus">クラウド状態を確認</button>
            <button class="primary-button" :disabled="cloudBusy" @click="saveToCloud(false)">{{ cloudBusy ? '通信中…' : 'クラウドへ保存' }}</button>
            <button class="secondary-button" :disabled="cloudBusy" @click="loadFromCloud">クラウドから読み込み</button>
          </div>
          <div class="year-detail-list cloud-status-list">
            <div><span>同期状態</span><strong>{{ cloudStatusLabel }}</strong></div>
            <div><span>クラウド版</span><strong>{{ cloudStatus?.exists ? `v${cloudStatus.revision}` : '未保存' }}</strong></div>
            <div><span>クラウド更新日時</span><strong>{{ formatDateTime(cloudStatus?.savedAt) }}</strong></div>
          </div>
          <div v-if="cloudConflict || cloudNeedsBaseline" class="warning-message" role="alert">
            {{ cloudNeedsBaseline ? 'このブラウザではクラウド版をまだ確認していません。既存データを読み込むか、ローカルデータを優先して上書きしてください。' : 'クラウド側の版が前回確認時から変わっています。通常保存は停止しています。' }}
            <button class="secondary-button" :disabled="cloudBusy" @click="saveToCloud(true)">ローカルを優先して上書き（クラウド履歴を保存）</button>
          </div>
          <div v-if="cloudMessage" class="success-message" role="status">{{ cloudMessage }}</div>
          <div v-if="cloudError" class="error-message" role="alert">{{ cloudError }}</div>
          <p class="helper-note">自動同期はローカルからクラウドへの送信です。クラウド側の更新を自動で取り込むことはせず、版番号が変わっていた場合は競合として同期を停止します。別端末で更新した場合は、クラウド状態を確認してから読み込んでください。</p>
        </section>
        <section class="content-card notice-card">
          <div class="section-heading"><div><p class="eyebrow">DATA SAFETY</p><h3>データ保管について</h3></div></div>
          <ul>
            <li>入力内容はこれまでどおり、このブラウザに自動保存されます。自動クラウド同期を有効にした場合は、変更後にクラウドへ送信します。</li>
            <li>JSONバックアップは、別の端末への移行やデータ復旧に利用できます。</li>
            <li>Excel読み込みはv1.1形式のXMLブックに対応します。通常の.xlsxファイルは現時点では対象外です。</li>
            <li>復元時は形式と必須項目を検証し、計算できることを確認してから置き換えます。</li>
            <li>JSONファイルには家計情報が含まれるため、共有・保管場所に注意してください。</li>
          </ul>
        </section>
      </template>

      <template v-else-if="activeTab === 'results'">
        <section class="intro-row">
          <div><h2>年ごとの家計と資産の動きを確認</h2><p>グラフと年次一覧は同じ年度位置で横スクロールします。年度を選ぶと詳細が切り替わります。</p></div>
          <label class="year-picker">詳細を見る年度<select v-model.number="selectedResultYear"><option v-for="row in simulationResult.annualResults" :key="row.year" :value="row.year">{{ row.year }}年</option></select></label>
        </section>

        <section v-if="selectedAnnualResult" class="content-card editor-card">
          <div class="section-heading"><div><p class="eyebrow">YEAR DETAIL</p><h3>{{ selectedAnnualResult.year }}年の資産詳細</h3></div><span class="status-pill">{{ selectedAnnualResult.ages.map((person) => `${person.name} ${person.age ?? '—'}歳`).join(' ／ ') }}</span></div>
          <div class="metric-grid year-detail-grid">
            <article class="metric-card"><span>年間収入</span><strong>{{ formatYen(selectedAnnualResult.income) }}</strong><small>給与・賞与・年金・退職金・その他・債券利息の合計</small></article>
            <article class="metric-card"><span>年間支出</span><strong>{{ formatYen(selectedAnnualResult.expense) }}</strong><small>ローン利息を含む</small></article>
            <article class="metric-card"><span>年間収支</span><strong :class="selectedAnnualResult.netCashflow >= 0 ? 'positive' : 'negative'">{{ formatYen(selectedAnnualResult.netCashflow) }}</strong><small>元金返済・税・社会保険料控除後</small></article>
            <article class="metric-card"><span>税金・社会保険料</span><strong>{{ formatYen(selectedAnnualResult.totalDeductions) }}</strong><small>所得税 {{ formatYen(selectedAnnualResult.incomeTax) }} ／ 住民税 {{ formatYen(selectedAnnualResult.residentTax) }} ／ 社会保険 {{ formatYen(selectedAnnualResult.socialInsurance) }}</small></article>
            <article class="metric-card"><span>年間投資積立額</span><strong>{{ formatYen(selectedAnnualResult.investmentContribution) }}</strong><small>評価額の運用増減 {{ formatYen(selectedAnnualResult.investmentGain) }}</small></article>
            <article class="metric-card"><span>資産取り崩し</span><strong>{{ formatYen(selectedAnnualResult.withdrawalAmount) }}</strong><small>{{ withdrawalSummary(selectedAnnualResult) }}</small></article>
            <article class="metric-card"><span>年間現金不足</span><strong :class="selectedAnnualResult.cashShortfall > 0 ? 'negative' : 'positive'">{{ formatYen(selectedAnnualResult.cashShortfall) }}</strong><small>この年に新たに発生した不足額</small></article>
            <article class="metric-card"><span>現金不足累計</span><strong :class="selectedAnnualResult.cumulativeCashShortfall > 0 ? 'negative' : 'positive'">{{ formatYen(selectedAnnualResult.cumulativeCashShortfall) }}</strong><small>{{ selectedAnnualResult.year }}年末までの累計不足額</small></article>
            <article class="metric-card"><span>年末金融資産</span><strong>{{ formatYen(selectedAnnualResult.closingFinancialAssets) }}</strong><small>年末負債 {{ formatYen(selectedAnnualResult.closingLiabilities) }}</small></article>
            <article class="metric-card"><span>年間の金融資産増減</span><strong :class="(selectedAnnualResult.closingFinancialAssets - selectedAnnualResult.openingFinancialAssets) >= 0 ? 'positive' : 'negative'">{{ formatYen((selectedAnnualResult.closingFinancialAssets - selectedAnnualResult.openingFinancialAssets)) }}</strong><small>年末金融資産 − 年初金融資産</small></article>
          </div>
          <section class="opening-assets-breakdown" aria-label="年間収入の内訳">
            <div class="section-heading"><div><p class="eyebrow">INCOME BREAKDOWN</p><h4>年間収入の内訳</h4></div></div>
            <div class="year-detail-list">
              <div><span>給与・再雇用収入</span><strong>{{ formatYen(selectedAnnualResult.salaryIncome) }}</strong></div>
              <div><span>賞与収入</span><strong>{{ formatYen(selectedAnnualResult.bonusIncome) }}</strong></div>
              <div><span>年金収入</span><strong>{{ formatYen(selectedAnnualResult.pensionIncome) }}</strong></div>
              <div><span>退職金収入</span><strong>{{ formatYen(selectedAnnualResult.retirementBenefit) }}</strong></div>
              <div><span>その他・臨時収入</span><strong>{{ formatYen(selectedAnnualResult.otherIncome) }}</strong></div>
              <div><span>金融資産収入（債券利息・預貯金の設定利回り）</span><strong>{{ formatYen(selectedAnnualResult.financialAssetIncome) }}</strong></div>
            </div>
            <p class="helper-note">金融資産収入は債券利息と、現金・預貯金に設定した利回りによる増加分です。資産の評価額が増えた分は「評価額の運用増減」に別表示します。</p>
          </section>
          <div class="year-detail-list">
            <div><span>ローン返済額</span><strong>{{ formatYen(selectedAnnualResult.debtPayment) }}</strong></div>
            <div><span>うち元金返済</span><strong>{{ formatYen(selectedAnnualResult.debtPrincipal) }}</strong></div>
            <div><span>年初金融資産</span><strong>{{ formatYen(selectedAnnualResult.openingFinancialAssets) }}</strong></div>
            <div><span>年末純資産</span><strong>{{ formatYen(selectedAnnualResult.netWorth) }}</strong></div>
          </div>
          <section class="opening-assets-breakdown" aria-label="年初金融資産の内訳">
            <div class="section-heading"><div><p class="eyebrow">OPENING ASSETS</p><h4>年初金融資産の内訳</h4></div></div>
            <div class="opening-assets-columns">
              <div class="opening-assets-group">
                <h5>区分別</h5>
                <div v-if="openingAssetCategoryRows.length" class="opening-assets-list">
                  <div v-for="row in openingAssetCategoryRows" :key="row.key"><span>{{ row.label }}</span><strong>{{ formatYen(row.amount) }}</strong></div>
                </div>
                <p v-else class="helper-note">内訳データはありません。</p>
              </div>
              <div class="opening-assets-group">
                <h5>個別資産別</h5>
                <div v-if="selectedAnnualResult.openingAssetDetails?.length" class="opening-assets-list">
                  <div v-for="asset in selectedAnnualResult.openingAssetDetails" :key="asset.assetId"><span>{{ asset.name }}</span><strong>{{ formatYen(asset.balance) }}</strong></div>
                </div>
                <p v-else class="helper-note">個別資産は登録されていません。</p>
              </div>
            </div>
            <p class="helper-note">選択した年度の年初時点で保有している資産を表示します。年度途中の購入・売却は翌年度の年初内訳に反映されます。</p>
          </section>
        </section>

        <section class="content-card chart-card">
          <div class="section-heading"><div><p class="eyebrow">ASSET PROJECTION</p><h3>金融資産・負債の推移</h3></div><span class="unit-label">円</span></div>
          <div ref="resultAssetScroll" class="year-axis-scroll" aria-label="金融資産・負債グラフの横スクロール" @scroll="syncResultScroll('assets')">
            <div class="year-axis-content" :style="{ width: resultContentWidth }">
              <div class="year-axis-spacer" aria-hidden="true"></div>
              <div class="year-axis-chart" :style="{ width: resultChartWidth }">
                <Bar :data="chartData" :options="yearlyAssetChartOptions" />
              </div>
            </div>
          </div>
        </section>

        <section class="content-card chart-card nisa-chart-card">
          <div class="section-heading"><div><p class="eyebrow">NISA PROJECTION</p><h3>NISA資産の推移</h3></div><span class="unit-label">円</span></div>
          <p class="helper-note">NISA区分に登録した資産の年末評価額を表示します。積立設定・運用条件の変更は再計算後に反映されます。</p>
          <div ref="resultNisaScroll" class="year-axis-scroll" aria-label="NISA資産グラフの横スクロール" @scroll="syncResultScroll('nisa')">
            <div class="year-axis-content" :style="{ width: resultContentWidth }">
              <div class="year-axis-spacer" aria-hidden="true"></div>
              <div class="year-axis-chart" :style="{ width: resultChartWidth }">
                <Line :data="nisaChartData" :options="yearlyChartOptions" />
              </div>
            </div>
          </div>
        </section>

        <section class="content-card chart-card">
          <div class="section-heading"><div><p class="eyebrow">ANNUAL CASHFLOW</p><h3>収入・支出・年間収支の推移</h3></div><span class="unit-label">円／年</span></div>
          <div ref="resultCashflowScroll" class="year-axis-scroll" aria-label="年間収支グラフの横スクロール" @scroll="syncResultScroll('cashflow')">
            <div class="year-axis-content" :style="{ width: resultContentWidth }">
              <div class="year-axis-spacer" aria-hidden="true"></div>
              <div class="year-axis-chart" :style="{ width: resultChartWidth }">
                <Line :data="annualCashflowChartData" :options="yearlyChartOptions" />
              </div>
            </div>
          </div>
          <p class="helper-note chart-note">年間収支は、収入から支出・元金返済・税金・社会保険料を差し引いた金額です。投資積立や資産売却は含みません。</p>
        </section>

        <section class="content-card table-card">
          <div class="section-heading"><div><p class="eyebrow">ANNUAL PROJECTION</p><h3>年次シミュレーション一覧</h3></div><span class="unit-label">年度列を選択すると詳細に反映</span></div>
          <p class="helper-note">年度が横方向に並びます。グラフと同じように左右へスクロールできます。左端の項目名は固定表示されます。</p>
          <div ref="resultTableScroll" class="year-axis-scroll annual-table-scroll" aria-label="年次シミュレーション表の横スクロール" @scroll="syncResultScroll('table')">
            <table class="annual-matrix" :style="{ width: resultContentWidth }">
              <colgroup>
                <col class="annual-label-column" />
                <col v-for="row in simulationResult.annualResults" :key="row.year" class="annual-year-column" />
              </colgroup>
              <thead>
                <tr>
                  <th class="annual-row-label" scope="col">項目</th>
                  <th v-for="row in simulationResult.annualResults" :key="row.year" scope="col" :class="{ 'selected-year-cell': Number(selectedResultYear) === row.year }">
                    <button type="button" class="year-header-button" :aria-pressed="Number(selectedResultYear) === row.year" @click="selectedResultYear = row.year">{{ row.year }}年</button>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="line in annualTableRows" :key="line.label">
                  <th class="annual-row-label" scope="row">{{ line.label }}</th>
                  <td
                    v-for="cell in line.cells"
                    :key="cell.year"
                    :class="[cell.className, { 'selected-year-cell': Number(selectedResultYear) === cell.year }]"
                    :title="cell.value"
                    @click="selectedResultYear = cell.year"
                  >{{ cell.value }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>

      <template v-else-if="activeTab === 'settings' && settingsSection === 'settings'">
        <section class="intro-row">
          <div><h2>アプリの設定</h2><p>表示や動作に関する設定を、今後の段階で順次追加します。</p></div>
        </section>
        <section class="content-card editor-card">
          <div class="section-heading"><div><p class="eyebrow">CURRENT SETTINGS</p><h3>現在の設定・保存方式</h3></div><span class="status-pill">V1.8.15</span></div>
          <div class="year-detail-list">
            <div><span>データ保存</span><strong>IndexedDB（主保存）</strong></div>
            <div><span>互換保存</span><strong>localStorage（ミラー）</strong></div>
            <div><span>自動保存</span><strong>入力変更時・保存日時を記録</strong></div>
            <div><span>自動バックアップ</span><strong>日次・直近7日分</strong></div>
            <div><span>クラウド連携</span><strong>{{ cloudAutoSyncEnabled ? '自動送信ON' : '手動' }}</strong></div>
            <div><span>試算方式</span><strong>月次計算・年次集計</strong></div>
          </div>
          <p class="helper-note">入力データはIndexedDBへ自動保存し、保存日時を記録します。データを変更した日の最初の保存時に日次バックアップを作成し、直近7日分を保持します。自動クラウド同期はローカルからクラウドへの送信に対応します。複数端末間の自動ダウンロード・自動競合解決は未実装です。</p>
          <button class="secondary-button" @click="settingsSection = 'data'">データ管理を開く</button>
        </section>
      </template>
      <template v-else-if="activeTab === 'compare' && compareMode === 'plans'">
        <section class="intro-row">
          <div><h2>保存した将来プランを比較</h2><p>現在の入力内容をプランとして保存し、条件の異なる家計計画を比較します。</p></div>
          <div class="button-row">
            <button class="secondary-button" @click="saveCurrentPlanSnapshot">現在のプランを更新保存</button>
            <button class="primary-button" @click="createSavedPlan">新しいプランを作成</button>
          </div>
        </section>
        <section class="content-card editor-card">
          <div class="section-heading"><div><p class="eyebrow">SAVED PLANS</p><h3>プラン一覧</h3></div><span class="status-pill">現在：{{ currentSavedPlanName }}</span></div>
          <p class="helper-note">プランを切り替えると、現在の入力内容を現在プランに保存してから切り替えます。別プランの条件は独立して保持されます。</p>
          <div class="saved-plan-list">
            <article v-for="plan in householdData.savedPlans" :key="plan.planId" class="saved-plan-row">
              <div class="saved-plan-name"><strong>{{ plan.name }}</strong><span v-if="plan.planId === householdData.activeSavedPlanId" class="status-pill">編集中</span></div>
              <div class="button-row">
                <button class="secondary-button" :disabled="plan.planId === householdData.activeSavedPlanId" @click="activateSavedPlan(plan.planId)">このプランを開く</button>
                <button class="secondary-button" @click="renameSavedPlan(plan)">名前変更</button>
                <button class="secondary-button danger-button" @click="deleteSavedPlan(plan)">削除</button>
              </div>
            </article>
          </div>
          <p v-if="planMessage" class="success-message" role="status">{{ planMessage }}</p>
        </section>
        <section class="content-card editor-card">
          <div class="section-heading"><div><p class="eyebrow">COMPARE PLANS</p><h3>比較するプランを選択</h3></div><span class="unit-label">{{ selectedPlanIds.length }}件選択</span></div>
          <div class="plan-select-grid">
            <label v-for="plan in householdData.savedPlans" :key="plan.planId" class="toggle-label">
              <input type="checkbox" :checked="selectedPlanIds.includes(plan.planId)" @change="togglePlanComparison(plan.planId, $event.target.checked)" />
              <span>{{ plan.name }}</span>
            </label>
          </div>
          <p class="helper-note">比較グラフと表は、選択したプランを対象に再計算します。プランを編集した後は「再計算する」を押してください。</p>
        </section>
        <section v-if="planComparisonEntries.length" class="content-card chart-card">
          <div class="section-heading"><div><p class="eyebrow">FINANCIAL ASSETS</p><h3>金融資産の推移・プラン比較</h3></div><span class="unit-label">円</span></div>
          <div v-if="planComparisonEntries.some((entry) => entry.error)" class="error-message">{{ planComparisonEntries.filter((entry) => entry.error).map((entry) => `${entry.plan.name}：${entry.error}`).join(' ／ ') }}</div>
          <div class="chart-wrap"><Line :data="planComparisonChartData" :options="chartOptions" /></div>
        </section>
        <section class="content-card table-card">
          <div class="section-heading"><div><p class="eyebrow">PLAN SUMMARY</p><h3>比較結果</h3></div></div>
          <div class="table-scroll"><table><thead><tr><th>プラン</th><th>最低金融資産</th><th>最低となる年・年齢</th><th>最終年</th><th>最終金融資産</th></tr></thead>
            <tbody><tr v-for="entry in planComparisonEntries.filter((item) => item.summary)" :key="entry.plan.planId">
              <td>{{ entry.plan.name }}</td><td>{{ formatYen(entry.summary.minimumAssets) }}</td>
              <td>{{ entry.summary.minimumYear }}年 ／ {{ entry.summary.minimumAges.map((person) => `${person.name} ${person.age == null ? '年齢不明' : `${person.age}歳`}`).join('・') || '年齢不明' }}</td>
              <td>{{ entry.summary.finalYear }}年</td><td>{{ formatYen(entry.summary.finalAssets) }}</td>
            </tr></tbody>
          </table></div>
        </section>
        <section class="content-card table-card">
          <div class="section-heading"><div><p class="eyebrow">AGE BY AGE</p><h3>年齢別・金融資産推移</h3></div></div>
          <p class="helper-note">年末金融資産を年ごとに表示します。年齢は最初に登録した人物を基準にしています。</p>
          <div class="table-scroll"><table><thead><tr><th>年</th><th>基準人物の年齢</th><th v-for="entry in planComparisonEntries.filter((item) => item.result)" :key="entry.plan.planId">{{ entry.plan.name }}</th></tr></thead>
            <tbody><tr v-for="row in planComparisonYearRows" :key="row.year"><td>{{ row.year }}年</td><td>{{ row.referenceAge == null ? '—' : `${row.referenceAge}歳` }}</td>
              <td v-for="value in row.values" :key="value.planId">{{ value.assets == null ? '—' : formatYen(value.assets) }}</td>
            </tr></tbody>
          </table></div>
        </section>
        <section class="content-card notice-card"><p>保存プランを含む完全なバックアップにはJSONバックアップを使用してください。Excel書き出しは現在開いているプランの分析用です。</p></section>
        <section v-if="!selectedPlanIds.length" class="content-card notice-card"><p>比較するプランを1件以上選択してください。</p></section>
      </template>
      <template v-else-if="activeTab === 'compare' && compareMode === 'scenarios'">
        <section class="intro-row"><div><h2>3つの将来シナリオを比較</h2><p>同じ世帯データを使い、経済条件を変えた場合の資産推移を比較します。</p></div><button class="secondary-button" @click="activeTab = 'data'">シナリオ条件を編集</button></section>
        <section class="metric-grid scenario-metric-grid">
          <article v-for="entry in scenarioResults" :key="entry.scenario.scenarioId" class="metric-card" :class="{ 'highlight-card': entry.scenario.scenarioId === 'standard' }">
            <span>{{ entry.scenario.name }}シナリオ・最終年金融資産</span>
            <strong>{{ formatYen(entry.result.summary.endFinancialAssets) }}</strong>
            <small>最終純資産：{{ formatYen(entry.result.summary.endNetWorth) }}</small>
            <small v-if="entry.result.summary.firstCashShortfallYear" class="negative">初回の現金不足：{{ entry.result.summary.firstCashShortfallYear }}年</small>
            <small v-else class="positive">現金不足の予測なし</small>
          </article>
        </section>
        <section class="content-card chart-card"><div class="section-heading"><div><p class="eyebrow">SCENARIO PROJECTION</p><h3>シナリオ別・金融資産の推移</h3></div><span class="unit-label">円</span></div><div class="chart-wrap"><Line :data="scenarioChartData" :options="chartOptions" /></div></section>
        <section class="content-card table-card"><div class="section-heading"><div><p class="eyebrow">SCENARIO SUMMARY</p><h3>比較一覧</h3></div></div><div class="table-scroll"><table><thead><tr><th>シナリオ</th><th>最終金融資産</th><th>最終負債</th><th>最終純資産</th><th>累計取り崩し</th><th>現金不足累計</th><th>初回現金不足年</th></tr></thead><tbody><tr v-for="entry in scenarioResults" :key="entry.scenario.scenarioId"><td>{{ entry.scenario.name }}</td><td>{{ formatYen(entry.result.summary.endFinancialAssets) }}</td><td>{{ formatYen(entry.result.summary.endLiabilities) }}</td><td>{{ formatYen(entry.result.summary.endNetWorth) }}</td><td>{{ formatYen(entry.result.summary.totalWithdrawals) }}</td><td>{{ formatYen(entry.result.summary.totalCashShortfall) }}</td><td>{{ entry.result.summary.firstCashShortfallYear ?? 'なし' }}</td></tr></tbody></table></div></section>
        <section class="content-card notice-card"><h3>シナリオの前提</h3><ul><li>標準は登録した基本条件をそのまま使用します。</li><li>楽観・悲観は標準条件に対する年率差を適用します。</li><li>投資利回りの差は現金・預金以外の資産に適用します。</li><li>これは条件を変えた比較試算であり、将来の結果を保証するものではありません。</li></ul></section>
      </template>
      <footer class="page-footer">未来シミュレーター v1.8.14 · 入力データはこのブラウザ内に自動保存されます。</footer>
    </main>
  </div>
</template>
