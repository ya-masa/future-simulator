/**
 * Google Apps Script Web App との通信。
 * CORSを回避するため、非表示フォームをiframeへPOSTし、GASのHTML応答をpostMessageで受け取る。
 */
export function validateCloudConfig(config) {
  if (!config || typeof config !== 'object') throw new Error('クラウド設定を入力してください。')
  let url
  try {
    url = new URL(String(config.webAppUrl || '').trim())
  } catch {
    throw new Error('GASウェブアプリURLが正しくありません。')
  }
  if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' ||
      !/^\/macros\/s\/[^/]+\/exec\/?$/.test(url.pathname)) {
    throw new Error('GASウェブアプリURLには、デプロイ済みの /macros/s/.../exec URLを指定してください。')
  }
  const accessToken = String(config.accessToken || '').trim()
  if (accessToken.length < 12) throw new Error('アクセスキーは12文字以上で設定してください。')
  return { webAppUrl: url.toString(), accessToken }
}

export function sendGasRequest(config, action, householdId, data = null, options = {}) {
  const valid = validateCloudConfig(config)
  if (!['save', 'load', 'status'].includes(action)) throw new Error('未対応のクラウド操作です。')
  if (!householdId) throw new Error('世帯IDがありません。世帯情報を確認してください。')

  return new Promise((resolve, reject) => {
    const requestId = `fs-${crypto.randomUUID()}`
    const iframe = document.createElement('iframe')
    iframe.name = `future-simulator-gas-${requestId}`
    iframe.style.display = 'none'
    iframe.setAttribute('aria-hidden', 'true')

    const form = document.createElement('form')
    form.method = 'POST'
    form.action = valid.webAppUrl
    form.target = iframe.name
    form.style.display = 'none'

    const fields = {
      action,
      accessToken: valid.accessToken,
      householdId: String(householdId),
      requestId,
    }
    if (action === 'save') {
      fields.payload = JSON.stringify(data)
      fields.expectedRevision = String(Number.isInteger(options.expectedRevision) ? options.expectedRevision : 0)
    }

    for (const [name, value] of Object.entries(fields)) {
      const input = document.createElement('input')
      input.type = 'hidden'
      input.name = name
      input.value = value
      form.appendChild(input)
    }

    let settled = false
    const cleanup = () => {
      window.removeEventListener('message', onMessage)
      window.clearTimeout(timeoutId)
      form.remove()
      iframe.remove()
    }
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      cleanup()
      callback(value)
    }
    const onMessage = (event) => {
      // HtmlService は内部iframeを挟むため、event.source は送信先iframeと
      // 一致しない。Googleの応答元ドメインと一意なrequestIdで検証する。
      let responseHost = ''
      try { responseHost = new URL(event.origin).hostname } catch { return }
      const isGoogleResponse = responseHost === 'script.google.com' ||
        responseHost === 'googleusercontent.com' || responseHost.endsWith('.googleusercontent.com')
      if (!isGoogleResponse) return
      const message = event.data
      if (!message || message.channel !== 'future-simulator-gas' || message.requestId !== requestId) return
      if (message.ok) finish(resolve, message.result)
      else {
        const error = new Error(message.error || 'GASとの通信に失敗しました。')
        error.code = message.errorCode || ''
        error.details = message.details || null
        finish(reject, error)
      }
    }
    const timeoutId = window.setTimeout(() => {
      finish(reject, new Error('GASから応答がありません。デプロイURL・アクセスキー・通信状態を確認してください。'))
    }, 30000)

    window.addEventListener('message', onMessage)
    document.body.append(iframe, form)
    form.submit()
  })
}
