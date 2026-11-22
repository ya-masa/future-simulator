/**
 * v1.1 が出力する Excel 2003 XML Spreadsheet を読み込み、世帯データへ戻す。
 * 読み込み対象は本アプリの複数シートXMLブック。
 */
const REQUIRED_SHEETS = ['世帯情報', '人物', '収入', '支出', '資産', '負債', '将来イベント', 'シナリオ', '試算条件']
const SHEET_KEYS = {
  人物: 'persons',
  収入: 'incomeRecords',
  年金: 'pensions',
  支出: 'expenseRecords',
  資産: 'assets',
  負債: 'liabilities',
  将来イベント: 'futureEvents',
  シナリオ: 'scenarios',
}

function decodeXml(value) {
  return value
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
}

function parseCell(cellXml) {
  const dataMatch = cellXml.match(/<(?:\w+:)?Data\b[^>]*>([\s\S]*?)<\/(?:\w+:)?Data\s*>/i)
  if (!dataMatch) return ''
  const raw = decodeXml(dataMatch[1])
  const typeMatch = cellXml.match(/<(?:\w+:)?Data\b[^>]*(?:ss:Type|\w+:Type|Type)="([^"]+)"/i)
  const type = typeMatch?.[1]
  if (type === 'Number' && raw.trim() !== '') {
    const number = Number(raw)
    return Number.isFinite(number) ? number : raw
  }
  if (type === 'Boolean') return raw === '1' || raw.toLowerCase() === 'true'
  if (raw === 'はい') return true
  if (raw === 'いいえ') return false
  if (typeof raw === 'string' && /^[\[{]/.test(raw.trim())) {
    try { return JSON.parse(raw) } catch { /* Excelで編集された通常文字列として扱う */ }
  }
  return raw
}

function parseRows(worksheetXml) {
  const rows = []
  const rowPattern = /<(?:\w+:)?Row\b[^>]*>([\s\S]*?)<\/(?:\w+:)?Row\s*>/gi
  let rowMatch
  while ((rowMatch = rowPattern.exec(worksheetXml))) {
    const cells = []
    const cellPattern = /<(?:\w+:)?Cell\b[^>]*>([\s\S]*?)<\/(?:\w+:)?Cell\s*>/gi
    let cellMatch
    while ((cellMatch = cellPattern.exec(rowMatch[1]))) cells.push(parseCell(cellMatch[0]))
    rows.push(cells)
  }
  return rows
}

function parseWorksheets(xml) {
  if (typeof xml !== 'string' || !xml.trim()) throw new Error('Excelファイルの内容が空です。')
  if (!/<(?:\w+:)?Workbook\b/i.test(xml)) throw new Error('対応しているExcel XMLブックではありません。v1.1で出力したXMLファイルを選択してください。')
  const sheets = new Map()
  const worksheetPattern = /<(?:\w+:)?Worksheet\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?Worksheet\s*>/gi
  let match
  while ((match = worksheetPattern.exec(xml))) {
    const nameMatch = match[1].match(/(?:ss:Name|\w+:Name|Name)="([^"]+)"/i)
    if (!nameMatch) continue
    sheets.set(decodeXml(nameMatch[1]), parseRows(match[2]))
  }
  return sheets
}

function rowsToRecords(rows, sheetName) {
  if (!rows?.length) return []
  const headers = rows[0].map((value) => String(value ?? '').trim())
  if (!headers.some(Boolean)) return []
  return rows.slice(1)
    .filter((row) => row.some((value) => value !== '' && value !== null && value !== undefined))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? '']).filter(([header]) => header)))
}

function rowsToObject(rows, sheetName) {
  const result = {}
  for (const row of (rows || []).slice(1)) {
    if (row.length < 1 || row[0] === '') continue
    result[String(row[0])] = row[1] ?? ''
  }
  if (!Object.keys(result).length) throw new Error(`「${sheetName}」シートにデータがありません。`)
  return result
}

/** XMLブックを検証してアプリ標準の世帯データを返す。 */
export function parseExcelWorkbook(xml) {
  const sheets = parseWorksheets(xml)
  const missing = REQUIRED_SHEETS.filter((name) => !sheets.has(name))
  if (missing.length) throw new Error(`必要なシートが見つかりません：${missing.join('、')}`)

  const household = {
    household: rowsToObject(sheets.get('世帯情報'), '世帯情報'),
    conditions: rowsToObject(sheets.get('試算条件'), '試算条件'),
  }
  for (const [sheetName, key] of Object.entries(SHEET_KEYS)) {
    if (sheets.has(sheetName)) household[key] = rowsToRecords(sheets.get(sheetName), sheetName)
  }
  if (!household.household.householdId || !household.household.householdName) {
    throw new Error('世帯情報シートに世帯IDまたは世帯名がありません。')
  }
  if (!Array.isArray(household.persons)) throw new Error('人物シートを読み込めません。')
  if (!household.conditions || typeof household.conditions !== 'object') throw new Error('試算条件を読み込めません。')
  return household
}
