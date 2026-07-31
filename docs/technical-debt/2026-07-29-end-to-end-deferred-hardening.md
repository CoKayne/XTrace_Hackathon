# End-to-End Underwriting：已知問題與延後完善清單

更新日期：2026-07-31
基準 commit：`6a5e811`
適用分支：`feat/source-grounded-underwriting-v1`

## 1. 文件目的

本文件記錄為了優先完成完整 VC Underwriting 垂直流程，而明確延後的
資料一致性、安全性、併發與營運硬化工作。這些問題不會被遺忘，也不得在
後續文件或發佈說明中被描述為「已解決」。

目前的交付原則是：

1. 會造成正常 demo 流程無法執行、分析使用錯誤資料、資料遺失，或產生
   錯誤正式決策的問題，仍在主線立即修正。
2. 需要惡意 service-role、罕見併發、重複重試、資料庫管理操作或 legacy
   異常資料才會觸發的問題，先登記並延後。
3. 對外公開前，所有標記為 `production gate` 的項目必須完成。
4. 每個延後項目都必須有可重現情境、影響、暫時限制與完成定義。

## 2. 嚴重度與狀態

- `P0`：可能產生錯誤投資結論、跨 workspace 洩漏或不可恢復資料損失。
- `P1`：可能造成資料不一致、錯誤重試結果或管理操作失敗。
- `P2`：主要影響可維護性、營運便利性或非主要使用路徑。
- `MVP deferred`：不阻擋目前端到端 demo。
- `Production gate`：正式接入真實 VC 私有資料前必須完成。
- `Backlog`：可在 production gate 之後安排。

## 3. 問題總表

| ID | 優先級 | 狀態 | 問題 |
|---|---:|---|---|
| TD-REG-001 | P0 | MVP 最小修補；完整方案為 Production gate | 分析輸入仍可在同一 Source Revision 下被覆寫 |
| TD-REG-002 | P1 | Production gate | status-only confirmation 沒有獨立 durable receipt |
| TD-REG-003 | P0 | Production gate | `service_role` 仍可直接修改部分權威資料 |
| TD-REG-004 | P1 | MVP deferred | Seed eligibility 可能早於 Evidence／Interaction 完整寫入 |
| TD-REG-005 | P1 | Production gate | Bundle loader 是多次查詢，仍存在讀取時間窗 |
| TD-REG-006 | P1 | Production gate | legacy evidence／interaction 的 revision 欄位仍可為 null |
| TD-REG-007 | P2 | Backlog | Company／Deal 更名沒有版本化 identity-correction 流程 |
| TD-SEED-001 | P1 | MVP deferred | CLI `--reset` 可能部分刪除後失敗 |
| TD-SEED-002 | P2 | Backlog | Memory reset 不會同步清除獨立 Registry |
| TD-IMP-001 | P1 | MVP deferred | Fixed corpus confirmation 不是單一交易 |
| TD-XTR-001 | P2 | Backlog | 本機 reset 不一定能刪除遠端 XTrace memory |
| TD-FWK-001 | P0 | Production gate | Side Quest 框架可產生實驗性觀點，但仍不能成為正式決策因子 |
| TD-FWK-002 | P1 | Production gate | 真實框架的授權、來源版本與 Decision Utility 尚未全部核准 |
| TD-COV-001 | P2 | Product limitation | 第一版深度估值只支援 Seed／Series A × B2B SaaS／Enterprise AI |
| TD-COV-002 | P2 | Backlog | `verifiedSourceCount` 名稱包含可追溯但未獨立驗證的 model inference |
| TD-COV-003 | P2 | Backlog | 同時含文字與圖片的 Deal 尚未在歷史匹配階段合併兩類 evidence |
| TD-OPS-001 | P2 | Backlog | 自動排程、訊息實際發送與 LinkedIn 發佈仍刻意停用 |
| TD-OPS-002 | P1 | Production gate | 舊版 hosted report rows 可能無法投影成目前 read DTO |
| TD-OPS-003 | P1 | Production gate | 舊 Cloudflare Worker 網址仍在線，可能讓使用者誤入過期介面 |
| TD-UI-001 | P2 | Test hardening | Action Draft Save 尚缺實際按鈕到 PATCH 的互動測試 |
| TD-UI-002 | P3 | Test hardening | Product source link 尚缺實際 click 到 signed URL navigation 的互動測試 |
| TD-RUN-001 | P0 | Production gate | Underwriting SECURITY DEFINER owner 尚未完全隔離既有 membership |
| TD-RUN-002 | P1 | Production gate | SQL finalization 對 artifact 內部引用只做粗粒度驗證 |
| TD-RUN-003 | P1 | MVP deferred | 相同 batch fingerprint 的並行 create-or-reuse 仍可能競態 |
| TD-RUN-004 | P2 | Backlog | 衝突 duplicate identity 的 fingerprint 排序尚未 fail closed |
| TD-DB-001 | P2 | Test hardening | CREATEROLE current-lineage catalog fingerprints 尚缺 committed dynamic E2E |
| TD-DB-002 | P2 | Test hardening | 固定的 cluster-global owner test roles 可能在共享／平行 PostgreSQL 互擾 |
| TD-DB-005 | P2 | Backlog | 0009 ACL 修復的 exact attestation 與 mutation 尚未位於同一交易 |
| TD-DEP-001 | P1 | Production hardening | `npm audit --omit=dev` 仍回報 Next 轉依賴的 PostCSS／Sharp 風險 |

## 4. 詳細問題

### TD-REG-001：同一 Source Revision 的分析 payload 可被覆寫

- **證據**
  - `lib/storage/service.ts` 的 Supabase upsert 使用
    `resolution=merge-duplicates`。
  - `source_evidence`、`deal_interactions` 與
    `source_documents.title` 目前仍是 loader 的直接輸入。
  - 實測在 revision 與 Deal status 不變時更新 evidence，eligible snapshot
    fingerprint 不變，舊 snapshot 仍可通過 report save。
- **使用者影響**
  - 同一份「已確認來源」可能在不同時間產生不同分析。
  - 舊報告看似引用同一 revision，實際內容可能已改變。
- **暫時主線修補**
  - 在 Candidate／Underwriting run 建立時保存實際使用的 immutable
    Evidence Pack、source title、source revision IDs 與 input fingerprint。
  - 所有估值、框架與決策只讀取該 Evidence Pack，不回頭讀 mutable tables。
- **延後的完整方案**
  - 建立 `deal_source_materializations`。
  - 同一 `(workspace, deal, source, revision)` 只能對應一份 canonical
    payload；語意改變必須 append 新 Source Revision。
  - loader 僅讀 active materialization。
- **完成條件**
  - 修改 source title、fact 或 interaction 不會改變既有 materialization。
  - 同 revision 不同 payload 被拒絕。
  - Memory／PostgreSQL canonical fingerprint 一致。
- **建議測試**
  - `tests/unit/deal-source-materialization.test.ts`
  - `tests/integration/schema-migrations.test.ts`
- **重啟時機**
  - 接入第一個真實 VC workspace 前。

### TD-REG-002：status-only confirmation 沒有獨立 receipt

- **證據**
  - `deal_source_assignments` 同時充當 assignment 與 request receipt。
  - 同一 active revision 使用新 request ID 改 status 時，PostgreSQL 不新增
    assignment，因此沒有保存該 request。
  - Memory implementation 會把新 request 映射到舊 assignment fingerprint，
    與 PostgreSQL 行為不同。
- **使用者影響**
  - 網路重送或重用 request ID 時可能重複改 status，或 Memory／Supabase
    得到不同結果。
- **暫時限制**
  - 目前 Web 流程避免 status-only confirmation；每個正式 demo run 使用
    stable fixture status。
- **完整修正**
  - 新增 append-only `deal_confirmation_receipts`。
  - 每次 confirmation 都保存 request fingerprint 與結果 snapshot。
- **完成條件**
  - 新 request 改 status 會新增 receipt，但不重複 assignment。
  - exact replay 為 no-op；同 request ID 不同內容原子拒絕。
- **重啟時機**
  - 開放一般使用者修改 Deal status 前。

### TD-REG-003：`service_role` 可繞過部分受控寫入

- **已完成部分**
  - `companies`／`deals` 的 direct `DELETE`、`TRUNCATE` 已撤銷。
  - live test 已以真實 `BYPASSRLS service_role` 驗證。
- **仍存在**
  - `source_documents`、`source_evidence`、`deal_interactions`、
    `workspace_documents` 仍保有部分直接 DML。
  - Company／Deal identity 或 status 的部分 direct update 邊界尚未全部
    收斂。
- **使用者影響**
  - 持有 server-side service key 的錯誤程式或遭入侵 worker 可繞過 RPC，
    改變分析依據。
- **暫時控制**
  - service key 只存在 server／worker；不進 public DTO、browser bundle
    或 log。
  - 正常產品路徑不得新增 direct authoritative DML。
- **完整修正**
  - 權威表對 `service_role` 僅保留 `SELECT`。
  - 寫入僅能透過受控 `SECURITY DEFINER` RPC。
- **完成條件**
  - INSERT／UPDATE／DELETE／TRUNCATE 權限矩陣全部拒絕。
  - source、confirm、status change、seed reset RPC 仍成功。
- **重啟時機**
  - 使用真實私有文件或部署公開可寫入環境前。

### TD-REG-004：Deal 可能在 payload 完整前變成 eligible

- **證據**
  - `scripts/seed-demo.ts` 目前先執行 source registry backfill／confirmation，
    再寫 `source_evidence` 與 `deal_interactions`。
- **影響**
  - worker 若在中間時間點執行，可能讀到缺少 evidence 的 eligible Deal。
- **暫時控制**
  - Demo seed 與分析不平行執行；seed 完成後才允許 `Run Analysis`。
- **完整修正**
  - materialization、assignment、receipt、eligibility 在同一交易發布。
- **完成條件**
  - incomplete payload 永遠不會出現在 eligible query。
- **重啟時機**
  - 啟用背景排程或多 worker 前。

### TD-REG-005：Bundle loader 多次查詢的一致性時間窗

- **證據**
  - Supabase loader 分別讀 Deals、assignments、evidence、interactions 與
    documents。
  - 前後 snapshot 能偵測部分 revision/status 變動，但不能提供真正單一
    database snapshot。
- **影響**
  - 罕見併發更新下，可能組合出不同時間點的資料。
- **暫時控制**
  - 分析以手動觸發為主；資料確認與分析不得同時操作。
  - Underwriting 會把輸入保存為 immutable Evidence Pack。
- **完整修正**
  - 使用單一 RPC 或 transaction-level materialization read。
- **完成條件**
  - 併發 confirmation／save 只能完整看見舊版或新版。
- **重啟時機**
  - 啟用自動排程或多人同時編輯前。

### TD-REG-006：legacy lineage 可為 null

- **證據**
  - `db/schema.ts` 中 `source_evidence.source_revision_id` 與
    `deal_interactions.source_revision_id` 仍為 nullable。
- **影響**
  - 舊資料可能無法建立精確來源鏈。
- **暫時控制**
  - 新 Underwriting Evidence Pack 對缺 revision lineage 的 Fact fail closed，
    不允許它支持正式結論。
- **完整修正**
  - 清查與 backfill 後改為 `NOT NULL`，不一致資料進 quarantine。
- **完成條件**
  - 所有 analysis-consumed facts/interactions 都有 exact revision ownership。
- **重啟時機**
  - 匯入第一批非 demo legacy corpus 前。

### TD-REG-007：沒有 identity correction 流程

- **現況**
  - Company／Deal identity 在首次受控建立後應視為 immutable。
- **影響**
  - 拼字錯誤、公司改名或錯誤 Deal 歸屬目前無正式修正流程。
- **未來方案**
  - 建立 versioned identity-correction request、審核、alias 與舊報告
    preservation。
- **完成條件**
  - correction 不改寫舊報告，搜尋可解析舊名與新名。
- **重啟時機**
  - 開放真實使用者長期管理 Deal Registry 前。

### TD-SEED-001：CLI `--reset` 可能部分完成

- **證據**
  - `createSupabaseDemoDataStore.resetDemoData()` 逐表 direct delete。
  - 現在可能先刪 interaction/evidence，再因 companies/deals 權限被拒絕。
- **影響**
  - 開發／demo reseed 可能留下半套資料。
- **暫時控制**
  - 主線開發不依賴 `--reset`；使用新 workspace ID 或完整重建 demo DB。
  - Web `RESET DEMO` 只清 scan products，與此問題無關。
- **完整修正**
  - 新增 workspace-scoped、atomic controlled seed-reset RPC。
- **完成條件**
  - reset 成功時全清；失敗時零變更；其他 workspace 不受影響。
- **重啟時機**
  - 需要可靠 CI reseed 或 demo 環境重複初始化前。

### TD-SEED-002：Memory reset 與 Registry reset 不一致

- **證據**
  - Memory `DemoDataStore.resetDemoData()` 不會清除獨立
    SourceRegistry／DealRegistry maps。
- **影響**
  - Memory 測試的 reset/reseed 行為與 PostgreSQL 不完全一致。
- **完整修正**
  - 由單一 seed coordinator 管理三個 memory stores。
- **重啟時機**
  - 強化 reset/reseed integration test 時。

### TD-IMP-001：fixed corpus confirmation 不是單一交易

- **證據**
  - `lib/corpus/service.ts` 逐文件呼叫 `ensureWorkspaceDocument()`、
    `ensureDeal()`、`ensureFixture()`。
- **影響**
  - 中途失敗會留下部分 13/13 confirmation。
- **暫時控制**
  - Demo 使用預先 seed 完成的固定 corpus；確認前先跑 readiness check。
  - DB 步驟完成後才呼叫 XTrace，避免 DB 失敗仍產生遠端記憶。
- **完整修正**
  - fixed corpus confirmation 改為一個 controlled transaction/RPC。
- **重啟時機**
  - upload／import 成為正式產品流程前。

### TD-XTR-001：reset 後可能留下遠端 XTrace memory

- **影響**
  - 本機 reseed 後可能重複召回舊遠端 memory。
- **暫時控制**
  - XTrace ingest 使用 stable lineage/fingerprint；報告的 citation authority
    始終是本機 immutable source，而不是 XTrace text。
- **完整修正**
  - 若 XTrace 支援 deletion，保存 remote memory ID 並受控刪除；否則以
    workspace generation 隔離舊 memory。
- **重啟時機**
  - 正式提供 workspace deletion／reset 前。

### TD-FWK-001：框架內容尚未可成為正式決策因子

- **證據**
  - Side Quest handoff：20 packs、199 Cards、270 sources。
  - 所有 Cards 目前是 `draft`／`unpublished`，Decision weight 必須為 `0`。
  - 19 Cards 標記 `pending_review`。
- **已確認的產品行為**
  - 180 張 `public_source_paraphrase` Cards 可以
    `experimental_advisory` 模式真正執行，對同一份 Evidence Pack 產生
    獨立觀點、支持證據、反證、未知、限制、來源與框架間分歧。
  - 這些觀點必須進入最終報告、研究問題與 DD／Action Draft rationale；
    不能只停留在資料夾或靜態展示。
  - 19 張 `pending_review` Cards 不得執行。
- **仍延後的正式決策邊界**
  - draft／unpublished／weight `0` 的 named Cards 不得單獨將正式結果升為
    `Invest Candidate`，也不得覆寫財務公式、Critical Evidence ceiling、
    Fund Policy 或 deterministic Decision Policy。
  - 正式決策仍由已發布的 core criteria、可稽核公式與版本化規則產生；
    experimental advisory 結果以清楚標示的獨立觀點呈現。
- **風險**
  - 未核准的名人框架若被誤標為正式決策因子，會讓投資結論缺乏可稽核性，
    也可能造成錯誤背書或來源權利問題。
- **完成條件**
  - rights、source revision、content approval、publication 與 Decision
    Utility gates 全部通過。
- **重啟時機**
  - 將 named framework 從 `experimental_advisory` 提升為可影響正式
    deterministic decision 的 factor 前。

### TD-FWK-002：授權與來源覆蓋缺口

- **現況**
  - licensed source backlog 與公開來源 paraphrase 仍需逐 Card 核准。
- **未來工作**
  - 對照 `research/framework-authoring/review/` 的 gap register。
  - 將來源固定到 edition／URL／access date／immutable revision。
- **完成條件**
  - published Card 可追溯到允許使用的固定來源，且無待審引用。

### TD-COV-001：第一版產業與階段覆蓋有限

- **目前完整深度**
  - Seed／Series A。
  - B2B SaaS／Enterprise AI。
  - Market comps、VC Method、簡化 ownership/dilution、gross deal-level
    MOIC／IRR。
- **目前不支援**
  - DCF、SAFE/note conversion、option pool、preferred waterfall、
    net fund return，以及硬體、生技、金融等 specialist models。
- **暫時產品行為**
  - 不支援情境只能輸出 Core-only／`unavailable`／最高 `Advance`，
    不得假裝已完成專業估值。
- **重啟時機**
  - 第一條垂直流程穩定後，以一個 sector/stage 一個版本擴充。

### TD-COV-002：`verifiedSourceCount` public contract 命名過度承諾

- **現況**
  - `CompanyAnalysis.verifiedSourceCount` 實際計算所有可追溯、可引用的
    source lineage，其中可能包含 `provenance=model_inference` 的圖片結構化
    證據。
  - 這代表來源可追溯，不代表該推論已被獨立驗證。
  - 本輪已將使用者可見文案改為 `traceable source(s)`；為維持既有 API 與
    persisted report 相容性，public contract 欄位名稱暫時不變。
- **未來修正**
  - 將欄位版本化更名為 `traceableSourceCount`。
  - 視產品需要增加選填的 `modelInferenceSourceCount`，讓 UI 與下游 consumer
    能區分文件引文、公開來源與模型推論。
- **完成條件**
  - 新舊 report 有明確 migration／compatibility adapter。
  - API、資料庫、Chat、Report 與 Underwriting 使用一致且不誇大的計數語意。

### TD-COV-003：混合文字＋圖片 Deal 的歷史匹配覆蓋不完整

- **現況**
  - 純文字 Deal 會使用 XTrace recall；純圖片 Deal 會使用有完整本機 lineage
    的結構化圖片 evidence fallback。
  - 同一 Deal 同時具有文字與圖片來源時，歷史機會匹配目前只使用成功
    recall 的文字 context；圖片 evidence 仍會進入後續 underwriting，
    但不參與該次 matching，也不會增加 partial coverage 計數。
- **影響**
  - 主要流程與報告仍可完成，且不會把未引用內容冒充證據；但若關鍵訊號
    只存在於圖片，該 Deal 在 Top 5 歷史匹配時可能被低估或漏選。
- **暫時控制**
  - Demo corpus 應避免把決定 matching 的唯一資訊只放在混合 Deal 的圖片。
  - 報告仍必須顯示實際使用的來源與 coverage，不得宣稱已分析未使用的圖片。
- **完整修正**
  - 在 historical-context builder 以 source revision 為單位合併 XTrace
    recall 與 structured image evidence，去重後共同參與 matching。
  - 增加混合來源 Deal 的成功、部分失敗、全失敗與 citation-lineage 測試。
- **完成條件**
  - 圖片中的關鍵產業／公司訊號能影響混合 Deal 排名；報告精確揭露文字與
    圖片各自的使用狀態，且所有引用仍可回到固定 source revision。
- **重啟時機**
  - 擴大真實 mixed-media corpus 或把圖片內容作為主要歷史 Deal 證據前。

### TD-OPS-001：自動執行與對外發送刻意停用

- **目前行為**
  - 使用者手動按 `Run Analysis`。
  - Email／SMS／LinkedIn 只產生可編輯、複製或下載的草稿。
  - Chat／Search 只查詢既有持久化資料。
- **原因**
  - 避免 demo 或早期產品在未確認收件人與內容時產生真實外部副作用。
- **未來工作**
  - scheduler、approval queue、delivery integration、audit log、
    unsubscribe/consent 與 provider retry。
- **重啟時機**
  - 使用者完成草稿品質驗證並明確要求自動化之後。

### TD-OPS-002：舊版 hosted report rows 需要 backfill 或 quarantine

- **證據**
  - 2026-07-29 對現有公開 `public_demo` Sites 資料做只讀 probe 時，
    PostgreSQL、XTrace、Anthropic、Storage 與 corpus 設定皆可用，但既有
    `/api/reports` rows 中有早於目前 underwriting/read DTO shape 的 legacy
    payload，投影時會 fail closed。
- **影響**
  - Read path 現在會逐筆驗證並隔離 malformed analysis，因此單一舊 row
    不再讓整個 report list 回傳 server error，也不會為缺失欄位捏造資料。
  - 被隔離的 analysis 不會出現在 company detail；混合新舊資料時，畫面只
    顯示能通過目前 schema 的分析。
  - 公開 Sites 的 `worker=false` 是另一件事：`public_demo` 本來就 read-only，
    Sites 也不提供長時間 Worker。不得用假 heartbeat 掩蓋。
- **暫時限制**
  - 公開 `public_demo` 不執行 manual scan 或任何 mutation。
  - Product acceptance 使用完整 migration chain、目前 seed/backfill 與獨立
    healthy Worker，不把 legacy hosted row 當成功 fixture。
- **完整修正**
  - 目前已完成 read-time quarantine；後續仍應為 legacy report payload
    建立一次性、可稽核的 backfill，或將隔離狀態持久化供管理者檢查。
  - 不得在 backfill 或 read path 猜測缺失的投資事實。
- **完成條件**
  - 已完成：`/api/reports` 不因單一 legacy row 讓整個 workspace list
    失敗，且沒有 fabricated fallback。
  - 未完成：既有 hosted rows 全部能通過目前 DTO validation，或有可查詢、
    可稽核的持久化 quarantine/backfill 紀錄。

### TD-OPS-003：舊 Cloudflare Worker 網址仍在線

- **證據**
  - `https://vsee-vc.j6m3c041008.workers.dev` 仍回傳過期介面，包含
    `RESET DEMO`、舊版 `verified sources` 文案，且缺少 Fund Policy。
  - 正式 Sites 網址已穩定回傳目前版本與版本化資產 namespace；兩者是
    彼此獨立的部署，不是同一網站的瀏覽器快取。
- **影響**
  - 持有舊連結的使用者可能誤以為過期介面是目前產品。
  - 舊版產生的草稿會引用舊 Worker origin。
- **目前防護**
  - 公開 demo 的新版草稿與來源絕對連結使用經驗證的
    `PUBLIC_APP_URL`；不再只信任瀏覽器 origin。
  - 正式 build 使用 commit／顯式版本的獨立資產 namespace，缺少版本時
    fail closed。
- **完整修正**
  - 在 Cloudflare 控制面停用舊 Worker，或將它改成到目前 Sites URL 的
    永久重新導向，並保留 path 與 query。
  - 此操作需要舊 Cloudflare 帳號／deployment authority，不由目前 Sites
    部署自動推定或代替。
- **完成條件**
  - 舊 Worker 不再呈現應用程式內容；任何舊連結皆會導向正式 Sites 網址。
- **重啟時機**
  - 取得舊 Cloudflare Worker 的部署權限後立即處理。

### TD-UI-001：Action Draft Save 缺少真正的 UI 互動覆蓋

- **證據**
  - 目前整合測試會直接呼叫 `saveActionDraftBody`，並完整覆蓋
    helper → `PATCH` route → repository。
  - 元件渲染測試則把 `ActionDraftEditor` 的 `onSave` 設成 no-op；兩者沒有
    證明實際 Save 按鈕會呼叫 session wiring。
- **影響**
  - 如果按鈕 handler 或頁面 wiring 退化，helper、route 與 repository
    測試仍可能全部通過。
- **完整修正／完成條件**
  - 用 browser 或 DOM interaction 測試修改 body、按 Save，並觀察真正的
    authenticated `PATCH`、成功狀態與重新讀取後的 current body。

### TD-UI-002：Product source link 缺少真正的 click/navigation 覆蓋

- **證據**
  - 目前測試分別驗證 server-rendered product `href`，以及直接呼叫
    `openSourceRevision` 後的 guarded route、signed URL 與最終 document read。
  - 尚未證明 `SourceRevisionLink` 的 click handler 真的連到該 helper 與
    browser navigation fallback。
- **影響**
  - click wiring 或 window navigation 退化時，route／capability／storage
    測試仍可能保持綠燈。
- **完整修正／完成條件**
  - 用 browser 或 DOM interaction 測試點擊 product source link，驗證它經過
    authenticated access route，最後導向對應的短效 signed URL。

### TD-RUN-001：Underwriting RPC owner 尚未完全隔離

- **證據**
  - `0011_underwriting_runs.sql` 建立的 `vsee_underwriting_owner` 擁有
    `SECURITY DEFINER` RPC。
  - 若資料庫中預先存在同名 role 且具有額外 membership／attributes，
    migration 尚未完整撤銷所有繼承能力。
- **影響**
  - 需要具備資料庫管理權限或惡意預先建立 role 才能觸發，但成功時可能
    繞過新表的 service-role 寫入邊界。
- **暫時控制**
  - Demo／CI 使用受控、全新資料庫角色；部署前檢查 role ownership 與
    membership。
- **完整修正**
  - migration 明確將 owner 設為 `NOLOGIN NOSUPERUSER NOCREATEDB
    NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`，撤銷所有 membership，
    並驗證只能存取 RPC 所需物件。
- **完成條件**
  - hostile pre-existing role fixture 不能保留任何額外權限，RPC 正常執行。
- **重啟時機**
  - 部署到非全新或由第三方維運的 PostgreSQL 前。

### TD-RUN-002：SQL finalization 的內部引用驗證不足

- **證據**
  - 應用層會用 strict Zod contracts 驗證 bundle，但 SQL RPC 主要驗證
    coarse JSON shape、workspace、lease 與部分 typed dependencies。
  - live probe 可直接呼叫 RPC，保存缺少 valuation calculation 或缺少
    blocking fact 的 completed bundle。
- **影響**
  - 正常 worker 不會產生這種 payload；但持有 RPC execute 權限的錯誤
    server code 可能保存內部不一致 artifact。
- **暫時控制**
  - 所有主線寫入只經 `UnderwritingArtifactsRepository`，先完成 strict
    contract、ID-resolution 與 lineage 驗證。
- **完整修正**
  - SQL finalizer 驗證 valuation/calculation IDs、blocking facts、
    judgments/disagreements、decision fired rules、drafts 與 claim edges
    全部能在同一 payload 或 pinned reference registry 精確解析。
- **完成條件**
  - 直接 RPC malformed-bundle matrix 全部原子拒絕且零 artifact row。
- **重啟時機**
  - 向更多 server components 授予 finalization RPC execute 前。

### TD-RUN-003：Batch create-or-reuse 的並行競態

- **證據**
  - 目前 Supabase 路徑先 SELECT、再 INSERT；兩個相同 fingerprint 請求可在
    同時看不到 row 後競爭唯一 constraint，其中一個回傳錯誤而非 reuse。
- **影響**
  - 手動單次 `Run Analysis` 不受影響；多 worker／自動排程同時啟動時可能
    出現可重試失敗。
- **暫時控制**
  - MVP 只允許單一手動啟動；worker 不並行建立同一 workspace batch。
- **完整修正**
  - 使用單一 `INSERT ... ON CONFLICT ... RETURNING` RPC 或 advisory lock。
- **完成條件**
  - 並行相同 fingerprint 全部成功取得同一 batch ID。
- **重啟時機**
  - 啟用自動排程或多 worker claim 前。

### TD-RUN-004：Fingerprint duplicate identity 未完全排序／拒絕

- **證據**
  - 若輸入含相同 identity 但內容衝突的 duplicates，僅依 identity 排序不構成
    total order，反轉輸入仍可能改變 hash。
- **影響**
  - 正常 builder 會先去重；只有繞過 builder 的 malformed input 會觸發。
- **完整修正**
  - canonicalizer 對 identity＋完整 canonical payload 建立 total order，
    或遇到同 identity 不同 payload 直接拒絕。
- **重啟時機**
  - 對外開放低階 batch API 或強化 fingerprint fuzz tests 時。

### TD-DB-001：CREATEROLE current-lineage fingerprints 缺少動態 E2E

- **證據**
  - PostgreSQL 17.6 Supabase non-superuser `CREATEROLE` profile 已保存
    0009／0011／0012／0013／0016／0017 的 current 與 bridged catalog
    fingerprints，並有 unique、stage-exclusive 與 exact allowlist 測試。
  - 真實雙 launcher E2E 會從 Supabase-shaped prototype 經 compatibility
    bridge 升級至 0017，因此動態覆蓋的是 bridged lineage。
  - current-lineage fingerprints 是用真實 PostgreSQL 17.6 catalog matrix
    產生，但目前沒有一個 committed E2E 從每個 current stage 啟動 launcher
    並逐一驗證其分類與續跑結果。
- **風險**
  - 若日後只改壞 current-lineage fingerprint 或 stage mapping，靜態唯一性測試
    可能仍通過，直到對應的已部署 current catalog 嘗試續跑才會被發現。
  - 這不影響目前已驗證的 prototype → bridged → 0017 生產升級路徑。
- **後續測試**
  - 在 disposable PostgreSQL 17.6 Supabase-shaped cluster 中，以專用 non-super
    executor 建立每個 current stage fixture。
  - 對每個 stage 執行 guarded bootstrap／migration launcher，斷言分類精確、
    只套用後續 migration，最後到 0017；同時保留 drift-negative fixture。
- **完成條件**
  - 所有 committed CREATEROLE current fingerprints 都至少被一個真實 catalog
    E2E 消費；任一 hash 或 stage mapping 變動都會讓測試 fail closed。

### TD-DB-002：固定 cluster-global test roles 可能互擾

- **證據**
  - production owner role 必須使用固定名稱 `vsee_registry_owner` 與
    `vsee_underwriting_owner`，測試中的 hostile／non-super executor fixtures
    也會操作 cluster-global roles。
  - 2026-07-31 中斷一輪 migration suite 後，另一輪在同一 PostgreSQL cluster
    讀到殘留的 unsafe owner attributes，於 0009 正確 fail closed；重建乾淨
    disposable cluster 後不再出現。這證明是 fixture isolation 問題，而不是
    migration 接受了不安全狀態。
- **風險**
  - 兩個 job 共用同一 PostgreSQL cluster、平行執行，或測試程序被強制中止
    時，可能互相刪除／改寫角色，造成 flaky false failure 或殘留 fixture。
  - production migration 本身應繼續對同名角色的任何 unsafe drift fail closed；
    不應為了讓測試方便而放寬安全檢查。
- **暫時控制**
  - release migration suite 使用 `--test-concurrency=1`，每個 PostgreSQL
    version/profile 使用獨立 disposable container，結束後移除整個 container。
- **後續測試／工具**
  - CI 為每個 migration job 配置獨立 cluster/container，不共用 role catalog。
  - 加入 suite-level cleanup trap 與 preflight，列出殘留測試 DB／role 並拒絕
    在非 disposable cluster 執行破壞性 fixture。
- **完成條件**
  - 平行 job 使用不同 cluster 時穩定通過；模擬中斷後的下一輪能以明確
    preflight 訊息清理或拒絕，而不留下無法判讀的角色狀態。

### TD-DB-003：Bootstrap 尚未在寫入前預檢 executor 的角色能力

- **證據**
  - 使用 `NOCREATEROLE` 的 non-superuser credential 執行 guarded bootstrap
    時，系統可先安全提交 compatibility bridge 與 0008，直到 0009 建立／管理
    owner roles 時才因權限不足而 fail closed。
- **風險**
  - 不會繞過角色安全邊界或寫入不完整的 0009，但部署會在已完成前置步驟後
    才暴露 credential 能力不足，增加維護時段與操作判讀成本。
- **暫時控制**
  - 前置步驟皆為 exact、可重入且可安全續跑；修正 credential 後重新執行
    launcher，會由已記錄的 migration stage 繼續。既有 resume E2E 與 runbook
    提供恢復路徑。
- **完整修正**
  - launcher 在任何 migration 寫入前檢查目前 executor 是否為 superuser，或
    至少具有後續 owner-role lifecycle 所需的 `CREATEROLE` 能力；不符合時立即
    以明確訊息退出。
- **完成條件**
  - `NOCREATEROLE` fixture 在 bridge／migration ledger／schema 都零變更的情況
    下失敗；合法 superuser 與 non-superuser `CREATEROLE` fixture 維持通過。

### TD-DB-004：Forward migration 的缺失 owner-role 診斷仍使用直接 cast

- **證據**
  - 0010、0011、0012、0013、0014 與 0016 的 owner-role attestation 仍包含
    `'<owner-role>'::regrole`。若已完成 0009 後又有人從 cluster 刪除必要 owner
    role，下一個 migration 會以 PostgreSQL `42704 role does not exist` 中止，
    而不是回傳專案定義的 attestation 訊息。
- **風險**
  - Production launcher 只允許從 owner role 已存在且通過 exact catalog 檢查的
    0009+ stage 前進，因此這不是 unsafe acceptance 或權限繞過；異常 catalog
    仍會 fail closed。風險限於錯誤診斷品質與維護時段可用性。
- **暫時控制**
  - Launcher 的 exact stage fingerprint 先攔截 owner role 遺失；維運時保留原始
    SQLSTATE 與 catalog fingerprint，禁止在未釐清 drift 前直接續跑。
- **完整修正**
  - 各 forward migration 先以 `pg_roles` 解析 owner OID，再用 OID 執行 membership
    檢查；OID 不存在時主動拋出一致、可操作的 attestation exception。
- **完成條件**
  - 每個 forward owner preflight 都有 missing-role fixture，確認零 schema mutation、
    明確 attestation 訊息，且 hostile membership 仍 fail closed。

### TD-DB-005：0009 ACL 修復仍有跨 session 的 attestation 時間窗

- **觸發條件**
  - `bootstrap-production-baseline.zsh` 先在一個 `psql` session 確認 production
    catalog 是唯一核准的 repair-only fingerprint、0009 為 exact partial state、
    沒有 forward migration、registry invariants 正確且 worker 已靜止。
  - 在 bootstrap 啟動另一個 `psql` session 執行 ACL repair transaction 前，另一個
    具有 DDL／ACL 權限的 operator、migration launcher 或管理程序同時修改 catalog，
    或開始 forward migration。
  - Repair transaction 會再次確認 13 筆已知錯誤 grant、registry invariants 與
    quiescence，但目前不會在該交易內重新計算完整 catalog fingerprint，也不會重新
    檢查所有 forward sentinels。
- **影響**
  - Repair 可能先對一個已經發生額外 drift 的 catalog 提交精準 revoke；bootstrap
    隨後的 exact postcondition 會偵測不一致並 fail closed，但 mutation 已經發生，
    需要人工判讀與恢復後才能續跑。
  - 目前不會把不正確 catalog 誤認為合法 migration stage，也不會自動繼續 forward
    migrations；風險是「在 drift 下已提交修復」而不是 silent unsafe acceptance。
  - 此情境需要維護窗口內另一個具資料庫管理能力的 actor 併發寫入，因此列為 P2
    Backlog，而非正常單一 operator 上線路徑的 blocker。
- **目前控制**
  - ACL repair 只能在 exclusive maintenance window 執行：先停止 Worker，不允許
    其他 deploy、migration、SQL console 或資料庫管理工作，同一時間只保留一個
    launcher/operator。
  - Bootstrap 在 repair 前後都驗證 exact catalog fingerprint，repair transaction
    另行鎖定相關 application tables，並重新檢查 quiescence、registry invariants、
    精準 grant 集合與 owner-role membership restoration。
  - 任一 postcondition 不符立即停止，不得手動跳過 fingerprint 或直接續跑 forward
    migration。
- **嚴格未來修正**
  - 將完整 catalog／forward-sentinel attestation 與 ACL mutation 放入同一個資料庫
    session 與 transaction，並以專用 migration advisory lock 串起 bootstrap、repair
    與 forward launcher；所有受控 schema mutation 入口必須先取得同一把 lock。
  - 在 transaction 內、mutation 緊鄰前重新驗證等價於 exact repair-only fingerprint
    的完整 server-side catalog contract，而不只計算 13 筆預期 grant。
  - 維運權限與 runbook 同時禁止任何不遵守 migration lock 的管理寫入；若偵測 drift，
    必須在零 ACL/schema mutation 下 rollback。
- **完成條件**
  - 兩個獨立 connection 的並行測試證明：repair 持鎖時，第二個 bootstrap、forward
    launcher 與 ACL／DDL 管理動作會阻塞或被明確拒絕。
  - 在 attestation 後、revoke 前注入 catalog drift 或 forward sentinel 時，repair
    transaction 必須 rollback，catalog、ACL 與 migration ledger 保持零變更。
  - Exact production-defect fixture 仍只能從
    `sha256:a5e1729c32fbe1a99a0487ce7a11701e23d09dc4c201fece540967101565591c`
    原子轉換為
    `sha256:15d4475110a5425162e246a0b33a547f33b8550d1e0327c92f67de9db8f1071e`；
    任一其他起點或終點都 fail closed，且不提交部分 mutation。

### TD-DEP-001：Next 的轉依賴仍有尚未提供相容修補的安全通報

- **證據**
  - 2026-07-31 執行 `npm audit --omit=dev` 仍回報 3 個 high severity
    production dependency findings。
  - 路徑為 `next@16.2.12` 所帶入的 `postcss@8.4.31` 與
    `sharp@0.34.5`；目前 npm 建議的自動修正會降級至不相容的 Next 14，
    不能直接套用。
  - 完整 `npm audit` 也必須納入 release 檢查，因為部分標示為
    `devDependency` 的 React Server Components 套件實際會被 Vinext 編入
    production Worker；不能只依 `--omit=dev` 判斷正式 Bundle。
  - 修補 RSC 後的完整 audit 仍有 7 個 high、4 個 moderate、1 個 low，
    主要分布於 Next 轉依賴與 Vite／Drizzle build tooling；這些項目必須以
    production Bundle 可達性逐一關閉或升級，不能只因列在 devDependencies
    就自動豁免。
- **目前暴露面**
  - Web runtime 由 Vinext／Cloudflare Worker 產生，並未使用 Next server
    作為正式 request runtime；產品也不接受使用者上傳 CSS。
  - 圖片處理與 build dependency 的實際可達性仍需逐一確認，因此不能只因
    audit 路徑存在就宣稱已無風險。
- **暫時控制**
  - 固定 dependency lockfile、禁止 `npm audit fix --force`，並持續使用
    Web parser boundary 驗證，避免文件解析或額外 server parser 進入 Web
    bundle。
  - React、React DOM 與 `react-server-dom-webpack` 已同步固定於
    `19.2.8`，關閉本次審核發現、且實際會進入 production RSC runtime 的
    Server Functions DoS 通報。
  - 正式站不提供任意 CSS build 或圖片轉換入口；來源圖片只經既有受控上傳
    與抽取流程。
- **完整修正**
  - 等待 Next 發布採用已修補 PostCSS／Sharp 的相容版本，或移除 Web runtime
    不需要的直接 Next dependency。
  - 針對 advisory 所述的 CSS source map 與圖片處理路徑建立實際可達性測試。
- **完成條件**
  - 完整 `npm audit` 與 `npm audit --omit=dev` 對 production Bundle
    可達 dependency 回報 0 個 high／critical，或以可重現的
    bundle/runtime reachability 證明剩餘通報套件完全不會進入正式執行路徑，
    並經安全審核接受。

## 5. 主線仍必須遵守的最低安全界線

以下不是技術債，任何加速實作都不能移除：

1. workspace authorization 與 public-demo read-only 邊界。
2. 私有 object storage 與短效 signed access。
3. XTrace 只作 recall transport，不是 citation authority。
4. Fact 必須具有本機 source revision lineage；缺 lineage 不得支持正式結論。
5. Money、Rate、Multiple 使用 decimal string／PostgreSQL `numeric`，不得
   使用 JavaScript binary float 作權威計算。
6. LLM 不得寫入或覆寫正式估值公式與最終決策。
7. `Invest Candidate` 只表示值得提交最終投資審查，不等於自動投資。
8. Action Draft 不得具有 Send／Publish 副作用。
9. 不支援或資料不足時必須顯示 `unavailable`、missing evidence 或 ceiling，
   不得以市場預設假裝成公司真實資料。

## 6. 建議完善順序

完成端到端 Vertical Slice 後依序處理：

1. TD-REG-001 完整 Materialization。
2. TD-REG-003 service-role 權限矩陣。
3. TD-REG-002 confirmation receipts。
4. TD-REG-004／005 atomic publication 與 single-snapshot loader。
5. TD-SEED-001／TD-IMP-001 reset/import transactions。
6. TD-REG-006 legacy lineage migration。
7. TD-FWK-001／002 framework publication gates。
8. TD-RUN-001／002／003 的 production persistence hardening。
9. TD-DEP-001 dependency hardening。
10. TD-REG-007、TD-XTR-001、TD-SEED-002、TD-RUN-004、TD-DB-005 與營運
    便利性工作。

每次關閉一項技術債時，必須在本文件補上：

- 修正 commit；
- 新增測試；
- 驗證命令與結果；
- 若風險只部分降低，拆出新的 ID，不得直接標示完成。
