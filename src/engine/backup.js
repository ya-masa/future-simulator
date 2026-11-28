export const BACKUP_FORMAT = 'future-simulator-backup'
export const BACKUP_SCHEMA_VERSION = 1
export const APP_VERSION = '1.14.1'

/** JSON互換データとしてバックアップ用の封筒を作成する。 */
export function createBackup(data, exportedAt = new Date().toISOString()) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('バックアップ対象のデータが正しくありません。')
  }
  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt,
    data: JSON.parse(JSON.stringify(data)),
  }
}

/** バックアップファイルを検証し、アプリの世帯データを返す。 */
export function parseBackup(text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('JSONファイルを読み取れません。ファイルの内容を確認してください。')
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('バックアップファイルの形式が正しくありません。')
  }
  if (parsed.format !== BACKUP_FORMAT) {
    throw new Error('このファイルは未来シミュレーターのバックアップではありません。')
  }
  if (parsed.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    throw new Error(`未対応のデータ形式です（形式バージョン: ${parsed.schemaVersion ?? '不明'}）。`)
  }

  const data = parsed.data
  if (!data || typeof data !== 'object' || Array.isArray(data) || !data.household || typeof data.household !== 'object') {
    throw new Error('世帯情報が見つかりません。バックアップファイルが破損している可能性があります。')
  }

  const requiredArrays = ['persons', 'incomeRecords', 'expenseRecords', 'assets', 'liabilities', 'futureEvents']
  for (const key of requiredArrays) {
    if (!Array.isArray(data[key])) {
      throw new Error(`「${key}」のデータ形式が正しくありません。`)
    }
  }
  if (!data.conditions || typeof data.conditions !== 'object' || Array.isArray(data.conditions)) {
    throw new Error('試算条件のデータ形式が正しくありません。')
  }
  if (data.scenarios != null && !Array.isArray(data.scenarios)) {
    throw new Error('シナリオ設定のデータ形式が正しくありません。')
  }

  return JSON.parse(JSON.stringify(data))
}
