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
  "同意意願","交通方式","電子簽名","IP位址","狀態"
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
  const widths = [160,70,260,90,60,100,100,90,80,110,110,140,140,140,90,140,200,120,80];
  widths.forEach((w, i) => sh.setColumnWidth(i + 1, w));
  SpreadsheetApp.getUi && SpreadsheetApp.flush();
  Logger.log("表頭建立完成：" + SHEET_NAME);
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

    const sigUrl = saveSignature(data.signature_image, data.activity_id, data.student_id, data.student_name);
    const ts     = Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-MM-dd HH:mm:ss");
    const ip     = (e.parameter && e.parameter.ip) || "";

    const row = [
      ts,
      data.activity_id       || "",
      data.activity_name     || "",
      data.class             || "",
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
      "已簽核"
    ];
    sh.appendRow(row);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, message: "簽核完成" }))
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
