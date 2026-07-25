# VSee Demo Runbook（2026-07-25 版）

> Reports 頁**只顯示最新一份報告**（歷史仍在資料庫與 API，UI 不再列出）。
> belief_revised 門檻：medium 信心 = 加權分數 ≥ 0.50（2026-07-25 產品決策）。
> 分數不再每輪浮動：同樣證據的判斷會存進 `reasoner_judgments` 表
> （migration 0006），之後掃描直接重放同一份判斷；只有證據真的變了
> 才會重新判斷。worker 加 `REASONER_JUDGMENT_REFRESH=1` 可強制重判
> （銀行模式，找到好結果後拿掉此變數即凍結）。

## 開演前 10 分鐘檢查清單

1. 啟動 worker（在任何終端機貼上；金鑰從 macOS Keychain 讀取，不會顯示）：

```bash
cd ~/Documents/Codex/2026-07-21/referenced-chatgpt-conversation-this-is-untrusted/XTrace_Hackathon
export SUPABASE_URL="$(security find-generic-password -a "$USER" -s vsee-supabase-url -w)"
export SUPABASE_SERVICE_ROLE_KEY="$(security find-generic-password -a "$USER" -s vsee-supabase-service-role-key -w)"
export ANTHROPIC_API_KEY="$(security find-generic-password -a "$USER" -s vsee-anthropic-api-key -w)"
export XTRACE_API_KEY="$(security find-generic-password -a "$USER" -s vsee-xtrace-api-key -w)"
export MARKET_OFFICIAL_FEEDS_JSON='[{"id":"sequoia-official","name":"Sequoia Capital official insights","url":"https://www.sequoiacap.com/feed/","publisher":"Sequoia Capital","eventType":"funding","confidence":"medium"},{"id":"lsvp-official","name":"Lightspeed Venture Partners insights","url":"https://lsvp.com/feed/","publisher":"Lightspeed Venture Partners","eventType":"funding","confidence":"medium"}]'
export MARKET_PUBLISHER_FEEDS_JSON='[{"id":"a16z-news","name":"a16z News","url":"https://www.a16z.news/feed","publisher":"Andreessen Horowitz","eventType":"trend","confidence":"medium"},{"id":"marijuana-moment","name":"Marijuana Moment policy news","url":"https://www.marijuanamoment.net/feed/","publisher":"Marijuana Moment","eventType":"regulatory","confidence":"medium"},{"id":"fierce-healthcare","name":"Fierce Healthcare news","url":"https://www.fiercehealthcare.com/rss/xml","publisher":"Fierce Healthcare","eventType":"commercial","confidence":"medium"},{"id":"supply-chain-dive","name":"Supply Chain Dive news","url":"https://www.supplychaindive.com/feeds/news/","publisher":"Supply Chain Dive","eventType":"commercial","confidence":"medium"},{"id":"retail-dive","name":"Retail Dive news","url":"https://www.retaildive.com/feeds/news/","publisher":"Retail Dive","eventType":"commercial","confidence":"medium"}]'
npm run worker
```

2. 另開一個終端機啟動 web（`.env.local` 已含全部設定，vinext 會自動讀）：

```bash
cd ~/Documents/Codex/2026-07-21/referenced-chatgpt-conversation-this-is-untrusted/XTrace_Hackathon
npm run dev
```

3. 健康檢查（全部 true 才開演）：

```bash
curl -s http://localhost:3000/api/settings/health
```

## Demo 編排：乾淨開場、現場揭曉（2026-07-25 定案）

原則：**頁面在分析跑完之前不知道結果**。belief revision 的數字與
PRIORITY RESULT 區塊只在掃描真的產出時才出現；開場時 Reports 頁是
「No intelligence report yet」的空狀態，數字是台上按掃描後當場跳出的。
（2026-07-25 彩排實測：空狀態 → 掃描 16 秒 → 1906 belief_revised
medium 52.5% 出現，與凍結判斷一致。）

**重置是全自動的：每次頁面載入（重整）都會清空所有掃描產物**——報告、
分析、已完成的 run 歷史、市場事件。保留 Deal 語料、來源、XTrace 記憶
與判斷快取；排隊中/執行中的掃描不受影響。（實作：頁面掛載時打
`POST /api/demo/reset`。）

1. **開演前 1-2 小時彩排**：按 WAKE AGENT & SCAN MARKET。記下結果——
   證據沒變的話台上會得到一模一樣的報告；有新證據則是誠實的新判斷。
2. **上台前**：重新整理頁面一次即可，所有頁面回到不知情狀態
   （Reports =「No intelligence report yet」、Overview =「No report yet」）。
3. **台上**：按 WAKE AGENT & SCAN MARKET → 進度畫面走完整管線
   （市場掃描 → XTrace 記憶召回 → 19 家逐一分析 → 報告）→ 約 16-30 秒
   後報告生成，belief revision 第一次出現在畫面上。
4. **注意**：報告出現後**不要再重整頁面**（會被自動清掉）；真的手滑了
   就再按一次掃描，判斷重放會在約 16 秒內重現同一份報告。

## 展示順序

1. Overview：19 筆 Deal、Sample decision record 標籤、XTrace 開關。
2. Reports 頁：現在是空的——「系統還沒有任何結論」。
3. **現場按 WAKE AGENT & SCAN MARKET**（主秀）：進度畫面走完整管線，
   約 20-30 秒後報告當場生成。
4. 講解跳出的 BELIEF REVISED：Then（當初 pass 的決策脈絡，來自 XTrace
   recall）對 Now（真實市場事件，引用點開是真的 federalregister.gov /
   官方來源），建議行動走白名單；低於門檻的相關訊號誠實標 monitor。

## 現場掃描的話術（重要）

結果每次會不同（真實市場 + 嚴格證據門檻）。事先講：
「系統只在證據真正達標時才升級為 belief revision——低於門檻的相關訊號誠實
標為 monitor，完全無關就說 no material change。它寧可說『這週沒有推翻決策
級的證據』也不編造推薦。」現場只出 monitor 時，這句話就是加分項。

## 疑難排解

- health 的 worker=false：worker 沒在跑或剛重啟，等 15 秒或重跑步驟 1。
- POST /api/runs 回 503：fail-closed 機制，同上，等 worker 心跳恢復。
- 換新資料庫部署時：migrations 必須套到 0006（README 已更新）。
- 彩排結果不理想且證據已變（凍結模式會把第一次的新判斷存起來重放）：
  刪掉最新一列判斷快取，強制下一掃重新判斷：
  `curl -s "$SUPABASE_URL/rest/v1/reasoner_judgments?select=fingerprint&order=updated_at.desc&limit=1" -H "apikey: $SRK" -H "Authorization: Bearer $SRK"`
  取得 fingerprint 後
  `curl -s -X DELETE "$SUPABASE_URL/rest/v1/reasoner_judgments?fingerprint=eq.<fp>" -H "apikey: $SRK" -H "Authorization: Bearer $SRK"`
- 兩個 worker 同時在跑會搶工作：`ps aux | grep runner.ts` 檢查，多的殺掉。

## 關鍵事實（評審問答備用）

- XTrace 整合：真連線 api.production.xtrace.ai，ingest 每 Deal 一份 bundle，
  recall 每 Deal 一條內容化查詢（25 req/min 分散式限流），記憶 id 全部解析回
  本機來源 lineage 才能當證據。
- 誠實三層防線：逐字 excerpt grounding、確定性 overlap 驗證、白名單化的
  建議行動。分析中沒有任何一句話能脫離已存證據。
- XTrace 失敗絕不靜默 fallback：該 Deal 標 analysis_unavailable、報告標
  incomplete。
- 信心門檻：加權分數 ≥ 0.78 = high、≥ 0.50 = medium；belief_revised 需要
  medium 以上，低於門檻的相關訊號一律 monitor。
