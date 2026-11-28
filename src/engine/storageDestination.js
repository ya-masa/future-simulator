const DB_NAME = 'future-simulator-destination'
const DB_VERSION = 1
const STORE = 'settings'
const KEY = 'destination'
const VERSION_KEY = 'future-simulator-save-version'
const MODE_KEY = 'future-simulator-storage-mode'

export const STORAGE_OPTIONS = [
  { value: 'indexeddb', label: 'IndexedDBのみ' },
  { value: 'json', label: 'IndexedDB＋JSON' },
  { value: 'excel', label: 'IndexedDB＋Excel' },
  { value: 'gas', label: 'IndexedDB＋GAS経由のスプレッドシート' },
]

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('保存設定DBを開けません。'))
  })
}
async function readSetting() {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY)
      req.onsuccess = () => resolve(req.result || { mode: 'indexeddb', handle: null })
      req.onerror = () => reject(req.error)
    })
  } finally { db.close() }
}
async function writeSetting(value) {
  const db = await openDb()
  try {
    await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, KEY)
      req.onsuccess = resolve
      req.onerror = () => reject(req.error)
    })
  } finally { db.close() }
}
export async function getDestinationSettings() {
  try { return await readSetting() } catch { return { mode: localStorage.getItem(MODE_KEY) || 'indexeddb', handle: null } }
}
export async function setDestinationMode(mode) {
  const current = await getDestinationSettings()
  await writeSetting({ ...current, mode, updatedAt: new Date().toISOString() })
  localStorage.setItem(MODE_KEY, mode)
  return mode
}
export async function chooseDestinationFile(mode) {
  if (!['json', 'excel'].includes(mode)) throw new Error('ファイル保存方式が指定されていません。')
  if (!window.showSaveFilePicker) throw new Error('このブラウザはファイルへの自動保存に対応していません。最新のEdgeまたはChromeでお試しください。')
  const handle = await window.showSaveFilePicker({
    suggestedName: mode === 'json' ? 'future-simulator-backup.json' : 'future-simulator-backup.xml',
    types: [{ description: mode === 'json' ? 'JSONバックアップ' : 'Excel XMLブック', accept: mode === 'json' ? { 'application/json': ['.json'] } : { 'application/vnd.ms-excel': ['.xml'] } }],
  })
  const permission = await getFilePermission(handle, true)
  if (permission !== 'granted') throw new Error('選択したファイルへの書き込み許可を取得できませんでした。')
  const current = await getDestinationSettings()
  await writeSetting({ ...current, mode, handle, fileName: handle.name, updatedAt: new Date().toISOString() })
  await setDestinationMode(mode)
  return handle.name
}
export async function getFilePermission(handle, request = false) {
  if (!handle) return 'missing'
  try {
    const state = await handle.queryPermission({ mode: 'readwrite' })
    if (state === 'granted' || !request) return state
    return await handle.requestPermission({ mode: 'readwrite' })
  } catch { return 'denied' }
}
export async function readDestinationFile() {
  const settings = await getDestinationSettings()
  if (!['json', 'excel'].includes(settings.mode) || !settings.handle) return null
  const permission = await getFilePermission(settings.handle, false)
  if (permission !== 'granted') return { permission, mode: settings.mode, fileName: settings.fileName }
  try {
    const file = await settings.handle.getFile()
    return { mode: settings.mode, fileName: settings.handle.name, text: await file.text(), savedAt: new Date(file.lastModified).toISOString() }
  } catch (error) { return { error: error.message, mode: settings.mode, fileName: settings.fileName } }
}
export async function writeDestinationFile(text, mode) {
  const settings = await getDestinationSettings()
  if (settings.mode !== mode || !settings.handle) throw new Error('保存ファイルが設定されていません。データ管理から保存先を設定してください。')
  const permission = await getFilePermission(settings.handle, false)
  if (permission !== 'granted') throw new Error('保存ファイルへのアクセス許可がありません。データ管理でアクセス許可を設定してください。')
  const writable = await settings.handle.createWritable()
  await writable.write(text)
  await writable.close()
  return { fileName: settings.handle.name, savedAt: new Date().toISOString() }
}
export function getSaveVersion() {
  const value = Number(localStorage.getItem(VERSION_KEY) || 0)
  return Number.isInteger(value) && value >= 1 && value <= 999 ? value : 0
}
export function advanceSaveVersion() {
  const next = getSaveVersion() >= 999 ? 1 : getSaveVersion() + 1
  localStorage.setItem(VERSION_KEY, String(next))
  return `V${String(next).padStart(3, '0')}`
}
export function formatSaveVersion() {
  const value = getSaveVersion()
  return `V${String(value || 1).padStart(3, '0')}`
}
