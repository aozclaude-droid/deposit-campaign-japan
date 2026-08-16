"use strict";

/*
 * Deposit Campaign Japan - Unified Prefecture Heatmap Patch
 * 2026-08-16
 *
 * Integrates:
 *   - 定期預金: R1 current_default_ranking.json (standard/storefront term-deposit rates)
 *   - 普通預金: R1 current_default_ranking.json (ordinary/savings rates)
 *   - キャンペーン預金・貯金: existing campaign_all.json-backed state.records
 *
 * Loaded AFTER app.js and web_r1_bridge.js.
 */

(() => {
  const PATCH_VERSION = "20260816.4";
  const R1_CURRENT_URL = "./r1_data/current_default_ranking.json";

  const PRODUCT_MODES = [
    ["base_term", "定期預金"],
    ["base_ordinary", "普通預金"],
    ["campaign", "キャンペーン預金・貯金"]
  ];

  const PREFECTURES = [
    "北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県","茨城県","栃木県","群馬県","埼玉県","千葉県",
    "東京都","神奈川県","新潟県","富山県","石川県","福井県","山梨県","長野県","岐阜県","静岡県","愛知県","三重県",
    "滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県","鳥取県","島根県","岡山県","広島県","山口県","徳島県",
    "香川県","愛媛県","高知県","福岡県","佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県"
  ];
  const PREF_SET = new Set(PREFECTURES);

  const R1 = { rows: [], loaded: false, error: "" };
  const q = (s, root = document) => root.querySelector(s);
  const qa = (s, root = document) => Array.from(root.querySelectorAll(s));

  const num = (v) => {
    const x = Number(String(v ?? "").replace(/[,%％\s]/g, ""));
    return Number.isFinite(x) ? x : null;
  };
  const pick = (row, ...keys) => {
    for (const key of keys) {
      const value = row?.[key];
      if (value !== undefined && value !== null && String(value).trim() !== "") return value;
    }
    return "";
  };
  const inst = (row) => String(pick(row, "institution_name", "金融機関名")).trim();
  const pref = (row) => String(pick(row, "prefecture", "都道府県")).trim();
  const region = (row) => String(pick(row, "region", "地域")).trim();
  const productFamily = (row) => String(pick(row, "product_family")).trim();
  const productLabel = (row) => String(pick(row, "product_label", "product_name", "商品名", "product_type", "商品区分")).trim();
  const tableContext = (row) => String(pick(row, "table_context", "source_table_context")).trim();
  const sourceDate = (row) => String(pick(row, "source_as_of_date", "effective_from", "base_rate_source_date")).trim();

  function normalizeType(value, name = "") {
    let t = String(value || "").trim();
    if (["JA", "JAバンク", "JAマリンバンク", "JFマリンバンク", "農業協同組合"].includes(t)) t = "JA等";
    if (["政府系金融機関", "外国銀行", "銀行"].includes(t)) t = "その他銀行";
    if (/商工中金|商工組合中央金庫/.test(name)) t = "その他銀行";
    if (/イオン銀行/.test(name)) t = "ネット銀行";
    return t;
  }
  const instType = (row) => normalizeType(pick(row, "institution_type", "金融機関種別"), inst(row));

  function termMonths(row) {
    const direct = num(pick(row, "term_months", "term_month", "months"));
    if (direct !== null) return Math.round(direct);
    const label = String(pick(row, "term_label", "term", "預入期間・年限")).trim();
    let m = label.match(/(\d+)\s*(?:か月|ヶ月|ヵ月|カ月|月)/);
    if (m) return Number(m[1]);
    m = label.match(/(\d+)\s*年/);
    return m ? Number(m[1]) * 12 : null;
  }

  function rate(row) {
    return num(pick(row, "rate_percent", "interest_rate_numeric", "interest_rate", "base_rate_percent", "rate"));
  }

  function isYen(row) {
    const currency = String(pick(row, "currency", "通貨")).trim().toUpperCase();
    if (currency && !/^(JPY|YEN|円)$/.test(currency)) return false;
    const text = `${productLabel(row)} ${tableContext(row)} ${pick(row, "currency_label")}`;
    return !/外貨|米ドル|USドル|USD|ユーロ|EUR|豪ドル|AUD|NZドル|NZD|英ポンド|GBP/i.test(text);
  }

  function isOrdinary(row) {
    if (!isYen(row)) return false;
    const text = `${productLabel(row)} ${pick(row, "term_label", "term", "預入期間・年限")} ${tableContext(row)}`;
    return /普通預金|普通貯金|通常貯金/.test(text) || /ORDINARY|DEMAND|SAVINGS/i.test(productFamily(row));
  }

  function isTerm(row) {
    if (!isYen(row) || isOrdinary(row)) return false;
    const text = `${productLabel(row)} ${tableContext(row)}`;
    return /定期預金|定期貯金|スーパー定期|大口定期|定期/.test(text)
      || /STANDARD_TERM|TIME_DEPOSIT|TERM_DEPOSIT/i.test(productFamily(row))
      || termMonths(row) !== null;
  }

  function isNetwork(row) {
    return /ネット銀行|インターネット銀行/.test(instType(row)) || /全国/.test(pref(row)) || /全国/.test(region(row));
  }

  function selectedValues(selector) {
    const el = q(selector);
    return new Set(el ? Array.from(el.selectedOptions).map((o) => o.value).filter(Boolean) : []);
  }

  function currentMode() {
    const value = q("#heatmapProductFilter")?.value || "";
    return PRODUCT_MODES.some(([mode]) => mode === value) ? value : "base_term";
  }

  function currentTerm() {
    if (typeof heatmapTerm === "function") return heatmapTerm();
    const key = state?.heatmapTermKey || "1y";
    const map = { "1y": { key: "1y", label: "1年", months: 12 }, "3y": { key: "3y", label: "3年", months: 36 }, "5y": { key: "5y", label: "5年", months: 60 } };
    return map[key] || map["1y"];
  }

  function avg(values) {
    const xs = values.filter(Number.isFinite);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  }

  function representativeInstitutions(rows) {
    const groups = new Map();
    for (const row of rows) {
      const name = inst(row);
      if (!name) continue;
      const key = `${name}\u241f${pref(row)}\u241f${instType(row)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    const out = [];
    for (const group of groups.values()) {
      const valid = group.map((row) => ({ row, value: rate(row), amount: num(pick(row, "amount_min", "amount_min_yen", "minimum_amount", "deposit_amount_min")) })).filter((x) => x.value !== null);
      if (!valid.length) continue;
      let chosen = null;
      const distinct = [...new Set(valid.map((x) => x.value.toFixed(9)))];
      if (distinct.length === 1) {
        chosen = valid[0].value;
      } else {
        const withAmount = valid.filter((x) => x.amount !== null).sort((a, b) => a.amount - b.amount || a.value - b.value);
        if (withAmount.length) {
          const minAmount = withAmount[0].amount;
          const smallest = withAmount.filter((x) => x.amount === minAmount);
          const smallRates = [...new Set(smallest.map((x) => x.value.toFixed(9)))];
          if (smallRates.length === 1) chosen = smallest[0].value;
        }
      }
      // 金額帯が曖昧な場合は推測せず除外。
      if (chosen === null) continue;
      const dates = group.map(sourceDate).filter(Boolean).sort();
      out.push({
        institution: inst(group[0]),
        institution_type: instType(group[0]),
        prefecture: pref(group[0]),
        averageRate: chosen,
        maximumRate: chosen,
        minimumRate: chosen,
        records: group,
        source_date: dates.at(-1) || ""
      });
    }
    return out.sort((a, b) => b.averageRate - a.averageRate || a.institution.localeCompare(b.institution, "ja"));
  }

  function buildBaseData(mode) {
    const term = currentTerm();
    const selectedTypes = selectedValues("#heatmapInstitutionTypeFilter");
    const typeActive = selectedTypes.size > 0;
    let rows = R1.rows.filter(isYen);
    rows = mode === "base_ordinary"
      ? rows.filter(isOrdinary)
      : rows.filter((row) => isTerm(row) && termMonths(row) === term.months);

    const regionalRows = rows.filter((row) => !isNetwork(row) && PREF_SET.has(pref(row)) && (!typeActive || selectedTypes.has(instType(row))));
    const onlineRows = rows.filter(isNetwork);
    const byPref = new Map(PREFECTURES.map((p) => [p, []]));
    regionalRows.forEach((row) => byPref.get(pref(row))?.push(row));

    const prefectures = new Map();
    for (const [p, pRows] of byPref.entries()) {
      const institutions = representativeInstitutions(pRows);
      const rates = institutions.map((x) => x.averageRate).filter(Number.isFinite);
      prefectures.set(p, {
        prefecture: p,
        averageRate: avg(rates),
        institutionCount: institutions.length,
        recordCount: pRows.length,
        comparableCount: institutions.length,
        maximumRate: rates.length ? Math.max(...rates) : null,
        minimumRate: rates.length ? Math.min(...rates) : null,
        institutions,
        records: pRows
      });
    }

    const rankedPrefectures = [...prefectures.values()]
      .filter((x) => Number.isFinite(x.averageRate))
      .sort((a, b) => b.averageRate - a.averageRate || PREFECTURES.indexOf(a.prefecture) - PREFECTURES.indexOf(b.prefecture));
    const regionalInstitutions = representativeInstitutions(regionalRows);
    const onlineInstitutions = representativeInstitutions(onlineRows);

    return {
      mode,
      label: mode === "base_ordinary" ? "普通預金" : "定期預金",
      rateLabel: mode === "base_ordinary" ? "普通預金金利" : "店頭表示金利",
      term: mode === "base_ordinary" ? { key: "ordinary", label: "普通預金", months: null } : term,
      institutionTypes: [...selectedTypes],
      statuses: [],
      regionalRecords: regionalRows,
      onlineRecords: onlineRows,
      prefectures,
      rankedPrefectures,
      regionalInstitutions,
      onlineInstitutions,
      nationalAverage: avg(regionalInstitutions.map((x) => x.averageRate)),
      onlineAverage: avg(onlineInstitutions.map((x) => x.averageRate)),
      pending: !R1.loaded,
      error: R1.error
    };
  }

  function buildCampaignData() {
    const term = currentTerm();
    const types = selectedValues("#heatmapInstitutionTypeFilter");
    const statuses = selectedValues("#heatmapStatusFilter");
    const typeActive = types.size > 0;
    const statusActive = statuses.size > 0;

    const records = (state.records || []).filter((record) => {
      if (record._analyticsTermKey !== term.key || !Number.isFinite(record._comparableRate)) return false;
      if (!/預金|貯金/.test(record.product_type || "") || /積金/.test(record.product_type || "")) return false;
      if (statusActive && !statuses.has(record.status)) return false;
      return true;
    });

    const regionalRecords = records.filter((record) => record.institution_type !== "ネット銀行" && PREF_SET.has(record.prefecture) && (!typeActive || types.has(record.institution_type)));
    const onlineRecords = records.filter((record) => record.institution_type === "ネット銀行");
    const byPref = new Map(PREFECTURES.map((p) => [p, []]));
    regionalRecords.forEach((record) => byPref.get(record.prefecture)?.push(record));
    const prefectures = new Map();
    for (const [p, pRows] of byPref.entries()) {
      const institutions = typeof buildInstitutionRateGroups === "function" ? buildInstitutionRateGroups(pRows) : [];
      const instRates = institutions.map((x) => x.averageRate).filter(Number.isFinite);
      const rawRates = pRows.map((r) => r._comparableRate).filter(Number.isFinite);
      prefectures.set(p, {
        prefecture: p,
        averageRate: avg(instRates),
        institutionCount: institutions.length,
        recordCount: pRows.length,
        comparableCount: rawRates.length,
        maximumRate: rawRates.length ? Math.max(...rawRates) : null,
        minimumRate: rawRates.length ? Math.min(...rawRates) : null,
        institutions,
        records: pRows
      });
    }
    const rankedPrefectures = [...prefectures.values()].filter((x) => Number.isFinite(x.averageRate))
      .sort((a, b) => b.averageRate - a.averageRate || PREFECTURES.indexOf(a.prefecture) - PREFECTURES.indexOf(b.prefecture));
    const regionalInstitutions = typeof buildInstitutionRateGroups === "function" ? buildInstitutionRateGroups(regionalRecords) : [];
    const onlineInstitutions = typeof buildInstitutionRateGroups === "function" ? buildInstitutionRateGroups(onlineRecords) : [];
    return {
      mode: "campaign",
      label: "キャンペーン預金・貯金",
      rateLabel: "キャンペーン金利",
      term,
      institutionTypes: [...types],
      statuses: [...statuses],
      regionalRecords,
      onlineRecords,
      prefectures,
      rankedPrefectures,
      regionalInstitutions,
      onlineInstitutions,
      nationalAverage: avg(regionalInstitutions.map((x) => x.averageRate)),
      onlineAverage: avg(onlineInstitutions.map((x) => x.averageRate))
    };
  }

  function dataForCurrentMode() {
    const mode = currentMode();
    return mode === "campaign" ? buildCampaignData() : buildBaseData(mode);
  }

  function configureControls(force = false) {
    const product = q("#heatmapProductFilter");
    if (!product) return;
    const expectedValues = PRODUCT_MODES.map(([value]) => value);
    const actualValues = Array.from(product.options).map((option) => option.value);
    const optionsAreUnified = actualValues.length === expectedValues.length
      && expectedValues.every((value, index) => actualValues[index] === value);
    if (force || product.dataset.unifiedHeatmapPatch !== PATCH_VERSION || !optionsAreUnified || product.multiple) {
      const previous = expectedValues.includes(product.value) ? product.value : "base_term";
      product.multiple = false;
      product.size = 3;
      product.innerHTML = PRODUCT_MODES.map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
      product.value = previous;
      product.dataset.unifiedHeatmapPatch = PATCH_VERSION;
    }

    const termField = q(".heatmap-term-switch");
    const statusLabel = q("#heatmapStatusFilter")?.closest("label");
    const mode = currentMode();
    if (termField) termField.hidden = mode === "base_ordinary";
    if (statusLabel) statusLabel.hidden = mode !== "campaign";

    const heading = q("#prefectureHeatmapPanel h2");
    if (heading) heading.textContent = "都道府県別 金利ヒートマップ";
    const tabDesc = q("#heatmapTab .workspace-tab-description");
    if (tabDesc) tabDesc.textContent = "店頭表示金利・普通預金・キャンペーン金利を商品区分別に比較";
    const help = q(".heatmap-help");
    if (help) {
      help.textContent = mode === "campaign"
        ? "キャンペーン預金・貯金の比較可能金利を集計します。店頭表示金利は含みません。"
        : mode === "base_ordinary"
          ? "R1通常金利データの普通預金・普通貯金金利を表示します。普通預金には預入年限がないため期間切替は使用しません。"
          : "R1通常金利データの定期預金・定期貯金の店頭表示金利を表示します。キャンペーン金利は含みません。";
    }
  }

  function hideSeparateR1Heatmap() {
    // The old R1 bridge is no longer a user-facing section.  Its data files
    // remain available to the unified prefecture heatmap and R1 matrix logic,
    // but the standalone BASE RATE / EFFECTIVE RATE shell must not appear.
    const shell = q("#r1BridgeShell");
    if (!shell) return false;
    shell.hidden = true;
    shell.setAttribute("aria-hidden", "true");
    shell.style.setProperty("display", "none", "important");
    return true;
  }

  function renderUnified() {
    configureControls();
    if (typeof renderJapanTileMap === "function") renderJapanTileMap();
    const mapSvg = q("#japanHeatmap");
    if (mapSvg && !mapSvg.querySelector(".prefecture-label-layer") && typeof buildPrefectureMapLabels === "function") {
      window.requestAnimationFrame(() => {
        if (!mapSvg.querySelector(".prefecture-label-layer")) buildPrefectureMapLabels(mapSvg);
      });
    }
    const data = dataForCurrentMode();
    state.heatmapData = data;

    const values = data.rankedPrefectures.map((x) => x.averageRate);
    const min = values.length ? Math.min(...values) : null;
    const max = values.length ? Math.max(...values) : null;
    const highest = data.rankedPrefectures[0] || null;
    const lowest = data.rankedPrefectures.length ? data.rankedPrefectures[data.rankedPrefectures.length - 1] : null;
    const termPrefix = data.mode === "base_ordinary" ? "" : `${data.term.label} `;

    const title = q("#heatmapMapTitle");
    if (title) title.textContent = `${termPrefix}${data.rateLabel}・都道府県平均`;
    const summary = q("#heatmapSummary");
    if (summary) {
      if (data.pending) summary.textContent = "R1通常金利データを読み込み中…";
      else if (data.error && data.mode !== "campaign") summary.textContent = `R1通常金利データ読込エラー: ${data.error}`;
      else summary.textContent = `${data.label}${data.mode === "base_ordinary" ? "" : ` / ${data.term.label}`} / ${data.rankedPrefectures.length}都道府県 / 地域金融機関 ${data.regionalInstitutions.length}先 / 全国向け ${data.onlineInstitutions.length}先`;
    }

    const cards = q("#heatmapSummaryCards");
    if (cards && typeof summaryCardHtml === "function") {
      cards.innerHTML = [
        summaryCardHtml("地域金融機関・全国平均", formatRate(data.nationalAverage), `${data.regionalInstitutions.length}金融機関を均等平均`, "national"),
        summaryCardHtml("最高の都道府県", highest ? formatRate(highest.averageRate) : "—", highest ? `${highest.prefecture}・${highest.institutionCount}金融機関` : "比較可能データなし", "highest"),
        summaryCardHtml("最低の都道府県", lowest ? formatRate(lowest.averageRate) : "—", lowest ? `${lowest.prefecture}・${lowest.institutionCount}金融機関` : "比較可能データなし", "lowest"),
        summaryCardHtml("算出対象", `${data.rankedPrefectures.length} / 47`, `${data.rateLabel} ${data.regionalRecords.length}レコード`, "coverage")
      ].join("");
    }

    if (typeof renderHeatmapLegend === "function") renderHeatmapLegend(min, max);
    qa(".prefecture-shape").forEach((shape) => {
      const item = data.prefectures.get(shape.dataset.prefecture);
      const has = item && Number.isFinite(item.averageRate);
      const fill = typeof heatmapColor === "function" ? heatmapColor(item?.averageRate, min, max) : "#e5e7eb";
      shape.style.setProperty("fill", fill, "important");
      shape.classList.toggle("has-data", !!has);
      shape.classList.toggle("no-data", !has);
      shape.classList.toggle("is-selected", shape.dataset.prefecture === state.heatmapSelectedPrefecture);
      shape.setAttribute("aria-label", has ? `${item.prefecture} ${data.rateLabel}平均 ${formatRate(item.averageRate)}` : `${shape.dataset.prefecture} データなし`);
      if (typeof svgPrefectureLabel === "function") {
        const label = svgPrefectureLabel(shape.dataset.prefecture);
        if (label && typeof heatmapLabelColor === "function") label.style.fill = heatmapLabelColor(fill, has);
      }
    });

    const ranking = q("#heatmapRanking");
    if (ranking) {
      ranking.innerHTML = data.rankedPrefectures.length
        ? data.rankedPrefectures.map((item, i) => `<button class="heatmap-ranking-row ${item.prefecture === state.heatmapSelectedPrefecture ? "is-selected" : ""}" data-prefecture="${item.prefecture}" type="button"><span class="heatmap-rank-number">${i + 1}</span><span class="heatmap-rank-name">${item.prefecture}</span><strong>${formatRate(item.averageRate)}</strong><small>${item.institutionCount}金融機関</small></button>`).join("")
        : `<div class="heatmap-empty">${data.pending ? "R1通常金利データを読み込み中です。" : "比較可能な都道府県データがありません。"}</div>`;
      qa(".heatmap-ranking-row", ranking).forEach((button) => button.addEventListener("click", () => {
        state.heatmapSelectedPrefecture = button.dataset.prefecture;
        renderSelection();
      }));
    }
    renderSelection();
    renderOnline();
    state.heatmapRendered = true;
  }

  function renderUnifiedSafe() {
    try {
      renderUnified();
      return true;
    } catch (error) {
      try { state.heatmapRendered = false; } catch (_) {}
      const summary = q("#heatmapSummary");
      if (summary) summary.textContent = `統合ヒートマップ描画エラー: ${String(error?.message || error)}`;
      const ranking = q("#heatmapRanking");
      if (ranking) ranking.innerHTML = `<div class="heatmap-empty">統合ヒートマップを描画できませんでした。ページを再読み込みしてください。</div>`;
      console.error("[UnifiedHeatmap] render failed", error);
      return false;
    }
  }

  function renderSelection() {
    const data = state.heatmapData;
    const detail = q("#heatmapPrefectureDetail");
    if (!data || !detail) return;
    qa(".prefecture-shape").forEach((el) => el.classList.toggle("is-selected", el.dataset.prefecture === state.heatmapSelectedPrefecture));
    qa(".heatmap-ranking-row").forEach((el) => el.classList.toggle("is-selected", el.dataset.prefecture === state.heatmapSelectedPrefecture));
    const item = data.prefectures.get(state.heatmapSelectedPrefecture);
    const termLabel = data.mode === "base_ordinary" ? "普通預金" : data.term.label;
    if (!item || !Number.isFinite(item.averageRate)) {
      detail.innerHTML = state.heatmapSelectedPrefecture
        ? `<div class="heatmap-detail-heading"><div><h3>${state.heatmapSelectedPrefecture}・${termLabel}</h3><p class="muted">選択条件に一致する比較可能データがありません。</p></div></div>`
        : '<div class="heatmap-empty">地図またはランキングから都道府県を選択してください。</div>';
      return;
    }

    if (data.mode === "campaign") {
      const rows = item.institutions.map((x, i) => `<tr><td>${i + 1}</td><th scope="row">${x.institution}</th><td class="rate">${formatRate(x.averageRate)}</td><td>${formatRate(x.maximumRate)}</td><td>${x.records.length}件</td></tr>`).join("");
      detail.innerHTML = `<div class="heatmap-detail-heading"><div><p class="section-kicker">PREFECTURE DETAIL</p><h3>${item.prefecture}・${termLabel}</h3><p class="muted">キャンペーン平均 ${formatRate(item.averageRate)} / ${item.institutionCount}金融機関</p></div></div><div class="table-scroll"><table class="heatmap-detail-table"><thead><tr><th>順位</th><th>金融機関</th><th>機関内平均</th><th>最高金利</th><th>明細数</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    } else {
      const rows = item.institutions.map((x, i) => `<tr><td>${i + 1}</td><th scope="row">${x.institution}</th><td>${x.institution_type}</td><td class="rate">${formatRate(x.averageRate)}</td><td>${x.source_date || "—"}</td></tr>`).join("");
      detail.innerHTML = `<div class="heatmap-detail-heading"><div><p class="section-kicker">PREFECTURE DETAIL</p><h3>${item.prefecture}・${termLabel}</h3><p class="muted">${data.rateLabel}平均 ${formatRate(item.averageRate)} / ${item.institutionCount}金融機関</p></div></div><div class="table-scroll"><table class="heatmap-detail-table"><thead><tr><th>順位</th><th>金融機関</th><th>金融機関種別</th><th>${data.rateLabel}</th><th>基準日</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }
  }

  function renderOnline() {
    const data = state.heatmapData;
    if (!data) return;
    const headline = q("#onlineBankHeadline");
    const results = q("#onlineBankResults");
    if (!headline || !results) return;
    const institutions = data.onlineInstitutions || [];
    headline.textContent = institutions.length ? `平均 ${formatRate(data.onlineAverage)} / ${institutions.length}金融機関` : "比較可能データなし";
    if (!institutions.length) {
      results.innerHTML = '<div class="heatmap-empty">選択条件に一致する全国向け・ネット銀行データがありません。</div>';
      return;
    }
    const rows = data.mode === "campaign"
      ? institutions.map((x, i) => `<tr><td>${i + 1}</td><th scope="row">${x.institution}</th><td class="rate">${formatRate(x.averageRate)}</td><td>${formatRate(x.maximumRate)}</td><td>${x.records.length}件</td></tr>`).join("")
      : institutions.map((x, i) => `<tr><td>${i + 1}</td><th scope="row">${x.institution}</th><td>${x.institution_type}</td><td class="rate">${formatRate(x.averageRate)}</td><td>${x.source_date || "—"}</td></tr>`).join("");
    results.innerHTML = `<div class="table-scroll"><table class="heatmap-detail-table online-bank-table"><thead><tr><th>順位</th><th>金融機関</th>${data.mode === "campaign" ? "<th>機関内平均</th><th>最高金利</th><th>明細数</th>" : `<th>種別</th><th>${data.rateLabel}</th><th>基準日</th>`}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function tooltip(event, prefecture) {
    const data = state.heatmapData;
    const item = data?.prefectures.get(prefecture);
    const box = q("#tooltip");
    if (!box) return;
    const termLabel = data?.mode === "base_ordinary" ? "普通預金" : data?.term?.label || "—";
    box.innerHTML = item && Number.isFinite(item.averageRate)
      ? `<strong>${prefecture}</strong><div class="tooltip-grid"><span class="tooltip-key">商品区分</span><span>${data.label}</span><span class="tooltip-key">対象</span><span>${termLabel}</span><span class="tooltip-key">平均金利</span><span>${formatRate(item.averageRate)}</span><span class="tooltip-key">金融機関数</span><span>${item.institutionCount}先</span></div>`
      : `<strong>${prefecture}</strong><div class="tooltip-grid"><span class="tooltip-key">商品区分</span><span>${data?.label || "—"}</span><span class="tooltip-key">平均金利</span><span>比較可能データなし</span></div>`;
    box.style.display = "block";
    if (typeof moveTooltip === "function") moveTooltip(event);
  }

  function resetUnifiedControls(render = true) {
    try { state.heatmapTermKey = "1y"; } catch (_) {}
    try { state.heatmapSelectedPrefecture = ""; } catch (_) {}
    qa(".heatmap-term-button").forEach((button) => {
      const active = button.dataset.heatmapTerm === "1y";
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    configureControls(true);
    const product = q("#heatmapProductFilter");
    if (product) product.value = "base_term";
    const types = q("#heatmapInstitutionTypeFilter");
    if (types) Array.from(types.options).forEach((option) => { option.selected = option.value !== "ネット銀行"; });
    const statuses = q("#heatmapStatusFilter");
    if (statuses) Array.from(statuses.options).forEach((option) => { option.selected = option.value === "開催中"; });
    configureControls();
    if (render && typeof state !== "undefined" && state.activeView === "heatmap") renderUnifiedSafe();
    else if (typeof state !== "undefined") state.heatmapRendered = false;
  }

  // Replace existing app.js heatmap function bindings.  This must run only
  // after app.js has executed; the installer therefore loads this patch with
  // `defer` after app.js and web_r1_bridge.js.  We retry during init as a
  // defensive measure for cached/older HTML.
  function installOverrides() {
    let installed = false;
    try {
      if (typeof renderPrefectureHeatmap === "function") {
        renderPrefectureHeatmap = renderUnifiedSafe;
        installed = true;
      }
    } catch (_) {}
    try { if (typeof resetHeatmapControls === "function") resetHeatmapControls = resetUnifiedControls; } catch (_) {}
    try { if (typeof renderHeatmapSelection === "function") renderHeatmapSelection = renderSelection; } catch (_) {}
    try { if (typeof renderOnlineBankSection === "function") renderOnlineBankSection = renderOnline; } catch (_) {}
    try { if (typeof showHeatmapTooltip === "function") showHeatmapTooltip = tooltip; } catch (_) {}
    return installed;
  }

  installOverrides();

  function bindControls() {
    const product = q("#heatmapProductFilter");
    if (product && !product.dataset.unifiedBound) {
      product.dataset.unifiedBound = "1";
      product.addEventListener("change", () => {
        state.heatmapSelectedPrefecture = "";
        configureControls();
        renderUnifiedSafe();
      });
    }
    qa(".heatmap-term-button").forEach((button) => {
      if (button.dataset.unifiedBound) return;
      button.dataset.unifiedBound = "1";
      button.addEventListener("click", () => setTimeout(renderUnifiedSafe, 0));
    });
    ["#heatmapInstitutionTypeFilter", "#heatmapStatusFilter"].forEach((selector) => {
      const el = q(selector);
      if (el && !el.dataset.unifiedBound) {
        el.dataset.unifiedBound = "1";
        el.addEventListener("change", () => renderUnifiedSafe());
      }
    });
  }

  function appUiReady() {
    try {
      return Array.isArray(state.records) && state.records.length > 0
        && !!q("#heatmapTabPanel") && !!q("#heatmapProductFilter")
        && q("#heatmapInstitutionTypeFilter")?.options.length > 0;
    } catch (_) {
      return false;
    }
  }

  function refreshAfterAppInit() {
    installOverrides();
    configureControls(true);
    hideSeparateR1Heatmap();
    bindControls();
    if ((typeof state !== "undefined" && state.activeView === "heatmap") || window.location.hash === "#prefecture-heatmap") {
      renderUnifiedSafe();
    }
  }

  function watchForAppInitialization() {
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      hideSeparateR1Heatmap();
      if (appUiReady()) {
        window.clearInterval(timer);
        refreshAfterAppInit();
      } else if (attempts >= 100) {
        window.clearInterval(timer);
      }
    }, 100);
  }

  function bindViewHooks() {
    if (document.documentElement.dataset.unifiedHeatmapViewHooks === PATCH_VERSION) return;
    document.documentElement.dataset.unifiedHeatmapViewHooks = PATCH_VERSION;
    window.addEventListener("hashchange", () => {
      if (window.location.hash === "#prefecture-heatmap") window.setTimeout(refreshAfterAppInit, 0);
    });
    document.addEventListener("click", (event) => {
      const tab = event.target.closest?.("#heatmapTab,[data-view='heatmap']");
      if (tab) window.setTimeout(refreshAfterAppInit, 0);
    }, true);
  }

  async function init() {
    installOverrides();
    configureControls();
    bindViewHooks();
    watchForAppInitialization();
    hideSeparateR1Heatmap();
    bindControls();

    // web_r1_bridge.js creates #r1BridgeShell on DOMContentLoaded.  Keep a
    // short-lived observer so the standalone R1 shell cannot reappear because
    // of execution order or a future async re-render.
    const observer = new MutationObserver(() => hideSeparateR1Heatmap());
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    window.setTimeout(() => observer.disconnect(), 5000);

    try {
      const response = await fetch(R1_CURRENT_URL, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();
      R1.rows = Array.isArray(json) ? json : (Array.isArray(json.rows) ? json.rows : Array.isArray(json.records) ? json.records : []);
      R1.loaded = true;
    } catch (error) {
      R1.error = String(error?.message || error);
    }

    installOverrides();
    configureControls(appUiReady());
    hideSeparateR1Heatmap();
    bindControls();
    if (typeof state !== "undefined" && state.activeView === "heatmap") renderUnifiedSafe();

    // One final retry catches app/bridge initialization that completed in the
    // same event turn after this handler.
    window.setTimeout(() => {
      installOverrides();
      configureControls(appUiReady());
      hideSeparateR1Heatmap();
      bindControls();
      if (typeof state !== "undefined" && state.activeView === "heatmap") renderUnifiedSafe();
    }, 0);
  }

  window.addEventListener("pageshow", () => {
    if (window.location.hash === "#prefecture-heatmap") window.setTimeout(refreshAfterAppInit, 0);
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
