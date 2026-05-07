/**
 * 家長同意書 - 異常資料掃描 / 自動清理
 * 適用：各項活動-家長同意書 (Sheet ID: 16WrEJ5RWXaF7LxjQmDE0Xjwc9sCh2W9Ci2jB7Kbas0U)
 *
 * 使用方式（加入既有 Apps Script 專案）：
 *   1. 開啟試算表 → 擴充功能 → Apps Script（會打開既有的 Code.gs 專案）
 *   2. 左側「檔案」➕ → 指令碼 → 命名為「cleanup」
 *   3. 把預設的 `function myFunction(){}` 全刪，貼上本檔案全部內容，存檔
 *   4. 重新整理試算表，會多一個「🔧 異常清理」選單
 *   5. 第一次使用，建議先按「① 掃描異常（不修改）」產出報告
 *   6. 確認沒問題後，依序執行「② 修正班級寫法」「③ 刪除重複/班級錯誤」
 *
 * 與 Code.gs 共存：
 *   - 本檔的 onOpen 會在試算表開啟時觸發（既有 Code.gs 沒有 onOpen，不衝突）
 *   - 本檔的 mapClass / normalizeClass 函數名稱與 Code.gs 的 inferDeptFromStudentId_ / normalizeClass_ 不同，不衝突
 *
 * 作者：學務處 / 2026-05-06
 */

// ============ 設定 ============
const CONFIG = {
  DATA_SHEET_NAME: '簽核紀錄',  // ★ 與 Code.gs 的 SHEET_NAME 一致
  REPORT_SHEET_NAME: '_異常掃描報告',  // 自動產生的報告分頁
  COL: {
    時間: 1, 活動ID: 2, 活動名稱: 3, 班級: 4, 座號: 5, 學號: 6, 姓名: 7,
    家長: 8, 關係: 9, 手機: 10, 備用: 11, 體質: 12, 藥物: 13, 身體: 14,
    同意: 15, 交通: 16, 簽名: 17, IP: 18, 狀態: 19,
  },
};

// ============ 選單 ============
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🔧 異常清理')
    .addItem('① 掃描異常（不修改）', 'menuScan')
    .addSeparator()
    .addItem('② 修正班級寫法（去掉高X、注音→國字、錯字）', 'menuFixClassFormat')
    .addItem('③ 刪除重複提交 + 班級錯誤 + 學號錯誤', 'menuDeleteAnomalies')
    .addSeparator()
    .addItem('🔁 一鍵全部處理（先確認）', 'menuRunAll')
    .addToUi();
}

// ============ 學號 → 班級 對應 ============
function mapClass(學號) {
  if (!學號 || !/^\d{6}$/.test(String(學號))) return null;
  const s = String(學號);
  // 樹人家商學號: 第1碼=年級(2三/3二/4一)，第3碼=科
  const grade = {'2': '三', '3': '二', '4': '一'}[s[0]];
  const dept = {'1': '商', '2': '資處', '3': '觀', '4': '餐', '5': '幼', '6': '美', '7': '電', '8': '資訊', '9': '影'}[s[2]];
  if (!grade || !dept) return null;
  return `${dept}${grade}`;
}

// ============ 班級正規化 ============
function normalizeClass(cls) {
  if (!cls) return '';
  return String(cls)
    .replace(/^高[一二三12]?/, '')
    .replace(/ㄧ/g, '一')
    .replace(/2/g, '二').replace(/1/g, '一').replace(/3/g, '三')
    .replace(/^幼保/, '幼')
    .replace('商科', '商三')
    .replace('商二終', '商二忠')
    .replace('商三終', '商三忠');
}

// ============ 核心：掃描異常 ============
function scanAnomalies() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.DATA_SHEET_NAME) || ss.getSheets()[0];
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return { total: 0, dup: [], mismatch: [], format: [], incomplete: [], dataErr: [] };

  const header = data[0];
  const rows = data.slice(1);
  const c = CONFIG.COL;

  const issues = { dup: [], mismatch: [], format: [], incomplete: [], dataErr: [] };
  const seen = new Map();

  rows.forEach((r, idx) => {
    const rowNum = idx + 2;  // 試算表實際列號（含表頭）
    const time = r[c.時間 - 1];
    const act = r[c.活動ID - 1];
    const cls = String(r[c.班級 - 1] || '');
    const seat = r[c.座號 - 1];
    const sid = String(r[c.學號 - 1] || '');
    const name = String(r[c.姓名 - 1] || '');
    const parent = String(r[c.家長 - 1] || '');
    const 體質 = String(r[c.體質 - 1] || '').trim();
    const 藥物 = String(r[c.藥物 - 1] || '').trim();
    const 身體 = String(r[c.身體 - 1] || '').trim();

    // 1. 重複提交（學號+活動）
    const key = `${sid}|${act}`;
    if (seen.has(key)) {
      issues.dup.push({ 列號: rowNum, 簽核時間: time, 活動: act, 班級: cls, 學號: sid, 姓名: name, 與第幾列重複: seen.get(key) });
    } else {
      seen.set(key, rowNum);
    }

    // 2. 班級與學號不符
    const expected = mapClass(sid);
    if (expected) {
      let normCls = normalizeClass(cls);
      // 「資一」可能是資處一或資訊一，由學號決定
      const isAmbigZ = /^資[一二三]/.test(normCls) && !/^資處/.test(normCls) && !/^資訊/.test(normCls);
      const isExpectedZ = expected.startsWith('資處') || expected.startsWith('資訊');
      if (!(isAmbigZ && isExpectedZ) && !normCls.startsWith(expected)) {
        issues.mismatch.push({ 列號: rowNum, 簽核時間: time, 活動: act, 班級: cls, 學號: sid, 姓名: name, 應為: expected });
      }
    }

    // 3. 班級寫法不規範（不影響身分，可批量修正）
    const fmtReasons = [];
    if (/^高[一二三12]/.test(cls)) fmtReasons.push('多餘「高X」前綴');
    if (/ㄧ/.test(cls)) fmtReasons.push('注音「ㄧ」→國字「一」');
    if (/[12]/.test(cls)) fmtReasons.push('阿拉伯數字→國字');
    if (cls === '商二終' || cls === '商三終') fmtReasons.push('錯字「終」→「忠」');
    if (cls === '幼保一忠') fmtReasons.push('「幼保一忠」→「幼一忠」');
    if (fmtReasons.length > 0) {
      const after = normalizeClass(cls);
      issues.format.push({ 列號: rowNum, 簽核時間: time, 活動: act, 原班級: cls, 應改為: after, 學生: name, 問題: fmtReasons.join('、') });
    }

    // 4. 必填欄位空白
    const empty = [];
    if (!體質) empty.push('特殊體質');
    if (!藥物) empty.push('藥物過敏');
    if (!身體) empty.push('身體狀況');
    if (empty.length > 0) {
      issues.incomplete.push({ 列號: rowNum, 簽核時間: time, 活動: act, 班級: cls, 學生: name, 空白欄位: empty.join('、') });
    }

    // 5. 學號/家長資料錯誤
    const errs = [];
    if (sid && !/^\d{6}$/.test(sid)) errs.push(`學號異常「${sid}」(非 6 位數)`);
    if (parent && parent === name) errs.push('家長姓名 = 學生姓名');
    if (errs.length > 0) {
      issues.dataErr.push({ 列號: rowNum, 簽核時間: time, 活動: act, 班級: cls, 學號: sid, 姓名: name, 家長: parent, 問題: errs.join('；') });
    }
  });

  return { total: rows.length, ...issues };
}

// ============ ① 掃描（產出報告分頁） ============
function menuScan() {
  const result = scanAnomalies();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let report = ss.getSheetByName(CONFIG.REPORT_SHEET_NAME);
  if (report) ss.deleteSheet(report);
  report = ss.insertSheet(CONFIG.REPORT_SHEET_NAME);

  let row = 1;
  const ts = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
  report.getRange(row++, 1).setValue(`異常掃描報告 (掃描時間: ${ts})`).setFontWeight('bold').setFontSize(14);
  report.getRange(row++, 1).setValue(`總筆數: ${result.total}`);
  report.getRange(row++, 1, 1, 2).setValues([[
    `重複提交: ${result.dup.length} 筆 / 班級錯誤: ${result.mismatch.length} 筆 / 班級寫法不規範: ${result.format.length} 筆 / 必填空白: ${result.incomplete.length} 筆 / 學號家長錯: ${result.dataErr.length} 筆`,
    ''
  ]]);
  row++;

  function writeBlock(title, items, headers) {
    report.getRange(row, 1).setValue(`【${title}】共 ${items.length} 筆`).setFontWeight('bold').setBackground('#1F4E79').setFontColor('#fff');
    report.getRange(row, 1, 1, headers.length).merge();
    row++;
    if (items.length === 0) {
      report.getRange(row++, 1).setValue('  （無）').setFontColor('#888');
      row++; return;
    }
    report.getRange(row, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#D9E2F3');
    row++;
    const matrix = items.map(o => headers.map(h => o[h] !== undefined ? o[h] : ''));
    report.getRange(row, 1, matrix.length, headers.length).setValues(matrix);
    row += matrix.length + 1;
  }

  writeBlock('① 重複提交（保留最早一筆，刪餘）', result.dup, ['列號','簽核時間','活動','班級','學號','姓名','與第幾列重複']);
  writeBlock('② 班級與學號不符（建議刪除讓學生重交）', result.mismatch, ['列號','簽核時間','活動','班級','學號','姓名','應為']);
  writeBlock('③ 班級寫法不規範（自動修正）', result.format, ['列號','簽核時間','活動','原班級','應改為','學生','問題']);
  writeBlock('④ 必填欄位空白（請學生補填）', result.incomplete, ['列號','簽核時間','活動','班級','學生','空白欄位']);
  writeBlock('⑤ 學號/家長資料錯誤（建議刪除讓學生重交）', result.dataErr, ['列號','簽核時間','活動','班級','學號','姓名','家長','問題']);

  report.autoResizeColumns(1, 8);
  report.setFrozenRows(4);
  ss.setActiveSheet(report);

  SpreadsheetApp.getUi().alert(
    `掃描完成\n\n` +
    `總筆數: ${result.total}\n` +
    `重複提交: ${result.dup.length}\n` +
    `班級錯誤: ${result.mismatch.length}\n` +
    `班級寫法不規範: ${result.format.length}\n` +
    `必填空白: ${result.incomplete.length}\n` +
    `學號/家長錯誤: ${result.dataErr.length}\n\n` +
    `詳細請看「${CONFIG.REPORT_SHEET_NAME}」分頁。`
  );
}

// ============ ② 修正班級寫法 ============
function menuFixClassFormat() {
  const ui = SpreadsheetApp.getUi();
  const result = scanAnomalies();
  if (result.format.length === 0) {
    ui.alert('沒有需要修正的班級寫法。');
    return;
  }
  const resp = ui.alert(
    `將自動修正 ${result.format.length} 筆班級寫法\n（去掉「高X」前綴、注音→國字、錯字修正）\n\n是否繼續？`,
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.DATA_SHEET_NAME) || ss.getSheets()[0];
  result.format.forEach(item => {
    sheet.getRange(item.列號, CONFIG.COL.班級).setValue(item.應改為);
  });
  ui.alert(`已修正 ${result.format.length} 筆班級寫法。`);
}

// ============ ③ 刪除異常筆 ============
function menuDeleteAnomalies() {
  const ui = SpreadsheetApp.getUi();
  const result = scanAnomalies();
  // 合併要刪除的列號（去重，由大到小排序，從尾巴刪才不會錯位）
  const toDelete = new Set();
  result.dup.forEach(x => toDelete.add(x.列號));
  result.mismatch.forEach(x => toDelete.add(x.列號));
  result.dataErr.forEach(x => toDelete.add(x.列號));

  if (toDelete.size === 0) {
    ui.alert('沒有需要刪除的異常筆。');
    return;
  }

  const sortedRows = [...toDelete].sort((a, b) => b - a);
  const resp = ui.alert(
    `將刪除 ${sortedRows.length} 筆異常資料\n` +
    `（重複 ${result.dup.length} + 班級錯 ${result.mismatch.length} + 學號家長錯 ${result.dataErr.length}）\n\n` +
    `刪除後，請通知對應學生重新填寫表單。\n\n是否繼續？`,
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.DATA_SHEET_NAME) || ss.getSheets()[0];
  sortedRows.forEach(rowNum => sheet.deleteRow(rowNum));
  ui.alert(`已刪除 ${sortedRows.length} 筆異常資料。`);
}

// ============ 一鍵全部處理 ============
function menuRunAll() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.alert(
    `將依序執行：\n  ① 掃描\n  ② 修正班級寫法\n  ③ 刪除重複/錯誤筆\n\n建議先單獨執行 ①「掃描異常」確認後再使用此功能。\n\n是否繼續？`,
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;
  menuScan();
  Utilities.sleep(500);
  menuFixClassFormat();
  Utilities.sleep(500);
  menuDeleteAnomalies();
}
