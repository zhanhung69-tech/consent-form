# 樹人家商 活動家長同意書 線上簽核系統

## 檔案結構

```
活動家長同意書線上簽核/
├── index.html                      # 首頁：四個活動入口
├── A001_原住民戶外探索.html          # 活動 1 同意書
├── A002_身障運動會伴舞.html          # 活動 2 同意書
├── A003_身障運動會禮賓.html          # 活動 3 同意書
├── A004_身障運動會觀眾席.html        # 活動 4 同意書
├── common.js                       # 共用前端（簽名板 + 送出）
├── Code.gs                         # Google Apps Script 後端
└── README_部署說明.md               # 本文件
```

## 部署步驟

### 1. 設定 Google Apps Script（後端）

1. 開啟目標試算表：
   https://docs.google.com/spreadsheets/d/16WrEJ5RWXaF7LxjQmDE0Xjwc9sCh2W9Ci2jB7Kbas0U/edit
2. 選單列：**擴充功能 → Apps Script**
3. 將 `Code.gs` 全部內容貼到編輯器，儲存
4. 左側執行 `setupSheet` 函式一次（建立「簽核紀錄」工作表及表頭）
5. 右上角 **部署 → 新增部署作業**
   - 類型：**網頁應用程式**
   - 執行身分：**我**
   - 存取權：**任何人**（家長需匿名存取）
6. 複製「網頁應用程式 URL」

### 2. 設定前端

打開 `common.js`，將第 8 行：

```js
const GAS_ENDPOINT = "https://script.google.com/macros/s/AKfycbxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/exec";
```

換成剛剛複製的 Web App URL。

### 3. 發佈

將整個資料夾上傳至以下任一位置，將網址／QR Code 發給家長：

- 學校網頁伺服器
- GitHub Pages（免費）
- Netlify / Vercel（免費）
- Google 雲端硬碟（開「查看權限」，以 https://drive.google.com/... 分享）

## 資料流

```
家長 → 點擊連結 → 打開活動頁 → 填表 + 簽名 → 送出
                                            │
                                            ▼
                        GAS Web App （Code.gs doPost）
                                            │
               ┌────────────────────────────┼────────────────────┐
               ▼                                                  ▼
  Google Drive：簽名 PNG 圖檔              Google 試算表：一列簽核紀錄
  （資料夾「家長簽名_樹人家商」）                    （19 欄依規格）
```

## 試算表欄位（依您的規格）

| # | 欄位 |
|---|------|
| 1 | 簽核時間戳記 |
| 2 | 活動 ID |
| 3 | 活動名稱 |
| 4 | 班級 |
| 5 | 座號 |
| 6 | 學號 |
| 7 | 學生姓名 |
| 8 | 家長姓名 |
| 9 | 家長關係 |
| 10 | 家長手機 |
| 11 | 備用電話 |
| 12 | 特殊體質 |
| 13 | 藥物過敏 |
| 14 | 身體狀況 |
| 15 | 同意意願 |
| 16 | 交通方式 |
| 17 | 電子簽名（Drive 圖片連結） |
| 18 | IP 位址 |
| 19 | 狀態 |

## 測試方式

1. 本機雙擊 `index.html` 即可預覽四張表
2. 實際送出前務必先完成上面步驟 1、2，否則會送出失敗
3. 部署後請先自己測送一筆，確認試算表有寫入、簽名圖有出現於 Drive

## 客製化調整

- **欄位增減**：改 `Code.gs` 的 `HEADERS` 與 `row`，同步改 HTML 表單
- **顏色主題**：各活動 HTML 頂部 `<style>` 內的漸層色可調整
- **簽核截止提醒**：可加入 `setupTrigger()` + `MailApp.sendEmail()` 做到期通知
