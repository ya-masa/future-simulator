import { createApp } from 'vue'
import App from './App.vue'
import './styles/base.css'
import { initializeLocalStore, saveLocalStore } from './engine/localStore.js'
import { readDestinationFile } from './engine/storageDestination.js'
import { parseBackup } from './engine/backup.js'
import { parseExcelWorkbook } from './engine/excelImport.js'
import { sendGasRequest, validateCloudConfig } from './engine/cloudStorage.js'
import { getDestinationSettings } from './engine/storageDestination.js'
import { getLatestLocalBackup } from './engine/localStore.js'

const STORAGE_KEY = 'future-simulator-household-v02'

async function startApp() {
  const initialized = await initializeLocalStore(STORAGE_KEY)
  let startupData = initialized.data
  let destinationNotice = ''
  try {
    const destinationSettings = await getDestinationSettings()
    if (destinationSettings.mode === 'indexeddb') {
      const latestLocalBackup = await getLatestLocalBackup(STORAGE_KEY)
      if (latestLocalBackup?.data) {
        const confirmed = window.confirm(`IndexedDBの最新バックアップを確認しました。\\n保存日時：${latestLocalBackup.savedAt || '不明'}\\n\\n最新のバックアップを反映していいですか？`)
        if (confirmed) {
          startupData = latestLocalBackup.data
          destinationNotice = `IndexedDBのバックアップ（${latestLocalBackup.savedAt || '日時不明'}）を反映しました。`
        } else destinationNotice = 'IndexedDBのバックアップは反映せず、現在の保存データを使用しています。'
      }
    }
    const external = await readDestinationFile()
    if (destinationSettings.mode === 'gas') {
      const webAppUrl = localStorage.getItem('future-simulator-gas-url') || ''
      const accessToken = localStorage.getItem('future-simulator-gas-token') || ''
      if (webAppUrl && accessToken && startupData?.household?.householdId) {
        const config = validateCloudConfig({ webAppUrl, accessToken })
        const status = await sendGasRequest(config, 'status', String(startupData.household.householdId))
        if (status?.exists) {
          const cloud = await sendGasRequest(config, 'load', String(startupData.household.householdId))
          if (cloud?.data) {
            const confirmed = window.confirm(`Googleスプレッドシートの最新データを確認しました。\\nクラウド版 ${status.revision}\\n保存日時：${status.savedAt || '不明'}\\n\\n最新のバックアップを反映していいですか？`)
            if (confirmed) {
              startupData = cloud.data
              try { localStorage.setItem(`future-simulator-cloud-revision:${String(startupData.household?.householdId)}`, String(status.revision)) } catch {}
              destinationNotice = `Googleスプレッドシートのデータ（版 ${status.revision}）を反映しました。`
            } else destinationNotice = 'Googleスプレッドシートのデータは反映せず、IndexedDBのデータを使用しています。'
          }
        }
      } else {
        destinationNotice = 'GAS保存先の接続設定が未登録です。データ管理でURLとアクセスキーを設定してください。'
      }
    }
    if (external?.text) {
      let externalData
      if (external.mode === 'json') externalData = parseBackup(external.text)
      else externalData = parseExcelWorkbook(external.text)
      const confirmed = window.confirm(`保存先の最新データを確認しました。\\n${external.fileName || '外部ファイル'}\\n保存日時：${external.savedAt || '不明'}\\n\\n最新のバックアップを反映していいですか？`)
      if (confirmed) {
        startupData = externalData
        destinationNotice = `外部保存先のデータを反映しました（${external.fileName || 'ファイル'}）。`
      } else {
        destinationNotice = '外部保存先のデータは反映せず、IndexedDBのデータを使用しています。'
      }
    } else if (external?.permission && external.permission !== 'granted') {
      destinationNotice = '外部ファイルのアクセス許可がありません。データ管理で許可を設定してください。'
    } else if (external?.error) {
      destinationNotice = `外部ファイルを読み込めませんでした：${external.error}`
    }
  } catch (error) {
    destinationNotice = `外部保存先の確認に失敗しました：${error.message}`
  }
  window.__FUTURE_SIMULATOR_INITIAL_DATA__ = startupData
  window.__FUTURE_SIMULATOR_DESTINATION_NOTICE__ = destinationNotice
  window.__FUTURE_SIMULATOR_SAVED_AT__ = initialized.savedAt
  window.__FUTURE_SIMULATOR_LAST_BACKUP_AT__ = initialized.lastBackupAt
  try {
    localStorage.setItem('future-simulator-storage-mode', initialized.mode)
  } catch {
    // 保存モード表示が保存できなくてもアプリ起動は継続する。
  }

  createApp(App).mount('#app')

  // 初回起動時のサンプルデータや、正規化後のデータもIndexedDBへ保存する。
  try {
    const currentData = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (currentData) await saveLocalStore(STORAGE_KEY, currentData)
  } catch {
    // App側の自動保存で再試行する。起動自体は妨げない。
  }
}

startApp()
