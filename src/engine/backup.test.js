import test from 'node:test'
import assert from 'node:assert/strict'
import { createBackup, parseBackup, BACKUP_FORMAT, BACKUP_SCHEMA_VERSION, APP_VERSION } from './backup.js'

const sample = {
  household: { householdName: 'テスト世帯', startDate: '2026-01-01', endAge: 100 },
  persons: [], incomeRecords: [], expenseRecords: [], assets: [], liabilities: [], futureEvents: [],
  conditions: { calculationEndAge: 100 }, scenarios: [],
}

test('バックアップを書き出して元データを復元できる', () => {
  const backup = createBackup(sample, '2026-11-19T00:00:00.000Z')
  assert.equal(backup.format, BACKUP_FORMAT)
  assert.equal(backup.schemaVersion, BACKUP_SCHEMA_VERSION)
  assert.equal(backup.appVersion, APP_VERSION)
  assert.equal(APP_VERSION, '1.13.1')
  assert.deepEqual(parseBackup(JSON.stringify(backup)), sample)
})

test('JSONでないファイルはエラーにする', () => {
  assert.throws(() => parseBackup('not json'), /JSONファイルを読み取れません/)
})

test('別形式のファイルはエラーにする', () => {
  assert.throws(() => parseBackup(JSON.stringify({ format: 'other', schemaVersion: 1, data: sample })), /バックアップではありません/)
})

test('未対応の形式バージョンはエラーにする', () => {
  assert.throws(() => parseBackup(JSON.stringify({ format: BACKUP_FORMAT, schemaVersion: 99, data: sample })), /未対応のデータ形式/)
})

test('必須データが欠けているファイルはエラーにする', () => {
  const invalid = { ...sample, assets: null }
  assert.throws(() => parseBackup(JSON.stringify({ format: BACKUP_FORMAT, schemaVersion: 1, data: invalid })), /assets/)
})
