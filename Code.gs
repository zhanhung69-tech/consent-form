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
      // 5. 重複提交檢查（同學號 + 同活動）
      if (isDuplicateSubmission_(sh, data.student_id, data.activity_id)) {
        return ContentService
          .createTextOutput(JSON.stringify({ ok: false, message: "您已經提交過本活動的同意書，請勿重複簽核。如需更正請聯絡學務處。" }))
          .setMimeType(ContentService.MimeType.JSON);
      }
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
      // 教職員工以姓名+部門當作識別，避免重複報名
      const last = sh.getLastRow();
      if (last >= 2) {
        const data2 = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
        const colA = HEADERS.indexOf("活動ID");
        const colN = HEADERS.indexOf("學生姓名");
        const colC = HEADERS.indexOf("班級");
        const dup = data2.some(r => String(r[colA]) === "A006"
                                  && String(r[colN]).trim() === String(data.student_name).trim()
                                  && String(r[colC]).trim() === normCls);
        if (dup) {
          return ContentService
            .createTextOutput(JSON.stringify({ ok: false, message: "您已報名本活動，請勿重複送出。如需更正請聯絡學務處。" }))
            .setMimeType(ContentService.MimeType.JSON);
        }
      }
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
