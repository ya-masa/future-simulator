import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const app = readFileSync(new URL('../App.vue', import.meta.url), 'utf8')

test('three result charts and annual table have linked scroll handlers', () => {
  for (const name of ['resultAssetScroll', 'resultNisaScroll', 'resultCashflowScroll', 'resultTableScroll']) {
    assert.ok(app.includes(`const ${name} = ref(null)`), `missing scroll ref: ${name}`)
  }
  for (const source of ['assets', 'nisa', 'cashflow', 'table']) {
    assert.ok(app.includes(`syncResultScroll('${source}')`), `missing scroll handler: ${source}`)
  }
  assert.ok(app.includes('scrollRatio'))
})
