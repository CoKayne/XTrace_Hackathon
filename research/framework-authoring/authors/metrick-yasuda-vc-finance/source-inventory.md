# Metrick / Yasuda VC Finance — Source Inventory

研究截止日：2026-07-28  
目標版本：*Venture Capital and the Finance of Innovation*, 3rd ed. (2021)

## 來源分層

### P1：作者／共同作者公開材料

- Yale 官方 textbook page：確認第三版、作者與模型範圍。
- SSRN 作者授權 Chapter 1 與 Chapter 5：Chapter 1 的第三版 36 頁公開節錄已於
  2026-07-29 直接覆核，內容包含前言、完整目錄與完整第一章；Chapter 5 公開摘要
  僅支援其排名定位與方法概述。
- Ayako Yasuda 的 UC Davis 課程 syllabus：公開解釋 Reality-Check DCF、comparables、
  staged financing、convertible preferred、fund economics 與 real options；但使用第二版，
  因此只作第三版架構的 corroboration。
- `vcvtools.com`：作者配套的 AUTO、FLEX 與 option calculators，公開展示模型輸入、
  輸出與 total/partial valuation 的連接方式；網站標示為第二版 companion。

### P2：出版社公開材料

- Wiley 第三版 catalog：出版資料、全書描述與四部分／24 章架構。
- Wiley 第三版 Brief Contents：合法公開的章名與起始頁，不把章名當作完整 doctrine。

### E1：外部實證與理論檢驗

- Cochrane：VC return 的 selection bias、波動與 round 差異。
- Gompers 等：885 位 institutional VCs 的決策實務與 stage/industry/geography 異質性。
- Kaplan／Strömberg：screening、risk、rights、monitoring 與契約配置的實證。
- Gornall／Strebulaev：headline post-money 與 security-specific value 的差異。
- Robinson／Sensoy：fees、carry、ownership 與 LP net cash flow 的區分。
- Harris 等：fund persistence 必須用 fundraising 當時可知資訊衡量。
- Fluck／Garrison／Myers：staged finance 的 learning／effort／abandonment 與 hold-up
  trade-off。

## 目前可安全蒸餾的範圍

1. VC investment analysis 必須分成 company total valuation、security partial valuation、
   GP/LP economics 與 deterministic fund decision。
2. VC Method 的 exit-backsolve arithmetic identity，可作 calculation contract；第三版
   對 target return、success probability、cost of capital 與 retention 的專有校準仍待
   授權全文覆核。
3. Reality-Check DCF 與 comparables 都是在估 successful exit total value，不能取代
   現在的 security waterfall。
4. preferred stock、participation、liquidation preference、prior rounds 與 caps 必須透過
   deterministic payoff schedule 計算。
5. fund fee、carry、GP/LP split 與 LP cost 不可與 startup investment amount 混為一談。
6. staged R&D 是資訊更新與選擇權問題，但也可能造成 hold-up，不是「分期一定更好」。

## 已覆核的 Chapter 1 節錄邊界

- 公開來源：SSRN abstract 929145。
- 檔案雜湊（SHA-256）：
  `aec0815b2b2213a8c6ab9510d1e9c05835d36901b62bd79a102bad79996a4709`。
- 支援範圍：第三版書目與架構、VC 的定義、investing／monitoring／exiting、
  產業歷史，以及 stage／industry／region 的歷史分布。
- 不支援範圍：Chapters 3–4 與 7–24 的公式、參數、例外與方法細節。
- Framework 影響：補強 `VCFI-01` 與 Pack positioning；不解除
  `VCFI-03` 至 `VCFI-10` 的 pending review。
- 儲存政策：不提交受版權保護的 PDF，只保存公開 URL、metadata、hash、
  neutral paraphrase 與 exact locator。

## 尚不能聲稱

- 不能把第二版 companion 的完整公式無差別標為第三版內容。
- 不能在沒有第三版正文時宣稱 target multiple、retention、cost of capital 或 option
  parameters 的唯一正確數值。
- 不能把 Black-Scholes／random-expiration calculator 當作所有 startup securities 的
  經驗真實值；輸入、模型與適用性需驗證。
- 不能把 survey frequency 當成 best practice，或把歷史 fund returns 當成目前 hurdle。
- 不能把 preferred round price 套到 common shares，或把 implied post-money 當 intrinsic
  value。

## 待合法版本覆核

- Third edition Chapter 3–4：returns 與 VC cost of capital。
- Chapter 7–12：investment analysis、VC Method、Reality-Check DCF、comparables。
- Chapter 13–18：option pricing、preferred、later rounds、participating securities、
  implied valuation 與 complex structures。
- Chapter 19–24：R&D finance、simulation、real options、trees、game theory 與 R&D
  valuation。

只有全部公開來源研究完成後，才會把仍然必要的付費／授權材料列入最終電子書缺口清單。
