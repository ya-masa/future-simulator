import test from 'node:test'
import assert from 'node:assert/strict'
import { advanceSaveVersion, formatSaveVersion } from './storageDestination.js'

function withLocalStorage(initial, fn) {
  const old = globalThis.localStorage
  const map = new Map(Object.entries(initial))
  globalThis.localStorage = {
    getItem: (key) => map.has(key) ? map.get(key) : null,
    setItem: (key, value) => map.set(key, String(value)),
  }
  try { fn(map) } finally { globalThis.localStorage = old }
}

test('save version increments and formats as Vnnn', () => {
  withLocalStorage({ 'future-simulator-save-version': '7' }, (map) => {
    assert.equal(formatSaveVersion(), 'V007')
    assert.equal(advanceSaveVersion(), 'V008')
    assert.equal(map.get('future-simulator-save-version'), '8')
  })
})

test('save version wraps from 999 to 001', () => {
  withLocalStorage({ 'future-simulator-save-version': '999' }, (map) => {
    assert.equal(advanceSaveVersion(), 'V001')
    assert.equal(map.get('future-simulator-save-version'), '1')
  })
})
