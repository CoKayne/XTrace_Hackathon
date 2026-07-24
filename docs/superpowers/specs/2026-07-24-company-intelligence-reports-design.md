# 公司投資情報報告設計

## 狀態

已於 2026 年 7 月 24 日的產品討論中核准。

## 目標

將目前以 Runs 頁面為優先的掃描體驗，改造成 Second Look 風格的投資決策情報流程。每次成功完成的 14 天掃描，都必須產生一份可持久保存的報告，並為固定 MVP corpus 中的 19 筆 Deal 各自建立一份分析。

中信心與高信心的分析可以被推薦為值得重新關注的機會。其他 Deal 仍必須得到誠實且受證據約束的結果，明確說明本次掃描沒有發現足以改變原投資判斷的重要資訊。

實作必須保留目前 VSee 的黑色與螢光綠視覺系統，同時採用 Second Look 參考應用程式所呈現的產品流程與報告資訊層級。

## 產品原則

1. 一次掃描的主要產出是投資情報報告，不是工程任務識別碼。
2. 每次成功掃描都必須分析固定 MVP corpus 中的全部 19 筆 Deal。
3. 沒有推薦結果也是有效的產品輸出，不應被視為空白狀態。
4. 任何顯示的公司指標、融資條款、客戶資訊、市場事件或歷史投資決策，都必須具有可追蹤的證據。
5. 缺少證據時，顯示 `Not available in current evidence`。
6. 在 XTrace mode 中，XTrace 是歷史投資脈絡的必要記憶來源。XTrace recall 無法使用時，不得在未告知使用者的情況下改用本機 structured memory。
7. AI 只能建議由人執行的研究、盡職調查或後續追蹤，不得建議投入資金或直接做出投資決策。

## 主要使用者流程

全站共用的掃描按鈕改名為 `WAKE AGENT & SCAN MARKET`。

1. 使用者可從產品中的任何頁面啟動掃描。
2. 畫面進入掃描進度體驗，而不是跳到 Runs 頁面。
3. 進度畫面顯示可持久保存的 Worker 階段：
   - 掃描最近 14 天的公開資訊；
   - 正規化並排序市場事件；
   - 同步並召回 XTrace 記憶；
   - 將證據與全部 19 筆 Deal 逐一比對；
   - 產生並保存報告。
4. Worker 建立 19 筆可持久保存的 `CompanyAnalysis`。
5. 掃描完成後：
   - 若有一筆以上的中信心或高信心分析，應用程式自動開啟排名最高的 `Belief revised` 結果；
   - 若沒有公司達到推薦門檻，應用程式開啟已完成的報告，並明確說明本次沒有投資判斷出現重大變化。
6. 使用者可以開啟任一 Deal 的完整 Company Brief，或在該次報告中查看全部 19 筆結果。
7. Runs 仍可使用，但降級為 Settings 下的次要技術診斷功能，不再是投資人的主要流程。

## 分析結果類型

每一筆 `CompanyAnalysis` 必須且只能具有以下其中一種 outcome：

- `belief_revised`：中信心或高信心證據明確滿足、反駁或改變已記錄的歷史 decision reason 或 revisit condition；
- `monitor`：存在相關證據，但強度不足以改變投資判斷或支持立即 follow-up；
- `no_material_change`：本次掃描中沒有足夠相關的市場證據與此 Deal 相符；
- `analysis_unavailable`：必要服務或個別公司的推理流程失敗，因此無法完成公司分析。

只有 `belief_revised` 分析可以進入 Recommended second look 排名。`monitor` 與 `no_material_change` 分析仍須顯示在報告及公司歷史中。

## 公司分析資料契約

每一筆分析都必須保存並回傳以下欄位。

### 公司識別與分析結果

- Report ID
- Run ID
- Deal ID
- 公司名稱
- Deal status
- Analysis outcome
- 信心：`low`、`medium` 或 `high`
- 介於 0 到 1 的有界分數
- 分析時間
- 已驗證來源數量

### Then / Investment Memory

- Previous meeting summary
- Decision reason
- Partner concerns
- Revisit conditions
- 若證據中存在，顯示上次評估時間
- 已解析的 XTrace memory ID
- 原始文件與 synthetic fixture 的 lineage

合成的 VC decision record 必須持續明確標示為 Hackathon demo fixture。它們可以代表內部歷史脈絡，但不得被呈現為外部公司事實。

### Now / Market Evidence

- 相符的市場事件 ID
- 事件標題與類型
- 發布時間
- 為何該事件可能影響這間公司的證據支持說明
- 該事件是否滿足、反駁或沒有實質影響原本投資決策脈絡的判定
- 正面影響
- 負面影響
- 公開資訊來源

若沒有重要的公開證據與公司相符，分析顯示：

> No material market evidence matched this company during the current 14-day scan.

### Recommended next move

中信心與高信心的 `belief_revised` 分析，會根據 Deal status 得到由應用程式控制的安全 follow-up 建議。

低信心或判斷未改變的分析顯示：

> No immediate follow-up recommended. Continue monitoring.

模型不得提供任意操作、對外收件人、投資指示或承諾資金的建議。

### Company Brief 區塊

Company Brief 包含：

- IC Snapshot
- Traction
- Deal Terms
- Risks
- Decision History
- Source Lineage

這些區塊是稀疏的證據檢視畫面，不是要求模型一定要填滿的欄位。ARR、成長率、客戶、毛利、融資金額、估值、round terms、目標持股、日期與風險，只有在來源支持時才能顯示。

所有沒有證據支持的欄位一律顯示：

> Not available in current evidence.

### 內部報告草稿

中信心與高信心分析可建立一份可編輯的內部 VC 報告草稿，內容包含：

- Subject；
- 為何現在值得重新查看；
- 過去的投資決策脈絡；
- 哪項證據改變或滿足了原本條件；
- 尚未解決的風險或問題；
- 建議由人執行的下一步；
- 資料來源引用。

草稿沒有收件人、不會寄出 Email，並保留現有的複製到剪貼簿流程。

## 報告資料契約

每一份 `IntelligenceReport` 對應一次 Scan Run，並包含：

- Report ID
- Run ID
- Workspace ID
- 建立時間
- 市場摘要
- 證據覆蓋範圍摘要
- 公司分析總數；MVP corpus 固定為 19
- 各種 analysis outcome 的數量
- 若存在推薦結果，保存 Priority Deal ID
- 報告完成狀態
- 全部 19 筆公司分析

報告摘要可以說明有多少公開資訊被接受、有多少因不具備市場訊號而被排除，以及有多少因輸入上限而未進入後續排序。正常的證據篩選屬於資訊說明，不得因此將 Run 標記為 partial。

## 持久化設計

### `intelligence_reports`

擴充現有可持久保存的報告欄位：

- `analysis_status`
- `company_count`
- `belief_revised_count`
- `monitor_count`
- `no_material_change_count`
- `analysis_unavailable_count`
- `priority_deal_id`，可為 null
- `evidence_coverage`，JSON

相容期間保留現有的 Report ID、Run 關聯、建立時間、市場摘要與舊版 opportunities JSON。

### `company_analyses`

新增以 Report 與 Deal 為核心的持久資料表：

- `id`
- `workspace_id`
- `report_id`
- `run_id`
- `deal_id`
- `company_name`
- `deal_status`
- `outcome`
- `confidence`
- `score`
- `investment_memory`，JSON
- `market_evidence`，JSON
- `implications`，JSON
- `recommended_next_move`
- `company_brief`，JSON
- `source_refs`，JSON
- `created_at`

資料庫必須確保每一組 `(report_id, deal_id)` 只有一筆資料。同一間公司可以在不同 Report 中具有多筆分析，以建立長期的投資判斷歷史。

### 向後相容

- 現有 Report 資料必須繼續可讀。
- 當舊 Report 沒有 `company_analyses` 時，現有 `opportunities` 被解讀為推薦公司結果。
- 新版中信心與高信心推薦分析，在相容期間仍會產生舊版 public opportunities projection；Chat 與 Draft 會逐步改用新的持久化分析資料契約。
- 現有 Report URL 必須持續有效。

## Worker 與推理架構

### 階段 1：Market scan

使用已設定的八種公開來源，掃描最近 14 天資訊。正規化、去重、分類並排序具有來源支持的市場事件。

系統保存所有被接受的事件，但必須限制實際傳送給 XTrace 與 Opus 的事件數量與輸入大小。

### 階段 2：XTrace memory recall

同步尚未完成的 Deal memory ingest job。對全部 19 筆 Deal 分別使用有界且公司專屬的 query 召回歷史記憶。

每個 XTrace request 都必須符合 4,000 字元 query 上限，並遵守現有的分散式 rate limiter。每一筆被召回的 memory 都必須解析回指定的本機 Deal 與來源 lineage。

全域 market query 可以用來縮小可能相符的候選 Deal，但不能取代建立全部 19 個 Investment Memory 區塊所需的 per-Deal recall。

在 XTrace mode 中，XTrace recall 失敗時必須產生 incomplete report，不得改用本機 structured-memory fallback。必要記憶召回失敗的 Deal 會得到 `analysis_unavailable`；其他成功取得記憶的 Deal 仍繼續處理。

### 階段 3：準備候選證據

為全部 19 筆 Deal 建立獨立的證據資料包：

- Deal identity 與 status；
- 已解析的歷史記憶；
- 原始文件與 fixture lineage；
- 可能相關且已排序的市場事件；
- 允許引用的 source catalog。

候選選擇層可以使用 token、entity、sector、theme、decision reason、concern 與 revisit condition 的確定性重疊規則。候選選擇本身不得被當成對使用者顯示的事實。

### 階段 4：逐間公司分析

每一筆 Deal 都必須得到一個結果。

- 具有可信候選證據的 Deal 會交給 evidence-constrained Opus reasoner。
- Grounding validation 必須拒絕任何未直接複製自或未受到引用 excerpt 支持的 claim。
- 沒有可信候選證據的 Deal，得到確定性的 `no_material_change` 分析。
- 單一公司的模型或驗證失敗時，該公司得到 `analysis_unavailable`；其他 Deal 繼續處理。

### 階段 5：排序與保存報告

只有中信心與高信心的 `belief_revised` 分析可以進入推薦排名。

從產品使用者的角度，系統必須將報告與全部 19 筆分析視為一次完整操作進行保存。排名最高的推薦 Deal 會被設為 `priority_deal_id`。

Run status 規則：

- `completed`：所有必要階段完成，依賴服務與證據覆蓋正常；即使沒有任何 Deal 被推薦，仍可為 completed；
- `partial`：至少一個資料來源或公司分析失敗，但系統仍能產生報告；
- `failed`：必要市場證據、持久化服務或報告本身無法產生。

## API 設計

### 現有 Endpoint

- `POST /api/runs`：建立或重用可持久保存的掃描任務。
- `GET /api/runs/:id`：提供掃描進度與技術診斷。
- `GET /api/reports`：提供報告摘要列表。
- `GET /api/reports/:id`：提供完整報告。

### 新增 Endpoint

- `GET /api/reports/:id/companies/:dealId`：回傳指定 Report 中的一份 Company Brief。
- `GET /api/deals/:id/analyses`：回傳該 Deal 的長期掃描分析歷史。

所有 public serializer 都必須移除內部技術診斷、格式錯誤的舊資料及不受來源支持的模型輸出。

## 使用者介面設計

### Overview

顯示 Agent readiness、最新掃描摘要與最高優先順位結果。若沒有符合條件的推薦結果，顯示已完成的分析公司數量，以及本次沒有重大判斷變化的誠實結論。

### Scan progress

顯示可持久保存的 Run stage，但不得將 Run UUID 當成主要內容。前端輪詢 Run endpoint；當 Run 進入 terminal status 後，自動取得並開啟相對應的 Report。

### Priority Result

採用 Second Look 的資訊層級：

1. 公司 identity 與目前 Deal state；
2. Then / Investment Memory；
3. 投資判斷是否改變的關係；
4. Now / Market Evidence；
5. 信心與證據覆蓋；
6. Recommended next move；
7. Inspect evidence、Draft internal report 與 Open full company brief 操作。

### Reports

每一份 Report 顯示：

- 掃描日期與市場摘要；
- 各 outcome 數量；
- 證據覆蓋；
- 全部 19 筆公司分析；
- outcome、Deal status 與 confidence 篩選器；
- 中／高信心 belief change 排在最前，之後依序為 monitor、unchanged 與 unavailable。

### Company Brief

提供 IC Snapshot、Traction、Deal Terms、Risks、Decision History 與 Source Lineage 分頁。所有缺少證據的欄位一律使用已核准的 unavailable 標示。

### Deals

保留固定 corpus 中的全部 Deal。加入最新 Company Brief 與公司過去的掃描分析，同時保留現有 source 與 synthetic context 標示。

### Runs / System activity

將 Runs 移至 Settings 下的次要 `System activity` 區域。保留 Run ID、Worker stage、warnings 與 error details 作為診斷資訊。

投資人主要操作流程不再將 Run UUID 當成報告內容。

## 證據與安全規則

1. 公開市場事實必須引用 `public_web` source。
2. 歷史原始資料事實必須引用 `source_document` source。
3. 合成內部決策必須具有明確標示的 `demo_fixture` lineage。
4. `model_inference` 可以解釋受約束的關聯，但不能建立新的公司事實。
5. XTrace text 的證據強度不得高於其解析後的本機 source excerpt。
6. 每一個顯示的 claim，在持久化、API serialization、Chat、Draft 與 UI rendering 全流程中都必須保留 source ID。
7. 缺少證據時產生 unavailable 或 no-change 結果，不得讓模型自行補完。
8. 所有建議都只能是由人執行的研究與 follow-up。

## 錯誤處理

- 部分市場來源失敗時，使用成功來源產生報告，並加入 evidence coverage warning。
- 所有市場來源失敗時，不得產生公司推薦。
- 在 XTrace mode 中，XTrace recall 失敗時將歷史脈絡標示為 unavailable，且不得執行隱性 structured fallback。
- Opus JSON 或 Schema 驗證錯誤只允許一次有界修復。
- 單一公司分析失敗時，記錄 `analysis_unavailable`，其他 Deal 繼續執行。
- 報告持久化失敗時，整個 Run 標記為 failed。
- System activity 必須保存經過清理的 provider 與 stage error details。
- UI 必須區分「證據不完整」與「投資判斷沒有改變」。

## 測試與驗收標準

### 資料契約與持久化

- 一次成功的 MVP 掃描必須恰好保存 19 筆 company analysis。
- 資料庫拒絕重複的 `(report_id, deal_id)`。
- 每一種 analysis outcome 都必須通過資料契約驗證。
- 稀疏的 Company Brief 區塊必須保存明確的 unavailable 欄位。
- 現有 Report migration 必須保留舊資料與 URL。

### Grounding 與推理

- 沒有來源支持的財務、traction、融資、客戶與風險 claim 必須被移除。
- 沒有候選事件的 Deal 必須在不讓 Opus 捏造內容的情況下得到 `no_material_change`。
- 中／高信心推薦排名只能包含具有完整 grounding 的 `belief_revised` 分析。
- XTrace 失敗時不得使用隱性的 structured fallback。
- 公開 claim 與歷史 claim 必須分別解析到正確的 provenance。

### Worker

- 即使一間公司分析失敗，Worker 仍必須處理全部 19 筆 Deal。
- 正常的事件排序與輸入限制不得使 Run 變成 partial。
- 單一公司失敗時建立 `analysis_unavailable`。
- 即使沒有公司被推薦，掃描仍必須完成並產生完整報告。

### API 與 UI

- 掃描進度必須對應可持久保存的 stage。
- 掃描完成後自動開啟該次 Report。
- 有符合條件的掃描必須自動開啟 Priority Result。
- 沒有推薦結果時，顯示明確的 no-change 結論。
- Reports 必須顯示並可篩選全部 19 筆分析。
- Company Brief 不得顯示沒有來源支持的值。
- Runs 必須可從 System activity 查看，但不得作為主要操作流程。
- Chat 與 Draft 必須使用相同的持久化 CompanyAnalysis lineage。

### 完成前驗證

宣告完成前必須：

- 執行完整 unit 與 integration test；
- 執行 type checking 與 lint；
- 建立 production artifact；
- 執行 live XTrace bridge；
- 使用已設定的公開來源執行一次真實 14 天掃描；
- 驗證 19 筆可持久保存的公司結果，以及 completed 或誠實標示為 partial 的 terminal report；
- 部署精確對應已驗證 commit 的版本；
- 驗證 production health、report API、priority-result navigation、Company Brief rendering 與 source link。
