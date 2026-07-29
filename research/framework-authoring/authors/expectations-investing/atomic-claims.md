# Expectations Investing 原子主張

版本：0.1  
研究截止日：2026-07-28

## EI-CLM-001 — 從價格反推 conditional expectations

- 類型：`direct_doctrine`
- 來源：`EI-P2-BOOK-2021`, `EI-P1-CBS-ABSTRACT`, `EI-P1-ABOUT-FAQ`
- 中性主張：分析從可觀察價格出發，反推一組可與該價格相容的未來 sales、cost、
  investment 與 cash-flow expectations，再判斷未來修正方向。
- 限定：反推結果依賴已固定的其他假設，不是唯一市場信念。

## EI-CLM-002 — 三步流程須保持分離

- 類型：`direct_doctrine`
- 來源：`EI-P1-ABOUT-FAQ`, `EI-P1-CHAPTER-SUMMARIES`
- 中性主張：先估 price-implied expectations，再找 expectations opportunity，最後
  才在成本與 margin of safety 下做 buy/sell/hold；描述、判斷與行動不是同一步。
- 限定：VC 產品中的最終動作改由 Fund Policy 與 deterministic Decision Policy 處理。

## EI-CLM-003 — 核心輸入是 future cash flow

- 類型：`direct_doctrine`
- 來源：`EI-P1-ABOUT-FAQ`, `EI-P1-TUTORIAL-1`
- 中性主張：價值取決於 cash-flow amount、風險調整後的 required return 與等待時間；
  EPS、P/E 或敘事不能代替 cash-flow bridge。
- 限定：private startup 的 required return 不可從 public-company WACC 直接複製。

## EI-CLM-004 — Expectations infrastructure 連接 trigger、factor 與 driver

- 類型：`direct_doctrine`
- 來源：`EI-P1-CBS-ABSTRACT`, `EI-P1-CHAPTER-SUMMARIES`, `EI-P1-ABOUT-FAQ`
- 中性主張：sales、cost、investment 等 value triggers 應連到 volume、price/mix、
  operating leverage、scale、cost efficiency 與 investment efficiency 等可驗證因素，
  再連到 valuation drivers。
- 限定：不同 business model 的 factor mapping 不同。

## EI-CLM-005 — Revenue expectations 需拆 volume、price 與 mix

- 類型：`direct_doctrine`
- 來源：`EI-P1-ABOUT-FAQ`, `EI-P1-TUTORIAL-2`
- 中性主張：sales growth 應由歷史資料、公司指引、獨立研究與 low/base/high cases
  支持，並拆分 volume、price 與 mix。
- 限定：無客戶或 pre-revenue 公司只能使用 milestone/driver scenarios，不可虛構收入。

## EI-CLM-006 — Margin expectations 需有經濟機制

- 類型：`direct_doctrine`
- 來源：`EI-P1-ABOUT-FAQ`, `EI-P1-TUTORIAL-3`
- 中性主張：margin revision 應連到 selling price、mix、economies of scale 或
  cost efficiency，而非只增加 spreadsheet 百分點。
- 限定：unit economics、gross margin 與 operating margin 不可互換。

## EI-CLM-007 — Growth 必須包含 working 與 fixed capital

- 類型：`direct_doctrine`
- 來源：`EI-P1-TUTORIAL-4`, `EI-P1-TUTORIAL-5`, `EI-P1-TUTORIAL-8`
- 中性主張：free cash flow 從 operating profit 與 cash taxes 扣除 incremental
  working/fixed capital；只提高收入而忽略再投資會高估價值。
- 限定：capitalized software、acquisitions、stock compensation 等分類需與 DSV 模型對齊。

## EI-CLM-008 — Price-implied expectations 需要 equity bridge

- 類型：`direct_doctrine`
- 來源：`EI-P1-TUTORIAL-8`
- 中性主張：先計算 operating free cash flow，再加入 non-operating assets、扣除 debt
  與其他 claims，才可把 enterprise-side forecast 與 market equity value 對齊。
- 限定：每個 value object 必須同日期、同幣別、同 security owner。

## EI-CLM-009 — Implied forecast period 是 conditional output

- 類型：`direct_doctrine`, `product_inference`
- 來源：`EI-P1-TUTORIAL-8`, `EI-A1-CAP-2026`
- 中性主張：固定 sales、margin、investment、cost of capital 與 residual assumptions
  後，可延長明示 forecast 直到 present value 與價格相容，得到 conditional implied
  forecast/competitive-advantage period。
- 限定：其他假設改變會改變 implied period；不得把它當直接觀察事實。

## EI-CLM-010 — 一個價格通常不能唯一識別所有 drivers

- 類型：`product_inference`
- 來源：`EI-CLM-001` 至 `EI-CLM-009`
- 中性主張：單一價格方程同時包含 growth、margin、reinvestment、duration 與 discount
  rate，多個未知數會產生多組解；系統必須一次反推一個 driver 或輸出 joint feasible set。
- 限定：所有被固定的 anchors 必須顯示並做 sensitivity。

## EI-CLM-011 — 私人募資輪需先 normalize security

- 類型：`product_inference`, `empirical_qualification`
- 來源：`EI-E1-PRIVATE-VALUATIONS-2017`, `VCFI-CLM-009` 至 `VCFI-CLM-015`
- 中性主張：preferred round price 含 liquidation、conversion、participation 與其他
  rights value；headline post-money 不可直接作為 common-equity intrinsic value 或
  reverse DCF target。
- 限定：需完整 term sheet、cap table 與 prior-round stack。

## EI-CLM-012 — 私人 round price 不必代表廣泛市場共識

- 類型：`product_inference`, `empirical_qualification`
- 來源：`EI-E1-PRIVATE-VALUATIONS-2017`
- 中性主張：inside/strategic/bridge round、稀疏競價、signaling、條款交換與投資人權利，
  可能使 round price 只反映特定交易；輸出應稱為 transaction-implied expectations。
- 限定：不能把外部研究的平均差距套用到個案。

## EI-CLM-013 — 找出最敏感的 turbo trigger

- 類型：`direct_doctrine`, `product_inference`
- 來源：`EI-P1-ABOUT-FAQ`, `EI-P1-CHAPTER-SUMMARIES`
- 中性主張：敏感度與 strategy analysis 應找出對價值最重要且可被新證據更新的 trigger，
  並區分 business sensitivity 與 evidence uncertainty。
- 限定：最敏感不等於最可能改善，也不自動成為 action。

## EI-CLM-014 — Strategy 判斷 expectations revision 的可行性與持久性

- 類型：`direct_doctrine`, `affiliated_doctrine`
- 來源：`EI-P1-CHAPTER-SUMMARIES`, `EI-A1-MOAT-2024`, `EI-A1-CAP-2026`
- 中性主張：competitive analysis 檢驗 sales、margin、reinvestment 與 duration 的修正
  是否具有機制；value creation 同時取決於 return-cost spread、可投入資本與持續時間。
- 限定：後兩項為 Mauboussin 後續附屬研究，不能歸因為二位作者共同原文。

## EI-CLM-015 — Base rate 是 prior，不是答案

- 類型：`affiliated_doctrine`
- 來源：`EI-A1-BASE-RATES-2026`
- 中性主張：先選擇與 stage、business model、geography、cohort 相符的 reference class，
  再以公司特定證據更新；分布本身可能隨時間改變。
- 限定：沒有合適 reference class 時應降低 confidence，而非選方便的平均數。

## EI-CLM-016 — Probability、payoff、expected value 與 edge 必須分開

- 類型：`direct_doctrine`, `affiliated_doctrine`
- 來源：`EI-P1-CHAPTER-SUMMARIES`, `EI-A1-EXPECTED-VALUE-2025`
- 中性主張：每個情境需有 probability 與 payoff，再形成 expected value；估值差、margin
  of safety 與 position sizing 是不同物件。
- 限定：VC security payoff 仍需 VCFI waterfall；LLM 不計算。

## EI-CLM-017 — Event 只形成 revision hypothesis

- 類型：`direct_doctrine`, `product_inference`
- 來源：`EI-P1-CHAPTER-SUMMARIES`
- 中性主張：macro shock、management change、regulation、lawsuit、issuance 等事件要先
  映射到 trigger/factor/driver，再判斷方向、幅度、時間與證據；事件本身不自動利多利空。
- 限定：沒有公司 exposure 與 causal bridge 時只可建立 Watch。

## EI-CLM-018 — Intangible accounting adjustment 不改變 free cash flow

- 類型：`direct_doctrine`, `affiliated_doctrine`
- 來源：`EI-P1-ABOUT-FAQ`, `EI-A1-ROIC-2022`
- 中性主張：為分析 invested capital 與 operating return，可將部分 intangible expense
  重分類為投資，但 reconciliation 不得創造現金或改變總 free cash flow。
- 限定：capitalization life 與 amortization 需明示，並與會計原始資料對帳。

## EI-CLM-019 — Existing business 與 growth option 不得 double count

- 類型：`direct_doctrine`, `product_inference`
- 來源：`EI-P1-TUTORIAL-10`, `EI-P1-ABOUT-FAQ`
- 中性主張：若不確定 growth opportunity 另以 real option 表示，必須先從 existing-business
  DCF、explicit growth 與 terminal value 排除同一 cash flow。
- 限定：沒有 exclusivity、exercise cost、finite window 與 identifiable project 時不適用。

## EI-CLM-020 — Expectations lens 不能自行輸出 Invest Candidate

- 類型：`product_inference`
- 來源：`EI-CLM-001` 至 `EI-CLM-019`
- 中性主張：本 Pack 產生 transaction-implied expectation、revision hypothesis、
  scenario value 與 evidence gap；最終投資分類仍由 VCFI、Fund Policy 與 deterministic
  Decision Policy 決定。
- 限定：所有 research cards 在 validation 前 formal weight 為 0。
