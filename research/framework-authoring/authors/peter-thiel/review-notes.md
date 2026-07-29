# Peter Thiel Framework Pack — Review Notes

版本：0.1  
狀態：研究 draft；未發布；不得進入正式 Decision Policy

## 已完成

- 建立來源分級與歸因邊界；
- 將 Peter Thiel 本人來源、Blake Masters 衍生課堂筆記、Founders Fund
  機構立場、公開行為與外部研究分開；
- 登錄 25 項原子主張／實證限定；
- 建立 10 張結構化 Framework Cards；
- 每張卡都有適用條件、required evidence、判斷問題、positive signals、
  red flags、disconfirming evidence、contraindications、confidence anchors、
  rights／review status；
- 每張卡的正式決策權重均為 0；
- 明確保留各卡與其他框架的重疊及分歧；
- 不保存長 prompt 或私人 chain of thought。

## 最重要的內容修正

### 1. Power law 不等於集中投資必然較佳

`PT-06` 保留兩個分開命題：

1. venture returns 具有重尾；
2. 一筆 deal 的合理性需考慮是否能實質影響基金。

但是「只投七到十間」仍是 advisory portfolio doctrine。AngelList 的公開分析
支持重尾，卻顯示沒有 selection edge 的典型十筆組合會落後廣泛市場組合。

### 2. Creative monopoly 不等於所有競爭有害

`PT-02` 將 monopoly 操作化為可持續差異化與價值捕捉，不作法律結論。
Aghion 等研究對「競爭一律有害」提供 inverted-U 的重要限定。

### 3. Founder alignment 不等於永久 founder control

`PT-07` 保留 ownership、possession、control 與成立初期路徑依賴，但加入
founder replacement 可能改善表現的反證。人格、古怪、年齡、dropout status
都不得成為正向 predictor。

### 4. Hard problems 不等於可投資

`PT-09` 將技術可行性、商業路徑、資金、法規、製造／供應與價值捕捉拆開。
Bruce Gibney 撰寫的 Founders Fund manifesto 僅標為機構 doctrine，不能寫成
Peter Thiel 本人規則。

### 5. Trend signal 同時可能是基本面與模仿

`PT-10` 要求市場情報系統分開建立：

- fundamental-change timeline；
- attention／capital timeline；
- company-specific edge；
- crowding effect on price and economics。

它不會因某產業熱門就自動加分或扣分。

## 發布前阻塞項

1. 取得官方 Y Combinator 影片 captions，保存 video ID、caption hash 與核准
   timestamp ranges。第三方可搜尋逐字稿只能作研究導航。
2. 對 Stanford eCorner PDF 與實證論文保存授權來源 revision、hash 與精確頁碼。
3. 完成跨作者 overlap graph，防止下列證據重複計分：
   - creative monopoly / 7 Powers / network effects；
   - distribution / B2B GTM specialist；
   - fund return / VC Method / Fund Policy；
   - definite agency / Venture Mindset；
   - founder alignment / Super Founders / Founder's Dilemmas。
4. 完成全書單公開來源研究後，才統一判斷 `Zero to One` 電子書是否為 Critical
   gap；目前不向使用者索取。
5. 由主系統 content reviewer 和 rights reviewer 核准後，才能從
   `research/framework-authoring/` 轉成 `seed/underwriting/framework-pack-v1`。

## 主系統接入建議

- Task 7 先載入 schema 與 `draft` cards 做 seed conversion 測試，但不得標為
  `published`；
- Framework Registry 應拒絕任何：
  - `publicationStatus != published`；
  - 欠缺 immutable source revision；
  - rights status 未通過；
  - `formalDecisionWeight > 0` 且 utility status 不是
    `validated_decision_factor` 的卡；
- Task 11 每個 lens 獨立輸出 Decision Trace，不能讓一個 lens 看見其他 lens
  的結論後再改寫自身判斷；
- deterministic Decision Policy 只讀各卡明示的 structured outputs，不讀研究
  Markdown 或未發布 authoring notes。

