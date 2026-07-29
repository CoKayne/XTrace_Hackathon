# Venture Deals 公開來源清單

研究截止日：2026-07-28  
狀態：`draft / public-source pass`

## 核心定位

本 Pack 以 Brad Feld、Jason Mendelson 的《Venture Deals: Be Smarter Than Your
Lawyer and Venture Capitalist》第四版（Wiley，2019）為定位來源，並以二位作者公開的
Term Sheet 系列作原則與條款語義的主要內容來源。

它不提供法律意見，也不把歷史慣例當成目前的 default。2025–2026 NVCA Model Legal
Documents 用來檢查當代文件結構與版本差異；Cooley 的市場資料只作外部 frequency
qualification。

## 來源分層

| 層級 | 來源 | 用途 |
|---|---|---|
| P2 | Wiley 第四版書目、excerpt、contents | 版本、章節結構、範圍 |
| P1 | Feld/Mendelson Term Sheet 系列 | 公開條款語義、權衡與歷史實務 |
| P1/I1 | Techstars 課程、NVCA model documents | 當前教學結構與文件版本控制 |
| E1 | Cooley 公開交易資料 | 慣例頻率的外部校準，不是規則 |

## 第四版公開章節架構

- Chapter 4：Term Sheet overview；economics 與 control；
- Chapter 5：valuation、option pool、warrants、liquidation preference、
  pay-to-play、vesting、exercise period、anti-dilution；
- Chapter 6：board、protective provisions、drag-along、conversion；
- Chapter 7：dividends、redemption、closing conditions、information、
  registration、ROFR、voting、co-sale、no-shop 等；
- Chapter 8：convertible debt、discount、cap、interest、conversion、sale、
  warrants 與其他 terms；
- Chapter 9：cap table 與 convertible-note price-per-share methods；
- Chapters 11–13：venture debt、fund mechanics、negotiation；
- Chapter 18：term sheets、transaction costs、agency、information asymmetry、
  reputation；
- Chapter 19：IP、employment、corporate structure、409A、83(b) 等法律議題。

## 主要公開作者來源

| ID | 主題 | 使用限制 |
|---|---|---|
| `VD-P1-PRICE-2005` | economics/control、price、fully diluted、option pool、warrants | 歷史文章，不是 current market default |
| `VD-P1-LIQUIDATION-2004` | preference 與 conversion choice | 需完整 waterfall |
| `VD-P1-PARTICIPATION-2004` | participation、cap、outcome sensitivity | 單輪例子不可替代多輪計算 |
| `VD-P1-ANTIDILUTION-2005` | ratchet、weighted average、denominator、carve-outs | 公式依簽署文件 |
| `VD-P1-BOARD-2005` | board election、constituency、observer | 不判斷 fiduciary duty |
| `VD-P1-PROTECTIVE-2005` | enumerated veto rights | 門檻、class vote 依文件與法域 |
| `VD-P1-DRAG-2005` | exit consent、holdout、class conflict | 需 counsel review |
| `VD-P1-VESTING-2005` | vesting、repurchase、acceleration | 文章中的常見年限不是 default |
| `VD-P1-PAYTOPLAY-2005` | follow-on participation consequence | 需完整 qualified financing definition |
| `VD-P1-VC-RIGHTS-2012` | pro rata、downside、board/information 簡化圖 | 是 mnemonic，不是完整權利清單 |
| `VD-P1-CONVERTIBLE-2011` | discount、cap、conversion、sale、warrants | 每張 instrument 需逐條解析 |
| `VD-P1-NOSHOP-2005` | fundraising 到 closing、期限 | enforceability 依法域 |

## 權利與法律邊界

- 所有條款卡只產生 `term_effect`、`required_document`、`conflict` 與
  `deterministic_calculation_contract`。
- 不提供 legal opinion、enforceability、fiduciary-duty 或 tax conclusion。
- 美國 Delaware-style 文件以外一律降低 applicability；德國、英國、台灣、新加坡等
  法域需獨立 counsel pack。
- `standard`、`market` 或 `customary` 必須帶 dataset、期間、stage、geography 與 sample。
- 歷史作者文章中的「常見」敘述只能作 historical description。

## 待合法全文覆核

1. 第四版 Chapters 4–9 的完整文字、例題與精確頁碼；
2. Chapter 13 negotiation 的完整邊界；
3. Chapter 18 對 term-sheet rationale、agency 與 transaction costs 的定義；
4. Appendix A/B sample term sheets 與最新 NVCA documents 的逐條差異；
5. 第四版 SAFE、convertible debt、venture debt 與不同 stage 的完整處理。

在完成 licensed copy、venture counsel 與 deterministic waterfall review 前，全 Pack
維持 `draft / unpublished / formalDecisionWeight=0`。
