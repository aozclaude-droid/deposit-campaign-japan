"use strict";

/*
 * Deposit Campaign Japan - Unified Prefecture Heatmap Patch
 * v4.7 / 2026-10-18
 *
 * Integrates into the existing prefecture heatmap:
 *   - 定期預金: R1 current_default_ranking.json (店頭表示金利)
 *   - 普通預金: R1 base_rate_history.json から最新スナップショットを抽出 (普通預金金利)
 *   - キャンペーン預金・貯金: existing campaign_all.json-backed state.records
 *
 * Loaded AFTER app.js and web_r1_bridge.js.
 */

(() => {
  const PATCH_VERSION = "20261028.2";
  const R1_CURRENT_URL = "./r1_data/current_default_ranking.json";
  const R1_HISTORY_URL = "./r1_data/base_rate_history.json?v=20261025-3";

  const PRODUCT_MODES = [
    ["base_term", "定期預金"],
    ["base_ordinary", "普通預金"],
    ["campaign", "キャンペーン預金・貯金"]
  ];
  const INSTITUTION_TYPE_ORDER = [
    "都市銀行", "地方銀行", "信託銀行", "その他銀行",
    "信用金庫", "信用組合", "JA等", "労働金庫", "ゆうちょ銀行"
  ];

  const PREFECTURES = [
    "北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県","茨城県","栃木県","群馬県","埼玉県","千葉県",
    "東京都","神奈川県","新潟県","富山県","石川県","福井県","山梨県","長野県","岐阜県","静岡県","愛知県","三重県",
    "滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県","鳥取県","島根県","岡山県","広島県","山口県","徳島県",
    "香川県","愛媛県","高知県","福岡県","佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県"
  ];
  const PREF_SET = new Set(PREFECTURES);

  const R1 = { rows: [], historyRows: [], loaded: false, historyReady: false, error: "", historyError: "" };
  const q = (s, root = document) => root.querySelector(s);
  const qa = (s, root = document) => Array.from(root.querySelectorAll(s));

  // Prevent a one-frame flash of the old standalone R1 section.
  const style = document.createElement("style");
  style.id = "unifiedHeatmapV4Style";
  style.textContent = `#r1BridgeShell{display:none!important}`;
  document.head?.appendChild(style);

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
  const inst = (row) => String(pick(row, "institution_name", "金融機関名", "bank_name", "name")).trim();
  const pref = (row) => String(pick(row, "prefecture", "都道府県", "prefecture_name")).trim();
  const region = (row) => String(pick(row, "region", "地域", "area")).trim();
  const productFamily = (row) => String(pick(
    row, "product_family", "product_category", "deposit_type", "account_type", "category"
  )).trim();
  const productLabel = (row) => String(pick(
    row, "product_label", "product_name", "商品名", "product_type", "商品区分",
    "deposit_name", "account_name", "product"
  )).trim();
  const tableContext = (row) => String(pick(
    row, "table_context", "source_table_context", "rate_type", "rate_category", "context"
  )).trim();
  const sourceDate = (row) => String(pick(
    row, "source_as_of_date", "effective_from", "base_rate_source_date", "as_of_date", "date"
  )).trim();

  const isoDateOnly = (value) => {
    const s = String(value ?? "").trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
  };

  const effectiveFrom = (row) => isoDateOnly(pick(row, "effective_from", "valid_from", "start_date"));
  const effectiveTo = (row) => isoDateOnly(pick(row, "effective_to", "valid_to", "end_date"));
  const observedDate = (row) => isoDateOnly(pick(row, "observed_at", "collected_at", "fetched_at", "updated_at"));
  const rowSnapshotDate = (row) => effectiveFrom(row) || isoDateOnly(sourceDate(row)) || observedDate(row);

  function todayIsoLocal() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function productText(row) {
    return [
      productFamily(row),
      productLabel(row),
      tableContext(row),
      pick(row, "term_label", "term", "預入期間・年限", "tenor", "period"),
      pick(row, "rate_type", "rate_category", "deposit_type", "account_type")
    ].map((v) => String(v || "").trim()).filter(Boolean).join(" ");
  }

  function normalizeType(value, name = "") {
    let t = String(value || "").replace(/\s+/g, "");
    if (["JA", "JA等", "JAバンク", "JAマリンバンク", "JFマリンバンク", "農業協同組合", "農協"].includes(t)) t = "JA等";
    if (["地銀", "地方銀行", "第二地銀", "第二地方銀行"].includes(t)) t = "地方銀行";
    if (["ネット銀行", "ネット銀行等", "新たな形態の銀行", "インターネット銀行"].includes(t)) t = "ネット銀行";
    if (["その他銀行", "その他の銀行", "銀行", "政府系金融機関", "外国銀行", "外国銀行（在日拠点）"].includes(t)) t = "その他銀行";
    if (/商工中金|商工組合中央金庫/.test(name)) t = "その他銀行";
    if (/イオン銀行/.test(name)) t = "ネット銀行";
    if (!t && (/^JA/.test(name) || /農業協同組合|農協/.test(name))) t = "JA等";
    return t;
  }
  const instType = (row) => normalizeType(
    pick(
      row,
      "institution_type_normalized",
      "institution_type",
      "金融機関種別",
      "institution_type_raw",
      "type",
      "bank_type"
    ),
    inst(row)
  );

  function refreshInstitutionTypeOptions() {
    const select = q("#heatmapInstitutionTypeFilter");
    if (!select) return;
    const rows = [];
    try { if (Array.isArray(state.records)) rows.push(...state.records); } catch (_) {}
    rows.push(...R1.rows, ...R1.historyRows);
    const available = new Set(rows.map(instType).filter((type) => type && type !== "ネット銀行"));
    if (!available.size) return;

    const known = new Set(INSTITUTION_TYPE_ORDER);
    const desired = [
      ...INSTITUTION_TYPE_ORDER.filter((type) => available.has(type)),
      ...[...available].filter((type) => !known.has(type)).sort((a, b) => a.localeCompare(b, "ja"))
    ];
    const currentOptions = Array.from(select.options);
    const current = currentOptions.map((option) => option.value);
    if (current.length === desired.length && current.every((value, index) => value === desired[index])) return;

    const selected = new Set(currentOptions.filter((option) => option.selected).map((option) => normalizeType(option.value)));
    const selectAll = currentOptions.length === 0 || currentOptions.every((option) => option.selected);
    select.replaceChildren(...desired.map((type) => {
      const option = document.createElement("option");
      option.value = type;
      option.textContent = type;
      option.selected = selectAll || selected.has(type);
      return option;
    }));
  }

  function termMonths(row) {
    const direct = num(pick(
      row, "term_months", "term_month", "months", "period_months", "tenor_months", "maturity_months"
    ));
    if (direct !== null) return Math.round(direct);

    const years = num(pick(row, "term_years", "years", "period_years", "tenor_years"));
    if (years !== null) return Math.round(years * 12);

    const label = String(pick(
      row, "term_label", "term", "預入期間・年限", "tenor", "period", "maturity"
    )).trim();

    let m = label.match(/(\d+(?:\.\d+)?)\s*(?:か月|ヶ月|ヵ月|カ月|月)/i);
    if (m) return Math.round(Number(m[1]));
    m = label.match(/(\d+(?:\.\d+)?)\s*年/i);
    if (m) return Math.round(Number(m[1]) * 12);
    m = label.match(/\b(\d+)\s*M\b/i);
    if (m) return Number(m[1]);
    m = label.match(/\b(\d+(?:\.\d+)?)\s*Y\b/i);
    return m ? Math.round(Number(m[1]) * 12) : null;
  }

  function rate(row) {
    if (typeof row?._comparableRate === "number" && Number.isFinite(row._comparableRate)) {
      return row._comparableRate;
    }
    return num(pick(
      row,
      "rate_percent",
      "effective_rate_percent",
      "resolved_effective_rate_percent",
      "effective_rate",
      "interest_rate_numeric",
      "interest_rate",
      "base_rate_percent",
      "default_rate_percent",
      "standard_rate_percent",
      "ordinary_rate_percent",
      "deposit_rate_percent",
      "rate"
    ));
  }

  function isYen(row) {
    const currency = String(pick(row, "currency", "通貨", "currency_code")).trim().toUpperCase();
    if (currency && !/^(JPY|YEN|円|日本円)$/.test(currency)) return false;
    const text = `${productText(row)} ${pick(row, "currency_label")}`;
    return !/外貨|米ドル|USドル|USD|ユーロ|EUR|豪ドル|AUD|NZドル|NZD|英ポンド|GBP/i.test(text);
  }

  function isOrdinary(row) {
    if (!isYen(row)) return false;

    // R1 has an explicit product_family taxonomy.  Ordinary deposits must be
    // identified from that row-local field (or an exact row-local Japanese
    // product label fallback) only.  Do NOT search the broad table context and
    // do NOT use the token "SAVINGS": it also matches INSTALLMENT_SAVINGS
    // (定期積金), which caused the false 0.392% / 27-prefecture result.
    const family = productFamily(row).toUpperCase();
    if (family === "ORDINARY_DEPOSIT") return true;
    if (family) return false;

    const label = productLabel(row).replace(/[\s　]+/g, "");
    return /^(普通預金|普通貯金|通常貯金)$/.test(label);
  }

  function isR1OrdinaryEligible(row) {
    // Fail closed when R1 exposes eligibility metadata.  The current frozen
    // R1 release contains one ORDINARY_DEPOSIT row, but it is record_eligible=0;
    // it must not be presented as a comparable current ordinary-deposit rate.
    const eligible = String(pick(row, "record_eligible", "record_eligible_v072", "record_eligible_v071")).trim();
    if (eligible && eligible !== "1") return false;

    const measure = String(pick(row, "rate_measure_type", "rate_measure_type_v072")).trim();
    if (measure && measure !== "NOMINAL_INTEREST_RATE") return false;

    // Do not reject FUTURE_EFFECTIVE here forever.  currentOrdinaryRows()
    // performs a date-aware snapshot gate, so a row becomes visible automatically
    // once its source/effective date arrives.
    return true;
  }

  function isTerm(row) {
    if (!isYen(row) || isOrdinary(row)) return false;
    const text = productText(row);
    return /定期預金|定期貯金|スーパー定期|大口定期|期日指定定期|定期/.test(text)
      || /STANDARD_TERM|TIME_DEPOSIT|TERM_DEPOSIT|FIXED_DEPOSIT|FIXED_TERM/i.test(text)
      || termMonths(row) !== null;
  }

  function isNetwork(row) {
    const aggregation = String(pick(row, "prefecture_aggregation_eligible")).trim();
    const scope = String(pick(row, "ranking_scope")).trim().toUpperCase();
    return aggregation === "0"
      || scope === "NATIONWIDE_ONLY"
      || /ネット銀行|インターネット銀行/.test(instType(row))
      || /全国/.test(pref(row))
      || /全国/.test(region(row));
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

  function scaleRate(value) {
    return Number.isFinite(value) ? Number(value.toFixed(6)) : null;
  }

  function currentOrdinaryRows() {
    const today = todayIsoLocal();
    const source = (R1.historyRows.length ? R1.historyRows : R1.rows)
      .filter((row) => isOrdinary(row) && isR1OrdinaryEligible(row) && rate(row) !== null);

    // Future-effective rows are not part of today's ordinary-deposit snapshot.
    const eligible = source.filter((row) => {
      const from = effectiveFrom(row);
      const to = effectiveTo(row);
      const snapshot = rowSnapshotDate(row);
      if (from && from > today) return false;
      if (to && to < today) return false;
      if (!from && snapshot && snapshot > today) return false;
      return true;
    });

    // base_rate_history is historical. Keep only the latest available snapshot
    // for each institution / prefecture / institution-type combination so old
    // observations do not get averaged into the current ordinary-deposit rate.
    const latest = new Map();
    for (const row of eligible) {
      const key = [inst(row), pref(row), instType(row)].join("\u241f");
      if (!inst(row)) continue;
      const date = rowSnapshotDate(row);
      const current = latest.get(key);
      if (!current || date > current.date) latest.set(key, { date, rows: [row] });
      else if (date === current.date) current.rows.push(row);
    }

    // When the latest snapshot contains amount tiers, use the small-balance
    // tier as the institution's representative rate. This keeps, for example,
    // Aozora Bank's <= 1 million yen rate (1.20%) instead of averaging it with
    // the > 1 million yen rate (0.75%).
    const smallBalanceScore = (row) => {
      const band = String(pick(row, "amount_band") || pick(row, "product_label") || "").replace(/[,，\s]/g, "");
      if (/100万円以下|100万円まで|百万円以下|百万円まで/.test(band)) return 0;
      if (/以下|まで|未満/.test(band)) return 1;
      if (/GENERAL_OR_UNSPECIFIED|一般|指定なし/.test(band)) return 2;
      return 3;
    };
    return [...latest.values()].map((item) => item.rows.slice().sort((a, b) =>
      smallBalanceScore(a) - smallBalanceScore(b) || (rate(b) ?? -Infinity) - (rate(a) ?? -Infinity)
    )[0]).filter(Boolean);
  }

  function campaignOrdinaryRows() {
    try {
      return (state.records || []).filter((record) =>
        ["普通預金", "普通貯金"].includes(String(record.product_type || "").trim())
        && record.status === "開催中"
        && Number.isFinite(record._comparableRate)
      );
    } catch (_) {
      return [];
    }
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
      const validRates = group.map(rate).filter(Number.isFinite);
      if (!validRates.length) continue;

      // Existing heatmap methodology:
      // first average within each institution, then weight institutions equally
      // when calculating prefectural averages.
      const institutionAverage = avg(validRates);
      const dates = group.map(sourceDate).filter(Boolean).sort();

      out.push({
        institution: inst(group[0]),
        institution_type: instType(group[0]),
        prefecture: pref(group[0]),
        averageRate: institutionAverage,
        maximumRate: Math.max(...validRates),
        minimumRate: Math.min(...validRates),
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
    let ordinarySource = "";
    let rows;
    if (mode === "base_ordinary") {
      rows = currentOrdinaryRows();
      if (rows.length) {
        ordinarySource = "r1";
      } else if (!R1.historyReady || R1.historyError) {
        // Never flash the campaign fallback while the large history file is
        // still loading (or when its load failed). It produces a misleading
        // one-prefecture / 0.9% map before the real nationwide data arrives.
        ordinarySource = R1.historyError ? "history_error" : "history_loading";
        rows = [];
      } else {
        ordinarySource = "campaign_all";
        rows = campaignOrdinaryRows();
      }
    } else {
      rows = R1.rows.filter((row) => isYen(row) && isTerm(row) && termMonths(row) === term.months);
    }

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
      .sort((a, b) => scaleRate(b.averageRate) - scaleRate(a.averageRate) || PREFECTURES.indexOf(a.prefecture) - PREFECTURES.indexOf(b.prefecture));
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
      ordinarySource,
      pending: mode === "base_ordinary" ? (!R1.historyReady && !R1.historyError) : !R1.loaded,
      error: mode === "base_ordinary" ? (R1.historyError || R1.error) : R1.error
    };
  }

  function buildCampaignData() {
    const term = currentTerm();
    const types = selectedValues("#heatmapInstitutionTypeFilter");
    const statuses = selectedValues("#heatmapStatusFilter");
    const periodFrom = q("#heatmapCampaignDateFrom")?.value || "";
    const periodTo = q("#heatmapCampaignDateTo")?.value || "";
    const invalidPeriod = Boolean(periodFrom && periodTo && periodTo < periodFrom);
    const typeActive = types.size > 0;
    const statusActive = statuses.size > 0;

    const records = (state.records || []).filter((record) => {
      if (record._analyticsTermKey !== term.key || !Number.isFinite(record._comparableRate)) return false;
      if (!/預金|貯金/.test(record.product_type || "") || /積金/.test(record.product_type || "")) return false;
      if (statusActive && !statuses.has(record.status)) return false;
      if (invalidPeriod || (typeof recordOverlapsPeriod === "function" && !recordOverlapsPeriod(record, periodFrom, periodTo))) return false;
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
      .sort((a, b) => scaleRate(b.averageRate) - scaleRate(a.averageRate) || PREFECTURES.indexOf(a.prefecture) - PREFECTURES.indexOf(b.prefecture));
    const regionalInstitutions = typeof buildInstitutionRateGroups === "function" ? buildInstitutionRateGroups(regionalRecords) : [];
    const onlineInstitutions = typeof buildInstitutionRateGroups === "function" ? buildInstitutionRateGroups(onlineRecords) : [];
    return {
      mode: "campaign",
      label: "キャンペーン預金・貯金",
      rateLabel: "キャンペーン金利",
      term,
      institutionTypes: [...types],
      statuses: [...statuses],
      periodFrom,
      periodTo,
      invalidPeriod,
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


  function updateInstitutionCoverage(data) {
    const grid = q("#heatmapInstitutionCoverageGrid");
    const note = q("#heatmapInstitutionCoverageNote");
    if (!grid || !note) return;
    const regional = data.regionalInstitutions.length;
    const nationwide = data.onlineInstitutions.length;
    const total = regional + nationwide;
    const records = data.regionalRecords.length + data.onlineRecords.length;
    const periodLabel = data.mode === "campaign"
      ? `${data.periodFrom || "開始指定なし"}～${data.periodTo || "終了指定なし"}`
      : data.mode === "base_ordinary" ? "期間指定なし" : data.term.label;
    note.textContent = `${data.label}・${periodLabel}・現在の絞り込み条件を反映`;
    grid.innerHTML = [
      `<div class="heatmap-institution-stat primary"><span class="heatmap-institution-stat-label">対象金融機関 合計</span><strong class="heatmap-institution-stat-value">${total.toLocaleString("ja-JP")}先</strong><span class="heatmap-institution-stat-meta">現在のヒートマップ条件</span></div>`,
      `<div class="heatmap-institution-stat"><span class="heatmap-institution-stat-label">都道府県別の対象</span><strong class="heatmap-institution-stat-value">${regional.toLocaleString("ja-JP")}先</strong><span class="heatmap-institution-stat-meta">地域金融機関</span></div>`,
      `<div class="heatmap-institution-stat"><span class="heatmap-institution-stat-label">全国向けの対象</span><strong class="heatmap-institution-stat-value">${nationwide.toLocaleString("ja-JP")}先</strong><span class="heatmap-institution-stat-meta">ネット銀行等</span></div>`,
      `<div class="heatmap-institution-stat"><span class="heatmap-institution-stat-label">比較可能な明細</span><strong class="heatmap-institution-stat-value">${records.toLocaleString("ja-JP")}件</strong><span class="heatmap-institution-stat-meta">${data.rankedPrefectures.length}都道府県を算出</span></div>`
    ].join("");
  }

  function configureControls(force = false) {
    const product = q("#heatmapProductFilter");
    if (!product) return;
    refreshInstitutionTypeOptions();
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
    const campaignPeriodField = q("#heatmapCampaignPeriod");
    const statusLabel = q("#heatmapStatusFilter")?.closest("label");
    const mode = currentMode();
    if (termField) termField.hidden = mode === "base_ordinary";
    if (campaignPeriodField) campaignPeriodField.hidden = mode !== "campaign";
    if (statusLabel) statusLabel.hidden = mode !== "campaign";

    const heading = q("#prefectureHeatmapPanel h2");
    if (heading) heading.textContent = "都道府県別 金利ヒートマップ";
    const tabDesc = q("#heatmapTab .workspace-tab-description");
    if (tabDesc) tabDesc.textContent = "店頭表示金利・普通預金・キャンペーン金利を商品区分別に比較";
    const help = q(".heatmap-help");
    if (help) {
      help.textContent = mode === "campaign"
        ? "指定した集計対象期間と1日以上重なるキャンペーン預金・貯金の比較可能金利を集計します。開始日が確認できない明細は期間集計から除外します。店頭表示金利は含みません。"
        : mode === "base_ordinary"
          ? "R1の比較可能な普通預金金利を優先し、利用可能なR1データがない場合は全国JSONの開催中普通預金・普通貯金を表示します。普通預金には預入年限がないため期間切替は使用しません。"
          : "R1通常金利データの定期預金・定期貯金の店頭表示金利を表示します。キャンペーン金利は含みません。";
    }
  }

  function hideSeparateR1Heatmap() {
    // Keep the R1 data source, remove only the standalone visual section.
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
    updateInstitutionCoverage(data);

    const values = data.rankedPrefectures.map((x) => scaleRate(x.averageRate));
    const min = values.length ? Math.min(...values) : null;
    const max = values.length ? Math.max(...values) : null;
    const highest = data.rankedPrefectures[0] || null;
    const lowest = data.rankedPrefectures.length ? data.rankedPrefectures[data.rankedPrefectures.length - 1] : null;
    const allPrefecturesTied = Number.isFinite(min) && min === max;
    const termPrefix = data.mode === "base_ordinary" ? "" : `${data.term.label} `;

    const title = q("#heatmapMapTitle");
    if (title) title.textContent = `${termPrefix}${data.rateLabel}・都道府県平均`;
    const summary = q("#heatmapSummary");
    if (summary) {
      if (data.invalidPeriod) summary.textContent = "期間指定を確認してください（終了日は開始日以後）";
      else if (data.pending) summary.textContent = "R1通常金利データを読み込み中…";
      else if (data.error && data.mode !== "campaign") summary.textContent = `R1通常金利データ読込エラー: ${data.error}`;
      else if (data.mode === "base_ordinary" && data.ordinarySource === "campaign_all" && (data.regionalInstitutions.length > 0 || data.onlineInstitutions.length > 0)) {
        summary.textContent = `普通預金 / 全国JSON（開催中） / ${data.rankedPrefectures.length}都道府県 / 地域金融機関 ${data.regionalInstitutions.length}先 / 全国向け ${data.onlineInstitutions.length}先`;
      } else if (data.mode === "base_ordinary" && data.ordinarySource === "r1") {
        summary.textContent = `普通預金 / 通常金利履歴 / ${data.rankedPrefectures.length}都道府県 / 地域金融機関 ${data.regionalInstitutions.length}先 / 全国向け ${data.onlineInstitutions.length}先`;
      } else if (data.mode === "base_ordinary" && R1.historyRows.length > 0 && data.regionalInstitutions.length === 0 && data.onlineInstitutions.length === 0) {
        summary.textContent = `普通預金 / R1履歴 ${R1.historyRows.length}行読込済み / 比較可能な普通預金金利0件（R1普通預金収集を拡充中）`;
      } else if (data.mode !== "campaign" && R1.rows.length > 0 && data.regionalInstitutions.length === 0 && data.onlineInstitutions.length === 0) {
        summary.textContent = `${data.label}${data.mode === "base_ordinary" ? "" : ` / ${data.term.label}`} / R1 ${R1.rows.length}行読込済み / 対象金利0件`;
      } else summary.textContent = `${data.label}${data.mode === "base_ordinary" ? "" : ` / ${data.term.label}`}${data.mode === "campaign" ? ` / ${data.periodFrom || "開始指定なし"}～${data.periodTo || "終了指定なし"}` : ""} / ${data.rankedPrefectures.length}都道府県 / 地域金融機関 ${data.regionalInstitutions.length}先 / 全国向け ${data.onlineInstitutions.length}先`;
    }

    const cards = q("#heatmapSummaryCards");
    if (cards && typeof summaryCardHtml === "function") {
      cards.innerHTML = [
        summaryCardHtml("地域金融機関・全国平均", formatRate(data.nationalAverage), `${data.regionalInstitutions.length}金融機関を均等平均`, "national"),
        summaryCardHtml("最高の都道府県", highest ? formatRate(highest.averageRate) : "—", allPrefecturesTied ? `${data.rankedPrefectures.length}都道府県が同率` : highest ? `${highest.prefecture}・${highest.institutionCount}金融機関` : "比較可能データなし", "highest"),
        summaryCardHtml("最低の都道府県", lowest ? formatRate(lowest.averageRate) : "—", allPrefecturesTied ? `${data.rankedPrefectures.length}都道府県が同率` : lowest ? `${lowest.prefecture}・${lowest.institutionCount}金融機関` : "比較可能データなし", "lowest"),
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
      let previousRate = null;
      let displayedRank = 0;
      const rankedWithTies = data.rankedPrefectures.map((item, index) => {
        const comparableRate = scaleRate(item.averageRate);
        if (index === 0 || comparableRate !== previousRate) displayedRank = index + 1;
        previousRate = comparableRate;
        return { item, rank: displayedRank };
      });
      ranking.innerHTML = rankedWithTies.length
        ? rankedWithTies.map(({ item, rank }) => `<button class="heatmap-ranking-row ${item.prefecture === state.heatmapSelectedPrefecture ? "is-selected" : ""}" data-prefecture="${item.prefecture}" type="button"><span class="heatmap-rank-number">${rank}</span><span class="heatmap-rank-name">${item.prefecture}</span><strong>${formatRate(item.averageRate)}</strong><small>${item.institutionCount}金融機関</small></button>`).join("")
        : `<div class="heatmap-empty">${data.pending ? "通常金利データを読み込み中です。" : data.mode === "base_ordinary" ? "比較可能な開催中の普通預金金利がありません。" : "比較可能な都道府県データがありません。"}</div>`;
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
    const periodFrom = q("#heatmapCampaignDateFrom");
    const periodTo = q("#heatmapCampaignDateTo");
    if (periodFrom) periodFrom.value = "";
    if (periodTo) periodTo.value = "";
    configureControls();
    if (render && typeof state !== "undefined" && state.activeView === "heatmap") renderUnifiedSafe();
    else if (typeof state !== "undefined") state.heatmapRendered = false;
  }

  // Replace existing app.js heatmap function bindings.
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
    ["#heatmapInstitutionTypeFilter", "#heatmapStatusFilter", "#heatmapCampaignDateFrom", "#heatmapCampaignDateTo"].forEach((selector) => {
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

  function extractR1Rows(json) {
    if (Array.isArray(json)) return json;
    if (!json || typeof json !== "object") return [];

    const preferredKeys = [
      "rows", "records", "data", "items", "ranking", "rankings",
      "current", "current_default_ranking", "results"
    ];
    for (const key of preferredKeys) {
      if (Array.isArray(json[key])) return json[key];
    }

    // Defensive fallback: choose the largest top-level array of objects.
    const candidates = Object.values(json)
      .filter((value) => Array.isArray(value) && value.some((x) => x && typeof x === "object"))
      .sort((a, b) => b.length - a.length);
    return candidates[0] || [];
  }

  function logR1Diagnostics() {
    if (!R1.loaded) return;
    const yen = R1.rows.filter(isYen);
    const term = yen.filter(isTerm);
    const historyYen = R1.historyRows.filter(isYen);
    const historyOrdinary = historyYen.filter(isOrdinary);
    const currentOrdinary = currentOrdinaryRows();
    const withRate = R1.rows.filter((row) => rate(row) !== null);
    console.info("[UnifiedHeatmap v4.4] R1 diagnostics", {
      rawRows: R1.rows.length,
      historyRows: R1.historyRows.length,
      rowsWithNormalizedType: R1.rows.filter((row) => String(pick(row, "institution_type_normalized")).trim()).length,
      rowsWithResolvedType: R1.rows.filter((row) => instType(row)).length,
      selectedInstitutionTypes: [...selectedValues("#heatmapInstitutionTypeFilter")],
      yenRows: yen.length,
      termRows: term.length,
      historyOrdinaryRows: historyOrdinary.length,
      currentOrdinaryRows: currentOrdinary.length,
      currentOrdinaryInstitutions: new Set(currentOrdinary.map(inst).filter(Boolean)).size,
      rateRows: withRate.length,
      oneYearTermRows: term.filter((row) => termMonths(row) === 12).length,
      threeYearTermRows: term.filter((row) => termMonths(row) === 36).length,
      fiveYearTermRows: term.filter((row) => termMonths(row) === 60).length
    });
  }

  async function init() {
    installOverrides();
    configureControls();
    bindViewHooks();
    watchForAppInitialization();
    hideSeparateR1Heatmap();
    bindControls();

    const observer = new MutationObserver(() => hideSeparateR1Heatmap());
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    window.setTimeout(() => observer.disconnect(), 5000);

    try {
      const response = await fetch(R1_CURRENT_URL, { cache: "no-store" });
      if (!response.ok) throw new Error(`current_default_ranking.json: HTTP ${response.status}`);
      const json = await response.json();
      R1.rows = extractR1Rows(json);
      R1.error = R1.rows.length ? "" : "current_default_ranking.json に読み取り可能な明細配列がありません。";
    } catch (error) {
      R1.error = String(error?.message || error);
    }

    try {
      const response = await fetch(R1_HISTORY_URL, { cache: "no-store" });
      if (!response.ok) throw new Error(`base_rate_history.json: HTTP ${response.status}`);
      const json = await response.json();
      R1.historyRows = extractR1Rows(json);
      R1.historyReady = true;
      R1.historyError = R1.historyRows.length ? "" : "base_rate_history.json に読み取り可能な明細配列がありません。";
    } catch (error) {
      R1.historyReady = false;
      R1.historyError = String(error?.message || error);
    }

    R1.loaded = true;
    logR1Diagnostics();

    installOverrides();
    configureControls(appUiReady());
    hideSeparateR1Heatmap();
    bindControls();
    if (typeof state !== "undefined" && state.activeView === "heatmap") renderUnifiedSafe();

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
