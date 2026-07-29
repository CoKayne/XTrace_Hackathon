# Venture Deals Public Framework Pack — Review Notes

狀態：`draft / unpublished`

## 核心定位

這個 Pack 不是用條款名稱判斷「好 deal／壞 deal」，而是把每個條款轉成：

1. 它影響哪個 claim、角色、事件與時間；
2. 它改變 economics、control、information、retention 或 process 的哪一部分；
3. 需要哪些文件；
4. 交給哪個 deterministic service；
5. 哪些衝突必須由 counsel、IC 或 Fund Policy 解決。

## 三層輸出不得混合

### Contract semantics

文件實際寫了什麼：trigger、threshold、formula、class、sunset、exception、owner。

### Deterministic effect

在特定 financing/exit/termination state 下，ownership、payoff、vote、veto 或 deadline
如何變化。

### Investment judgment

條款與 valuation、company quality、fund return、governance 和 alternatives 綜合後是否
符合 Fund Policy。只有主系統的 deterministic Decision Policy 可以輸出。

## 文件優先順序

1. executed charter、purchase agreement、investor rights、voting、ROFR/co-sale；
2. executed notes/SAFEs、side letters、option plan/grants、employment agreements；
3. signed term sheet；
4. current board/cap-table records；
5. NVCA model 或作者 sample 僅作 interpretation template；
6. 市場報告僅作 comparison。

若 signed/executed 文件與 summary、CRM、模型或 memory 衝突，以法律文件為 evidence，
但衝突本身必須顯示並交 counsel。

## 計算責任

- `cap_table_service`：fully diluted、pool、warrants、notes/SAFEs、ownership。
- `security_waterfall_service`：preference、participation、conversion、seniority、exit。
- `anti_dilution_service`：conversion-price adjustment 與 carve-outs。
- `governance_service`：board、class vote、protective provision、drag threshold。
- `vesting_service`：service、leaver、repurchase、acceleration。
- `deadline_service`：no-shop、closing、maturity、notice、sunset。
- LLM 不計算，也不判定 enforceability。

## 主要防誤用規則

- headline valuation 不能替代 fully diluted cap-table math；
- option pool 不得以固定 percentage 自動填入；
- `1x` 不足以描述 liquidation payoff；
- `participating`、`capped`、`seniority` 必須拆開；
- `anti-dilution` 不足以確定公式；
- board seat、observer、protective provision、class vote 是不同權利；
- drag-along 不等於所有 holders 在經濟上相同；
- pro rata 不等於 follow-on commitment；
- SAFE cap 不等於 pre/post-money priced valuation；
- term sheet 不等於 closing，也不保證 definitive documents 一致；
- model/legal documents 不能取代律師。

## 與其他 Packs 的分工

- `VCFI-08/09` 接收本 Pack 解析的條款並計算 payoff、waterfall 與 implied value。
- `EI-02` 使用 security-normalized value，而非 headline round price。
- `SHR` 提供 fund/board workflow；本 Pack 提供條款級 semantics。
- `VM` 與 `SHR` 可建議 follow-on/reunderwrite；`VD-08` 驗證是否具有權利與 capacity。
- `DSV` 估 company operating value，不處理 security claim。

## 待驗證

1. 合法完整閱讀第四版 Chapters 4–9、13、18、19 與 Appendices；
2. 對照 2025–2026 NVCA documents 逐欄建立 schema；
3. 美國 venture counsel review；
4. 不同法域獨立 pack；
5. 使用完整 term sheet/cap table 的 golden-case tests；
6. Content、rights、Framework Fidelity 與 Decision Utility review。

全 Pack 暫為 `draft / unpublished / formalDecisionWeight=0`。
