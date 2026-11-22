/**
 * Excel 2003 XML Spreadsheet形式で複数シートのブックを生成する。
 * Excel / LibreOfficeで開けるXMLワークブック。外部ライブラリ不要。
 */
const escapeXml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;')

function cell(value) {
  if (value === null || value === undefined || value === '') return '<Cell><Data ss:Type="String"></Data></Cell>'
  if (typeof value === 'number' && Number.isFinite(value)) return `<Cell><Data ss:Type="Number">${value}</Data></Cell>`
  if (typeof value === 'boolean') return `<Cell><Data ss:Type="String">${value ? 'はい' : 'いいえ'}</Data></Cell>`
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return `<Cell><Data ss:Type="String">${escapeXml(text)}</Data></Cell>`
}

function normalizeRows(records) {
  if (!Array.isArray(records) || records.length === 0) return [['データ'] , ['データなし']]
  const keys = [...new Set(records.flatMap((record) => Object.keys(record || {})))]
  return [keys, ...records.map((record) => keys.map((key) => record?.[key]))]
}

function objectRows(value) {
  return [['項目', '値'], ...Object.entries(value || {}).map(([key, item]) => [key, item])]
}

function worksheet(name, rows) {
  const safeRows = rows.length ? rows : [['データなし']]
  const xmlRows = safeRows.map((row, index) => {
    const cells = (Array.isArray(row) ? row : [row]).map(cell).join('')
    return `<Row>${index === 0 ? cells.replaceAll('<Cell>', '<Cell ss:StyleID="Header">') : cells}</Row>`
  }).join('')
  return `<Worksheet ss:Name="${escapeXml(name)}"><Table>${xmlRows}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane><ActivePane>2</ActivePane></WorksheetOptions></Worksheet>`
}

export function createExcelXml({ household, simulationResult, scenarioResults = [] }) {
  if (!household || typeof household !== 'object') throw new Error('出力する世帯データがありません。')
  const annualRows = (simulationResult?.annualResults || []).map((row) => ({
    年度: row.year,
    年齢: (row.ages || []).map((person) => `${person.name || ''}:${person.age ?? ''}歳`).join(' / '),
    収入: row.income,
    年金収入: row.pensionIncome,
    退職金: row.retirementBenefit,
    支出: row.expense,
    所得税: row.incomeTax,
    住民税: row.residentTax,
    社会保険料: row.socialInsurance,
    年間収支: row.netCashflow,
    資産取り崩し: row.withdrawalAmount,
    現金不足: row.cashShortfall,
    ローン利息: row.debtInterest,
    返済額: row.debtPayment,
    年末負債: row.closingLiabilities,
    年末純資産: row.netWorth,
    年末金融資産: row.closingFinancialAssets,
  }))
  const comparisonRows = scenarioResults.map((entry) => ({
    シナリオ: entry.scenario?.name,
    最終金融資産: entry.result?.summary?.endFinancialAssets,
    最終負債: entry.result?.summary?.endLiabilities,
    最終純資産: entry.result?.summary?.endNetWorth,
    累計取り崩し: entry.result?.summary?.totalWithdrawals,
    初回現金不足年: entry.result?.summary?.firstCashShortfallYear ?? 'なし',
  }))
  const sheets = [
    ['世帯情報', objectRows(household.household)],
    ['人物', normalizeRows(household.persons)],
    ['収入', normalizeRows(household.incomeRecords)],
    ['年金', normalizeRows(household.pensions || [])],
    ['支出', normalizeRows(household.expenseRecords)],
    ['資産', normalizeRows(household.assets)],
    ['負債', normalizeRows(household.liabilities)],
    ['将来イベント', normalizeRows(household.futureEvents)],
    ['シナリオ', normalizeRows(household.scenarios)],
    ['試算条件', objectRows(household.conditions)],
    ['年次試算結果', normalizeRows(annualRows)],
    ['シナリオ比較', normalizeRows(comparisonRows)],
  ]
  const worksheetXml = sheets.map(([name, rows]) => worksheet(name, rows)).join('')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<?mso-application progid="Excel.Sheet"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#EADCCB" ss:Pattern="Solid"/></Style></Styles>${worksheetXml}</Workbook>`
}

export function downloadExcelWorkbook(data, filenameDate = new Date().toISOString().slice(0, 10)) {
  const xml = createExcelXml(data)
  const blob = new Blob(['\uFEFF', xml], { type: 'application/vnd.ms-excel;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `future-simulator-${filenameDate}.xml`
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
