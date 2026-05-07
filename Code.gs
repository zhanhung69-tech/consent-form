/* ================================================================
   樹人家商 活動家長同意書 - Google Apps Script (後端)
   部署步驟：
     1. 開啟試算表：
        https://docs.google.com/spreadsheets/d/16WrEJ5RWXaF7LxjQmDE0Xjwc9sCh2W9Ci2jB7Kbas0U/edit
     2. 擴充功能 → Apps Script，貼上本檔全部內容
     3. 執行 setupSheet() 一次（建立表頭）
     4. 部署 → 新增部署作業 → 類型「網頁應用程式」
        - 執行身分：我
        - 存取權：任何人（才能讓家長匿名存取）
     5. 複製 Web App URL，貼入 common.js 的 GAS_ENDPOINT
   ================================================================ */

const SHEET_ID   = "16WrEJ5RWXaF7LxjQmDE0Xjwc9sCh2W9Ci2jB7Kbas0U";
const SHEET_NAME = "簽核紀錄";
const SIG_FOLDER = "家長簽名_樹人家商";     // Google Drive 簽名圖存放資料夾

const HEADERS = [
  "簽核時間戳記","活動ID","活動名稱","班級","座號",
  "學號","學生姓名","家長姓名","家長關係","家長手機",
  "備用電話","特殊體質","藥物過敏","身體狀況",
  "同意意願","交通方式","電子簽名","IP位址","狀態",
  "家長陪同","陪同人數","陪同者姓名"
];

/* ---------- 初始化：建立工作表與表頭 ---------- */
function setupSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);
  sh.clear();
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
    .setFontWeight("bold").setBackground("#1a4d8c").setFontColor("#fff").setHorizontalAlignment("center");
  sh.setFrozenRows(1);
  const widths = [160,70,260,90,60,100,100,90,80,110,110,140,140,140,90,140,200,120,80,80,80,220];
  widths.forEach((w, i) => sh.setColumnWidth(i + 1, w));
  SpreadsheetApp.getUi && SpreadsheetApp.flush();
  Logger.log("表頭建立完成：" + SHEET_NAME);
}

/* ---------- 學號 → 班級推斷（同前端規則） ---------- */
function inferDeptFromStudentId_(sid) {
  if (!/^\d{6}$/.test(String(sid || ""))) return null;
  const s = String(sid);
  const grade = { "2": "三", "3": "二", "4": "一" }[s[0]];
  const dept  = { "1": "商", "2": "資處", "3": "觀", "4": "餐", "5": "幼", "6": "美", "7": "電", "8": "資訊", "9": "影" }[s[2]];
  if (!grade || !dept) return null;
  return dept + grade;
}

/* ---------- 班級正規化（伺服器端，最終把關） ---------- */
function normalizeClass_(cls) {
  if (!cls) return "";
  return String(cls)
    .replace(/^高[一二三12]?/, "")
    .replace(/ㄧ/g, "一")
    .replace(/2/g, "二").replace(/1/g, "一").replace(/3/g, "三")
    .replace(/^幼保(?=[一二三])/, "幼")
    .replace("商科", "商三")
    .replace(/(商|餐|幼|美|資處|資訊|觀|電|影)([一二三])終/, "$1$2忠")
    .trim();
}

/* ---------- 重複偵測：同學號+同活動 ---------- */
function isDuplicateSubmission_(sheet, studentId, activityId) {
  const last = sheet.getLastRow();
  if (last < 2) return false;
  const data = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
  const colA = HEADERS.indexOf("活動ID");
  const colS = HEADERS.indexOf("學號");
  return data.some(r => String(r[colS]) === String(studentId) && String(r[colA]) === String(activityId));
}

/* ---------- 處理家長 POST 送出 ---------- */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss   = SpreadsheetApp.openById(SHEET_ID);
    const sh   = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);

    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
        .setFontWeight("bold").setBackground("#1a4d8c").setFontColor("#fff");
      sh.setFrozenRows(1);
    }

    /* ---------- 伺服器端驗證 + 正規化 ---------- */
    const isStaff = String(data.activity_id || "") === "A006";
    let normCls;

    if (!isStaff) {
      // 1. 學號格式
      if (!/^\d{6}$/.test(String(data.student_id || ""))) {
        return ContentService
          .createTextOutput(JSON.stringify({ ok: false, message: "學號格式錯誤：請填寫 6 位數字。" }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      // 2. 家長姓名 ≠ 學生姓名
      if (data.parent_name && data.student_name && String(data.parent_name).trim() === String(data.student_name).trim()) {
        return ContentService
          .createTextOutput(JSON.stringify({ ok: false, message: "家長姓名不可與學生姓名相同，請由家長親自填寫。" }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      // 3. 班級正規化
      normCls = normalizeClass_(data.class);
      if (!normCls) {
        return ContentService
          .createTextOutput(JSON.stringify({ ok: false, message: "班級欄位不可為空。" }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      // 4. 班級與學號科別是否一致
      const expected = inferDeptFromStudentId_(data.student_id);
      if (expected) {
        const isAmbigZ = /^資[一二三]/.test(normCls) && !normCls.startsWith("資處") && !normCls.startsWith("資訊");
        const isExpZ   = expected.indexOf("資處") === 0 || expected.indexOf("資訊") === 0;
        if (!normCls.startsWith(expected) && !(isAmbigZ && isExpZ)) {
          return ContentService
            .createTextOutput(JSON.stringify({ ok: false, message: `班級「${data.class}」與學號 ${data.student_id} 推斷的「${expected}」不一致。` }))
            .setMimeType(ContentService.MimeType.JSON);
        }
      }
      // 5. 重複提交檢查 — 已暫時停用以允許家長補填親友資訊
      //    舊資料保留為歷史，後續以 mergeDuplicates() 一鍵合併（保留最新版）
      // if (isDuplicateSubmission_(sh, data.student_id, data.activity_id)) {
      //   return ContentService
      //     .createTextOutput(JSON.stringify({ ok: false, message: "您已經提交過本活動的同意書，請勿重複簽核。如需更正請聯絡學務處。" }))
      //     .setMimeType(ContentService.MimeType.JSON);
      // }
    } else {
      /* ---------- A006 教職員工：簡化驗證 ---------- */
      if (!String(data.student_name || "").trim()) {
        return ContentService
          .createTextOutput(JSON.stringify({ ok: false, message: "請填寫姓名。" }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      normCls = String(data.class || "").trim();
      if (!normCls) {
        return ContentService
          .createTextOutput(JSON.stringify({ ok: false, message: "請填寫單位／部門。" }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      if (!/^09\d{8}$/.test(String(data.parent_phone || ""))) {
        return ContentService
          .createTextOutput(JSON.stringify({ ok: false, message: "聯絡手機格式錯誤：請填寫 09 開頭共 10 碼。" }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      // 教職員工重複偵測 — 已暫時停用以允許補填家屬資訊
      // 舊資料保留為歷史，後續以 mergeDuplicates() 一鍵合併
    }

    const sigUrl = saveSignature(data.signature_image, data.activity_id, data.student_id, data.student_name);
    const ts     = Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-MM-dd HH:mm:ss");
    const ip     = (e.parameter && e.parameter.ip) || "";

    const row = [
      ts,
      data.activity_id       || "",
      data.activity_name     || "",
      normCls,
      data.seat              || "",
      data.student_id        || "",
      data.student_name      || "",
      data.parent_name       || "",
      data.relation          || "",
      data.parent_phone      || "",
      data.backup_phone      || "",
      data.health_condition  || "",
      data.allergy           || "",
      data.recent_status     || "",
      data.consent           || "",
      data.transport         || "",
      sigUrl                 || "",
      ip,
      "已簽核",
      data.parent_accompany  || "否",
      data.accompany_count   || "",
      data.accompany_names   || ""
    ];
    sh.appendRow(row);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, message: "簽核完成", normalizedClass: normCls }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    Logger.log("doPost error: " + err);
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, message: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/* ---------- 簽名圖：Base64 → Drive ---------- */
function saveSignature(dataUrl, activityId, studentId, studentName) {
  if (!dataUrl || dataUrl.indexOf("base64,") < 0) return "";
  const base64 = dataUrl.split("base64,")[1];
  const bytes  = Utilities.base64Decode(base64);
  const ts     = Utilities.formatDate(new Date(), "Asia/Taipei", "yyyyMMdd_HHmmss");
  const name   = `${activityId}_${studentId}_${studentName}_${ts}.png`;
  const blob   = Utilities.newBlob(bytes, "image/png", name);

  const folder = getOrCreateFolder(SIG_FOLDER);
  const file   = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

function getOrCreateFolder(name) {
  const it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}

/* ---------- 部署測試：瀏覽器直接開 Web App URL 會看到此訊息 ---------- */
function doGet() {
  return ContentService.createTextOutput(
    "樹人家商 活動家長同意書 簽核 API 運作中 — " +
    Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-MM-dd HH:mm:ss")
  );
}

/* ================================================================
   試算表選單：開啟時自動建立「🔧 系統管理」選單
   ================================================================ */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("🔧 系統管理")
    .addItem("📊 統計各活動簽核人數",  "showActivityStats")
    .addSeparator()
    .addItem("🔍 預覽重複資料（不修改）", "previewDuplicates")
    .addItem("🔄 合併重複資料（保留最新+親友資訊）", "mergeDuplicates")
    .addSeparator()
    .addItem("📦 將「已合併」舊列移至備份分頁", "archiveMergedRows")
    .addToUi();
}

/* ---------- 取得所有資料列（含表頭索引） ---------- */
function _getAllRows_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName(SHEET_NAME);
  if (!sh || sh.getLastRow() < 2) return { sh: sh, rows: [], idx: {} };
  const rng  = sh.getRange(1, 1, sh.getLastRow(), HEADERS.length);
  const all  = rng.getValues();
  const head = all[0];
  const idx = {};
  HEADERS.forEach(h => { idx[h] = head.indexOf(h); });
  const rows = all.slice(1).map((r, i) => ({ rowNum: i + 2, data: r }));
  return { sh: sh, rows: rows, idx: idx };
}

/* ---------- 產生分組鍵：學生用「學號+活動」、A006 用「姓名+部門+活動」 ---------- */
function _groupKey_(row, idx) {
  const aid = String(row.data[idx["活動ID"]] || "").trim();
  if (aid === "A006") {
    return `A006|${String(row.data[idx["學生姓名"]] || "").trim()}|${String(row.data[idx["班級"]] || "").trim()}`;
  }
  return `${aid}|${String(row.data[idx["學號"]] || "").trim()}`;
}

/* ---------- 統計各活動簽核人數（含親友統計） ---------- */
function showActivityStats() {
  const { rows, idx } = _getAllRows_();
  const stats = {};   // {活動ID: {total, agree, accompany, accompanyPeople}}
  rows.forEach(r => {
    if (String(r.data[idx["狀態"]] || "").indexOf("已合併") >= 0) return; // 跳過舊版
    const aid = String(r.data[idx["活動ID"]] || "").trim();
    if (!aid) return;
    if (!stats[aid]) stats[aid] = { total:0, agree:0, accompany:0, people:0 };
    stats[aid].total++;
    if (String(r.data[idx["同意意願"]] || "") === "同意") stats[aid].agree++;
    if (String(r.data[idx["家長陪同"]] || "") === "是") {
      stats[aid].accompany++;
      const cntStr = String(r.data[idx["陪同人數"]] || "");
      const m = cntStr.match(/(\d+)/);
      stats[aid].people += m ? parseInt(m[1], 10) : 0;
    }
  });
  let msg = "📊 各活動簽核統計（已扣除已合併舊版）\n\n";
  Object.keys(stats).sort().forEach(aid => {
    const s = stats[aid];
    msg += `【${aid}】\n　簽核總數：${s.total}　同意：${s.agree}\n　親友陪同戶數：${s.accompany}　陪同總人數約：${s.people} 人\n\n`;
  });
  SpreadsheetApp.getUi().alert(msg);
}

/* ---------- 預覽重複資料（不修改） ---------- */
function previewDuplicates() {
  const { rows, idx } = _getAllRows_();
  const groups = {};
  rows.forEach(r => {
    if (String(r.data[idx["狀態"]] || "").indexOf("已合併") >= 0) return;
    const k = _groupKey_(r, idx);
    if (!groups[k]) groups[k] = [];
    groups[k].push(r);
  });
  const dups = Object.entries(groups).filter(([_, arr]) => arr.length > 1);
  if (dups.length === 0) {
    SpreadsheetApp.getUi().alert("✓ 目前沒有重複資料。");
    return;
  }
  let msg = `🔍 找到 ${dups.length} 組重複資料：\n\n`;
  dups.slice(0, 20).forEach(([k, arr]) => {
    msg += `【${k}】共 ${arr.length} 筆\n`;
    arr.forEach(r => {
      msg += `　第 ${r.rowNum} 列：${r.data[idx["簽核時間戳記"]]}　${r.data[idx["學生姓名"]]}　陪同：${r.data[idx["家長陪同"]] || "—"}\n`;
    });
    msg += "\n";
  });
  if (dups.length > 20) msg += `\n（僅顯示前 20 組，共 ${dups.length} 組）`;
  msg += "\n按下「合併重複資料」可一鍵清理。";
  SpreadsheetApp.getUi().alert(msg);
}

/* ---------- 合併重複資料：保留最新+親友資訊 ---------- */
function mergeDuplicates() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.alert(
    "確認執行合併？",
    "將把同一人多筆簽核合併為一筆：\n" +
    "• 主資料以「最新一筆」為準\n" +
    "• 若舊筆有「家長陪同=是」、新筆=否，則保留「是」與陪同資訊\n" +
    "• 舊筆會在「狀態」欄標記為「已合併到第 X 列」\n" +
    "• 不刪除任何資料，僅標記。",
    ui.ButtonSet.OK_CANCEL
  );
  if (resp !== ui.Button.OK) return;

  const { sh, rows, idx } = _getAllRows_();
  const groups = {};
  rows.forEach(r => {
    if (String(r.data[idx["狀態"]] || "").indexOf("已合併") >= 0) return; // 跳過已處理
    const k = _groupKey_(r, idx);
    if (!groups[k]) groups[k] = [];
    groups[k].push(r);
  });

  const tsCol = idx["簽核時間戳記"];
  const accCol = idx["家長陪同"];
  const accCntCol = idx["陪同人數"];
  const accNamesCol = idx["陪同者姓名"];
  const stateCol = idx["狀態"];

  let mergedGroups = 0;
  let markedRows   = 0;

  Object.values(groups).forEach(arr => {
    if (arr.length < 2) return;
    // 依時間戳記排序，最新者在最後
    arr.sort((a,b) => new Date(a.data[tsCol]) - new Date(b.data[tsCol]));
    const latest = arr[arr.length - 1];

    // 檢查舊筆是否有 親友資訊 比 latest 完整
    if (String(latest.data[accCol] || "") !== "是") {
      const acc = arr.slice(0, -1).reverse().find(r => String(r.data[accCol] || "") === "是");
      if (acc) {
        // 把舊筆的親友資訊複製到 latest
        sh.getRange(latest.rowNum, accCol + 1).setValue(acc.data[accCol]);
        sh.getRange(latest.rowNum, accCntCol + 1).setValue(acc.data[accCntCol]);
        sh.getRange(latest.rowNum, accNamesCol + 1).setValue(acc.data[accNamesCol]);
      }
    }
    // 將舊筆狀態改為「已合併」
    arr.slice(0, -1).forEach(r => {
      sh.getRange(r.rowNum, stateCol + 1).setValue(`已合併到第 ${latest.rowNum} 列`);
      sh.getRange(r.rowNum, 1, 1, HEADERS.length).setBackground("#f3f4f6").setFontColor("#9ca3af");
      markedRows++;
    });
    mergedGroups++;
  });

  ui.alert(`✓ 合併完成\n\n合併組數：${mergedGroups}\n標記為「已合併」的舊列數：${markedRows}\n\n（舊列以灰色淡化顯示但未刪除）`);
}

/* ---------- 將「已合併」舊列移至備份分頁 ---------- */
function archiveMergedRows() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.alert(
    "確認執行歸檔？",
    "會把所有「狀態」為「已合併到第 X 列」的舊列搬到「歷史備份」分頁，主表只保留現行有效資料。",
    ui.ButtonSet.OK_CANCEL
  );
  if (resp !== ui.Button.OK) return;

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName(SHEET_NAME);
  let archive = ss.getSheetByName("歷史備份");
  if (!archive) {
    archive = ss.insertSheet("歷史備份");
    archive.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight("bold").setBackground("#9ca3af").setFontColor("#fff");
    archive.setFrozenRows(1);
  }

  const last = sh.getLastRow();
  if (last < 2) { ui.alert("無資料可歸檔。"); return; }
  const all = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
  const stateCol = HEADERS.indexOf("狀態");

  const toArchive = [];
  const toKeep    = [];
  all.forEach(r => {
    if (String(r[stateCol] || "").indexOf("已合併") >= 0) toArchive.push(r);
    else toKeep.push(r);
  });

  if (toArchive.length === 0) { ui.alert("沒有「已合併」的列可歸檔。"); return; }

  // 把 archived rows 寫到歷史備份
  archive.getRange(archive.getLastRow() + 1, 1, toArchive.length, HEADERS.length).setValues(toArchive);

  // 重寫主表：只保留有效列
  sh.getRange(2, 1, last - 1, HEADERS.length).clearContent().setBackground(null).setFontColor(null);
  if (toKeep.length > 0) {
    sh.getRange(2, 1, toKeep.length, HEADERS.length).setValues(toKeep);
  }

  ui.alert(`✓ 歸檔完成\n\n搬到「歷史備份」：${toArchive.length} 列\n主表保留：${toKeep.length} 列`);
}
