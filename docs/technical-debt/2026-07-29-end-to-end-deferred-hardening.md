# End-to-End Underwriting：已知問題與延後完善清單

更新日期：2026-07-29  
基準 commit：`eec063d`  
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
| TD-OPS-001 | P2 | Backlog | 自動排程、訊息實際發送與 LinkedIn 發佈仍刻意停用 |
| TD-RUN-001 | P0 | Production gate | Underwriting SECURITY DEFINER owner 尚未完全隔離既有 membership |
| TD-RUN-002 | P1 | Production gate | SQL finalization 對 artifact 內部引用只做粗粒度驗證 |
| TD-RUN-003 | P1 | MVP deferred | 相同 batch fingerprint 的並行 create-or-reuse 仍可能競態 |
| TD-RUN-004 | P2 | Backlog | 衝突 duplicate identity 的 fingerprint 排序尚未 fail closed |

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
9. TD-REG-007、TD-XTR-001、TD-SEED-002、TD-RUN-004 與營運便利性工作。

每次關閉一項技術債時，必須在本文件補上：

- 修正 commit；
- 新增測試；
- 驗證命令與結果；
- 若風險只部分降低，拆出新的 ID，不得直接標示完成。
