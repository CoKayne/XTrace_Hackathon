# Metrick / Yasuda VC Finance 原子主張

版本：0.1  
研究截止日：2026-07-28

## VCFI-CLM-001 — VC analysis 需要 total 與 partial valuation

- 類型：`direct_doctrine`
- 來源：`VCFI-P2-BOOK-2021`, `VCFI-P1-YALE-TEXTBOOK`,
  `VCFI-P1-VCVTOOLS-OVERVIEW`
- 中性主張：先估公司在 exit 的 total value，再依 term sheet 與各輪 claim 拆分為
  founders、不同輪投資人、GP 與 LP 的 partial value；不能用單一 headline valuation
  代替所有層次。
- 限定：公開材料確認架構；第三版完整計算細節仍待正文覆核。

## VCFI-CLM-002 — VC return data 必須處理 selection bias 與分布

- 類型：`empirical_qualification`
- 來源：`VCFI-E1-RISK-RETURN-2001`
- 中性主張：只觀察 IPO／acquisition 的成功 exit 會高估回報；VC return 高度波動，
  arithmetic 與 geometric averages 差異大，且不同 financing rounds 的 risk 不同。
- 限定：研究的歷史樣本不能直接成為當前 stage-specific hurdle。

## VCFI-CLM-003 — Fund track record 與 hurdle 不可直接複製

- 類型：`empirical_qualification`
- 來源：`VCFI-P1-SSRN-CH5-2021`, `VCFI-E1-FUND-PERSISTENCE-2020`
- 中性主張：VC firm ranking 與 fund persistence 取決於方法、時間與可得資訊；歷史
  performance、early unicorn participation、IPO rate 或 quartile 都不能自動轉成
  某筆投資的 target return。
- 限定：fund policy 必須由使用者確認，並以當時可知的 cash-flow data 校準。

## VCFI-CLM-004 — LP cost 與 GP/LP value 必須分開

- 類型：`direct_doctrine`, `empirical_qualification`
- 來源：`VCFI-P1-VCVTOOLS-AUTO`, `VCFI-E1-FUND-FEES-2012`
- 中性主張：deal investment、committed capital、lifetime fees、GP carry、LP cost、
  GP value 與 LP value 是不同輸入與輸出；fund 淨經濟不得由 gross deal payoff 代替。
- 限定：沒有 LPA／fund policy 時只能做明示假設，不能套用「2 and 20」之類慣例。

## VCFI-CLM-005 — VC Method 是 successful-exit backsolve

- 類型：`direct_doctrine`, `product_inference`
- 來源：`VCFI-P2-CONTENTS-2021`, `VCFI-P1-VCVTOOLS-OVERVIEW`,
  `VCFI-P1-UCD-SYLLABUS-2019`
- 中性主張：VC Method 以 successful scenario 的 exit total equity value、投資成本、
  目標成功倍數與持有期間反推 exit ownership，再調整未來稀釋得到 current required
  ownership。
- 限定：target multiple 的來源、success/failure treatment 與 cost-of-capital mapping
  必須在第三版正文覆核，且不得重複計入失敗風險。

## VCFI-CLM-006 — Ownership backsolve 必須明示 dilution／retention

- 類型：`product_inference`
- 來源：`VCFI-P1-VCVTOOLS-OVERVIEW`, `VCFI-P1-UCD-SYLLABUS-2019`
- 中性主張：若投資人在 exit 前還會經歷 option pool 擴張、新輪融資、conversion 或
  pay-to-play，現在需要的 ownership 必須以可稽核的 retention path 反推。
- 限定：不能從產業平均虛構公司的 cap table；缺資料時只可用標示為 prior 的範圍。

## VCFI-CLM-007 — Reality-Check DCF 連接 revenue、margin 與 capital productivity

- 類型：`direct_doctrine`
- 來源：`VCFI-P2-BOOK-2021`, `VCFI-P1-UCD-SYLLABUS-2019`,
  `VCFI-P1-VCVTOOLS-OVERVIEW`
- 中性主張：high-growth company 的 successful-exit total value 可用特製 DCF，將
  revenue growth、profit margin 與 capital productivity 的可查核路徑連到 cash flow。
- 限定：這是 total valuation；不能直接得到 preferred security 或 LP value。

## VCFI-CLM-008 — Comparables 是另一個 successful-exit total-value 模型

- 類型：`direct_doctrine`
- 來源：`VCFI-P2-BOOK-2021`, `VCFI-P1-UCD-SYLLABUS-2019`,
  `VCFI-P1-VCVTOOLS-OVERVIEW`
- 中性主張：comparables 可作 exit total value 的另一種估計，並與 Reality-Check DCF
  交叉驗證；它不是 current preferred round price 的同義詞。
- 限定：multiple、metric、date、stage、geography 與 business model 必須可比較。

## VCFI-CLM-009 — Convertible preferred 是 state-contingent claim

- 類型：`direct_doctrine`, `contractual_convention`
- 來源：`VCFI-P2-BOOK-2021`, `VCFI-P1-UCD-SYLLABUS-2019`,
  `VCFI-E1-CONTRACTING-2000`
- 中性主張：VC preferred stock 同時包含 downside preference、conversion upside
  與其他可能的控制權；不同 outcome 下 cash-flow、liquidation、voting 與 board
  rights 不必相同。
- 限定：具體 payoff 以該輪法律文件為準。

## VCFI-CLM-010 — Non-participating preferred 有 preference／conversion 選擇

- 類型：`contractual_convention`, `product_inference`
- 來源：`VCFI-P1-VCVTOOLS-AUTO`, `VCFI-E1-CONTRACTING-2000`
- 中性主張：典型 non-participating convertible preferred 在 exit 時比較適用的
  liquidation preference 與 as-converted payoff；真正結果仍受 seniority、dividends、
  caps、thresholds 與其他輪影響。
- 限定：本主張不是法律意見，也不能替代完整 waterfall。

## VCFI-CLM-011 — Participating 與複雜條款會改變 payoff shape

- 類型：`direct_doctrine`, `contractual_convention`
- 來源：`VCFI-P2-CONTENTS-2021`, `VCFI-P1-VCVTOOLS-AUTO`
- 中性主張：participation、caps、redemption、qualified-IPO thresholds 與其他複雜
  provisions 會產生非線性、分段的 exit payoff，不能用 fully diluted percentage 乘
  exit value 近似。
- 限定：需逐條讀取 charter、term sheet、cap table 與 side letters。

## VCFI-CLM-012 — Later-round valuation 需要完整 prior-round stack

- 類型：`direct_doctrine`
- 來源：`VCFI-P1-VCVTOOLS-AUTO`, `VCFI-P1-UCD-SYLLABUS-2019`
- 中性主張：估 later round 不能只看新一輪；所有先前輪次的 securities、shares、
  preferences、conversion、participation、caps 與 approvals 都會影響分配。
- 限定：缺少一輪重大條款時，partial valuation 與 implied valuation 應標
  insufficient evidence。

## VCFI-CLM-013 — Implied post-money 不等於 common-equity intrinsic value

- 類型：`direct_doctrine`, `empirical_qualification`
- 來源：`VCFI-P1-VCVTOOLS-AUTO`, `VCFI-E1-VALUATIONS-2017`
- 中性主張：security terms 的價值會使 round price 隱含的 company value 與每股
  common value 不同；研究顯示把最近 preferred price 套到每股會顯著高估一些
  unicorn 的 headline value。
- 限定：特定研究樣本的平均差距不能套到其他公司；每案需 deterministic waterfall。

## VCFI-CLM-014 — Partial valuation 可分解為 option-like payoff components

- 類型：`direct_doctrine`
- 來源：`VCFI-P1-VCVTOOLS-FLEX`, `VCFI-P1-VCVTOOLS-OPTIONS`
- 中性主張：分段 security payoff 可表成 regular、binary 或 random-expiration option
  components，再由 model 對各 component 計價。
- 限定：option formula 的 assumptions、volatility、exit timing、illiquidity 與
  model risk 必須驗證，不能因 calculator 存在而視為真實市場價值。

## VCFI-CLM-015 — Partial valuation 需要 total value distribution 而非單點

- 類型：`product_inference`
- 來源：`VCFI-P1-VCVTOOLS-AUTO`, `VCFI-P1-VCVTOOLS-OPTIONS`
- 中性主張：security payoff 取決於 exit value、volatility、holding period、
  interest rate 與 contractual strikes；只有單一 exit point 只能畫 waterfall，
  不能完整估現在的 partial value。
- 限定：distribution 參數需由 deterministic valuation service 管理並揭露敏感度。

## VCFI-CLM-016 — Screening、contracts 與 monitoring 是相互連接的

- 類型：`empirical_association`
- 來源：`VCFI-E1-CONTRACT-ANALYSES-2002`, `VCFI-E1-VC-DECISIONS-2016`
- 中性主張：VC 的 business、team、external、internal 與 deal risks，會與 cash-flow
  rights、control rights、contingencies 及預期 monitoring/support 一起被評估。
- 限定：歷史 association 不是「某風險必須配某條款」的自動規則。

## VCFI-CLM-017 — Staging 可把資金承諾綁定 milestone 與新資訊

- 類型：`direct_doctrine`, `product_inference`
- 來源：`VCFI-P1-UCD-SYLLABUS-2019`, `VCFI-P2-CONTENTS-2021`
- 中性主張：技術、商業與法規不確定性可透過 stage／milestone 拆開；每個節點允許
  invest、wait、syndicate、redesign 或 abandon，形成真實選擇權。
- 限定：milestone 必須能產生決策相關資訊，且後續資金與權利可實際執行。

## VCFI-CLM-018 — Staging 同時可能產生 hold-up 成本

- 類型：`empirical_qualification`
- 來源：`VCFI-E1-STAGED-FINANCE-2005`
- 中性主張：staging 可改善努力與停止錯誤專案，但也可能讓 incumbent investor
  取得後續資金議價權、稀釋 founder、降低 effort；syndication 與 competitive
  financing access 會改變 trade-off。
- 限定：不能把 staging 一律視為增值或一律視為傷害。

## VCFI-CLM-019 — 模型輸出必須保持 claim、time 與 owner 一致

- 類型：`product_inference`
- 來源：`VCFI-CLM-001` 至 `VCFI-CLM-018`
- 中性主張：exit enterprise/equity value、current company value、round implied
  post-money、security partial value、GP value、LP value 與 LP net return 必須分欄、
  同幣別、同日期並標記 owner；任何一欄不得靜默替代另一欄。
- 限定：所有 arithmetic 與 option/waterfall calculation 由 deterministic services
  執行，LLM 只整理 evidence、規則、判斷、反證與未知。

## VCFI-CLM-020 — Framework 不能自行輸出 Invest Candidate

- 類型：`product_inference`
- 來源：`VCFI-CLM-001` 至 `VCFI-CLM-019`
- 中性主張：本 Pack 可提供 risk/return、total value、required ownership、
  security payoff、LP economics 與 staging 輸入；最終分類仍由 Fund Policy 與
  deterministic Decision Policy 產生。
- 限定：所有 research cards 在 validation 前 formal weight 為 0。
