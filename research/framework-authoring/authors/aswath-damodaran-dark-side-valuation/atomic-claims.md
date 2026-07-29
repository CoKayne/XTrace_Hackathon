# Aswath Damodaran / The Dark Side of Valuation 原子主張

版本：0.1  
研究截止日：2026-07-28

## DSV-CLM-001 — 不確定性必須被建模，而不是被精確外觀掩蓋

- 類型：`direct_doctrine`
- 來源：`DSV-P1-UNCERTAINTY`, `DSV-P1-VALUATION-INTRO`
- 中性主張：估值一定含偏誤與不確定性；增加小數位或模型複雜度不會移除它。
  應辨識最重要的不確定性，做出可更新的最佳估計並揭露敏感度。
- 限定：不確定性不是任意數字均可接受；輸入仍需來源、單位與一致性檢查。

## DSV-CLM-002 — 不同風險應放在不同模型位置

- 類型：`direct_doctrine`
- 來源：`DSV-P1-UNCERTAINTY`, `DSV-P1-YOUNG-2009`
- 中性主張：估計不確定性、公司特定與宏觀不確定性，以及離散與連續風險不應
  全部塞進同一個折現率。離散重大事件可用機率與後果，微觀風險可反映在 cash
  flow，系統性風險才主要影響 discount rate。
- 限定：實際 placement 仍取決於投資人是否分散、security 與模型口徑。

## DSV-CLM-003 — 年輕公司仍可系統性估值

- 類型：`direct_doctrine`
- 來源：`DSV-P1-YOUNG-2009`, `DSV-P1-SUPPORT-3E`
- 中性主張：缺乏歷史、負收益與高失敗率使估值更 noisy，但不代表只能用 shortcut；
  可以結合 mature-company evidence 與 company-specific evidence，逐步估計 cash
  flow、risk、survival、claims 與 liquidity。
- 限定：結果是條件式 valuation，不是精確事實，也不是自動投資建議。

## DSV-CLM-004 — Revenue 應由市場或營運驅動因果建構

- 類型：`direct_doctrine`
- 來源：`DSV-P1-YOUNG-2009`, `DSV-P1-BIG-MARKET-2015`
- 中性主張：top-down 可由市場規模、競爭與可行 share 建構；bottom-up 可由 capacity、
  units、price、conversion 與 retention 建構。兩者應在可比範圍內互相校驗。
- 限定：大市場或高市場成長不能獨立證明公司會取得收入。

## DSV-CLM-005 — 高 market share 假設必須支付其營運與競爭成本

- 類型：`direct_doctrine`
- 來源：`DSV-P1-YOUNG-2009`, `DSV-P1-BIG-MARKET-2015`
- 中性主張：若預測公司取得高 share，模型必須同時反映 capacity、sales、marketing、
  pricing、competitive response 與 reinvestment；不能只調高 revenue。
- 限定：這不是固定 market-share ceiling，而是一致性要求。

## DSV-CLM-006 — Margin 路徑需連接現況、單位經濟與穩態

- 類型：`direct_doctrine`
- 來源：`DSV-P1-YOUNG-2009`, `DSV-P1-HIGHGROW`
- 中性主張：target operating margin 可參考成熟、相近業務的公司，但必須解釋從
  現況到穩態的 operating leverage、pricing、mix、cost 與競爭路徑。
- 限定：直接套用同業平均 margin 不構成路徑證據。

## DSV-CLM-007 — Growth、margin 與 reinvestment 必須一致

- 類型：`direct_doctrine`
- 來源：`DSV-P1-YOUNG-2009`, `DSV-P1-HIGHGROW`
- 中性主張：收入成長需要資本；公開模型用 sales-to-capital ratio 將增量收入
  連到 reinvestment，穩態 growth 也必須與 return on capital 及 reinvestment rate
  一致。
- 限定：sales-to-capital 是簡化 proxy，應依商業模式調整 working capital、
  capitalized R&D、customer acquisition、hardware 與 capacity。

## DSV-CLM-008 — 風險與折現率應隨公司生命週期改變

- 類型：`direct_doctrine`
- 來源：`DSV-P1-YOUNG-2009`, `DSV-P1-HIGHGROW`
- 中性主張：年輕私人公司的營運、融資與 owner diversification 狀態會隨成長改變；
  因而 beta、cost of capital、debt capacity 與 terminal risk 不能永久固定在 today。
- 限定：不能把歷史案例中的 beta 或 total beta 直接套到所有 startup。

## DSV-CLM-009 — 失敗機率應與 going-concern cash flow 分離

- 類型：`direct_doctrine`
- 來源：`DSV-P1-YOUNG-2009`, `DSV-P1-UNCERTAINTY`
- 中性主張：離散 failure risk 可用存活機率與 distress outcome 另列，而非只提高
  discount rate；公開示例以 going-concern value 與 distress-sale value 做機率加權。
- 限定：survival prior 與 distress recovery 必須符合 stage、sector、geography、
  cohort、runway、capital access 與 security。

## DSV-CLM-010 — 一般企業存活資料只能作弱 prior

- 類型：`empirical_qualification`
- 來源：`DSV-E1-BLS-SURVIVAL`
- 中性主張：官方 cohort data 顯示 establishment survival 隨產業與 cohort 改變。
  這些資料可提醒模型使用條件化 prior，但不等於 venture-backed startup failure rate。
- 限定：缺乏匹配資料時只能降信心，不能把一般企業平均當作公司真實機率。

## DSV-CLM-011 — Bear／Base／Bull 必須是內部一致的完整情境

- 類型：`direct_doctrine`
- 來源：`DSV-P1-PROBABILISTIC`
- 中性主張：情境應圍繞少數重大 drivers，維持變數間的因果相容性；例如最高
  growth 與最高 margin 未必能同時存在。若分配概率，情境需覆蓋完整結果集合。
- 限定：三個任意 point estimates 並不自動構成情境分析。

## DSV-CLM-012 — Sequential risk 適合 decision tree

- 類型：`direct_doctrine`
- 來源：`DSV-P1-PROBABILISTIC`
- 中性主張：當價值依序通過技術、法規、商業或融資 milestone，decision tree 可將
  event nodes、decision nodes、cash flows 與後續行動分開並向後折算。
- 限定：每一 phase 概率需有 cohort 或 evidence；不能將管理者可選擇行動誤當隨機。

## DSV-CLM-013 — Relative valuation 仍需四項基本控制

- 類型：`direct_doctrine`
- 來源：`DSV-P1-MULTIPLES`
- 中性主張：multiple 必須一致定義與測量、理解其分布、連回 cash flow/growth/risk
  fundamentals，並選擇 comparables 或控制差異。
- 限定：同一產業標籤不是 comparability 的充分條件。

## DSV-CLM-014 — Young-company comparables 需額外控制生命週期與存活

- 類型：`direct_doctrine`
- 來源：`DSV-P1-YOUNG-2009`
- 中性主張：公開成熟公司與年輕私人公司在 growth、risk、cash flow、survival、
  liquidity 與 claim rights 上不同；relative valuation 並未消除 intrinsic model
  面對的問題。
- 限定：可比交易少、陳舊或條款不透明時，結果應以寬區間與低信心呈現。

## DSV-CLM-015 — Value 與 price 是不同模型

- 類型：`direct_doctrine`
- 來源：`DSV-P1-VC-PRICING-2016`, `DSV-P1-VALUATION-INTRO`, `DSV-P1-SUPPORT-3E`
- 中性主張：value 由 fundamentals、cash flow、growth 與 risk 推導；price 由其他
  市場參與者對相似資產支付什麼推導。兩者可同時有用，但必須分開展示。
- 限定：任一模型都可能錯；價差不是立即收斂的保證。

## DSV-CLM-016 — 私人市場價格含 sample、staleness 與條款問題

- 類型：`direct_doctrine`
- 來源：`DSV-P1-VC-PRICING-2016`
- 中性主張：VC pricing 常依小樣本、低頻且不透明的交易；preferred rights、
  dilution protection 與 optionality 使一輪投資價格不能直接外推到全部 common
  equity。
- 限定：本 Pack 不計算 liquidation waterfall；交由 terms/ownership service。

## DSV-CLM-017 — Real option 必須具有可辨識的排他權與期限

- 類型：`direct_doctrine`
- 來源：`DSV-P1-REALOPTIONS`, `DSV-P1-YOUNG-2009`
- 中性主張：延遲、擴張或開發機會只有在公司有足以阻擋或延遲競爭者的 rights，
  且權利存在可估期限與行使成本時，才像可估的 option。
- 限定：大 TAM、management flexibility 或「未來可以做」本身不是 real option。

## DSV-CLM-018 — 已進入 cash flow 的 growth option 不得再加一次

- 類型：`direct_doctrine`
- 來源：`DSV-P1-YOUNG-2009`, `DSV-P1-REALOPTIONS`
- 中性主張：若 expansion 已反映在 revenue、margin、reinvestment 或 terminal value，
  再加入 option premium 會重複計算；競爭可自由進入時也缺乏 company-specific option。
- 限定：只有被 base DCF 排除且通過權利與期限 gate 的 incremental cash flow 可另列。

## DSV-CLM-019 — Terminal value 必須符合穩態約束

- 類型：`direct_doctrine`
- 來源：`DSV-P1-HIGHGROW`
- 中性主張：stable growth 不可永久高於相關經濟體成長；穩態 risk、margin、
  reinvestment、return on capital 與 capital structure 應相容。
- 限定：terminal value 占比高不是自動錯誤，但要求更清楚的敏感度與可證偽假設。

## DSV-CLM-020 — 完整估值是條件式研究產物，不是 deterministic 投資決策

- 類型：`product_inference`
- 來源：`DSV-CLM-001` 至 `DSV-CLM-019`
- 中性主張：Framework Pack 應輸出 evidence-backed assumptions、Bear/Base/Bull
  values、敏感度、value-price gap、counterevidence 與未知數；terms、ownership、
  fund policy 與最終 decision 由主系統 deterministic services 處理。
- 限定：缺少公司真實數據時可使用明示 prior 做分析，但不能把 prior 說成事實。
