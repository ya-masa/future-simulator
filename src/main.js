import { createApp } from 'vue'
import App from './App.vue'
import './styles/base.css'
import { initializeLocalStore, saveLocalStore } from './engine/localStore.js'

const STORAGE_KEY = 'future-simulator-household-v02'

async function startApp() {
  const initialized = await initializeLocalStore(STORAGE_KEY)
  window.__FUTURE_SIMULATOR_INITIAL_DATA__ = initialized.data
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
