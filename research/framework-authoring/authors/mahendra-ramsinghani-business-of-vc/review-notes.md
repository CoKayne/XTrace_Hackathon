# The Business of Venture Capital Public Framework Pack — Review Notes

狀態：`draft / unpublished`

## 核心定位

這個 Pack 把「這家公司是否好」提升成「這筆投資能否在本基金的策略、資本預算、
ownership、reserve、team capacity 與 exit horizon 下產生足夠貢獻」。它不重新做
company valuation，而是建立 deal-to-fund bridge。

## 三層必須分開

1. **Company quality**：team、market、product、business model、economics、risk。
2. **Deal economics**：price、security、ownership、dilution、follow-on、waterfall。
3. **Fund fit**：strategy、check、reserve、concentration、capacity、time、return
   contribution。

只有第三層通過，好的公司才是這個基金可執行的 investment。

## 目前最重要的 product interfaces

- Fund Policy profile：stage、sector、geography、check、ownership、risk、reserve。
- Portfolio state：deployed、uncalled、reserved、recyclable、concentration、capacity。
- Deal capital path：initial、follow-on scenarios、dilution、exit ownership。
- Return contribution：Bear/Base/Bull proceeds、timing、gross/net bridge。
- Decision trace：company conclusion、terms conclusion、fund-fit conclusion各自保存。

## 主要防誤用

- 不使用「業界通常 50% reserve」之類無條件常數。
- Market default 可以作假設，但不能假裝成基金真實 policy。
- 例外投資必須顯示 mandate drift 與 opportunity cost。
- Founder-friendly 不等於省略 diligence 或不談 terms。
- 高 headline ownership 不等於高 net return；要看 follow-on、dilution、exit 和 time。
- Value-add 不作形容詞，要列 owner、資源、capacity、milestone。
- Exit scenario 是條件式路徑，不是承諾。

## 與其他 Pack 的邊界

- Metrick/Yasuda 與 Venture Deals 負責 ownership、security、waterfall、terms。
- Venture Mindset 負責 power-law 與決策習慣；本 Pack 負責 fund operating model。
- Scott Kupor 負責 institutional VC/board/LP-GP語境；本 Pack提供全流程流程卡。
- Valuation Packs 產生 company value；本 Pack問這筆投資對基金是否有意義。

## 與主系統交接

- 所有卡 formal weight 0。
- fund-math 必須由 deterministic service 計算。
- 缺少使用者 policy 時可載入明示的 stage default，但報告中必須標成假設。
- `BVC-06` 與 `BVC-07` 可直接接現有 Deal Memory、market event 與 re-evaluation 工作流。
- 完整第三版 review 前，Chapter 13/14 相關規則不得宣稱作者明示。
