/**
 * 未来シミュレーター v1.5.9 - Google Apps Script 保存API
 *
 * 既存の SimulatorData シート（A:C）は維持し、D列にrevision、
 * E列にschemaVersionを追加する。既存行のrevisionが空欄なら1として扱う。
 *
 * 保存時はexpectedRevisionによる楽観ロックを行い、
 * 上書き前のデータをSimulatorHistoryへ退避する。
 */
const SPREADSHEET_ID = 'ここにスプレッドシートIDを設定';
const ACCESS_TOKEN = 'ここに32文字以上のランダムなアクセスキーを設定';
const SHEET_NAME = 'SimulatorData';
const HISTORY_SHEET_NAME = 'SimulatorHistory';
const CHANNEL = 'future-simulator-gas';
const DATA_SCHEMA_VERSION = 1;

function doPost(e) {
  const params = (e && e.parameter) || {};
  const requestId = String(params.requestId || '');
  try {
    if (!ACCESS_TOKEN || ACCESS_TOKEN.indexOf('ここに') === 0 || ACCESS_TOKEN.length < 12) {
      throw new Error('GASのACCESS_TOKENが未設定です。');
    }
    if (String(params.accessToken || '') !== ACCESS_TOKEN) throw new Error('アクセスキーが一致しません。');
    const householdId = String(params.householdId || '').trim();
    if (!householdId) throw new Error('世帯IDが指定されていません。');

    let result;
    const action = String(params.action || '');
    if (action === 'save') {
      const payload = JSON.parse(String(params.payload || ''));
      validateHousehold_(payload);
      if (String(payload.household.householdId) !== householdId) throw new Error('世帯IDがデータと一致しません。');
      const expectedRevision = Number(params.expectedRevision);
      if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
        throw new Error('保存前のクラウド版番号が不正です。アプリを更新してください。');
      }
      result = saveHousehold_(householdId, payload, expectedRevision);
    } else if (action === 'load') {
      result = loadHousehold_(householdId);
    } else if (action === 'status') {
      result = getHouseholdStatus_(householdId);
    } else {
      throw new Error('未対応の操作です。');
    }
    return response_(requestId, true, result, '', '', null);
  } catch (error) {
    return response_(
      requestId,
      false,
      null,
      error && error.message ? error.message : String(error),
      error && error.code ? error.code : '',
      error && error.details ? error.details : null
    );
  }
}

function validateHousehold_(data) {
  if (!data || typeof data !== 'object' || !data.household || typeof data.household !== 'object') {
    throw new Error('世帯データの形式が正しくありません。');
  }
  ['persons', 'incomeRecords', 'expenseRecords', 'assets', 'liabilities', 'futureEvents'].forEach(function(key) {
    if (!Array.isArray(data[key])) throw new Error(key + 'のデータ形式が正しくありません。');
  });
  if (!data.conditions || typeof data.conditions !== 'object') throw new Error('試算条件がありません。');
}

function getSheet_() {
  if (!SPREADSHEET_ID || SPREADSHEET_ID.indexOf('ここに') === 0) throw new Error('GASのSPREADSHEET_IDが未設定です。');
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, 5).setValues([['世帯ID', 'データJSON', '更新日時', 'revision', 'schemaVersion']]);
    sheet.setFrozenRows(1);
  } else {
    // 旧A:C構成を維持しながら、新しいメタデータ列だけ追加する。
    sheet.getRange(1, 1, 1, 5).setValues([['世帯ID', 'データJSON', '更新日時', 'revision', 'schemaVersion']]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getHistorySheet_() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = spreadsheet.getSheetByName(HISTORY_SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(HISTORY_SHEET_NAME);
    sheet.appendRow(['世帯ID', 'revision', '退避日時', '元の更新日時', 'データJSON']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function findHouseholdRow_(sheet, householdId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues().flat();
  const index = ids.indexOf(householdId);
  return index >= 0 ? index + 2 : 0;
}

function getRecordAtRow_(sheet, row) {
  if (!row) return null;
  const values = sheet.getRange(row, 1, 1, 5).getValues()[0];
  const dataText = String(values[1] || '');
  const data = dataText ? JSON.parse(dataText) : null;
  const savedAt = values[2] instanceof Date
    ? values[2].toISOString()
    : (values[2] ? new Date(values[2]).toISOString() : null);
  // 旧バージョンの行にはrevision列がないため、初期値を1とする。
  const revision = Number(values[3]) > 0 ? Number(values[3]) : 1;
  return {
    householdId: String(values[0] || ''),
    data: data,
    savedAt: savedAt,
    revision: revision,
    schemaVersion: Number(values[4]) || 0
  };
}

function getHouseholdStatus_(householdId) {
  const sheet = getSheet_();
  const row = findHouseholdRow_(sheet, householdId);
  const record = getRecordAtRow_(sheet, row);
  return record
    ? { householdId: householdId, exists: true, revision: record.revision, savedAt: record.savedAt }
    : { householdId: householdId, exists: false, revision: 0, savedAt: null };
}

function saveHousehold_(householdId, data, expectedRevision) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = getSheet_();
    const row = findHouseholdRow_(sheet, householdId);
    const current = getRecordAtRow_(sheet, row);
    const currentRevision = current ? current.revision : 0;

    if (currentRevision !== expectedRevision) {
      const conflict = new Error(
        'クラウドデータが別の更新で変更されています。クラウド状態を再確認し、読み込みまたは明示的な上書きを選んでください。'
      );
      conflict.code = 'CLOUD_CONFLICT';
      conflict.details = {
        currentRevision: currentRevision,
        currentSavedAt: current ? current.savedAt : null
      };
      throw conflict;
    }

    // 既存データは上書き前に履歴シートへ退避する。
    if (current && current.data) {
      const history = getHistorySheet_();
      history.appendRow([
        householdId,
        current.revision,
        new Date(),
        current.savedAt ? new Date(current.savedAt) : '',
        JSON.stringify(current.data)
      ]);
    }

    const newRevision = currentRevision + 1;
    const savedAt = new Date();
    const values = [
      householdId,
      JSON.stringify(data),
      savedAt,
      newRevision,
      DATA_SCHEMA_VERSION
    ];
    if (row) sheet.getRange(row, 1, 1, 5).setValues([values]);
    else sheet.appendRow(values);

    return {
      householdId: householdId,
      revision: newRevision,
      previousRevision: currentRevision,
      savedAt: savedAt.toISOString()
    };
  } finally {
    lock.releaseLock();
  }
}

function loadHousehold_(householdId) {
  const sheet = getSheet_();
  const row = findHouseholdRow_(sheet, householdId);
  const record = getRecordAtRow_(sheet, row);
  if (!record || !record.data) return null;
  validateHousehold_(record.data);
  return {
    householdId: householdId,
    data: record.data,
    revision: record.revision,
    savedAt: record.savedAt
  };
}

function response_(requestId, ok, result, error, errorCode, details) {
  const message = {
    channel: CHANNEL,
    requestId: requestId,
    ok: ok,
    result: result,
    error: error,
    errorCode: errorCode || '',
    details: details || null
  };
  const safeJson = JSON.stringify(message).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  const html = '<!doctype html><html><head><meta charset="utf-8"></head><body><script>' +
    'window.top.postMessage(' + safeJson + ', "*");' +
    '</script></body></html>';
  return HtmlService.createHtmlOutput(html).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function setupCheck() {
  const sheet = getSheet_();
  Logger.log('接続先: ' + sheet.getParent().getName() + ' / ' + sheet.getName());
}
