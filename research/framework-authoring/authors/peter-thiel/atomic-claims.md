# Peter Thiel 原子主張登錄表

版本：0.1  
研究截止日：2026-07-28

> 本檔只保存「來源可以支持的最小主張」。產品操作化、公司評分與最終投資結論另放 Framework Cards，不混入本檔。

## A. Peter Thiel 直接公開主張

### PT-CLM-001 — 價值創造與價值捕捉是兩個不同變數

```yaml
claim_id: PT-CLM-001
framework_ids: [PT-02]
claim_type: direct_doctrine
claim_text_zh: >
  有價值的公司必須同時創造價值，並能捕捉其中一部分；創造的總價值與捕捉比例是彼此獨立的變數。
source_ids: [PT-P1-LECTURE-2014]
location: "00:50–03:21"
attribution_scope: peter_thiel
fidelity_confidence: high
utility_status: candidate
qualifications:
  - "不能把社會價值或市場營收直接當成股東價值。"
  - "價值捕捉仍需用價格、毛利、留存、議價力與現金流證據驗證。"
```

### PT-CLM-002 — 創業公司應追求 creative monopoly 並避免同質競爭

```yaml
claim_id: PT-CLM-002
framework_ids: [PT-02, PT-10]
claim_type: direct_doctrine
claim_text_zh: >
  創辦新公司時，應以建立 creative monopoly 為目標，並避免在高度同質化的競爭中耗散利潤。
source_ids: [PT-P1-LECTURE-2014]
location: "00:20–06:54"
attribution_scope: peter_thiel
fidelity_confidence: high
utility_status: candidate
qualifications:
  - "這是有意採取的極端二分，不代表任何競爭都會降低創新。"
  - "產品中的 monopoly 指可持續差異化與價值捕捉，不作法律結論。"
```

### PT-CLM-003 — 市場定義存在策略性扭曲

```yaml
claim_id: PT-CLM-003
framework_ids: [PT-02, PT-03]
claim_type: direct_doctrine
claim_text_zh: >
  高度競爭者傾向用過窄交集把自己描述成獨特公司，支配者則傾向用過寬聯集淡化支配地位；研究者需尋找客觀市場邊界。
source_ids: [PT-P1-LECTURE-2014, PT-P2-CS183-04]
location: "Lecture 06:54–13:17; CS183 Class 4 sections II–IV"
attribution_scope: peter_thiel_with_blake_derivative_support
fidelity_confidence: high
utility_status: candidate
qualifications:
  - "市場邊界需由客戶替代行為、價格、工作流程與競爭資料判定，而非只靠 TAM 敘事。"
```

### PT-CLM-004 — 從真實小市場主導後向外擴張

```yaml
claim_id: PT-CLM-004
framework_ids: [PT-03]
claim_type: direct_doctrine
claim_text_zh: >
  新創應先在一個真實、可服務且足以支撐初期公司的小市場取得高占有率，再以相鄰市場或同心圓方式擴張。
source_ids: [PT-P1-LECTURE-2014, PT-P2-CS183-04]
location: "Lecture 13:17–18:21; CS183 Class 4 section IV"
attribution_scope: peter_thiel
fidelity_confidence: high
utility_status: candidate
qualifications:
  - "小市場不能只是語意切割，也不能小到沒有迫切需求或付費客戶。"
  - "高 beachhead share 與可行 expansion path 必須分開驗證。"
```

### PT-CLM-005 — 四類可持續優勢

```yaml
claim_id: PT-CLM-005
framework_ids: [PT-02, PT-04]
claim_type: direct_doctrine
claim_text_zh: >
  專有技術、network effects、規模經濟與品牌是建立及延續市場力量的主要候選機制。
source_ids: [PT-P1-LECTURE-2014, PT-P2-CS183-04]
location: "Lecture 18:21–22:52; CS183 Class 4 section III"
attribution_scope: peter_thiel
fidelity_confidence: high
utility_status: candidate
qualifications:
  - "列出機制不等於機制已存在。"
  - "品牌是特別難以事前識別的項目。"
  - "與 Helmer 7 Powers、Andrew Chen network effects 高度重疊，合成時不得重複計分。"
```

### PT-CLM-006 — 最後移動者與耐久性

```yaml
claim_id: PT-CLM-006
framework_ids: [PT-04]
claim_type: direct_doctrine
claim_text_zh: >
  短暫領先不足以創造大部分企業價值；重要的是優勢能否長期維持，使遠期現金流得以實現。
source_ids: [PT-P1-LECTURE-2014]
location: "22:52–27:55"
attribution_scope: peter_thiel
fidelity_confidence: high
utility_status: candidate
qualifications:
  - "耐久性比當期成長更難量測，不能只以敘事代替證據。"
  - "需透過競爭反應、留存、切換成本、技術替代與單位經濟進行壓力測試。"
```

### PT-CLM-007 — 矽谷容易高估當期成長、低估耐久性

```yaml
claim_id: PT-CLM-007
framework_ids: [PT-04]
claim_type: direct_doctrine
claim_text_zh: >
  因為成長可即時量測而耐久性較定性，投資人容易高估目前成長率並低估十年後仍能存在的能力。
source_ids: [PT-P1-LECTURE-2014]
location: "22:52–27:55"
attribution_scope: peter_thiel
fidelity_confidence: high
utility_status: advisory
qualifications:
  - "此主張是注意力校正，不代表成長率不重要。"
```

### PT-CLM-008 — 模仿性競爭不構成價值證明

```yaml
claim_id: PT-CLM-008
framework_ids: [PT-10]
claim_type: direct_doctrine
claim_text_zh: >
  很多人投入同一件事不必然代表它有價值；競爭可能來自模仿、社會驗證與彼此追逐，而非獨立判斷。
source_ids: [PT-P1-LECTURE-2014]
location: "36:59–42:43"
attribution_scope: peter_thiel
fidelity_confidence: high
utility_status: advisory
qualifications:
  - "資金湧入既可能是需求訊號，也可能是擁擠／定價風險；必須保留兩種解釋。"
```

### PT-CLM-009 — 對 lean startup 與客戶問卷的懷疑

```yaml
claim_id: PT-CLM-009
framework_ids: [PT-01, PT-08]
claim_type: direct_doctrine
claim_text_zh: >
  對未知未來的重大創新，僅靠 incremental iteration、客戶問卷或既有市場回饋，可能無法發現真正的新產品方向。
source_ids: [PT-P1-LECTURE-2014]
location: "44:54–47:30"
attribution_scope: peter_thiel
fidelity_confidence: high
utility_status: advisory
qualifications:
  - "不能因此忽略使用者研究、需求證據或實驗。"
  - "此主張與 lean startup／customer discovery 存在明確方法分歧。"
```

### PT-CLM-010 — 技術進步不應只限於軟體或 bits

```yaml
claim_id: PT-CLM-010
framework_ids: [PT-09]
claim_type: direct_doctrine
claim_text_zh: >
  技術進步可以且應該出現在資訊科技以外的產業；重要創新可能改善實體世界、生活水準與文明能力。
source_ids: [PT-P1-WBUR-2014, PT-P1-TSINGHUA-2016, PT-P2-BOOK-001]
location: "WBUR interview; Tsinghua sections on innovation; publisher description"
attribution_scope: peter_thiel
fidelity_confidence: medium_high
utility_status: advisory
qualifications:
  - "困難問題與社會重要性不自動帶來可投資的商業模式。"
  - "需另驗證融資強度、開發週期、法規、配銷與價值捕捉。"
```

## B. Blake Masters 課程衍生主張

### PT-CLM-011 — 反共識問題與 secret

```yaml
claim_id: PT-CLM-011
framework_ids: [PT-01]
claim_type: affiliated_doctrine
claim_text_zh: >
  值得研究的創業機會可能建立在一項重要但尚未被普遍同意的事實上；投資人應要求團隊說明它相信什麼、為何其他人尚未看見。
source_ids: [PT-P2-CS183-01, PT-P2-CS183-11, PT-P2-BOOK-001]
location: "CS183 Class 1 and Class 11; official publisher description"
attribution_scope: blake_masters_derivative_of_thiel_course
fidelity_confidence: medium_high
utility_status: advisory
qualifications:
  - "反共識不等於正確。"
  - "必須提出可被證偽的因果機制、先驗證據與失敗條件。"
```

### PT-CLM-012 — 配銷是產品成立的一部分

```yaml
claim_id: PT-CLM-012
framework_ids: [PT-05]
claim_type: affiliated_doctrine
claim_text_zh: >
  產品品質不會自動帶來使用者、收入、人才或資金；每家公司都需要與客單價、購買流程與市場結構相容的有效配銷方式。
source_ids: [PT-P2-CS183-09, PT-P1-STANFORD-DISTRIBUTION]
location: "CS183 Class 9 sections I, II, IV, V; Stanford eCorner transcript"
attribution_scope: thiel_direct_plus_blake_derivative
fidelity_confidence: high
utility_status: candidate
qualifications:
  - "配銷能力需以 cohort、pipeline、CAC、回收期與實際轉換驗證。"
```

### PT-CLM-013 — CLV 與 CAC 的基本配銷約束

```yaml
claim_id: PT-CLM-013
framework_ids: [PT-05]
claim_type: affiliated_doctrine
claim_text_zh: >
  商業模式至少要證明客戶生命週期價值高於獲客成本，且不同價值的產品需要不同配銷通路。
source_ids: [PT-P2-CS183-09]
location: "CS183 Class 9 section II"
attribution_scope: blake_masters_derivative_of_thiel_course
fidelity_confidence: high
utility_status: candidate
qualifications:
  - "簡化 CLV 公式不處理 cohort、discount rate、服務成本、擴張收入、流失異質性與回收期。"
```

### PT-CLM-014 — Power law 與返回基金潛力

```yaml
claim_id: PT-CLM-014
framework_ids: [PT-06]
claim_type: affiliated_doctrine
claim_text_zh: >
  VC 的少數超級贏家可能主導基金報酬，因此單筆投資的合理性需要考慮其在可取得持股下是否具有實質返回基金的上行空間。
source_ids: [PT-P2-CS183-07]
location: "CS183 Class 7"
attribution_scope: thiel_course_with_other_contributors
fidelity_confidence: medium_high
utility_status: candidate
qualifications:
  - "返回基金潛力需使用基金規模、初始持股、稀釋、follow-on、退出價值與清算條款計算。"
  - "它是上行必要條件，不是公司成功機率。"
```

### PT-CLM-015 — 少數高度集中投資

```yaml
claim_id: PT-CLM-015
framework_ids: [PT-06]
claim_type: affiliated_doctrine
claim_text_zh: >
  課堂筆記主張基金可集中於約七到八家具有約十倍回報潛力的公司。
source_ids: [PT-P2-CS183-07]
location: "CS183 Class 7"
attribution_scope: thiel_course_with_other_contributors
fidelity_confidence: medium
utility_status: advisory
qualifications:
  - "同一來源警告不要機械化套用。"
  - "AngelList 實證支持重尾，但在沒有 selection edge 時反對少數持股必然較優。"
```

### PT-CLM-016 — 成立初期的治理與誘因設計具有路徑依賴

```yaml
claim_id: PT-CLM-016
framework_ids: [PT-07]
claim_type: affiliated_doctrine
claim_text_zh: >
  公司成立時的共同創辦關係、股權、控制、董事會與角色配置會形成難以逆轉的路徑依賴。
source_ids: [PT-P2-CS183-06]
location: "CS183 Class 6"
attribution_scope: blake_masters_derivative_of_thiel_course
fidelity_confidence: medium_high
utility_status: advisory
qualifications:
  - "不支持永久 founder control。"
  - "後續公司階段可能需要角色重設或專業管理。"
```

### PT-CLM-017 — 能動性與 definite plan

```yaml
claim_id: PT-CLM-017
framework_ids: [PT-08]
claim_type: affiliated_doctrine
claim_text_zh: >
  創業者應提出對未來的具體判斷與可執行計畫，而不是把結果完全交給運氣或無方向的多樣化。
source_ids: [PT-P2-CS183-13, PT-P1-HOOVER]
location: "CS183 Class 13; Hoover transcript discussion of agency"
attribution_scope: thiel_direct_plus_blake_derivative
fidelity_confidence: medium
utility_status: advisory
qualifications:
  - "課堂筆記承認 skill 與 luck 的論證缺乏嚴格實證。"
  - "具體計畫若不更新也可能形成過度自信。"
```

### PT-CLM-018 — 創辦人的象徵性與極端特質

```yaml
claim_id: PT-CLM-018
framework_ids: [PT-07]
claim_type: affiliated_doctrine
claim_text_zh: >
  課堂筆記把部分成功創辦人描述為具有極端或不尋常特質，並認為 founder 對早期組織具有象徵性作用。
source_ids: [PT-P2-CS183-18]
location: "CS183 Class 18"
attribution_scope: blake_masters_derivative_of_thiel_course
fidelity_confidence: medium
utility_status: advisory
qualifications:
  - "不得轉成人格評分或把古怪當成成功訊號。"
  - "個案高度受成功者偏誤影響。"
```

## C. Founders Fund 機構主張與行為

### PT-CLM-019 — 困難科學與工程問題

```yaml
claim_id: PT-CLM-019
framework_ids: [PT-09]
claim_type: affiliated_doctrine
claim_text_zh: >
  Founders Fund 公開材料偏好處理困難科學與工程問題、能帶來實質技術進步的公司。
source_ids: [PT-P2-FF-MANIFESTO]
location: "Founders Fund manifesto"
attribution_scope: founders_fund
fidelity_confidence: high
utility_status: advisory
qualifications:
  - "原作者是 Bruce Gibney，不得標為 Peter Thiel 本人原則。"
  - "該文承認核心命題仍像一項待驗證的投資實驗。"
```

### PT-CLM-020 — Thiel Fellowship 顯示對非傳統能動性的偏好

```yaml
claim_id: PT-CLM-020
framework_ids: [PT-08, PT-09]
claim_type: revealed_behavior
claim_text_zh: >
  Thiel Fellowship 的制度設計與支持高能動性、非傳統路徑及實際建造新事物的偏好一致。
source_ids: [PT-P2-THIEL-FELLOWSHIP]
location: "program description"
attribution_scope: thiel_affiliated_program
fidelity_confidence: high
utility_status: advisory
qualifications:
  - "不得把年齡、學歷中斷或 Fellowship 身分當成成功因果。"
```

## D. 實證限定與反證

### PT-EQ-001 — 重尾報酬獲得支持，但集中投資不隨之自動成立

```yaml
claim_id: PT-EQ-001
framework_ids: [PT-06]
claim_type: empirical_qualification
claim_text_zh: >
  AngelList 早期投資資料支持正報酬右尾呈 power law；但在沒有可證明選擇優勢時，少數十筆投資的典型組合反而落後市場型組合。
source_ids: [PT-E1-POWERLAW-ANGELLIST]
location: "sample/method and simulation results"
attribution_scope: external_empirical
fidelity_confidence: high
utility_status: candidate
qualifications:
  - "平台選樣、未實現估值與可投資性限制外部效度。"
```

### PT-EQ-002 — 競爭與創新存在條件性關係

```yaml
claim_id: PT-EQ-002
framework_ids: [PT-02, PT-10]
claim_type: empirical_qualification
claim_text_zh: >
  實證研究顯示 competition 與 innovation 可能呈 inverted-U，因此「避免同質競爭」不能擴張為「所有競爭都不利於創新」。
source_ids: [PT-E1-COMPETITION-INNOVATION]
location: "paper abstract and results"
attribution_scope: external_empirical
fidelity_confidence: high
utility_status: candidate
```

### PT-EQ-003 — Founder continuity 不應成為單向治理分數

```yaml
claim_id: PT-EQ-003
framework_ids: [PT-07]
claim_type: empirical_qualification
claim_text_zh: >
  founder replacement 的因果研究提供在特定 VC-backed startups 中更換創辦人管理者可改善表現的證據，因此 founder control 需視公司階段與能力匹配判斷。
source_ids: [PT-E1-FOUNDER-REPLACEMENT]
location: "paper abstract and identification strategy"
attribution_scope: external_empirical
fidelity_confidence: medium_high
utility_status: candidate
```

### PT-EQ-004 — VC 重視團隊是業界實況，不是預測有效性的充分證明

```yaml
claim_id: PT-EQ-004
framework_ids: [PT-07]
claim_type: empirical_qualification
claim_text_zh: >
  大型 VC 調查顯示投資人自陳高度重視團隊；但此結果描述實務，不能單獨證明團隊評分比商業因素更能預測結果。
source_ids: [PT-E1-VC-SURVEY, PT-E1-DEAL-SELECTION]
location: "survey results and deal-selection study"
attribution_scope: external_empirical
fidelity_confidence: medium_high
utility_status: candidate
```

### PT-EQ-005 — Founders Fund portfolio 不是 Peter Thiel 個人投資清單

```yaml
claim_id: PT-EQ-005
framework_ids: [PT-01, PT-02, PT-09]
claim_type: external_claim
claim_text_zh: >
  Founders Fund 的投資批准是多人治理過程，因此只能把公開 portfolio 當成機構級行為，不得視為 Peter Thiel 個人的完整決策樣本。
source_ids: [PT-P2-FF-PORTFOLIO, PT-S1-FF-GOVERNANCE]
location: "official portfolio and Axios governance description"
attribution_scope: external_and_firm_level
fidelity_confidence: high
utility_status: advisory
```

