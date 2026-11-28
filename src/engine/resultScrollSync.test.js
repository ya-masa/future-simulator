import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const app = readFileSync(new URL('../App.vue', import.meta.url), 'utf8')

test('integrated projection combines asset, NISA, and cashflow datasets and links to annual table', () => {
  assert.ok(app.includes('資産・NISA・年間収支の統合推移'))
  for (const label of ['NISA評価額', '収入', '支出', '年間収支']) {
    assert.ok(app.includes(`label: '${label}'`), `missing combined dataset: ${label}`)
  }
  assert.ok(app.includes('金融資産・負債の積み上げ'))
  assert.ok(app.includes('ref="resultAssetScroll"'))
  assert.ok(app.includes('ref="resultTableScroll"'))
  assert.ok(app.includes("syncResultScroll('assets')"))
  assert.ok(app.includes("syncResultScroll('table')"))
  assert.ok(!app.includes("ref=\"resultNisaScroll\""))
  assert.ok(!app.includes("ref=\"resultCashflowScroll\""))
})
