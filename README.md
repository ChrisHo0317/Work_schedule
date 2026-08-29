# 班表小幫手

拍下（或上傳）班表照片，在瀏覽器內自動辨識文字並整理成可編輯的表格，
儲存後即可在 iPhone 上以類 App 的方式查看每日上下班時間。

目前針對「員工 × 日期矩陣 + 班別代碼對照表」這種排班表格式（常見於零售／專櫃排班，
橫向 1~31 日、縱向每位員工一列，格內填 D2/N5/DN2/休/例/國 等代碼，表格下方另有
「代碼 → 上班時間 → 班別 → 時數」對照表）做了專門的辨識邏輯。

## 特色

- 純前端、無伺服器：辨識與資料儲存全部在裝置本機完成，圖片不會上傳到任何地方。
- 使用 [Tesseract.js](https://github.com/naptha/tesseract.js)（免費開源 OCR，`chi_tra` 語言 + 單欄
  版面模式）取得文字與座標，再用 `js/gridParser.js` 依座標還原成表格，而不是單純依賴 OCR 的閱讀順序。
- 辨識完成後會列出圖片中偵測到的所有員工姓名，點選其中一個即可讀取那一列，不需要事先知道或
  輸入姓名；找不到我的名字時也能手動輸入片段搜尋。並自動比對代碼對照表換算成實際上下班時間，
  辨識不出的代碼會標示「需手動確認」而不是留白或猜測，讓你在下一步表格中修正。
- 辨識結果會顯示成可編輯表格，方便手動修正日期／時間／備註後再儲存。
- 支援 PWA：在 iPhone Safari 開啟後可「加入主畫面」，離線也能查看已儲存的班表。

## 本機測試

純靜態網站，用任何本機伺服器開啟即可（不能直接用 `file://` 開啟，因為 Service Worker
與相機權限需要 http/https）：

```bash
npx serve .
# 或
python -m http.server 8000
```

再用瀏覽器開啟顯示的網址。

## 部署到 GitHub Pages

1. 在 GitHub 上建立一個新的 repository（例如 `work-schedule`）。
2. 在本專案資料夾內執行：
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<你的帳號>/work-schedule.git
   git push -u origin main
   ```
3. 到 GitHub repo 頁面 → **Settings → Pages**：
   - Source 選擇 `Deploy from a branch`
   - Branch 選擇 `main`，資料夾選擇 `/ (root)`
   - 儲存後等待約 1 分鐘，會產生一個 `https://<你的帳號>.github.io/work-schedule/` 網址。

## 在 iPhone 上使用

1. 用 Safari 開啟部署好的網址。
2. 點選底部分享圖示 → 「加入主畫面」，即可像 App 一樣從主畫面開啟。
3. 使用流程：
   - 「上傳」頁拍照或選圖片 → 「開始辨識文字」
   - 從辨識到的姓名清單中點選你自己（找不到就用手動輸入片段搜尋）
   - 檢查並修正自動產生的表格（日期、上下班時間、備註）
   - 「儲存班表」→ 切到「班表」頁即可依月份查看所有已存的班表卡片，可編輯或刪除。

## 已知限制

- 目前的座標式解析是針對「員工 × 日期矩陣 + 代碼對照表」這個固定版型設計，換成別種排版
  （純文字列表、手寫班表等）辨識效果會大幅下降。
- 只會讀取你點選那一列，不會同時顯示整份表格的其他員工。
- 少數代碼可能因為 OCR 誤判抓不到、或對照表沒抓到而顯示「需手動確認」，請務必逐列檢查後再儲存。
- 班表資料儲存在瀏覽器 `localStorage`，只存在於目前這台裝置／瀏覽器，
  清除瀏覽器資料或換手機不會保留，也不會跨裝置同步。

## 專案結構

```
index.html          頁面結構（上傳／班表列表／說明 三個分頁）
css/style.css        手機優先的響應式樣式
js/storage.js         localStorage 存取（班表資料 + 設定，如你的姓名）
js/parser.js          共用的星期計算等小工具
js/gridParser.js       依文字座標還原矩陣班表：定位日期欄、擷取指定員工那一列、解析代碼對照表
js/ocr.js              包裝 Tesseract.js（chi_tra 語言、單欄版面模式），輸出文字座標
js/app.js              UI 邏輯、分頁切換、表格編輯、Service Worker 註冊
manifest.json         PWA 設定
sw.js                    Service Worker（快取靜態資源供離線使用）
icons/                  PWA 圖示
```
