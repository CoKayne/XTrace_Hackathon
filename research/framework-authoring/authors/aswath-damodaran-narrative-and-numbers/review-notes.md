# Aswath Damodaran / Narrative and Numbers Public Framework Pack — Review Notes

狀態：`draft / unpublished`

## 核心定位

這個 Pack 不是另一套自由文字「投資故事產生器」，而是把 Founder／市場敘事轉成
可驗證、可版本化、可交給 deterministic valuation 的假設圖。它回答：

1. 現在相信的 business story 是什麼？
2. 哪些證據使它 possible、plausible 或 probable？
3. 故事的哪一段映射到 revenue、margin、reinvestment、risk 或 duration？
4. 新事件究竟是確認、調整、開啟新路徑，還是推翻故事？
5. 哪個 counter-narrative 仍成立，下一步應取得什麼證據？

## 與既有 Damodaran Pack 的邊界

- `NN-*` 負責 story、test、driver mapping、version delta 與 news interpretation。
- `DSV-*` 負責 revenue build、margin、reinvestment、risk、survival、scenario 與 valuation。
- `EI-*` 負責 price-implied expectations 與 event-to-trigger revision。
- 本 Pack 不重複 DCF、multiples、option、waterfall 或 fund-return 計算。

## 事件到推論的強制路徑

```text
Verified event
  -> company-specific exposure
  -> prior narrative node
  -> break / shift / change hypothesis
  -> value-driver delta
  -> deterministic scenario calculation
  -> counterevidence and next action
```

禁止 `positive news -> higher valuation` 或 `sector funding -> company succeeds` 的跳步。

## 主要防誤用修正

- 不模仿 Damodaran 的個人聲音，也不聲稱重建私人 chain of thought。
- Founder story、投資人 story 與客觀證據分欄保存。
- possible／plausible／probable 是 evidence state，不是 LLM 任意信心百分比。
- competing narratives 各自完整執行，不先平均或合成共識。
- 新聞分類必須相對於 versioned prior story；沒有 prior 就只能建立初始假設。
- 每個 narrative delta 必須指出受影響 driver、方向、lag、範圍與反證。
- stage／sector prior 可作假設，不可呈現為公司的真實數據。
- 估值變動與投資行動分離；完整故事不等於值得支付目前價格。

## 與其他 Pack 的預期分歧

- Peter Thiel 的 monopoly／contrarian story 可以很廣；本 Pack 要求將其轉成 share、
  margin、duration 與 falsifiable milestones。
- 7 Powers 可支持 durable advantage；本 Pack 要求說明每個 Power 如何影響 driver。
- Venture Mindset 可接受高不確定性與 power-law upside；本 Pack 仍要求 possible、
  plausible、probable 分層和完整 counter-narrative。
- Expectations Investing 從價格反推故事；本 Pack可從故事前推 numbers。兩者應比較，
  不應互相覆蓋。
- Super Founders 提供 base rates；本 Pack把 base rate當 plausibility test，不能取代
  company-specific evidence。

## 與主系統交接

- 十張卡 formal decision weight 均為 0。
- LLM 只能抽取、分類與解釋；任何數值計算由 valuation service 執行。
- `NN-07` 至 `NN-08` 可直接接產品現有近 14 天 event workflow。
- `NN-10` 輸出 versioned narrative ledger 與 action draft 所需欄位，但不自動寄送或聯絡。
- 完成合法 2017 版 review、投資專家審核與 historical backtest 前不得發布。
