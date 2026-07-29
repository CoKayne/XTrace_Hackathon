# Expectations Investing Public Framework Pack — Review Notes

狀態：`draft / unpublished`

## 核心定位

這個 Pack 回答的不是「公司值多少」本身，而是：

> 在明示的模型與 security normalization 下，當前價格要求哪些營運結果成立？新證據
> 會把這些要求往哪裡修正？

它將產品既有的「發生什麼事 → 有什麼影響 → 可以做什麼」轉成：

1. **Event**：發生什麼；
2. **Exposure**：哪家公司、哪個 driver 受影響；
3. **Expectation revision**：growth、margin、reinvestment、duration、risk 哪一項改變；
4. **Valuation effect**：Bear/Base/Bull 與 transaction-implied hurdle 如何變；
5. **Action**：需要何種證據、是否 Watch/Advance，以及草稿行動。

## 最重要的私人市場修正

公開股票有一個相對可觀察、可交易的 equity price。私人新創的「價格」通常是一輪特定
preferred security 的交易價格。因此在 reverse DCF 前，必須先通過：

```text
Round terms + cap table + prior rounds
                ↓
      VCFI security normalization
                ↓
Defined valuation target and date
                ↓
Transaction-implied expectation set
```

未通過 normalization 時，系統不得：

- 用 headline post-money 代表 common-equity intrinsic value；
- 把 preferred price 套到所有 shares；
- 說「市場相信某個成長率」；
- 將 round price 與 DCF 差額直接叫 overvalued/undervalued。

## Identifiability 規則

一個 price equation 同時含有 revenue growth、margin、reinvestment、forecast duration、
terminal assumptions 與 required return。系統必須：

- 每次只反推一個指定 driver，其他 anchors 全部顯示；或
- 輸出多組 joint feasible expectations，而不是單一答案；
- 對每個 anchor 做 sensitivity；
- 明確標示 source、日期、owner 與是否為 company fact、external base rate、fund
  policy 或 analyst scenario。

## 計算責任

- LLM 不做 DCF、reverse DCF、Bayesian update、expected value 或 real-option arithmetic。
- `valuation_service` 計算 cash-flow scenarios。
- `security_waterfall_service` normalize round security。
- `expectations_solver` 反推 driver 或 feasible set。
- Framework lens 只整理 evidence、applicable rule、judgment、counterevidence、unknowns、
  conclusion 與 next evidence request。

## Missing-data 規則

- 缺 term sheet/cap table：私人 round reverse DCF 為 `insufficient_evidence`。
- 缺 operating baseline：只列需要的 driver，不生成 implied number。
- 缺合適 reference class：base-rate confidence 降低。
- 缺 causal exposure：event 只進市場摘要，不推薦公司。
- 缺 company-specific update：可因 market event 建立 Watch，但不能宣稱原疑慮已解除。
- 缺 probability support：顯示 Bear/Base/Bull，不產生 probability-weighted expected value。

## 與其他 Pack 的分工

- `DSV` 建立 revenue、margin、reinvestment、survival 與 intrinsic-value scenarios。
- `VCFI` normalize preferred security、round price、ownership 與 waterfall。
- `H7P`、`PT`、`SF`、`VM`、`SHR` 提供 strategy、team、deal、governance 與 base-rate lenses。
- `EI` 比較 transaction-implied expectations 與 evidence-supported expectations。
- Fund Policy 與 deterministic Decision Policy 才能產生最終分類。

## 主要分歧必須保留

- DSV 可認為 intrinsic value 很高，但 EI 顯示當前 round 已要求更高的 execution。
- H7P 可認為存在 Power，但 EI 可能判斷該 Power 的 duration 已被價格充分反映。
- Event agent 可判斷 sector 受益，但 EI 可能發現受益需要超出公司 capacity 的
  reinvestment。
- Base rate 可偏低，但公司特定 evidence 可產生合理 posterior；兩者不得互相覆蓋。
- Real option 可增加 upside，但若已在 explicit/terminal growth 中就必須歸零。

## 待審查

1. 完成 2021 revised edition 合法全文與精確頁碼 review；
2. 由 valuation SME 驗證 private-round bridge、identifiability 與 solver contract；
3. 由 venture counsel 驗證 security normalization terminology；
4. 以公開公司與有完整 private-round terms 的案例回測；
5. 驗證 event-to-driver mapping 的 precision、recall 與 false-positive rate；
6. 完成 content、rights、Framework Fidelity 與 Decision Utility review。

所有 Cards 現階段皆為 `draft / unpublished / formalDecisionWeight=0`。
