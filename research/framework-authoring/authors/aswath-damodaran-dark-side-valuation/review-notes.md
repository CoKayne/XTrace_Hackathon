# Aswath Damodaran / The Dark Side of Valuation Public Framework Pack — Review Notes

狀態：`draft / unpublished`

## 核心定位

這個 Pack 把年輕公司估值拆成可查核的假設與 deterministic calculation inputs，而
不是讓 LLM 自由產生一個「合理估值」。每張卡只負責一類問題，主系統負責：

- 單位、幣別、valuation date 與 security 一致性；
- Bear／Base／Bull 計算；
- enterprise value 到 equity value 的 bridge；
- current round price、ownership、dilution 與 liquidation waterfall；
- Fund Policy 與 deterministic Decision Policy。

## 必須分開的五個層次

1. **Company evidence**：已發生且有來源的收入、客戶、成本、融資與產品資料。
2. **Model assumption**：市場規模、share、margin、reinvestment、risk、survival。
3. **Intrinsic value**：由 cash flow、growth 與 risk 推導。
4. **Market pricing**：由 private/public comparables、最近一輪與 exit market 推導。
5. **Investment decision**：再加入 terms、ownership、fund return、concentration 與政策。

任何缺失都不能由語氣上的確定性補上。

## Missing-data 規則

- 可以使用 stage／sector／geography priors，但要標為 `assumption`、附來源日期與範圍。
- prior 不可顯示為公司事實，也不可偽造 revenue、retention、gross margin 或 cap table。
- 若只有 prior，仍可產生完整情境分析；最高只應產生 Research／Watch／Advance
  rationale，直到主系統的必要公司證據 gate 通過。
- 本 Pack 不直接輸出 `Invest Candidate`。

## 主要防誤用修正

- **Revenue**：TAM × share 只是 top-down hypothesis；必須與 capacity／unit economics
  或客戶 acquisition/retention 路徑交叉檢查。
- **Margin**：成熟公司 margin 是 anchor，不是自動 target；需描述 convergence path。
- **Reinvestment**：高 growth 不能免費；sales-to-capital 只是 proxy，需按商業模式調整。
- **Risk**：failure、key person、illiquidity、company-specific execution 與 macro risk
  不可全部藏在折現率。
- **Survival**：一般企業存活率只能是弱 prior；需要 venture/stage/sector cohort。
- **Scenarios**：Bear/Base/Bull 需 internally coherent，不能把每一欄最好數字拼成 Bull。
- **Relative valuation**：multiple 定義、分母期間、EV/equity 口徑與 comparables 要一致。
- **Real options**：需排他權、期限、行使成本，並先排除 double counting。
- **Terminal value**：growth、risk、margin、reinvestment 與 return on capital 要穩態相容。
- **Value vs price**：融資 round headline 不能當 common-equity true value。

## 與其他 Pack 的預期分歧

- 7 Powers 可支持長期 excess return，但不能直接決定 terminal ROC 或估值。
- Zero to One 的 monopoly／contrarian narrative 可形成 revenue、margin、duration
  hypothesis，但 DSV 要求數值與反證。
- Super Founders 的 base rate 可做 prior，不能取代 company-specific evidence。
- Venture Mindset 的 power-law 邏輯可能接受巨大 range；DSV 仍要求每個 scenario
  內部一致並揭露 value sensitivity。
- Venture Deals 與 VC Finance packs 將負責 security rights、dilution、waterfall 與
  ownership；本 Pack 不重複實作。

## 與主系統交接

- 十張卡正式決策權重均為 0。
- deterministic formulas 只描述 calculation contract；LLM 不得心算或修改公式。
- `DSV-10` 是 value/price/decision handoff guardrail，不是一個投資推薦 lens。
- 所有公開來源完成前，不零散向使用者索取電子書。
- 完成合法第三版 review、專家審核、案例 backtest 與 calibration 前不得發布。
