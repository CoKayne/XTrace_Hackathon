# Metrick / Yasuda VC Finance Public Framework Pack — Review Notes

狀態：`draft / unpublished`

2026-07-29 source update：第三版 SSRN Chapter 1 公開節錄已直接覆核。它確認
第三版架構與 VC industry scope，但不含 Chapters 3–4 及 7–24 的方法正文，因此
不解除 `VCFI-03` 至 `VCFI-10` 的 pending review。

## 核心定位

這個 Pack 補上「公司可能很好，但這一輪 security 與 fund economics 是否值得」的
中間層。它不重複 Damodaran pack 的 operating forecast，而是把：

1. successful-exit company total value；
2. current/later-round security payoff；
3. GP／LP economics；
4. Fund Policy decision

切成四個不同、可稽核的物件。

## 三條不可破壞的邊界

### Total valuation ≠ partial valuation

DCF 或 comparables 估的是 company exit total value。Term sheet、seniority、preference、
conversion、participation、cap 與 prior rounds 決定每個 claim 的 partial payoff。

### Partial valuation ≠ headline post-money

新一輪 preferred security 的每股價格含 rights value。不能把它乘上全部 fully diluted
shares 後宣稱是 common-equity intrinsic value。

### Gross deal value ≠ LP net return

deal investment amount、committed capital、fees、carry、GP value、LP cost 與 LP value
要分開。Fund policy 的 target return 不能從其他基金、歷史平均或公開慣例直接複製。

## 公式政策

- Cards 只能描述 calculation contract 與 required inputs。
- LLM 不計算，不選擇未經確認的參數，也不補 cap table／term sheet。
- VC Method 的 arithmetic identity可以實作；target success multiple 如何由 fund policy、
  holding period、success/failure 與 cost of capital 產生，需第三版完整章節與專家覆核。
- option pricing／random expiration 是 candidate model，不是 universal truth。
- waterfall 必須由條款引擎逐輪 deterministic 執行。

## Missing-data 規則

- 缺公司 operating evidence：total valuation 為 `insufficient_evidence`。
- 缺 exit distribution：只能畫 payoff schedule，不能給 current partial value。
- 缺 prior round：later-round waterfall 與 implied post-money 為 `insufficient_evidence`。
- 缺 LPA/fund policy：可顯示 gross security economics，不能顯示 confirmed LP net result。
- 缺 future financing plan：required current ownership 只能用標示為 prior 的 retention
  range，並降低 confidence。

## 主要防誤用修正

- 不使用 headline post-money 作為全公司每股同價。
- 不把 liquidation preference 當成 guaranteed return。
- 不把 participation／cap／redemption 漏出 waterfall。
- 不把 fully diluted ownership 直接乘 exit value。
- 不把 DCF、comparables 與 option valuation 混成一個不可解釋數字。
- 不把 observed VC practice 當 normative rule。
- 不把歷史 arithmetic average return 當 hurdle。
- 不把 staged financing 一律視為 real-option bonus；需同時分析 hold-up。

## 與其他 Pack 的預期分工與分歧

- DSV 負責 revenue、margin、reinvestment、survival 與 total intrinsic value；
  VCFI 接收其 output，不重算。
- 7 Powers、Zero to One、Venture Mindset 可支持 upside persistence 或 power-law
  hypothesis；VCFI 仍要求它們落到 exit distribution、ownership 與 payoff。
- Scott Kupor pack 提供 fund/board/terms workflow；VCFI 提供 financial calculation
  contracts。
- Venture Deals pack 將補上逐條 term 的法律／談判語義；VCFI 只負責 payoff effect。
- Expectations Investing 將解讀 round price 隱含的 operating expectations；不可取代
  VCFI security normalization。

## 與主系統交接

- 十張卡正式決策權重均為 0。
- 每張 lens 獨立執行並保存分歧。
- Framework Fidelity 與 Decision Utility 分別審查。
- 完成第三版合法全文、valuation SME、venture counsel、fund operations review 與
  timestamped backtest 前不得發布。
