# 來源可稽核的 VC 投資承保與估值系統設計

## 狀態

本設計已於 2026 年 7 月 28 日逐段通過產品討論核准。

本文件描述 VSee 在 Hackathon 後的下一階段產品：在既有的市場掃描、XTrace
長期投資記憶、歷史 Deal 比對與重新關注預警之上，加入專業的公司承保、
多框架投資判斷、財務估值、基金報酬分析及行動草稿。

本設計刻意取代先前規格中「AI 不得提供投資判斷」的限制。新版允許系統輸出
`Invest Candidate`，但該詞只代表「在目前證據、假設與 Fund Policy
下，建議進入最終投資審查」，不代表 AI 已批准投資、承諾資金或執行交易。

與舊規格發生衝突時，依下列優先順序處理：

- 保留：全部歷史 Deal 的市場分析、event-first 的近 14 天掃描、中／高信心
  `belief_revised` Top 5 排名、只查詢既有資料的 Chat、XTrace lineage 規則、
  禁止外部寄送／發布，以及舊 Report URL／API 的向後相容。
- 取代：不得輸出投資判斷、不得產生 Founder outreach 草稿，以及不得在
  runtime 上傳來源的 Hackathon 限制。
- 新增：Top 5 候選的完整 Underwriting、Fund Policy、逐候選
  Underwriting Context、Framework／Valuation／Decision 層與 Action Draft。

未在本文件明確取代的舊規則繼續有效。

## 與既有產品的關係

既有產品回答：

> 最近發生了什麼市場變化？哪些過去接觸過的公司值得重新查看？

本階段新增回答：

> 這家公司本身是否優秀？目前價格是否合理？對這家基金而言是否值得投資？

兩者是前後相接而非互相取代的流程：

1. 掃描近 14 天公開市場資訊。
2. 找到可能影響產業或商業模式的事件。
3. 使用 XTrace 召回曾接觸公司的完整歷史脈絡。
4. 將市場事件與歷史 Deal 比對，產生既有的市場變化結果。
5. 對 Top 5 中／高信心 `belief_revised` 候選建立可稽核 Evidence Pack。
6. 執行投資框架、財務模型與基金回報分析。
7. 產生正式投資報告、投資承保結論與下一步行動草稿。

既有的市場變化 outcome 繼續保留：

- `belief_revised`
- `monitor`
- `no_material_change`
- `analysis_unavailable`

新的投資承保 decision 另行保存：

- `Pass`
- `Watch`
- `Advance`
- `Invest Candidate`

`belief_revised` 不自動等於 `Invest Candidate`。一家公司可能因市場變化值得
重新查看，但仍可能因公司品質、價格、條款或基金適配度不足而得到 `Watch`
或 `Pass`。

## 產品目標

1. 把市場訊號、公司證據、歷史投資脈絡與專業投資方法連成一條可重建的決策鏈。
2. 讓 AI 不只推薦「值得關注」，還能判斷「是否值得投資」。
3. 將公司品質與投資價格分開，避免把好公司直接等同於好投資。
4. 為不同階段、商業模式與地區選擇合適的指標及估值方法。
5. 顯示各投資框架的完整判斷與分歧，不以人格模仿或單一平均分數掩蓋差異。
6. 清楚區分事實、假設、計算、框架判斷與最終結論。
7. 所有重要結論都能追溯到原始文件、公開網址、框架來源或可重算公式。
8. 產生具體下一步行動與溝通草稿，但不自行寄送、發布或執行外部動作。

## 本設計的目標範圍

### 最終必須完成

- 由使用者按下 `Run Analysis` 手動啟動。
- 掃描最近 14 天公開資料。
- 延用既有全部歷史 Deal 與 XTrace 長期記憶，並為 workspace 中所有
  `analysis_eligible` Deal 產生既有 `CompanyAnalysis`；目前固定 MVP corpus
  的 19 筆 Deal 全部符合此條件，但 cardinality 不寫死為 19。
- 對 Top 5 中／高信心 `belief_revised` 候選建立 Evidence Pack 與完整
  Underwriting；未入選 Deal 保存 `underwriting_status = not_selected`，
  不得被解讀為 `Pass`。
- Authenticated product mode 接受 TXT、Markdown 與核准圖片格式的 runtime
  upload；固定 PDF corpus 繼續作為 preloaded source，但第一版不開放一般 PDF
  runtime upload。
- 上傳後提供 extraction preview，並由使用者確認公司名稱與 Deal 歸屬。
- 八個 Universal Core 投資鏡頭。
- B2B SaaS／Enterprise AI 的 A-depth 專項承保。
- Bear／Base／Bull 情境。
- 階段適用的估值方法。
- 募資價格、持股、稀釋、MOIC 與 IRR 分析。
- `Pass／Watch／Advance／Invest Candidate`。
- 完整來源、推論摘要、框架分歧與版本資訊。
- Email、簡訊、LinkedIn message、內部 memo 與 DD request 草稿。
- `Balanced Recommended Policy` 與一鍵套用推薦預設值。
- 保留 existing-data-only Chat，並讓它查詢已持久化的 Underwriting 結果。

### 明確延後

- 背景每日自動執行；架構保留 scheduled trigger，但第一版只啟用 manual trigger。
- 系統直接寄 Email、傳簡訊或發布 LinkedIn 內容。
- AI 自動投資、承諾資金或跳過人工最終審查。
- 一次混合多個主要階段、商業模式或地區建立加權 benchmark。
- 對所有產業宣稱具備與 B2B SaaS／Enterprise AI 相同的專項深度。
- 自動學習使用者 override 並偷偷修改 Fund Policy。
- 以電子書建立作者人格或宣稱重現作者未公開的私人思考過程。
- Audio、Gmail 或 Google Drive ingestion。
- Chat 自行上網、啟動分析、修改 Policy、重新計算或執行外部行動。

## 核心產品原則

### 1. 來源優先

沒有來源支持的公司事實不得進入正式報告。模型可以建立假設或提出判斷，
但必須以不同資料類型標示。

### 2. 計算與語言模型分離

LLM 負責抽取、分類、框架應用、分歧解釋及報告文字。DCF、稀釋、SAFE
conversion、liquidation waterfall、MOIC、IRR 等計算由確定性程式執行。

### 3. 公司品質、價格與基金適配分開

最終報告至少有三個獨立結論：

- Company Quality
- Price Attractiveness
- Fund Fit

綜合層不得因公司品質很高而忽略過高估值，也不得因價格便宜而忽略公司品質。

### 4. 框架分歧不是錯誤

不同框架可以得到相反結論。系統保存並解釋分歧，不以單一平均分數將其消除。

### 5. 缺資料時誠實降級

市場先驗可以代替分析假設，不能冒充公司的真實資料。缺少投資關鍵事實時，
若最低模型輸入仍足夠，系統完成 Bear／Base／Bull 分析，但最高只能輸出
`Advance`；連最低輸入都不足時，明確標示 Underwriting unavailable。

### 6. 歷史決策不可被新版本改寫

每次分析固定綁定當時的公司證據、Fund Policy、Benchmark Pack、
Framework Pack、模型設定與公式版本。未來更新不會重新解釋舊報告。

舊報告內容保持 immutable，但允許以附加 metadata 標示來源撤回、identity
更正或存在新版報告。更正必須保存原因、時間及 `superseded_by_run_id`，
不得直接修改舊結論。

### 7. 正式標籤由確定性規則決定

LLM 可以產生受 Schema 約束的框架判斷與文字說明，但不得決定或覆寫正式的
`Pass／Watch／Advance／Invest Candidate`。正式標籤由具版本的 Decision
Policy 依 evidence blocker、hard veto、估值與 Fund Policy 結果產生。

## 分析資料的五種型別

每一個可顯示的分析項目必須具有以下其中一種 `analysis_type`。型別與來源是
兩個正交維度；每個項目另存 `provenance_origin`，例如
`management／uploaded_document／public_source／benchmark／recommended_policy／user_custom`。
Fund Policy、Benchmark 及 Framework 以 immutable reference 進入分析，不得
為了符合五種類型而假裝成公司 Fact。

### `Fact`

由原始文件、已解析的 XTrace lineage 或公開來源支持、可精確定位的公司或
市場 assertion。`Fact` 表示「有來源的可檢查陳述」，不自動表示已經獨立驗證。

必須保存：

- immutable `source_revision_id`、source ID；
- URL 或儲存物件位置、object version 與 content hash；
- 文件頁碼、圖片位置或原文 excerpt；
- `published_at／event_at／retrieved_at` 與資料期間；
- parser／OCR／extractor ID、版本與抽取時間；
- 可用時的發行人、單位、幣別及定義；
- `source_role`：management、first-party filing 或 independent third party；
- `assertion_status`：reported、corroborated、verified 或 disputed；
- verification method、資料新鮮度與 `accepted_for_gate`。

Pitch deck 或 Founder 提供的 ARR、客戶、pipeline 等可以顯示為
`management-reported Fact`，但只有符合 Critical Evidence Profile 接受標準的
assertion 才能解除 `Invest Candidate` blocker。

既有 provenance 邊界繼續有效：

- `source_document` 與 `public_web` 可以支持外部公司／市場 Fact；
- `demo_fixture` 只能支持明確標示的內部歷史 decision context；
- `model_inference` 永遠不能成為 Fact；
- XTrace 是 recall transport，不是來源類型，recall 必須還原至上述 lineage。

### `Assumption`

為完成情境分析而建立的明示假設。

必須保存：

- Bear／Base／Bull 適用範圍；
- 假設值；
- 建立原因；
- 外部先驗或使用者輸入；
- 對結論的敏感度；
- 是否需要使用者或 Founder 確認。

### `Calculation`

可由保存的輸入及公式版本重新計算的結果。

必須保存：

- 公式 ID 與版本；
- 所有輸入值及其型別；
- 單位、幣別與期間；
- 計算結果；
- rounding policy；
- 計算時間。

### `Framework Judgment`

某個具名、具來源、具適用條件的投資框架，針對目前證據產生的判斷。

必須保存：

- Framework Card 與版本；
- 使用與未使用的證據；
- 支持與反對證據；
- 適用條件檢查；
- 簡潔的「證據 → 準則 → 判斷」理由摘要；
- 信心及限制；
- 與其他框架的衝突。

### `Final Synthesis`

綜合所有框架、估值、價格、風險及 Fund Policy 的正式結論。

最終綜合層只能引用前四類已保存項目，以及 immutable
`PolicyRef／BenchmarkRef／FrameworkRef`，不得建立新的公司事實或不可重算的
數字。

每個正式 claim 必須保存 typed provenance edge：

```text
Final claim
  -> Framework Judgment or Calculation
  -> Evidence item
  -> Exact source revision and locator
```

報告層的一組 broad source refs 不能取代逐 claim dependency edge。模型呼叫另存
provider、model ID、prompt/template version、schema version、sampling settings
及 application commit，讓結果可以重播與稽核。

## Evidence Pack

### 目的

Evidence Pack 是所有框架與估值模型唯一可以使用的公司分析輸入。它避免每個
Agent 各自搜尋、各自定義指標或引用不同版本的事實。

### 資料來源

- 使用者上傳的 TXT、Markdown 與圖片；
- 既有固定 MVP corpus 及未來使用者建立的 Deal；
- XTrace 召回的歷史投資脈絡；
- 近 14 天公開新聞、公司公告、VC 投資公告、產業資料及監管事件；
- 使用者後續補充的財務、cap table 或 round terms；
- 已核准的市場 benchmark 與 valuation comp set。

### 正規化

Evidence Pack Builder 必須：

- 解析公司 identity；
- 只接受使用者已確認 company／Deal assignment 的 runtime upload；
- 統一貨幣、期間、百分比與量綱；
- 將 ARR、revenue、bookings、GMV、pipeline 等概念分開；
- 將 recurring revenue、services 及 pass-through revenue 分開；
- 記錄 reported、calculated 與 management-adjusted 的差異；
- 建立來源衝突；
- 標示過期資料；
- 建立 evidence coverage；
- 為每個 source 建立 immutable revision、hash 與 exact locator；
- 禁止同一數字在不相容期間之間直接比較。

### 衝突

若兩個來源對同一欄位有不同數值，系統不得自行挑選較有利數字。Evidence Pack
需保存兩者、各自來源、期間與可信度。

每個欄位具有 versioned tolerance／materiality 規則，先區分 normalization
difference 與真正矛盾，再保存：

- `open`：尚未解決；
- `resolved`：有新證據及 resolution reason；
- `immaterial`：差異低於該欄位 materiality。

只有 critical 且 material 的 `open` conflict 會觸發 decision blocker；系統不得
依結果是否有利來決定來源或 materiality。

## 關鍵資料與降級規則

每個 Router profile 必須綁定 versioned `Critical Evidence Profile`，依
stage × business model × geography × security type 定義 required field、可接受的
assertion status、freshness、conflict materiality、blocking 狀態及缺失後的
decision ceiling。

以下資料只要適用於該 Deal，且未達 profile 的接受標準或具有 material open
conflict，就一定阻止 `Invest Candidate`：

- 公司 identity 與實際商業模式；
- 本輪募資價格、valuation cap 或足以重建價格的 round terms；
- 投資金額、證券類型及會影響收益分配的條款；
- 適用時的 fully diluted cap table；
- 適用階段的收入、ARR、growth、retention 或實際 customer proof；
- cash、burn、runway 或資金用途；
- 會實質改變 valuation 的 gross margin、服務成本或 AI inference cost；
- 重大客戶、供應商、模型供應商或法規集中風險；
- 用於計算 Fund Fit 的必要 Fund Policy 參數。

降級分成兩層：

- 公司 identity 或執行任一可信估值情境所需的最低輸入不足時，保存
  `underwriting_status = unavailable` 且正式 `decision = null`，不得偽造完整
  模型或借用既有市場 outcome。
- 仍可完成方向性分析，但有 critical blocker 時，最高 decision 為 `Advance`。

第二種情況仍然輸出：

- 完整 Bear／Base／Bull 情境；
- 可以確定的公司品質判斷；
- 市場價格區間；
- 已知與未知的風險；
- 目前最高可信 decision；
- 向 Founder 或團隊索取的資料清單；
- 哪一項資料最可能改變結論。

只有公司真實關鍵事實未達接受標準或具有 critical material conflict，才觸發
上述限制。採用系統預設的 Fund Policy 本身不會阻止 `Invest Candidate`。

## Decision taxonomy

### `Pass`

目前不值得繼續投入研究或 follow-up 資源。

常見原因：

- 明確不符合 mandate；
- 公司品質或市場機會不足；
- 核心風險無法透過條款或里程碑改善；
- 價格在所有合理情境下均無法達到基金回報要求；
- 觸發已定義的 hard veto。

### `Watch`

公司或市場仍值得追蹤，但目前時機、證據、價格或進展不足以展開正式 DD。

### `Advance`

值得採取下一步研究行動，例如安排 Founder meeting、取得資料、進行 customer
reference、建立完整模型或開始 DD。

關鍵資料不足時，即使部分情境十分有吸引力，最高仍為 `Advance`。

### `Invest Candidate`

在目前可用資料、明示假設、估值及生效 Fund Policy 下具有投資價值，建議
進入最終投資審查。

它不是：

- 投資委員會批准；
- 投資指示；
- 資金承諾；
- 對外要約；
- 不需進一步 DD 的保證。

對沒有正式 Investment Committee 的 Solo GP，意思是「建議進入最終決策與
交易條件確認」。

### Deterministic Decision Policy

每個 run 綁定 immutable、具版本的 Decision Policy。規則依以下固定順序執行：

1. 驗證 Router applicability、Evidence Pack 及最低模型輸入。
2. 依 Critical Evidence Profile 設定 decision ceiling。
3. 套用 mandate mismatch 與 hard veto。
4. 分別計算 Company Quality、Price Attractiveness 與 Fund Fit 的規則狀態。
5. 套用 valuation、return、ownership 及 concentration 門檻。
6. 以 versioned decision matrix 映射為四種 decision。
7. 保存所有 fired rule，不讓 LLM 更改結果。

`Invest Candidate` 必須同時滿足：

- 沒有 hard veto；
- critical evidence complete；
- Company Quality 通過；
- Price Attractiveness 通過；
- Fund Fit 通過。

`Pass／Watch／Advance` 的 mapping 也必須由 Decision Policy 定義，不能由 prompt
臨場決定。正式 trace 逐條保存
`decision_rule_id → typed input → result → ceiling／veto`。LLM 只能將此結果
解釋成人類可讀的文字。

`Core-only analysis` 只有在該 context 存在已發布的 Critical Evidence Profile、
受支援的 valuation method 與可接受的 Benchmark Pack 時，才可能輸出
`Invest Candidate`；否則最高為 `Advance`。

## Fund Policy

### Ownership

Fund Policy 目前以 workspace 為 ownership boundary，符合第一階段單一使用者
產品，同時為未來同一基金內多位 Partner／Associate 共用保留空間。

每次 Underwriting Run 保存完整 policy snapshot，不在執行中途讀取可能變動的
Active Policy。

Fund Policy 只保存基金層級規則，例如 mandate、risk、check、ownership、
reserves、concentration、horizon 及 return requirements；它不保存或冒充某間
公司的 stage／business model／geography 事實。

每個候選另有 immutable `Underwriting Context`，由該公司的
Stage × Primary Business Model × Primary Geography × Security Type × As-of
Date 決定 Router、Critical Evidence Profile、Benchmark Pack 及 Valuation Method
Policy。一次 batch 可以包含多種 context；所有候選共用同一份 Fund Policy
snapshot，但各自固定自己的 context 與 benchmark snapshot。

### 必要欄位

Fund Policy 至少涵蓋：

- stage mandate；
- sector／business-model mandate；
- geography mandate；
- base currency；
- risk preference；
- committed fund size／investable capital；
- remaining deployable capital；
- initial check range；
- target ownership range；
- optional hard minimum ownership；
- follow-on／pro-rata policy；
- reserve assumption；
- portfolio concentration limit；
- existing company／sector exposure（可用時）；
- target MOIC／IRR；
- investment horizon；
- acceptable dilution；
- scenario policy；
- valuation-method preference／constraints；
- hard vetoes；
- missing-evidence behavior；
- human final approval；
- external-action mode。

Target ownership 支援：

- target range；
- optional hard minimum；
- `No ownership target`。

精確 ownership 需要 fully diluted cap table。資料不足時，只能顯示近似值或
unavailable，不得假裝精確。

### Balanced Recommended Policy

新 workspace 預設使用 `Balanced Recommended Policy`。即使使用者尚未建立
自訂 Policy，Underwriting Run 也會固定保存當次解析出的推薦 Policy snapshot，
並可產生全部四種 decision。

Balanced 代表：

- 同時重視市場／Founder upside、公司證據、估值與風險；
- 不因早期公司缺少不適用的 late-stage 指標而自動扣分；
- 不因公司故事吸引人而忽略價格及 terms；
- 不因單一 benchmark 未達標而直接 hard veto；
- 關鍵資料缺失時採用 `Advance` 降級規則；
- 外部行動永遠為 draft-only；
- 最終投資永遠需要人類批准。

### 推薦預設值分流

推薦值分成兩層：

- Fund-level defaults：依使用者選擇的主要基金策略，填入風險、check、
  ownership、reserve、horizon 及 return target。
- Candidate context defaults：依每間公司自己的 Underwriting Context 選取
  evidence threshold、valuation method、benchmark 與情境先驗。

Candidate context preset 的選擇鍵為：

> Stage × Primary Business Model × Primary Geography × Security Type × As-of Date

不能只依融資階段選擇，因為同階段的 SaaS、Enterprise AI、Consumer、
Marketplace、硬體或生命科學公司具有不同 evidence、margin、capital needs
及 pricing distributions。

每個候選只選一個 primary underwriting context。不實作跨階段、多商業模式或
多地區 benchmark 自動加權；若候選 context 無法唯一解析，必須由使用者確認，
不得挑選最接近的 cohort。

### `Apply Recommended Defaults`

使用者選擇主要基金策略，按下 `Apply Recommended Defaults` 後：

1. 系統從 server-owned、具版本的 preset 取得全部值。
2. 空白 profile 直接填入並立即生效。
3. 預設值可直接支持 `Invest Candidate`。
4. 不要求逐欄確認或額外 Publish 動作。
5. 若 profile 已有 Custom 值，先顯示將被覆蓋的 diff。
6. 套用後建立新的 immutable policy version。
7. 使用者可以回復上一版本。

這個動作不會把使用者選擇的主要策略強制套用到所有候選。候選的 Benchmark、
Critical Evidence Profile 與 valuation method 永遠依其 Underwriting Context
逐公司解析並保存。

### 欄位來源

每個欄位保存並顯示：

- `Benchmark`：外部市場參考；
- `Recommended`：系統提供的 Balanced starter policy；
- `Custom`：使用者自行修改；
- `Assumption`：某個公司情境使用的輸入，不屬於永久 Fund Policy 事實。

報告必須標示：

> 本分析使用 Balanced Recommended Policy；部分基金參數為系統推薦預設，
> 而非使用者自行設定。

並列出對 decision 影響最大的預設參數。

### Benchmark 與 Policy 的界線

市場 benchmark 描述觀察到的 cohort，不能自動變成 hard gate。

可直接作為 benchmark reference 的項目包括：

- round valuation、round size 與 dilution distribution；
- stage／model-specific growth；
- gross margin；
- GRR／NRR；
- CAC payback；
- burn multiple／efficiency；
- runway；
- customer concentration；
- public/private valuation multiple；
- benchmark sample、period、geography 與 percentile。

會影響 Fund Fit 或 decision 的數值，即使由 benchmark 推導，仍標示為
`Recommended` policy，而不是客觀市場事實。

具體預設數值不寫死在本設計文件。實作使用一份獨立、版本化且可測試的
Benchmark／Preset Pack；每個值必須保存 provider、as-of date、cohort、
geography、business model、統計口徑、sample notes 與來源 URL，並分開保存：

- observation start／end；
- publication、retrieval 及 effective date；
- inclusion／exclusion rules；
- sample size、percentile 及 outlier treatment；
- pre／post-money 與 metric definition；
- stale threshold。

Comparable set 必須在看到 valuation output 之前，由 versioned selection policy
確定，避免 look-ahead bias 或 cherry-picking。唯一可用價格 benchmark 已超過
stale threshold 時，不得只降低信心後仍無條件支持 `Invest Candidate`。

### Benchmark 更新

- 更新不會自動改寫既有 policy version。
- 更新不會重跑或改寫既有 underwriting result。
- UI 顯示新版本可用及差異。
- 使用者套用後才建立新 policy version。
- 沒有可靠 cohort 時，不得靜默改用最接近的 cohort。
- 可顯示鄰近 cohort 作參考，但預設不將其用作決策門檻。
- 每個候選固定自己的 Benchmark Pack snapshot；同一 batch 不要求所有公司使用
  同一 cohort。

## Framework Library

### 原則

產品不建立「Peter Thiel Agent」或聲稱模仿名人。它建立具來源歸屬、版本及
適用條件的投資框架，例如：

> Contrarian Monopoly Lens — based on Peter Thiel's public writings and interviews

每個框架顯示完整判斷、來源、版本、適用條件及限制。

### Framework Card

每一張 Framework Card 至少保存：

- framework ID、名稱與版本；
- source title、author、edition、publisher、year、ISBN、immutable document hash；
- chapter、printed page、PDF page 或 ebook location；
- admin-only supporting passage；
- neutral paraphrase；
- paraphrase reviewer、approval status 與 rights／license status；
- claim type：實證關聯、歷史描述、規範性建議、契約慣例或產品應用推論；
- applicable stage、business model、sector、geography 及 security type；
- required conditions；
- required evidence；
- decision questions；
- positive signals；
- red flags；
- disconfirming evidence；
- scoring anchors 或 deterministic rule；
- confidence；
- contraindications；
- corroborating／conflicting framework IDs。

Framework Card 預設使用中性改寫。只有措辭不可替代時才保存短引用；不得重製
整章、圖表、工作表或足以取代原書的濃縮內容。發布流程執行 quote-length
check；對使用者顯示的 attribution 必須說明「根據公開來源整理，不代表本人
背書或提供投資意見」。

### 八個 Universal Core lenses

1. Market Size & Why Now
2. Founder & Unique Insight
3. Product-Market Fit & Customer Evidence
4. Contrarian Monopoly
5. Durable Competitive Power
6. GTM & Unit Economics
7. Revenue Quality & Retention
8. Valuation & Fund Return

每個 lens 都必須回答：

- 此框架是否適用？
- 使用了哪些證據？
- 最強支持理由是什麼？
- 最強反對或反證是什麼？
- 哪項未知數最重要？
- 框架自己的結論及信心是什麼？
- 它與哪些框架意見不同？

每個 criterion／claim 個別保存 `evidence_refs` 與 `framework_rule_ref`。信心
不得只用一個模糊分數，至少分開保存：

- source reliability；
- evidence strength；
- evidence coverage；
- applicability confidence；
- judgment confidence。

每一維使用具文字 anchor 的固定 ordinal scale，不得將不同信心維度簡單平均
成最終 decision。

### B2B SaaS／Enterprise AI specialist

第一個 A-depth 專項模組涵蓋：

- ARR 定義及 recurring／services／pass-through 拆分；
- ARR growth、GRR、NRR、logo retention；
- gross margin 與 contribution margin；
- CAC payback、LTV/CAC 及 founder-led sales 限制；
- pilot-to-paid、POC-to-production、time-to-value；
- sales cycle、pipeline、win/loss、rep ramp、quota attainment；
- customer concentration；
- burn multiple、efficiency、runway、FCF path；
- inference／model API cost；
- human review／FDE／custom implementation burden；
- task-level margin；
- eval design、quality drift、fallback；
- data rights、security、compliance；
- model provider concentration；
- AI feature 是否形成 workflow、data、distribution 或 switching-cost moat。

在沒有足夠 specialist module 的產業，系統使用 Universal Core 並明確標示
`Core-only analysis`，不得虛構產業專業 benchmark。

### 初始來源庫

第一批核心來源：

1. *The Venture Mindset* — Ilya Strebulaev、Alex Dang（2024）
2. *Secrets of Sand Hill Road* — Scott Kupor（2019）
3. *Zero to One* — Peter Thiel、Blake Masters（2014）
4. *Super Founders* — Ali Tamaseb（2021）
5. *7 Powers* — Hamilton Helmer（2016）
6. *The Dark Side of Valuation*, 3rd Edition — Aswath Damodaran（2018）
7. *Venture Capital and the Finance of Innovation*, 3rd Edition —
   Andrew Metrick、Ayako Yasuda（2021）
8. *Expectations Investing*, Revised and Updated —
   Michael Mauboussin、Alfred Rappaport（2021）
9. *Venture Deals*, 4th Edition — Brad Feld、Jason Mendelson（2019）
10. *Narrative and Numbers* — Aswath Damodaran（2017）

第二批補強來源：

- *The Business of Venture Capital*, 3rd Edition — Mahendra Ramsinghani（2021）
- *The Most Important Thing Illuminated* — Howard Marks（2013）
- *The Power Law* — Sebastian Mallaby（2022）
- *The Cold Start Problem* — Andrew Chen（2021）
- *The Founder's Dilemmas* — Noam Wasserman（2012）
- *Obviously Awesome*, Updated and Expanded 2nd Edition —
  April Dunford（2026）
- *Scaling People* — Claire Hughes Johnson（2023）

Marc Andreessen、Bill Gurley、Sequoia／Don Valentine、Mike Moritz 等沒有單一
完整著作的框架，使用官方文章、演講、訪談及公開 memo 建立獨立 source pack。

### 著作權與存取

- 電子書必須由產品管理者合法取得。
- 原始電子書保存在 admin-only 私有來源庫。
- 一般使用者不能瀏覽或下載整本書。
- 正式報告只使用必要的中性改寫、短引用及頁碼。
- 不逐頁摘要，不建立足以替代原書的重建版本。
- 框架來源庫與使用者 Deal corpus 分開管理。
- 原始 Framework Source 與 authoring lifecycle 為 platform／admin scoped；
  workspace 只引用 immutable published Framework Pack version。
- Framework Card 狀態為 `draft／reviewed／published／retired`；只有
  `published` 版本可以進入正式 Underwriting。

## Stage／Maturity Router

Round label 與 operating maturity 分開保存。Series A 不保證已有 PMF，具備
$5M ARR 也不保證 GTM 可重複。

Router 依下列資訊選擇分析路徑：

- round stage；
- product status；
- paying customer status；
- ARR／revenue scale；
- cohort maturity；
- GTM repeatability；
- profitability／FCF maturity；
- primary business model；
- primary geography；
- AI subtype；
- available evidence。

不適用的指標顯示 `Not applicable`，不以 0 分處理。

Router 使用 versioned enums、rules 及固定 precedence，不由 LLM 自由挑選
profile。來源明示值、使用者已確認值與推導值分開保存；若 primary stage、
business model、geography 或 security type 衝突而無法唯一解析，要求使用者
確認，該候選在確認前不執行需要該 context 的 valuation／decision。

## 各階段承保與估值

### Pre-seed

主要證據：

- Founder integrity、domain credibility 與 founder-market fit；
- problem frequency／severity 及 economic buyer；
- Why Now；
- prototype／MVP；
- customer discovery、design partner 或 commitment；
- Enterprise AI 的 task baseline、eval、data rights、cost per task、安全可行性；
- SAFE、discount、MFN、pro-rata、option pool 等條款。

主要方法：

- SAFE／cap-table conversion scenarios；
- 同 stage、geography 及 business model 的市場價格比較；
- 寬區間 Venture Return scenarios；
- milestone／survival paths。

禁止以單點 DCF 製造精確假象。ARR growth、NRR、CAC/LTV 在尚不適用時標示
`Not applicable`。

### Seed

主要證據：

- MVP 在真實 workflow 中使用；
- paying／production evidence；
- ICP、buyer、user、ACV、sales process；
- pilot-to-paid／production；
- usage、retention、customer references；
- ARR 定義與收入品質；
- gross margin、burn、runway、customer concentration；
- AI inference、human review、deployment 及 security evidence。

主要方法：

- current software／AI private-market comps；
- revenue scenario model；
- Venture Return Method；
- SAFE conversion、option pool 及 round terms waterfall。

Founder-led sales 的 CAC/LTV 不得假裝成已可擴張的 GTM economics。

### Series A

主要證據：

- monthly ARR bridge；
- renewal coverage 充分的 cohort；
- GRR、NRR、logo churn；
- gross margin；
- ICP repeatability、pipeline、win/loss、sales cycle；
- customer references；
- burn multiple、runway；
- AI task economics、human/FDE burden、provider concentration、安全及合規；
- hiring plan 及 use of funds。

主要方法：

- quality-adjusted EV／NTM revenue comps；
- Venture Return Method；
- scenario DCF；
- future dilution、option pool 及 term waterfall。

CAC payback 只在 channel 或 rep data 足以顯示可重複時啟用。

### Series B

主要證據：

- 多個完整 retention／expansion cohort；
- fully loaded GTM economics；
- rep ramp、quota attainment、channel economics；
- gross margin 與 burn／FCF reconciliation；
- customer、security、compliance references；
- AI task-level margin improvement、FDE reuse、eval drift、fallback；
- cap table、preferences 及 future financing plan。

主要方法：

- quality-adjusted public／private EV／NTM revenue comps；
- scenario DCF；
- Venture Returns after future dilution／preferences；
- Bear／Base／Bull exit multiple sensitivity。

Rule of X 只在 maturity 合適時顯示，不直接套用在不成熟的早期公司。

### Growth

Growth 由明示 stage／ARR／GTM maturity 規則判定，不由模型自由猜測。

主要證據：

- reconciled／audited financials；
- board plan vs actual；
- multi-year cohorts；
- revenue-quality split；
- operating leverage、cash conversion 與 FCF path；
- market share、win/loss、product expansion；
- full cap table、liquidation preferences、secondary terms；
- AI provider cost exposure、margin trajectory、eval 及 compliance at scale。

主要方法：

- full scenario DCF；
- public comp regression；
- precedent transactions；
- term-aware waterfall；
- secondary／IPO／M&A scenarios；
- price-implied expectations。

## Valuation Engine

### 輸入

- Evidence Pack 中符合該 Critical Evidence Profile 接受標準的 Fact；
- Bear／Base／Bull Assumption；
- versioned market benchmark／comp set；
- active Fund Policy snapshot；
- round terms 與 cap table；
- deterministic formula version。

財務值不得使用 JavaScript binary float 作為 authoritative output。Money 使用
decimal string／PostgreSQL `numeric`，並明示 amount、currency、scale 及
as-of date；Rate 與 Period 具有獨立型別。FX conversion 必須綁定 provider、
rate date 及版本，rounding 只在顯示邊界執行。

### 主要模型

- market pricing comparison；
- private／public comparable companies；
- Venture Capital Method；
- scenario DCF；
- reverse DCF／price-implied expectations；
- SAFE／note conversion；
- option pool adjustment；
- future dilution；
- liquidation waterfall；
- ownership and return-the-fund analysis；
- MOIC／IRR；
- sensitivity and break-even analysis。

每個 Formula Contract 必須固定：

- input／output value type；
- enterprise-to-equity bridge；
- pre-money、post-money、SAFE cap 與普通股價值定義；
- base currency、FX source 及 FX date；
- security class；
- cash-flow timing 及 day-count；
- dilution、follow-on、option pool 與 preferences；
- gross deal-level 或 net fund-level 口徑；
- rounding、invalid domain 及 fallback。

第一批只宣稱 `gross deal-level MOIC／IRR`。沒有完整 fund fee、carry 及 cash-flow
資料時，不輸出 net fund return。Security term normalization 必須明列受支援的
SAFE、note 及 preferred terms、seniority、conversion、participation；無法表示
的條款標示 `unsupported_terms`，阻止受影響計算並套用 decision ceiling。

### Valuation Method Policy

每個 Underwriting Context 在運算前綁定 versioned Valuation Method Policy，
定義：

- 適用、主要及只供參考的方法；
- comp selection 及任何權重；
- 不相容模型不得直接平均；
- 被排除方法及原因；
- Bear ≤ Base ≤ Bull 的 invariants；
- 使用機率加權時，機率必須合計 100%；
- 方法分歧的呈現方式。

如果該 context 沒有受支援的主要方法，系統顯示 valuation unavailable 並依
Critical Evidence／Decision Policy 降級，不能臨時讓 LLM 選一個模型。

### 情境

每個 Bear／Base／Bull 情境至少保存：

- revenue／ARR path；
- growth；
- gross／contribution margin；
- operating expenses；
- burn、cash、runway；
- future financing；
- dilution；
- exit timing；
- exit method；
- terminal／exit multiple；
- success and failure conditions；
- probability（若 Fund Policy 使用機率加權）。

模型不得只提供單點 valuation。報告顯示 range、主要 sensitivities 及哪些變數
會使 decision 改變。

### 價格比較

報告分別顯示：

- scenario value range；
- current fundraising valuation／cap；
- current terms；
- premium／discount；
- implied ownership；
- post-dilution ownership；
- MOIC／IRR；
- maximum acceptable valuation（資料與 Policy 足夠時）；
- price-implied operational expectations。

VC Method 是目標報酬下的持股算術，不得呈現為唯一真實的 intrinsic value。
Post-money valuation 也不等於普通股公平價值；terms 與 preference 必須納入。

## 多框架推論與綜合

### 獨立執行

每個適用 lens 使用相同 Evidence Pack，並獨立產生 Framework Judgment。
Evidence Pack 是唯一公司事實輸入；`Valuation & Fund Return` lens 另可引用
已保存的 deterministic Calculation、PolicyRef 及 BenchmarkRef，但不得自行
重算或建立新數字。

Lens 不得：

- 搜尋自己未被核准的外部資料；
- 新增 Evidence Pack 中不存在的公司事實；
- 引用另一個 lens 尚未保存的結論作為證據；
- 直接產生最終投資 decision。

### 分歧

系統保存 disagreement graph，例如：

- 高速 growth vs revenue quality；
- AI FDE 作為 moat investment vs services degeneration；
- large TAM vs weak willingness to pay；
- exceptional company vs unacceptable price；
- contrarian insight vs missing adoption evidence。

### 綜合

Deterministic Decision Engine 接收：

- framework judgments；
- valuation results；
- evidence coverage／conflicts；
- active Fund Policy snapshot；
- candidate Underwriting Context；
- Critical Evidence Profile；
- hard veto evaluation。

它依 versioned Decision Policy 先分別輸出 Company Quality、Price
Attractiveness、Fund Fit，再產生正式 decision 與逐規則 trace。它不得重新做
數學或建立新事實。

LLM Narrative Synthesis 只解釋上述正式輸出、框架分歧與限制；不得覆寫標籤、
ceiling、veto 或任何 deterministic calculation。

## 使用者流程

### 1. Fund Policy

新使用者可直接使用 Balanced Recommended Policy，也可選擇主要基金策略後按
`Apply Recommended Defaults` 或自行修改基金層級參數。

### 2. Source upload

在 authenticated product mode，使用者可上傳 TXT、Markdown 或核准圖片。系統
完成抽取 preview 後，使用者必須確認公司 identity 與 Deal 歸屬；確認後 source
才進入 authoritative Deal repository 並取得 `analysis_eligible_at`。原檔永久
保存於 workspace-private object storage，來源檢視使用短效 signed URL。

### 3. Run Analysis

第一版由使用者手動按下。按鈕建立或重用一個可持久保存、具冪等性的 run。

### 4. Market intelligence

系統掃描近 14 天全球公開來源，產生市場摘要及具來源的事件。

### 5. Historical matching

XTrace 召回歷史 Decision Memory，系統比對所有適用 Deal status：

- passed；
- watching；
- evaluating；
- invested。

所有 eligible Deal 都得到既有 CompanyAnalysis。只有 Top 5 中／高信心
`belief_revised` 候選自動進入完整 Underwriting；其他 Deal 的
`underwriting_status` 為 `not_selected`，不是 `Pass`。

### 6. Underwriting

對排名候選建立 Evidence Pack，執行 Router、framework lenses、valuation
及 synthesis。

### 7. Report

使用者查看市場事件、受影響公司、投資框架、估值、decision、來源及下一步。

報告保留全部 eligible Deal 的市場分析，並顯示最多 5 筆完整承保結果。

### 8. Draft actions

使用者可以編輯、複製或下載草稿。產品不直接發送或發布。

### 9. Chat and Search

Chat 只查詢已持久化資料，包含 Evidence Pack、Calculation、Framework
Judgment、Disagreement、Decision Result 及版本。它不得瀏覽網路、啟動或重跑
分析、修改 Policy、重新計算或建立／發送草稿。每個 factual claim 必須附來源，
並保留五種 analysis type。

## 最終報告

### 1. 發生什麼事？

- 近 14 天重要市場事件；
- 融資與資金流向；
- 技術、政策、競爭或產業事件；
- 日期、來源與 evidence confidence。

### 2. 會有什麼影響？

- 受影響產業及 business model；
- 正面與負面影響；
- 影響機制；
- 預期時間範圍；
- 哪些歷史假設可能因此改變。

### 3. 哪些歷史公司受到影響？

- company identity；
- Deal status；
- 過去互動與 decision context；
- 本次重新出現的原因；
- 匹配事件及來源。

### 4. 公司投資分析

每個適用框架顯示：

- framework name／attribution／version；
- applicability；
- complete judgment；
- supporting evidence；
- opposing／disconfirming evidence；
- unknowns；
- confidence；
- disagreements。

### 5. 估值與基金報酬

- Bear／Base／Bull valuation；
- current fundraising valuation；
- pricing gap；
- ownership／dilution；
- MOIC／IRR；
- maximum acceptable valuation；
- sensitivity；
- Fact／Assumption／Calculation 分類。

### 6. 最終結論

- Company Quality；
- Price Attractiveness；
- Fund Fit；
- `Pass／Watch／Advance／Invest Candidate`；
- concise auditable decision trace；
- confidence、limitations 及 blocking evidence。

### 7. 你可以做什麼？

- 向 Founder 要求的資料；
- Founder／customer follow-up；
- reference call；
- DD workstream；
- milestone monitoring；
- model update；
- 最終投資審查。

### 8. 行動草稿

- Founder outreach email；
- internal VC Partner memo；
- SMS／short message；
- LinkedIn message；
- founder／customer reference questions；
- due diligence request list。

所有草稿均在 App 中產生，供使用者編輯、複製或下載；只有 `ActionDraft`
持久化，`InternalReportDraft` 維持 browser-local。兩者都沒有對外收件、寄送或
發布能力。

草稿分成兩種：

- `InternalReportDraft`：延續既有 browser-local 行為，沒有 To、API write、
  persistence 或 Send。
- `ActionDraft`：新版公司層級 artifact，保存 editable body、channel 與
  `audience_type = founder | customer | internal`；預設不保存地址／handle，
  不建立 delivery state，也沒有 provider integration 或 send／publish side
  effect。

本條款明確取代舊規格「不得產生 Founder outreach 草稿」的限制，但不取代
「不得發送或發布」。

## 系統架構

### 既有模組

- Web App；
- PostgreSQL／Supabase persistence；
- Worker；
- public market collectors；
- XTrace ingest／recall；
- Claude／Anthropic client；
- opportunity matching；
- company intelligence reports；
- report draft；
- TXT／Markdown／image upload；
- existing-data-only Chat and Search。

### 新增邊界

#### `Evidence Pack Builder`

將來源正規化為唯一承保輸入，管理衝突、缺失與 coverage。

#### `Source Revision / Deal Registry`

將 seeded 與已確認 upload 統一成 authoritative Deal、Company、Source Revision
模型；以 `analysis_eligible_at` 控制是否進入掃描，不再依固定 19 筆 cardinality
判斷報告是否合法。

#### `Benchmark / Preset Registry`

保存 versioned benchmark packs 與 stage／model／geography policy presets。

#### `Fund Policy Service`

保存 active immutable version、歷史版本、推薦預設及 run snapshot。

#### `Framework Library`

保存 framework sources、cards、packs、版本、適用條件及交叉關係。

#### `Underwriting Orchestrator`

選擇 Router、並行執行 lenses、收集 judgments，管理 partial failure。

#### `Valuation Engine`

提供 deterministic models、formula registry、scenario results 及 sensitivities。

#### `Deterministic Decision Engine`

依 Decision Policy 產生 Company Quality、Price Attractiveness、Fund Fit、
正式 decision 與逐規則 trace。

#### `Narrative Synthesis`

將既有的 deterministic 結果、框架分歧與限制整理成報告文字，不改變正式結果。

#### `Action Draft Generator`

依 decision、missing evidence 及 recommended next steps 建立 draft-only artifacts。

### 服務責任

#### XTrace

- 保存及召回長期互動；
- 保存歷史 decision context；
- 跨時間、來源及會話提供 contextual recall。

XTrace 不是引用權威。任何 recall 必須解析回本機 source lineage，證據強度不能
高於其原始來源。

#### PostgreSQL

- authoritative structured state；
- source metadata；
- Evidence Pack；
- Fund Policy／Benchmark／Framework versions；
- formula inputs／outputs；
- judgments、decisions、reports 及 drafts。

#### Claude／LLM

- source extraction；
- framework applicability；
- framework judgments；
- disagreement explanation；
- report／draft language。

所有網頁、upload、XTrace text 與 framework passage 都是 untrusted data，不是
可執行指令。Lens 沒有任意 tool access；模型輸出必須通過 schema、lineage 與
grounding validation。

#### Deterministic application code

- normalization；
- formulas；
- Decision Policy gates；
- version pinning；
- idempotency；
- schema validation；
- citation verification。

#### Public collectors

- 近 14 天市場及公司資訊；
- source catalog；
- freshness、deduplication 及 publisher metadata。

Fetcher 必須拒絕 private-network URL、危險 redirect、超過限制的內容及 MIME
mismatch。

#### Web App

- 唯一使用入口；
- source upload、extraction preview、company／Deal confirmation 與 source inspection；
- Fund Policy；
- manual run；
- progress；
- report／evidence inspection；
- draft editing／copy／download；
- existing-data-only Chat and Search。

## 持久化概念模型

實作可以沿用現有 repository pattern，但需具備以下概念 entity：

- `companies`
- `deals`
- `source_revisions`
- `source_assignments`
- `benchmark_packs`
- `benchmark_entries`
- `fund_policy_versions`
- `underwriting_contexts`
- `critical_evidence_profiles`
- `valuation_method_policies`
- `decision_policies`
- `framework_sources`
- `framework_cards`
- `framework_packs`
- `evidence_packs`
- `evidence_items`
- `evidence_conflicts`
- `underwriting_batches`
- `candidate_runs`
- `scenario_models`
- `scenario_inputs`
- `calculation_results`
- `framework_judgments`
- `framework_disagreements`
- `valuation_results`
- `decision_results`
- `action_drafts`

每一份 decision result 保存：

- workspace ID；
- Deal／company ID；
- market report／scan run ID；
- underwriting batch／candidate run ID；
- Evidence Pack version；
- Fund Policy version／snapshot；
- candidate Underwriting Context；
- Critical Evidence Profile；
- candidate Benchmark Pack version；
- Valuation Method Policy；
- Decision Policy；
- Framework Pack version；
- formula／model versions；
- LLM model、prompt、schema 及 settings version；
- application commit；
- Company Quality；
- Price Attractiveness；
- Fund Fit；
- decision；
- decision ceiling、veto 及 fired rule trace；
- confidence；
- blocking evidence；
- claim-level provenance edges；
- created at。

既有資料庫 migration 及 API 必須向後相容。舊 report URL、公司分析與市場
outcome 不能因新增 underwriting 而失效。Underwriting 以獨立 relation／composite
read model 附加到既有 Report，不回寫或改變原 `CompanyAnalysis.outcome`。

Run 層級固定為：

```text
scan_run
  -> underwriting_batch
      -> candidate_run per selected company
```

Candidate status 為
`queued／running／partial／completed／unavailable／failed`。單一 candidate
以資料庫 RPC／stored procedure 或單一 immutable artifact commit 原子發布；
不得要求跨全部 candidate 的多表全域交易。Batch 可以為 `partial`，成功
candidate 仍可使用。重試從失敗 stage 繼續，已完成且 fingerprint 相同的 LLM
或 formula 結果直接重用。

## Run trigger 與未來排程

第一版只開放：

```text
trigger = manual
```

資料契約同時支援：

```text
trigger = scheduled
```

未來每日排程只負責建立相同的 run，不建立另一套分析邏輯。`Run Analysis`
持續保留，供重跑、補資料後更新及臨時研究。

Scan、batch 與 candidate 三層都必須冪等：

- `scan_request_key` 在 collection 前由 workspace、14-day window、collector
  configuration 及 trigger 建立；collection 完成後另存由 accepted immutable
  source revisions／event IDs 組成的 `market_snapshot_fingerprint`。
- `batch_input_fingerprint` 包含 workspace、14-day window、immutable market
  snapshot、eligible Deal revision set、XTrace lineage snapshot、selected event
  IDs、matching model／prompt／schema version、scoring／selection policy、
  matching judgment fingerprint、Fund Policy snapshot，以及
  Framework／Router／Decision versions。
- 每個 `candidate_analysis_fingerprint` 包含 Deal revision、immutable
  source／Evidence Pack IDs、XTrace lineage snapshot、candidate Underwriting
  Context、Critical Evidence、Benchmark、Framework、Router、Valuation Method、
  Decision、Formula、provider model、prompt／schema version 與相關 settings。

immutable input fingerprint 永遠不因重跑改變。一般執行的 execution key 對該
fingerprint 唯一；使用者明確要求更新時，以 `force_refresh` 加入
`refresh_nonce／sequence` 並建立新的 `rerun_of_id`。相同輸入不因按鈕重複
點擊而重新花費 LLM 或產生競爭結果。

第一版將自動完整承保候選上限固定為 5，並設定 bounded concurrency、各 stage
timeout／retry、token／cost budget 與 lens-level fingerprint cache。因預算被
跳過的候選或 lens 必須顯示 truncation warning，不得被解讀為負面判斷。

## 錯誤處理

### 公開來源

- 部分來源失敗：繼續使用成功來源，報告顯示 coverage warning。
- 所有來源失敗：標示 scan failed，不得說「市場沒有變化」。
- 來源內容無法驗證：不進入 Fact。

### XTrace

- individual recall 失敗：該公司歷史 context 不完整，標示 partial。
- XTrace mode 不得靜默改用另一份記憶來源並假裝等價。
- 已存在 PostgreSQL 的原始來源仍可顯示，但必須說明缺少 XTrace contextual recall。

### LLM

- schema failure 只允許有界修復重試；
- 仍失敗則標示該 lens unavailable；
- 一個 lens 失敗不得刪除其他成功 judgment；
- synthesis 不得用缺失 lens 的虛構結果補齊；
- Decision Policy 依該 lens 是否為 context-required 決定 ceiling；partial 本身不
  被當成正面或負面 evidence。

### Benchmark

- service failure 與「沒有 benchmark」必須分開；
- sample 過小、資料過期或 cohort 不匹配時降低信心；
- 不可靠 benchmark 不得自動變成 hard gate；
- 若唯一 pricing basis 已 stale 或不相容，Price Attractiveness 不得通過，
  Decision Policy 必須套用相應 ceiling。

### Valuation

- 無效單位、幣別、期間或公式輸入時拒絕計算；
- 不能用 `0` 代替 unknown；
- 除零、負數域、IRR 不存在及多解情況必須顯示明確狀態；
- 部分模型無法執行時，保留其他可用模型並說明原因。

### Persistence

- 保存 decision、calculation、source lineage 與 version snapshot 視為一次原子操作；
- 不能只顯示未持久化的模型結論；
- 單一 candidate 的 finalization failure 使該 candidate failed；
- batch 仍可 partial，其他已原子發布的 candidate 不回滾。

### UI

UI 必須區分：

- 沒有重要市場變化；
- 缺少證據；
- 第三方服務失敗；
- 分析仍在執行；
- 某個模型不適用；
- 某個模型因輸入不足無法執行。

## 安全與隱私

- API keys 只存在 server／worker secret store，不傳到 browser。
- private sources 使用受控 object storage。
- Deal、Policy、Evidence Pack、Report、Decision 及 Action Draft 都具有
  workspace boundary。
- 原始 Framework Source 與 authoring 為 platform／admin scoped；workspace
  只引用 immutable Framework Pack version。
- 未來多使用者版本以 membership／role 控制來源與 Policy 編輯權。
- 一般使用者只能看到 framework attribution、合規短摘錄、頁碼及限制，不能
  取得原書 object 或 download URL。
- 所有 public API serializer 移除內部 prompt、provider diagnostics 及未清理錯誤。
- Framework source ingestion 與一般 Deal upload 分開。
- action draft 不具有 send／publish side effect。
- 最終投資行動需要人類批准並在本階段產品外完成。

部署具有兩個明確模式：

- `public_demo`：只使用固定 synthetic／非敏感 corpus；runtime upload、source
  mutation、Policy mutation、Framework administration 及 private-source access
  全部停用。公開 scan 可以使用固定來源並做 rate limit；reset 由 operator
  secret 保護或完全停用。
- `product`：請求具有 authenticated principal；workspace 由 server-side
  membership 解析，不接受 request JSON 自稱的 workspace；Policy／Framework
  administration 需要 role check；private object URL 短效且限 workspace；
  真實 upload 與 Policy editing 只存在於此模式。

只有 `workspace_id` 欄位不構成授權。所有既有及未來會讀寫 workspace 的
report、chat、deal、document、upload、run、reset 與其他 endpoint，都必須通過
同一個 server-side authorization boundary 及跨 workspace negative test。既有
hardcoded demo route 只允許在 `public_demo` mode 使用。

## 測試策略

### Formula unit tests

必須使用固定 fixture 測試：

- pre／post-money；
- ownership；
- option pool；
- SAFE／note conversion；
- future dilution；
- liquidation preference／participation；
- waterfall；
- MOIC；
- IRR；
- DCF；
- reverse DCF；
- scenario weighting；
- maximum acceptable valuation；
- EV／equity、pre／post-money 及 SAFE cap 不可混用；
- decimal／FX／rounding contract；
- unsupported security terms；
- Bear ≤ Base ≤ Bull；
- probability weighting 合計 100%。

### Evidence tests

- 每個重要 Fact 必須解析到真實 source；
- excerpt、頁碼、URL 及 source ID 不得遺失；
- conflict 不得被任一模型靜默覆蓋；
- management claim 與 verified fact 不得混合；
- unsupported claim 必須被 grounding validator 拒絕；
- 每個 Fact 只能引用允許的 immutable source revision；
- `demo_fixture` 不能支持外部公司 Fact；
- public URL 內容變更後仍可由 hash／snapshot 重建舊報告；
- critical conflict materiality 及 resolution 規則可重現。

### Framework tests

- 不適用框架正確 abstain；
- 每個 judgment 包含支持及反證；
- source version 正確固定；
- 只有 published Framework Card 可以執行；
- neutral paraphrase approval、rights status 及 quote-length check 生效；
- 同一 pack／evidence 產生結構穩定的輸出；
- 框架分歧被保存而非平均刪除；
- Core-only sector 不會取得不存在的 specialist benchmark。

### Policy／Benchmark tests

- 新 workspace 使用 Balanced Recommended Policy；
- `Apply Recommended Defaults` 立即建立 active immutable version；
- Custom diff 可見且可回復；
- benchmark update 不改寫舊 policy／report；
- 同一 run 固定使用同一 Fund Policy snapshot；
- 不同 candidate 依各自 context 固定正確 benchmark snapshot；
- stale benchmark 與 comp preselection 規則生效；
- Router context 衝突時要求確認，不偷選相近 cohort。

### Decision tests

- 預設 Policy 在 evidence 足夠時可以輸出 `Invest Candidate`；
- 關鍵公司 Fact 缺失或 unresolved 時不得輸出 `Invest Candidate`；
- hard veto 可重現；
- 每個正式 decision 由 deterministic Decision Policy 產生；
- LLM narrative 無法覆寫 decision、ceiling 或 veto；
- 每條 fired rule 均保存 typed input 與結果；
- Company Quality、Price Attractiveness、Fund Fit 各自保存；
- `belief_revised` 不會自動變成 `Invest Candidate`；
- 相同 evidence／versions／settings 得到一致 decision contract；
- Core-only context 沒有必要 profile／model／benchmark 時最高為 `Advance`。

### End-to-end tests

使用現有固定公司與產業資料完整執行：

1. manual trigger；
2. 14-day market scan；
3. XTrace recall；
4. historical matching；
5. Evidence Pack；
6. Router；
7. core／specialist lenses；
8. valuation；
9. decision；
10. report；
11. draft actions。

測試至少涵蓋：

- evidence 充分且可得到 `Invest Candidate`；
- 關鍵資料不足而降級為 `Advance`；
- 好公司但價格過高；
- 市場訊號存在但公司品質不足；
- XTrace partial failure；
- public source partial failure；
- formula input conflict；
- Core-only unsupported sector；
- action drafts 從未真正發送；
- TXT／Markdown／image upload preview、identity confirmation 與 private source link；
- seeded 與 upload Deal 進入同一 eligible repository；
- Top 5 以外顯示 `not_selected` 而非 `Pass`；
- candidate partial failure 不破壞已完成 candidate；
- 相同 fingerprint 重用，`force_refresh` 正確連結 rerun；
- Chat 只回答持久化資料並保留逐 claim citation；
- product mode 所有既有與新增 route 的跨 workspace 請求被拒絕；
- public demo 拒絕 upload／source／Policy／Framework mutation；
- public demo 不暴露 private Deal 或 licensed framework body。

## 實作切片

下列切片只定義交付順序，不刪除本文件的完整範圍。每個切片都必須可以獨立
測試、整合及回滾；不支援的 stage／model／security 組合 fail closed，顯示
unavailable 與 decision ceiling，不得用臨時 LLM 推測補齊。

### Vertical Slice 1：可稽核的核心決策鏈

- Source Revision／unified Deal Registry；
- upload preview 與 identity confirmation；
- Evidence Pack、Fund Policy snapshot、Router；
- Critical Evidence 與 deterministic Decision Policy；
- Seed／Series A B2B SaaS／Enterprise AI；
- market comps、VC Method、simple ownership／dilution、gross MOIC／IRR；
- Universal Core、B2B SaaS／Enterprise AI specialist；
- report、Chat 與 draft-only actions。

### Vertical Slice 2：早期融資條款

- Pre-seed underwriting；
- SAFE／note conversion；
- option pool；
- 受支援 preferred terms；
- supported preference waterfall。

### Vertical Slice 3：成熟公司估值

- full DCF／reverse DCF；
- Series B／Growth stage；
- public comp regression；
- precedent transactions；
- 完整 sensitivity 與 price-implied expectations。

### Vertical Slice 4：產業擴充與自動化

- 額外 specialist sector packs；
- 額外 benchmark／preset contexts；
- scheduled trigger；
- 仍保留 manual rerun 與 draft-only external actions。

## 驗收標準

使用者查看任一正式報告時，必須能回答：

1. 發生了什麼事？
2. 為什麼會影響這家公司？
3. 哪些是公司事實，哪些是市場先驗或情境假設？
4. 每個投資框架使用什麼來源及如何判斷？
5. 各框架在哪裡同意或不同意？
6. 公司本身是否優秀？
7. 目前價格與條款是否合理？
8. 對目前 Fund Policy 是否值得投資？
9. 哪一項變數最可能改變 decision？
10. 下一步需要取得什麼資料或採取什麼行動？
11. 使用了哪個 Policy、Benchmark、Framework 及 Formula 版本？
12. 所有重要數字能否重算、所有重要 claim 能否打開來源？
13. 哪些內容是 management-reported，哪些已被 corroborated／verified？
14. 哪條 deterministic rule 產生目前 decision 或 ceiling？

產品驗收同時要求：

- 沒有證據時不捏造；
- 沒有 benchmark 時不偷偷借用不相容 cohort；
- 沒有完整公司資料時不輸出 `Invest Candidate`；
- 使用推薦 Policy 本身不阻止 `Invest Candidate`；
- Top 5 以外的公司不會被錯誤標為 `Pass`；
- 任何外部行動都只產生草稿；
- 任何更新都不改寫歷史決策；
- 來源被撤回或 identity 更正時，舊報告保留但醒目顯示 annotation／新版；
- public demo 與 product mode 具有不同且可測試的安全邊界。

## 參考市場來源

實作 Benchmark／Preset Pack 時優先使用具明確 cohort 與日期的來源，包括：

- Carta fundraising and dilution benchmarks：
  <https://carta.com/data/linkedin-vc-fundraising-benchmarks-2026/>
- Carta pre-seed data：
  <https://carta.com/data/newsletter-state-of-preseed-q1-data/>
- Carta private-market state：
  <https://carta.com/uk/en/data/state-of-private-markets-q1-2026/>
- PitchBook／NVCA Venture Monitor：
  <https://nvca.org/wp-content/uploads/2026/04/Q1-2026-PitchBook-NVCA-Venture-Monitor.pdf>
- Bessemer scaling and SaaS metrics：
  <https://www.bvp.com/atlas/the-founders-playbook-for-scaling-to-1-million-arr>
  <https://www.bvp.com/atlas/scaling-from-1-to-10-million-arr>
  <https://www.bvp.com/atlas/the-rule-of-x>
- Bessemer Enterprise AI benchmark：
  <https://www.bvp.com/atlas/the-state-of-ai-2025>
- Damodaran current valuation data：
  <https://pages.stern.nyu.edu/adamodar/New_Home_Page/datacurrent.html>

不同 provider、期間、industry mix 及 pre／post-money 定義的資料，不得直接
平均成單一「市場估值」。

## 已核准的產品決策摘要

- 主要使用者：中小型 VC Fund 的 Partner／GP；Associate 為次要使用者。
- 產品從市場變化與歷史 Deal 重新發現，延伸至正式投資承保。
- 先掃描市場，再找歷史公司，最後評估公司當前狀態。
- 近 14 天全球公開資訊。
- 所有 eligible Deal 保留市場分析，Top 5 中／高信心 `belief_revised` 候選進入
  完整 Underwriting。
- TXT、Markdown 與核准圖片可上傳、預覽並確認 Deal；固定 PDF corpus 保留為
  preloaded source。
- XTrace 保存長期投資脈絡；PostgreSQL 保存正式結構化狀態及計算。
- Claude／LLM 與 XTrace 是分開的服務。
- 第一版手動執行；未來每日自動執行並保留手動重跑。
- 行動只產生草稿。
- 框架具名、附來源、版本及適用條件，不進行名人角色扮演。
- 各框架顯示完整判斷與分歧。
- Universal Core 廣泛覆蓋，B2B SaaS／Enterprise AI 為第一個 A-depth specialist。
- Fund Policy 支援一鍵推薦預設及使用者風險偏好。
- 預設風險偏好為 Balanced。
- Candidate context 預設依 Stage × Business Model × Geography × Security Type ×
  As-of Date 分流。
- Fund Policy 是基金層級；每個候選依自己的 context 綁定 Critical Evidence、
  Benchmark 與 Valuation Method Policy。
- 預設值立即生效，可直接支持 `Invest Candidate`。
- 最低模型輸入足夠、但關鍵公司 Fact 未達接受標準時，仍完成情境分析但最高為
  `Advance`；最低輸入不足時，Underwriting 為 unavailable 且不產生 decision。
- `Invest Candidate` 表示建議進入最終投資審查，不表示投資已批准。
- 正式 decision 由 deterministic Decision Policy 產生，LLM 只負責判斷素材與
  說明。
- Chat 只查詢已持久化資料。

## 未決產品問題

沒有尚待使用者決定的產品問題。進入功能開發前，implementation plan 必須將
本文件已定義的資料 schema、versioned rule contracts、API、migration、security
mode 及測試 fixture 固定成可獨立驗證的任務，不得由實作 Agent 另行改變產品
規則。
