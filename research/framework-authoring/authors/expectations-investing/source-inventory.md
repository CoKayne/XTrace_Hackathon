# Expectations Investing 公開來源清單

研究截止日：2026-07-28  
狀態：`draft / public-source pass`

## 定位與歸屬

本 Pack 的核心歸屬是 Michael J. Mauboussin 與 Alfred Rappaport 共同撰寫的
《Expectations Investing: Reading Stock Prices for Better Returns, Revised and
Updated》（Columbia University Press，2021）。

來源分為三層：

1. **P2 正式出版資訊**：Columbia University Press 書目與公開 front matter；
2. **P1 作者官方配套**：官方 chapter summaries、FAQ 與 tutorials；
3. **A1 後續附屬研究**：Mauboussin 與 Morgan Stanley Investment Management
   同事的公開研究，只能標示為後續 affiliated doctrine，不能靜默歸因給 Rappaport
   或 2021 年書籍。

NBER 的私人公司估值研究僅作外部 empirical qualification。

## 已取得的核心來源

| ID | 來源 | 可支持內容 | 限制 |
|---|---|---|---|
| `EI-P2-BOOK-2021` | Columbia University Press 書目 | 版本、出版資料、高階方法與章節結構 | 不是全文 |
| `EI-P2-FRONTMATTER-2021` | 官方 front matter | 作者、版本、版權與 ISBN | 不支持章節細節 |
| `EI-P1-CBS-ABSTRACT` | Columbia Business School faculty record | inverse DCF、expectations infrastructure | 摘要層 |
| `EI-P1-CHAPTER-SUMMARIES` | 官方章節摘要 | 各章問題、順序與公開概念 | 不支持未公開公式 |
| `EI-P1-ABOUT-FAQ` | 官方 FAQ | 三步流程、cash-flow focus、trigger、strategy、intangibles、real options | 公開摘要 |
| `EI-P1-TUTORIAL-1` | Present value tutorial | cash flow、風險與時間 | 公開公司教學例 |
| `EI-P1-TUTORIAL-2` | Sales growth tutorial | sales evidence 與情境 | 不提供新創專屬 base rate |
| `EI-P1-TUTORIAL-3` | Operating margin tutorial | margin 及其經濟驅動 | 需依 business model 改寫 |
| `EI-P1-TUTORIAL-4` | Working capital tutorial | 增量 working capital | 早期新創資料可能不足 |
| `EI-P1-TUTORIAL-5` | Fixed capital tutorial | 增量 fixed capital | acquisition 等輸入需重分類 |
| `EI-P1-TUTORIAL-6` | Cash tax tutorial | book tax 與 unlevered cash tax | 稅制需另行確認 |
| `EI-P1-TUTORIAL-7` | Cost of capital tutorial | 公開公司 WACC 架構 | 不可直接套用私人新創 |
| `EI-P1-TUTORIAL-8` | Price-implied expectations tutorial | FCF、non-operating items、equity bridge、implied forecast period | 主要為上市股票 |
| `EI-P1-TUTORIAL-10` | Real-options tutorial | existing business 與 growth options 分離 | 需防 double count |
| `EI-A1-MOAT-2024` | Measuring the Moat | ROIC spread、reinvestment、duration | 後續附屬研究 |
| `EI-A1-ROIC-2022` | ROIC research | 投資報酬與資金成本、intangibles | 後續附屬研究 |
| `EI-A1-BASE-RATES-2026` | Bayes and Base Rates 2.0 | reference class 與 evidence update | 後續附屬研究 |
| `EI-A1-EXPECTED-VALUE-2025` | Probabilities and Payoffs | probability、payoff、EV、edge 的分離 | 後續附屬研究 |
| `EI-A1-CAP-2026` | Competitive Advantage Period | spread、investment、duration | 後續附屬研究 |
| `EI-E1-PRIVATE-VALUATIONS-2017` | Gornall / Strebulaev NBER | preferred terms 使 round price 不等於 common/company value | 外部樣本不可套用個案 |

## 出版資料差異

Columbia University Press 的正式書目將本書列為 2021 年、272 頁並提供 hardcover
與 ebook ISBN。Columbia Business School faculty page 的 publisher/date 顯示方式不同。
本 Pack 以出版社書目為 canonical metadata，faculty page 僅作內容摘要來源。

## 私人新創轉接限制

原方法以具有可觀察市場價格的公開股票為主。要用在 VC 募資輪，必須先：

1. 取得實際 security、price、shares、pre/post-money、日期與完整 rights；
2. 由 `VCFI-08`／`VCFI-09` 做 preferred security normalization；
3. 明確選定要反推的是 company enterprise value、company equity value、
   common-equivalent value，或該 security 的 partial value；
4. 承認一個 round price 可對應多組 revenue、margin、reinvestment、duration 與
   required-return 組合；
5. 將結果稱為「在已列假設下可與價格相容的 expectations set」，不得說成
   「市場一致相信」；
6. 把 strategic investor、inside round、稀疏競價、條款交換與 signaling 對價格的
   影響列為反證。

## 待合法全文覆核

- 2021 revised edition 各章精確頁碼、例題、公式與用詞；
- 第 5–8 章對 price-implied expectations、revision、expected value 與 risk 的完整界線；
- 第 9–10 章對 business model、intangible investment 與 real options 的細節；
- 第 12 章 event analysis 的完整事件分類與例外。

在完成 licensed edition review 前，Cards 只能使用公開 companion material 的中性
paraphrase，且全部維持 `draft / unpublished / formalDecisionWeight=0`。
