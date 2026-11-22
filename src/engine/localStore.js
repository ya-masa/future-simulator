/**
 * IndexedDBを主保存先として使用するローカルストア。
 * 旧localStorageからの初回移行、保存日時、日次スナップショットを管理する。
 */
const DB_NAME = 'future-simulator-local'
const DB_VERSION = 2
const STORE_NAME = 'households'
const BACKUP_STORE_NAME = 'dailyBackups'
const BACKUP_RETENTION_DAYS = 7
const writeQueues = new Map()

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('このブラウザではIndexedDBを利用できません。'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains(BACKUP_STORE_NAME)) {
        db.createObjectStore(BACKUP_STORE_NAME, { keyPath: 'key' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('IndexedDBを開けませんでした。'))
    request.onblocked = () => reject(new Error('IndexedDBの更新が別のタブによって保留されています。'))
  })
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('IndexedDBの読み書きに失敗しました。'))
  })
}

async function readRecord(db, storeName, key) {
  const transaction = db.transaction(storeName, 'readonly')
  return requestResult(transaction.objectStore(storeName).get(key))
}

async function writeRecord(db, storeName, record) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite')
    transaction.objectStore(storeName).put(record)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDBへの保存に失敗しました。'))
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDBへの保存が中断されました。'))
  })
}

function readLegacyData(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function dateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export async function initializeLocalStore(storageKey) {
  const legacyData = readLegacyData(storageKey)
  try {
    const db = await openDatabase()
    try {
      const saved = await readRecord(db, STORE_NAME, storageKey)
      if (saved?.data && typeof saved.data === 'object') {
        try { localStorage.setItem(storageKey, JSON.stringify(saved.data)) } catch { /* IndexedDBを正とする */ }
        return {
          data: saved.data,
          mode: 'IndexedDB',
          migrated: false,
          savedAt: saved.savedAt || null,
          lastBackupAt: saved.lastBackupAt || null,
        }
      }
      if (legacyData) {
        const savedAt = new Date().toISOString()
        await writeRecord(db, STORE_NAME, { key: storageKey, data: legacyData, savedAt, lastBackupAt: null })
        return { data: legacyData, mode: 'IndexedDB', migrated: true, savedAt, lastBackupAt: null }
      }
      return { data: null, mode: 'IndexedDB', migrated: false, savedAt: null, lastBackupAt: null }
    } finally {
      db.close()
    }
  } catch (error) {
    return {
      data: legacyData,
      mode: 'localStorage（代替保存）',
      migrated: false,
      savedAt: null,
      lastBackupAt: null,
      warning: error instanceof Error ? error.message : 'IndexedDBを利用できません。',
    }
  }
}

export function saveLocalStore(storageKey, data) {
  const snapshot = JSON.parse(JSON.stringify(data))
  const savedAt = new Date().toISOString()
  const backupKey = `${storageKey}:${dateKey(new Date(savedAt))}`

  try { localStorage.setItem(storageKey, JSON.stringify(snapshot)) } catch { /* IndexedDBへの保存を継続 */ }

  const previous = writeQueues.get(storageKey) || Promise.resolve()
  const current = previous.catch(() => {}).then(async () => {
    const db = await openDatabase()
    try {
      const existingBackup = await readRecord(db, BACKUP_STORE_NAME, backupKey)
      let lastBackupAt = existingBackup?.savedAt || null

      if (!existingBackup) {
        await writeRecord(db, BACKUP_STORE_NAME, {
          key: backupKey,
          storageKey,
          data: snapshot,
          savedAt,
        })
        lastBackupAt = savedAt

        // 直近7日分だけ保持する。別世帯のバックアップは削除しない。
        const transaction = db.transaction(BACKUP_STORE_NAME, 'readonly')
        const allBackups = await requestResult(transaction.objectStore(BACKUP_STORE_NAME).getAll())
        const ownBackups = allBackups
          .filter((item) => item.storageKey === storageKey)
          .sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)))
        for (const oldBackup of ownBackups.slice(BACKUP_RETENTION_DAYS)) {
          const deleteTransaction = db.transaction(BACKUP_STORE_NAME, 'readwrite')
          deleteTransaction.objectStore(BACKUP_STORE_NAME).delete(oldBackup.key)
          await new Promise((resolve, reject) => {
            deleteTransaction.oncomplete = resolve
            deleteTransaction.onerror = () => reject(deleteTransaction.error)
            deleteTransaction.onabort = () => reject(deleteTransaction.error)
          })
        }
      }

      await writeRecord(db, STORE_NAME, {
        key: storageKey,
        data: snapshot,
        savedAt,
        lastBackupAt,
      })
      return { savedAt, lastBackupAt, mode: 'IndexedDB' }
    } finally {
      db.close()
    }
  })
  writeQueues.set(storageKey, current)
  return current
}

export async function getLatestLocalBackup(storageKey) {
  const db = await openDatabase()
  try {
    const transaction = db.transaction(BACKUP_STORE_NAME, 'readonly')
    const allBackups = await requestResult(transaction.objectStore(BACKUP_STORE_NAME).getAll())
    const latest = allBackups
      .filter((item) => item.storageKey === storageKey && item.data)
      .sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)))[0]
    return latest ? { data: latest.data, savedAt: latest.savedAt } : null
  } finally {
    db.close()
  }
}
