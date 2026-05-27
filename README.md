# Bumping Smart Manufacturing Control Tower

這是一個純前端展示用儀表板，畫面參考使用者提供的 Production KPI Overview 控制塔照片，並套用 bumping 場機種分類：`DRY`、`WET1`、`WET2`。

## 檔案位置

專案在：

```text
C:\Users\jake\Documents\Codex\2026-05-26\github-repo-python-github
```

## 開啟方式

直接用瀏覽器開啟：

```text
index.html
```

如果要給內網搬運，優先使用單檔離線版：

```text
dist/dashboard.html
```

這個檔案已包含 HTML、CSS、JavaScript，不需要 Chart.js、CDN、npm 或 Python server。

或用 Python 標準庫啟動本機伺服器：

```powershell
python -m http.server 8000
```

然後開：

```text
http://localhost:8000
```

## 後端接口保留

目前所有資料都先在 `app.js` 裡面的 `api()` 產生假資料，並保留接口名稱：

```js
const endpointMap = {
  kpis: "/api/kpi/overview",
  machines: "/api/bumping/machines",
  alarms: "/api/alarm/history",
  facility: "/api/facility-energy/timeseries",
  environment: "/api/environment/status",
  workforce: "/api/workforce/status",
  analytics: "/api/ai-analytics/scores"
};
```

未來接後端時，可以把 `generateMockDashboardData()` 的資料來源逐步替換成 `fetch()` 這些 endpoint，再把回傳資料塞進原本的 render 流程。

## 內網搬運

請參考：

```text
TRANSFER.md
```

內網收到 `dashboard.html` 後，可用以下指令驗證沒有被改壞：

```powershell
python verify_dashboard.py dashboard.html
```

## 已展示的圖表類型

- KPI 動態數字
- 工廠機台 layout 與機台分類標籤
- 折線圖
- 長條圖
- 面積圖
- 混合長條加折線圖
- 儀表圖
- 甜甜圈圖
- 雷達圖
- 即時 alarm 表格
- 可點擊機台與按鈕互動

## 專業版互動功能

- `ALL / DRY / WET1 / WET2` 篩選：切換後 KPI、表格、熱圖、事件會以該機種分類為主。
- 點擊左上方任一機台：右側 Equipment Status、UPH/Yield Trend、AI Health 會切到該機台。
- 機台狀態燈：Running、Idle、Warning、Down 以固定色彩規則呈現。
- 滑鼠移到機台上：顯示 tooltip，包含 UPH、Yield、Utilization、Alarm。
- Demo Mode：
  - `Pause / Play`：暫停或恢復假資料流。
  - `Alarm Burst`：模擬短時間 alarm 增加。
  - `Simulate Down`：模擬目前選取機台 Down。
  - `Day / Night Shift`：切換班別，影響人員數字。
  - `Speed`：調整資料更新速度。
- Live Event Stream：模擬 MES / EAP / Alarm 串流事件。
- Risk Heatmap：以熱圖展示各分類機台的風險變化。
