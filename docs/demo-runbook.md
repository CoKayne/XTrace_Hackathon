# VSee Demo Runbook（2026-07-24 版）

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

4. 建議開演前先掃 1-2 次刷新報告庫（每次約 2 分鐘）。

## 展示順序

1. Overview：19 筆 Deal、Sample decision record 標籤、XTrace 開關。
2. 開報告歷史，進 **run 7747f72f 的報告**：完整 belief_revised 流程——
   Priority Result 是 1906（medium、0.56），Then（當初 pass 的合成決策脈絡，
   來自 XTrace recall）對 Now（白宮 E.O. 14401 加速精神疾病治療的行政命令與
   RFI），建議行動「重啟內部審視」，引用點開是真的 federalregister.gov 文件。
3. 開 **run 3134f225 的報告**：五筆 monitor 展示廣度（100Plus 對 CMS 給付案、
   Ada Health、1906、7bridges、INNFormNest）。
4. 現場按 WAKE AGENT & SCAN MARKET 掃一次（約 90-120 秒，進度畫面照著
   stage 走：市場掃描 → XTrace 記憶同步/召回 → 19 筆逐一分析 → 報告）。

## 現場掃描的話術（重要）

結果每次會不同（真實市場 + 嚴格證據門檻）。事先講：
「系統只在證據真正達標時才升級為 belief revision——低於門檻的相關訊號誠實
標為 monitor，完全無關就說 no material change。它寧可說『這週沒有推翻決策
級的證據』也不編造推薦。」現場只出 monitor 時，這句話就是加分項。

## 疑難排解

- health 的 worker=false：worker 沒在跑或剛重啟，等 15 秒或重跑步驟 1。
- POST /api/runs 回 503：fail-closed 機制，同上，等 worker 心跳恢復。
- 換新資料庫部署時：migrations 必須套到 0004（README 已更新）。
- 兩個 worker 同時在跑會搶工作：`ps aux | grep runner.ts` 檢查，多的殺掉。

## 關鍵事實（評審問答備用）

- XTrace 整合：真連線 api.production.xtrace.ai，ingest 每 Deal 一份 bundle，
  recall 每 Deal 一條內容化查詢（25 req/min 分散式限流），記憶 id 全部解析回
  本機來源 lineage 才能當證據。
- 誠實三層防線：逐字 excerpt grounding、確定性 overlap 驗證、白名單化的
  建議行動。分析中沒有任何一句話能脫離已存證據。
- XTrace 失敗絕不靜默 fallback：該 Deal 標 analysis_unavailable、報告標
  incomplete。
