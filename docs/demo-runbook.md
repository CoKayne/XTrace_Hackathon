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

## 賽前保險：把「好報告」留在最新位置

Reports 頁只顯示最新報告，所以**demo 畫面 = 最後一次掃描的結果**。開演前
1-2 小時做賽前預掃：

1. 按 WAKE AGENT & SCAN MARKET（或 `curl -s -X POST
   http://localhost:3000/api/runs -H "Content-Type: application/json" -d
   '{"mode":"xtrace"}'`），約 2 分鐘完成。
2. 看 Reports 頁：若有 1-2 家 BELIEF REVISED → 停手，這就是 demo 報告。
3. 若結果比上一份差（例如 0 家 BR），刪掉這份較差的報告，讓好報告回到
   最新位置：

```bash
export SUPABASE_URL="$(security find-generic-password -a "$USER" -s vsee-supabase-url -w)"
export SRK="$(security find-generic-password -a "$USER" -s vsee-supabase-service-role-key -w)"
# 先列出報告（新到舊），找出要刪的 report id：
curl -s "$SUPABASE_URL/rest/v1/intelligence_reports?select=id,run_id,created_at&order=created_at.desc&limit=5" -H "apikey: $SRK" -H "Authorization: Bearer $SRK"
# 刪除該報告（換掉 REPORT_ID，先刪 company_analyses 再刪報告本體）：
curl -s -X DELETE "$SUPABASE_URL/rest/v1/company_analyses?report_id=eq.REPORT_ID" -H "apikey: $SRK" -H "Authorization: Bearer $SRK"
curl -s -X DELETE "$SUPABASE_URL/rest/v1/intelligence_reports?id=eq.REPORT_ID" -H "apikey: $SRK" -H "Authorization: Bearer $SRK"
```

刪除只動報告快照，不影響 Deal、來源、XTrace 記憶或後續掃描。

## 展示順序

1. Overview：19 筆 Deal、Sample decision record 標籤、XTrace 開關。
2. Reports 頁（就是最新報告）：講 BELIEF REVISED 的完整故事——
   Then（當初 pass 的決策脈絡，來自 XTrace recall）對 Now（真實市場事件，
   引用點開是真的 federalregister.gov / 官方來源），建議行動走白名單。
3. 選配：現場按 WAKE AGENT & SCAN MARKET 掃一次（約 2 分鐘，進度畫面照
   stage 走：市場掃描 → XTrace 記憶同步/召回 → 19 筆逐一分析 → 報告）。
   **注意：現場掃描的新結果會取代畫面上的報告**——若賽前已備好強報告，
   建議把現場掃描放在講完主故事之後，或跳過。

## 現場掃描的話術（重要）

結果每次會不同（真實市場 + 嚴格證據門檻）。事先講：
「系統只在證據真正達標時才升級為 belief revision——低於門檻的相關訊號誠實
標為 monitor，完全無關就說 no material change。它寧可說『這週沒有推翻決策
級的證據』也不編造推薦。」現場只出 monitor 時，這句話就是加分項。

## 疑難排解

- health 的 worker=false：worker 沒在跑或剛重啟，等 15 秒或重跑步驟 1。
- POST /api/runs 回 503：fail-closed 機制，同上，等 worker 心跳恢復。
- 換新資料庫部署時：migrations 必須套到 0006（README 已更新）。
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
