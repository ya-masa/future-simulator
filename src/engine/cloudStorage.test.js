import test from 'node:test'
import assert from 'node:assert/strict'
import { validateCloudConfig } from './cloudStorage.js'

test('GASの正しいウェブアプリURLとアクセスキーを受け付ける', () => {
  const result = validateCloudConfig({ webAppUrl: 'https://script.google.com/macros/s/AKfycbxxxxxxxx/exec', accessToken: '0123456789abcdef' })
  assert.equal(result.accessToken, '0123456789abcdef')
})
test('httpや別ホストのURLを拒否する', () => {
  assert.throws(() => validateCloudConfig({ webAppUrl: 'http://script.google.com/macros/s/abc/exec', accessToken: '0123456789abcdef' }), /URL/)
  assert.throws(() => validateCloudConfig({ webAppUrl: 'https://example.com/macros/s/abc/exec', accessToken: '0123456789abcdef' }), /URL/)
})
test('短いアクセスキーを拒否する', () => {
  assert.throws(() => validateCloudConfig({ webAppUrl: 'https://script.google.com/macros/s/abc/exec', accessToken: 'short' }), /12文字以上/)
})
