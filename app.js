"use strict";

const DATA_URL = "campaign_all.json";
const TODAY_ISO = localIso(new Date());
const DATE_ISSUE_PAGE_SIZE = 50;
const ANALYTICS_TERMS = [
  { key: "6m", label: "6か月", months: 6 },
  { key: "1y", label: "1年", months: 12 },
  { key: "3y", label: "3年", months: 36 },
  { key: "5y", label: "5年", months: 60 }
];

const state = {
  metadata: {},
  records: [],
  filtered: [],
  sortKey: "campaign_start_date",
  sortDir: "desc",
  tablePage: 1,
  tablePageSize: 50,
  ganttPage: 1,
  ganttPageSize: 20,
  dateIssuePage: 1,
  focusKey: null,
  debounceTimer: null,
  quickDateRange: null,
  quickDateLabel: "",
  analyticsTimer: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const text = (value) => value == null ? "" : String(value);
const esc = (value) => text(value).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt = (n) => new Intl.NumberFormat("ja-JP").format(n || 0);
function localIso(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
const parseIso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(text(s)) ? new Date(`${s}T00:00:00`) : null;
function shiftIsoMonths(iso, months) {
  const source = parseIso(iso);
  if (!source) return "";
  const day = source.getDate();
  source.setDate(1);
  source.setMonth(source.getMonth() + months);
  const lastDay = new Date(source.getFullYear(), source.getMonth() + 1, 0).getDate();
  source.setDate(Math.min(day, lastDay));
  return localIso(source);
}
const dayMs = 86400000;
const campaignKey = (r) => `${text(r.institution_name)}\u241f${text(r.campaign_name)}`;
const groupKey = (r) => [r.institution_name, r.campaign_name, r.campaign_start_date, r.campaign_end_date, r.product_type, r.status].map(text).join("\u241f");
const statusClass = (status) => ({"開催中":"status-active","開催予定":"status-scheduled","終了済み":"status-ended","要確認":"status-review"}[status] || "status-review");

const toIso = (date) => date instanceof Date && !Number.isNaN(date.getTime())
  ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
  : "";

function addMonthsClamped(date, months) {
  const source = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const targetMonth = source.getMonth() + months;
  const targetYear = source.getFullYear() + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(targetYear, normalizedMonth + 1, 0).getDate();
  return new Date(targetYear, normalizedMonth, Math.min(source.getDate(), lastDay));
}
function addDuration(date, duration) {
  let result = addMonthsClamped(date, duration.months || 0);
  if (duration.days) result = new Date(result.getFullYear(), result.getMonth(), result.getDate() + duration.days);
  return result;
}
function durationFromToken(token, fallbackUnit = "") {
  const cleaned = text(token).replace(/(以上|以内|未満|以下)$/g, "");
  const match = cleaned.match(/^(\d+)(年|か月|日間?|週間?|週)?$/);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2] || fallbackUnit;
  if (!unit || !Number.isFinite(amount)) return null;
  if (unit === "年") return { months: amount * 12, days: 0, label: `${amount}年` };
  if (unit === "か月") return { months: amount, days: 0, label: `${amount}か月` };
  if (unit.startsWith("週")) return { months: 0, days: amount * 7, label: `${amount}週間` };
  if (unit.startsWith("日")) return { months: 0, days: amount, label: `${amount}日` };
  return null;
}
function parseTermDurations(term) {
  const raw = text(term).trim();
  if (!raw) return null;
  const value = raw
    .replace(/[ヶヵカ]月/g, "か月")
    .replace(/[～〜]/g, "~")
    .replace(/[－–—]/g, "-")
    .replace(/\s+/g, "");

  let match = value.match(/^(\d+)年(?:積金|\d+回)?$/);
  if (match) return { kind: "exact", durations: [{ months: Number(match[1]) * 12, days: 0, label: `${match[1]}年` }], note: "年限表記から推定" };
  match = value.match(/^(\d+)か月$/);
  if (match) return { kind: "exact", durations: [{ months: Number(match[1]), days: 0, label: `${match[1]}か月` }], note: "年限表記から推定" };
  match = value.match(/^(\d+)(?:日|日間)$/);
  if (match) return { kind: "exact", durations: [{ months: 0, days: Number(match[1]), label: `${match[1]}日` }], note: "期間表記から推定" };
  match = value.match(/^(\d+)(?:週間|週)$/);
  if (match) return { kind: "exact", durations: [{ months: 0, days: Number(match[1]) * 7, label: `${match[1]}週間` }], note: "期間表記から推定" };

  const listParts = value.split(/[、,・]/);
  if (listParts.length > 1) {
    const commonUnit = (value.match(/(年|か月|日間?|週間?|週)/) || [])[1] || "";
    const parsedList = listParts.map((part) => durationFromToken(part, commonUnit));
    if (parsedList.every(Boolean)) return { kind: "list", durations: parsedList, note: "複数年限表記から推定" };
  }

  match = value.match(/^(\d+)(年|か月)以上(\d+)(年|か月)以内$/);
  if (match) {
    const min = durationFromToken(`${match[1]}${match[2]}`);
    const max = durationFromToken(`${match[3]}${match[4]}`);
    return min && max ? { kind: "range", min, max, note: "年限範囲から推定" } : null;
  }

  const separator = value.includes("~") ? "~" : value.includes("-") ? "-" : "";
  if (separator) {
    const parts = value.split(separator);
    if (parts.length === 2) {
      const leftUnit = (parts[0].match(/(年|か月|日間?|週間?|週)/) || [])[1] || "";
      const rightUnit = (parts[1].match(/(年|か月|日間?|週間?|週)/) || [])[1] || "";
      const min = durationFromToken(parts[0], leftUnit || rightUnit);
      const max = durationFromToken(parts[1], rightUnit || leftUnit);
      if (min && max) return { kind: "range", min, max, note: "年限範囲から推定" };
    }
  }
  return null;
}
function yearRange(start, end) {
  if (!start || !end) return [];
  const first = Math.min(start.getFullYear(), end.getFullYear());
  const last = Math.max(start.getFullYear(), end.getFullYear());
  const years = [];
  for (let year = first; year <= last; year++) years.push(year);
  return years;
}
function estimateMaturity(record) {
  const campaignStart = parseIso(record.campaign_start_date);
  const parsed = parseTermDurations(record.term);
  if (!campaignStart || !parsed) return {
    start: "", end: "", period: "", note: !campaignStart ? "開始日不明のため推定不可" : "年限を機械判定できないため推定不可", years: []
  };
  const parsedEnd = parseIso(record.campaign_end_date);
  const validCampaignEnd = parsedEnd && parsedEnd >= campaignStart ? parsedEnd : campaignStart;
  const extraNotes = [];
  if (!parsedEnd) extraNotes.push("終了日未設定のため開始日基準");
  else if (parsedEnd < campaignStart) extraNotes.push("終了日不整合のため開始日基準");

  let windows = [];
  if (parsed.kind === "range") {
    windows = [{ start: addDuration(campaignStart, parsed.min), end: addDuration(validCampaignEnd, parsed.max) }];
  } else {
    windows = parsed.durations.map((duration) => ({
      start: addDuration(campaignStart, duration),
      end: addDuration(validCampaignEnd, duration)
    }));
  }
  const starts = windows.map((w) => w.start).filter(Boolean);
  const ends = windows.map((w) => w.end).filter(Boolean);
  const earliest = new Date(Math.min(...starts.map(Number)));
  const latest = new Date(Math.max(...ends.map(Number)));
  const years = [...new Set(windows.flatMap((w) => yearRange(w.start, w.end)))].sort((a,b) => a-b);
  const startIso = toIso(earliest);
  const endIso = toIso(latest);
  const period = startIso === endIso ? startIso : `${startIso} ～ ${endIso}`;
  return { start: startIso, end: endIso, period, note: [parsed.note, ...extraNotes].join("／"), years };
}


function classifyAnalyticsTerm(term) {
  const parsed = parseTermDurations(term);
  if (!parsed || parsed.kind !== "exact" || parsed.durations.length !== 1) return "";
  const duration = parsed.durations[0];
  if (duration.days || !duration.months) return "";
  const matched = ANALYTICS_TERMS.find((item) => item.months === duration.months);
  return matched ? matched.key : "";
}
function parseComparableInterestRate(rateText) {
  const original = text(rateText).trim();
  if (!original) return { value: null, reason: "金利記載なし", source: "" };
  const normalized = original
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/．/g, ".")
    .replace(/，/g, ",")
    .replace(/％/g, "%")
    .replace(/＋/g, "+")
    .replace(/×/g, "x")
    .replace(/＝/g, "=");
  const formulaLike = /店頭金利|上乗せ|加算|プラス|\+|\bx\s*\d|倍/.test(normalized);
  const percentRegex = /([0-9]+(?:\.[0-9]+)?)\s*%/g;
  if (formulaLike) {
    const equalIndex = normalized.lastIndexOf("=");
    if (equalIndex >= 0) {
      const resolved = normalized.slice(equalIndex + 1);
      const matches = [...resolved.matchAll(percentRegex)];
      if (matches.length) {
        const value = Number(matches[matches.length - 1][1]);
        if (Number.isFinite(value)) return { value, reason: "", source: `${value}%（算式の明示結果）` };
      }
    }
    return { value: null, reason: "店頭金利への上乗せ・倍率式で絶対金利不明", source: "" };
  }
  const first = percentRegex.exec(normalized);
  if (!first) return { value: null, reason: "年率％を数値化できない", source: "" };
  const value = Number(first[1]);
  if (!Number.isFinite(value)) return { value: null, reason: "金利数値が不正", source: "" };
  return { value, reason: "", source: `${value}%` };
}
function recordOverlapsPeriod(record, fromIso, toIso) {
  const start = parseIso(record.campaign_start_date);
  if (!start) return false;
  const rawEnd = parseIso(record.campaign_end_date);
  if (rawEnd && rawEnd < start) return false;
  const from = parseIso(fromIso);
  const to = parseIso(toIso);
  if (from && to && to < from) return false;
  if (to && start > to) return false;
  if (from && rawEnd && rawEnd < from) return false;
  return true;
}
function formatRate(value) {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}％`;
}
function analyticsDefaultDates() {
  const year = Number(TODAY_ISO.slice(0, 4));
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}
function resetAnalyticsControls(render = true) {
  const defaults = analyticsDefaultDates();
  $("#analyticsDateFrom").value = defaults.from;
  $("#analyticsDateTo").value = defaults.to;
  setSelectedValues("#analyticsRegionFilter", []);
  const products = uniqueSorted("product_type");
  setSelectedValues("#analyticsProductFilter", products.includes("定期預金") ? ["定期預金"] : products.slice(0, 1));
  if (render) renderRateAnalytics();
}
function scheduleAnalytics() {
  window.clearTimeout(state.analyticsTimer);
  state.analyticsTimer = window.setTimeout(renderRateAnalytics, 160);
}
function buildProductAnalytics(productType, records) {
  const byTerm = new Map(ANALYTICS_TERMS.map((term) => [term.key, new Map()]));
  records.forEach((record) => {
    if (record.product_type !== productType || !record._analyticsTermKey || !Number.isFinite(record._comparableRate)) return;
    const institutionMap = byTerm.get(record._analyticsTermKey);
    const existing = institutionMap.get(record.institution_name);
    const candidate = {
      rate: record._comparableRate,
      record,
      sourceCount: existing ? existing.sourceCount + 1 : 1
    };
    if (!existing || candidate.rate > existing.rate || (candidate.rate === existing.rate && record.campaign_start_date > existing.record.campaign_start_date)) {
      candidate.sourceCount = existing ? existing.sourceCount + 1 : 1;
      institutionMap.set(record.institution_name, candidate);
    } else {
      existing.sourceCount += 1;
    }
  });

  const stats = {};
  const topRanks = {};
  const union = new Map();
  ANALYTICS_TERMS.forEach((term) => {
    const entries = [...byTerm.get(term.key).entries()].map(([institution, data]) => ({ institution, ...data }));
    entries.sort((a, b) => b.rate - a.rate || a.institution.localeCompare(b.institution, "ja"));
    stats[term.key] = {
      count: entries.length,
      average: entries.length ? entries.reduce((sum, item) => sum + item.rate, 0) / entries.length : null
    };
    topRanks[term.key] = new Map(entries.slice(0, 5).map((item, index) => [item.institution, index + 1]));
    entries.slice(0, 5).forEach((item, index) => {
      if (!union.has(item.institution)) union.set(item.institution, { bestRank: index + 1, maxRate: item.rate });
      else {
        const current = union.get(item.institution);
        current.bestRank = Math.min(current.bestRank, index + 1);
        current.maxRate = Math.max(current.maxRate, item.rate);
      }
    });
  });
  const institutions = [...union.entries()]
    .sort((a, b) => a[1].bestRank - b[1].bestRank || b[1].maxRate - a[1].maxRate || a[0].localeCompare(b[0], "ja"))
    .map(([institution]) => institution);
  return { productType, byTerm, stats, topRanks, institutions };
}
function analyticsCellHtml(analytics, institution, term) {
  const entry = analytics.byTerm.get(term.key).get(institution);
  if (!entry) return '<td class="matrix-empty">—</td>';
  const rank = analytics.topRanks[term.key].get(institution);
  const r = entry.record;
  const title = `${r.campaign_name} / ${r.campaign_start_date || "開始日不明"}～${r.campaign_end_date || "終了日未設定"} / ${r.interest_rate}${r.rate_condition ? ` / ${r.rate_condition}` : ""}`;
  return `<td class="matrix-rate-cell ${rank ? `top-rank rank-${rank}` : ""}" title="${esc(title)}"><span class="matrix-rate">${esc(formatRate(entry.rate))}</span>${rank ? `<span class="rank-badge">${rank}位</span>` : ""}</td>`;
}
function productAnalyticsHtml(analytics) {
  const averageCards = ANALYTICS_TERMS.map((term) => {
    const stat = analytics.stats[term.key];
    return `<article class="average-card"><div class="average-term">${esc(term.label)}</div><div class="average-rate">${esc(formatRate(stat.average))}</div><div class="average-count">${fmt(stat.count)}金融機関の平均</div></article>`;
  }).join("");
  const body = analytics.institutions.length
    ? analytics.institutions.map((institution) => `<tr><th scope="row">${esc(institution)}</th>${ANALYTICS_TERMS.map((term) => analyticsCellHtml(analytics, institution, term)).join("")}</tr>`).join("")
    : `<tr><td colspan="5" class="table-empty">上位5を作成できる比較可能データがありません。</td></tr>`;
  return `<section class="product-analytics">
    <div class="product-analytics-heading"><h3>${esc(analytics.productType)}</h3><span class="muted">各列の上位5を表示</span></div>
    <div class="average-grid">${averageCards}</div>
    <div class="matrix-scroll"><table class="ranking-matrix"><thead><tr><th>金融機関</th>${ANALYTICS_TERMS.map((term) => `<th>${esc(term.label)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>
  </section>`;
}
function renderRateAnalytics() {
  const from = $("#analyticsDateFrom").value;
  const to = $("#analyticsDateTo").value;
  if (from && to && to < from) {
    $("#analyticsSummary").textContent = "期間指定を確認してください";
    $("#analyticsResults").innerHTML = '<div class="analytics-empty">対象期間の終了日は開始日以後にしてください。</div>';
    return;
  }
  const selectedRegions = new Set(selectedValues("#analyticsRegionFilter"));
  const selectedProducts = selectedValues("#analyticsProductFilter");
  const productTypes = selectedProducts.length ? selectedProducts : uniqueSorted("product_type");
  const periodRecords = state.records.filter((record) => {
    if (selectedRegions.size && !selectedRegions.has(record.region)) return false;
    if (!productTypes.includes(record.product_type)) return false;
    return recordOverlapsPeriod(record, from, to);
  });
  const comparable = periodRecords.filter((record) => record._analyticsTermKey && Number.isFinite(record._comparableRate));
  const noTerm = periodRecords.filter((record) => !record._analyticsTermKey).length;
  const noRate = periodRecords.filter((record) => record._analyticsTermKey && !Number.isFinite(record._comparableRate)).length;
  const institutionCount = new Set(comparable.map((record) => record.institution_name).filter(Boolean)).size;
  const regionLabel = selectedRegions.size ? [...selectedRegions].join("・") : "全国";
  const periodLabel = `${from || "期間指定なし"} ～ ${to || "期間指定なし"}`;
  $("#analyticsSummary").textContent = `${regionLabel} / ${periodLabel} / 比較可能 ${fmt(comparable.length)}明細`;
  const sections = productTypes.map((productType) => buildProductAnalytics(productType, periodRecords)).map(productAnalyticsHtml).join("");
  $("#analyticsResults").innerHTML = `<div class="analytics-data-summary"><strong>${fmt(institutionCount)}金融機関・${fmt(comparable.length)}比較可能明細</strong><span>対象明細 ${fmt(periodRecords.length)}件</span><span>対象外年限 ${fmt(noTerm)}件</span><span>絶対金利を算出不可 ${fmt(noRate)}件</span></div>${sections || '<div class="analytics-empty">条件に一致するデータがありません。</div>'}`;
}

function selectedValues(id) {
  return Array.from($(id).selectedOptions).map((o) => o.value);
}
function setSelectedValues(id, values) {
  const wanted = new Set(values);
  Array.from($(id).options).forEach((o) => { o.selected = wanted.has(o.value); });
}
function uniqueSorted(field) {
  return [...new Set(state.records.map((r) => text(r[field]).trim()).filter(Boolean))].sort((a,b) => a.localeCompare(b, "ja"));
}
function fillSelect(id, values) {
  $(id).innerHTML = values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
}
function normalizeRecord(record, index) {
  const fields = ["region","prefecture","institution_name","institution_type","product_type","campaign_name","campaign_start_date","term","interest_rate","rate_condition","eligibility_conditions","deposit_amount","product_url","status","review_notes"];
  const normalized = { _index: index };
  fields.forEach((f) => { normalized[f] = text(record[f]); });
  normalized.campaign_end_date = record.campaign_end_date == null ? "" : text(record.campaign_end_date);
  normalized._searchInstitution = normalized.institution_name.toLocaleLowerCase("ja");
  normalized._searchCampaign = normalized.campaign_name.toLocaleLowerCase("ja");
  normalized._searchTerm = normalized.term.toLocaleLowerCase("ja");
  normalized._searchRate = `${normalized.interest_rate} ${normalized.rate_condition}`.toLocaleLowerCase("ja");
  normalized._analyticsTermKey = classifyAnalyticsTerm(normalized.term);
  const comparableRate = parseComparableInterestRate(normalized.interest_rate);
  normalized._comparableRate = comparableRate.value;
  normalized._rateExclusionReason = comparableRate.reason;
  normalized._rateSource = comparableRate.source;
  const maturity = estimateMaturity(normalized);
  normalized.estimated_maturity_start_date = maturity.start;
  normalized.estimated_maturity_end_date = maturity.end;
  normalized.estimated_maturity_period = maturity.period;
  normalized.maturity_estimation_note = maturity.note;
  normalized._maturityYears = maturity.years;
  normalized._maturitySort = maturity.start;
  normalized._groupKey = groupKey(normalized);
  normalized._campaignKey = campaignKey(normalized);
  return normalized;
}

async function loadData() {
  try {
    const response = await fetch(DATA_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    let payload;
    try { payload = await response.json(); }
    catch (error) { throw new Error(`JSONの解析に失敗しました: ${error.message}`); }
    if (!payload || !Array.isArray(payload.records)) throw new Error("JSONに records 配列がありません。");

    state.metadata = payload.metadata || {};
    state.records = payload.records.map(normalizeRecord);
    initializeUi();

    const metadataCount = Number(state.metadata.record_count);
    if (Number.isFinite(metadataCount) && metadataCount !== state.records.length) {
      showWarning(`metadata.record_count（${fmt(metadataCount)}件）と records の実件数（${fmt(state.records.length)}件）が一致しません。画面は records の実件数を使用します。`);
    }
    $("#loadStatus").textContent = "データ読込完了";
    $("#loadStatus").classList.add("ready");
    $("#app").setAttribute("aria-busy", "false");
  } catch (error) {
    showFatalError(`campaign_all.jsonを読み込めませんでした。起動ファイルからローカルHTTPサーバーを開始し、campaign_all.jsonがindex.htmlと同じフォルダーにあることを確認してください。\n\n詳細: ${error.message}`);
  }
}

function initializeUi() {
  const created = state.metadata.created_at;
  $("#updatedAt").textContent = created ? `データ更新日時: ${created}` : "データ更新日時: 不明";
  fillSelect("#regionFilter", uniqueSorted("region"));
  fillSelect("#prefectureFilter", uniqueSorted("prefecture"));
  fillSelect("#institutionTypeFilter", uniqueSorted("institution_type"));
  fillSelect("#productTypeFilter", uniqueSorted("product_type"));
  fillSelect("#statusFilter", ["開催中","開催予定","終了済み","要確認"].filter((s) => state.records.some((r) => r.status === s)));
  setSelectedValues("#statusFilter", ["開催中","開催予定"]);
  const maturityYears = [...new Set(state.records.flatMap((r) => r._maturityYears))].sort((a,b) => b-a);
  $("#maturityYearFilter").innerHTML = `<option value="">指定なし</option>${maturityYears.map((year) => `<option value="${year}">${year}年</option>`).join("")}`;
  const maturityEstimable = state.records.filter((r) => r._maturityYears.length).length;
  $("#maturityCoverage").textContent = `推定可能 ${fmt(maturityEstimable)}件 / ${fmt(state.records.length)}件。年を指定すると開催状況を全件に切り替えます。`;
  fillSelect("#analyticsRegionFilter", uniqueSorted("region"));
  fillSelect("#analyticsProductFilter", uniqueSorted("product_type"));
  resetAnalyticsControls(false);

  const notes = Array.isArray(state.metadata.notes) ? state.metadata.notes : [];
  $("#metadataNotes").innerHTML = notes.length ? notes.map((n) => `<li>${esc(n)}</li>`).join("") : "<li>metadata.notes はありません。</li>";
  bindEvents();
  applyFilters();
}

function bindEvents() {
  ["#regionFilter","#prefectureFilter","#institutionTypeFilter","#productTypeFilter","#statusFilter","#reviewFilter"].forEach((id) => {
    $(id).addEventListener("change", scheduleFilter);
  });
  ["#startFrom","#startTo","#endFrom","#endTo"].forEach((id) => {
    $(id).addEventListener("change", () => {
      deactivateQuickDatePreset();
      scheduleFilter();
    });
  });
  $("#maturityYearFilter").addEventListener("change", () => {
    if ($("#maturityYearFilter").value) setSelectedValues("#statusFilter", []);
    scheduleFilter();
  });
  ["#institutionSearch","#campaignSearch","#termSearch","#rateSearch"].forEach((id) => {
    $(id).addEventListener("input", scheduleFilter);
  });
  $("#clearFilters").addEventListener("click", clearFilters);
  $("#activeOnly").addEventListener("click", () => quickStatus(["開催中"]));
  $("#activeScheduled").addEventListener("click", () => quickStatus(["開催中","開催予定"]));
  $("#reviewOnly").addEventListener("click", () => { clearFilters(false); $("#reviewFilter").value = "yes"; applyFilters(); });
  $$(".date-preset").forEach((button) => {
    button.addEventListener("click", () => setQuickDateRange(Number(button.dataset.months), button.dataset.label || button.textContent.trim(), button));
  });
  $("#clearDatePreset").addEventListener("click", clearDatePreset);
  $("#ganttPageSize").addEventListener("change", (e) => { state.ganttPageSize = Number(e.target.value); state.ganttPage = 1; renderGantt(); });
  $("#tablePageSize").addEventListener("change", (e) => { state.tablePageSize = Number(e.target.value); state.tablePage = 1; renderTable(); });
  $("#ganttPrev").addEventListener("click", () => { state.ganttPage--; renderGantt(); });
  $("#ganttNext").addEventListener("click", () => { state.ganttPage++; renderGantt(); });
  $("#tablePrev").addEventListener("click", () => { state.tablePage--; renderTable(); });
  $("#tableNext").addEventListener("click", () => { state.tablePage++; renderTable(); });
  $("#dateIssuePrev").addEventListener("click", () => { state.dateIssuePage--; renderDateIssues(); });
  $("#dateIssueNext").addEventListener("click", () => { state.dateIssuePage++; renderDateIssues(); });
  $("#csvDownload").addEventListener("click", downloadCsv);
  $("#clearFocus").addEventListener("click", clearFocus);
  ["#analyticsDateFrom","#analyticsDateTo","#analyticsRegionFilter","#analyticsProductFilter"].forEach((id) => $(id).addEventListener("change", scheduleAnalytics));
  $("#generateAnalytics").addEventListener("click", renderRateAnalytics);
  $("#resetAnalytics").addEventListener("click", () => resetAnalyticsControls(true));
  $$("#detailTable th[data-sort]").forEach((th) => th.addEventListener("click", () => changeSort(th.dataset.sort)));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hideTooltip(); });
}

function scheduleFilter() {
  window.clearTimeout(state.debounceTimer);
  state.debounceTimer = window.setTimeout(applyFilters, 140);
}
function quickStatus(statuses) {
  clearFilters(false);
  setSelectedValues("#statusFilter", statuses);
  applyFilters();
}
function deactivateQuickDatePreset() {
  state.quickDateRange = null;
  state.quickDateLabel = "";
  $$(".date-preset").forEach((button) => {
    button.classList.remove("is-active");
    button.setAttribute("aria-pressed", "false");
  });
  const status = $("#quickPeriodStatus");
  if (status) status.textContent = "期間ボタンを押すと、開始日と終了日の条件を自動設定します。";
}
function setQuickDateRange(months, label, activeButton) {
  if (!Number.isFinite(months) || months <= 0) return;
  const from = shiftIsoMonths(TODAY_ISO, -months);
  const to = TODAY_ISO;
  state.quickDateRange = { from, to };
  state.quickDateLabel = label;

  // 直感的な期間指定: キャンペーン開始日「以上」に期間初日、終了日「以下」に今日を設定。
  $("#startFrom").value = from;
  $("#startTo").value = "";
  $("#endFrom").value = "";
  $("#endTo").value = to;

  $$(".date-preset").forEach((button) => {
    const active = button === activeButton;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  setSelectedValues("#statusFilter", []);
  $("#quickPeriodStatus").textContent = `${label}: 開始日 ${from} 以降／終了日 ${to} 以前（終了日未設定を含む・開催状況は全件）`;
  state.focusKey = null;
  applyFilters();
}
function clearDatePreset() {
  ["#startFrom","#startTo","#endFrom","#endTo"].forEach((id) => { $(id).value = ""; });
  deactivateQuickDatePreset();
  state.focusKey = null;
  applyFilters();
}
function clearFilters(run = true) {
  ["#regionFilter","#prefectureFilter","#institutionTypeFilter","#productTypeFilter","#statusFilter"].forEach((id) => setSelectedValues(id, []));
  ["#institutionSearch","#campaignSearch","#termSearch","#rateSearch","#startFrom","#startTo","#endFrom","#endTo"].forEach((id) => { $(id).value = ""; });
  $("#maturityYearFilter").value = "";
  $("#reviewFilter").value = "all";
  deactivateQuickDatePreset();
  state.focusKey = null;
  if (run) applyFilters();
}

function applyFilters() {
  const f = {
    regions: new Set(selectedValues("#regionFilter")),
    prefectures: new Set(selectedValues("#prefectureFilter")),
    institutionTypes: new Set(selectedValues("#institutionTypeFilter")),
    productTypes: new Set(selectedValues("#productTypeFilter")),
    statuses: new Set(selectedValues("#statusFilter")),
    institution: $("#institutionSearch").value.trim().toLocaleLowerCase("ja"),
    campaign: $("#campaignSearch").value.trim().toLocaleLowerCase("ja"),
    term: $("#termSearch").value.trim().toLocaleLowerCase("ja"),
    rate: $("#rateSearch").value.trim().toLocaleLowerCase("ja"),
    startFrom: $("#startFrom").value,
    startTo: $("#startTo").value,
    endFrom: $("#endFrom").value,
    endTo: $("#endTo").value,
    maturityYear: Number($("#maturityYearFilter").value) || null,
    review: $("#reviewFilter").value
  };

  state.filtered = state.records.filter((r) => {
    if (f.regions.size && !f.regions.has(r.region)) return false;
    if (f.prefectures.size && !f.prefectures.has(r.prefecture)) return false;
    if (f.institutionTypes.size && !f.institutionTypes.has(r.institution_type)) return false;
    if (f.productTypes.size && !f.productTypes.has(r.product_type)) return false;
    if (f.statuses.size && !f.statuses.has(r.status)) return false;
    if (f.institution && !r._searchInstitution.includes(f.institution)) return false;
    if (f.campaign && !r._searchCampaign.includes(f.campaign)) return false;
    if (f.term && !r._searchTerm.includes(f.term)) return false;
    if (f.rate && !r._searchRate.includes(f.rate)) return false;
    if (state.quickDateRange) {
      const { from, to } = state.quickDateRange;
      // 指定期間内に開始し、今日までに終了したキャンペーンを抽出。終了日未設定は継続中として含める。
      if (!r.campaign_start_date || r.campaign_start_date < from || r.campaign_start_date > to) return false;
      if (r.campaign_end_date && r.campaign_end_date > to) return false;
    } else {
      if (f.startFrom && (!r.campaign_start_date || r.campaign_start_date < f.startFrom)) return false;
      if (f.startTo && (!r.campaign_start_date || r.campaign_start_date > f.startTo)) return false;
      if (f.endFrom && (!r.campaign_end_date || r.campaign_end_date < f.endFrom)) return false;
      if (f.endTo && (!r.campaign_end_date || r.campaign_end_date > f.endTo)) return false;
    }
    if (f.maturityYear && !r._maturityYears.includes(f.maturityYear)) return false;
    if (f.review === "yes" && !r.review_notes.trim()) return false;
    if (f.review === "no" && r.review_notes.trim()) return false;
    return true;
  });

  state.tablePage = 1;
  state.ganttPage = 1;
  state.dateIssuePage = 1;
  state.focusKey = null;
  renderAll();
}

function renderAll() {
  renderStats();
  renderRateAnalytics();
  renderGantt();
  renderDateIssues();
  renderTable();
}

function renderStats() {
  const records = state.filtered;
  const institutions = new Set(records.map((r) => r.institution_name).filter(Boolean)).size;
  const campaigns = new Set(records.map((r) => r._campaignKey)).size;
  const counts = {"開催中":0,"開催予定":0,"終了済み":0,"要確認":0};
  records.forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });
  $("#statInstitutions").textContent = fmt(institutions);
  $("#statCampaigns").textContent = fmt(campaigns);
  $("#statRecords").textContent = fmt(records.length);
  $("#statActive").textContent = fmt(counts["開催中"]);
  $("#statScheduled").textContent = fmt(counts["開催予定"]);
  $("#statEnded").textContent = fmt(counts["終了済み"]);
  $("#statReview").textContent = fmt(counts["要確認"]);
  const maturityYear = $("#maturityYearFilter").value;
  const quickRange = state.quickDateRange ? ` / ${state.quickDateLabel} ${state.quickDateRange.from}～${state.quickDateRange.to}` : "";
  $("#filterSummary").textContent = `全${fmt(state.records.length)}件中 ${fmt(records.length)}件を表示${maturityYear ? ` / 想定満期 ${maturityYear}年` : ""}${quickRange}`;
}

function buildGanttGroups() {
  const map = new Map();
  state.filtered.forEach((r) => {
    if (!map.has(r._groupKey)) {
      map.set(r._groupKey, {
        key: r._groupKey,
        institution: r.institution_name,
        prefecture: r.prefecture,
        institutionType: r.institution_type,
        productType: r.product_type,
        campaign: r.campaign_name,
        start: r.campaign_start_date,
        end: r.campaign_end_date,
        status: r.status,
        reviewNotes: new Set(),
        variants: []
      });
    }
    const g = map.get(r._groupKey);
    if (r.review_notes) g.reviewNotes.add(r.review_notes);
    g.variants.push(r);
  });
  return [...map.values()].sort((a,b) => a.institution.localeCompare(b.institution,"ja") || text(b.start).localeCompare(text(a.start)) || a.campaign.localeCompare(b.campaign,"ja"));
}

function dateIssueReason(r) {
  const start = parseIso(r.campaign_start_date);
  const end = parseIso(r.campaign_end_date);
  const reasons = [];
  if (!start) reasons.push("開始日不明");
  if (!end) reasons.push("終了日未設定・不明");
  if (start && end && end < start) reasons.push("終了日が開始日より前");
  if (/日付不整合|日付要確認|開始日.*不明|終了日.*不明|終了日未設定|終了日が開始日|開始日が終了日|期間.*不整合/.test(r.review_notes)) reasons.push("日付関連の要確認事項あり");
  return [...new Set(reasons)].join("／");
}

function renderGantt() {
  const groups = buildGanttGroups();
  const institutionMap = new Map();
  groups.forEach((g) => {
    if (!institutionMap.has(g.institution)) institutionMap.set(g.institution, []);
    institutionMap.get(g.institution).push(g);
  });
  const institutions = [...institutionMap.keys()].sort((a,b) => a.localeCompare(b,"ja"));
  const totalPages = Math.max(1, Math.ceil(institutions.length / state.ganttPageSize));
  state.ganttPage = Math.min(Math.max(1, state.ganttPage), totalPages);
  const startIndex = (state.ganttPage - 1) * state.ganttPageSize;
  const pageInstitutions = institutions.slice(startIndex, startIndex + state.ganttPageSize);
  const pageGroups = pageInstitutions.flatMap((name) => institutionMap.get(name));
  const validStarts = groups.map((g) => parseIso(g.start)).filter(Boolean);
  const validEnds = groups.map((g) => parseIso(g.end)).filter(Boolean);

  $("#ganttPageInfo").textContent = institutions.length ? `${fmt(startIndex + 1)}～${fmt(Math.min(startIndex + state.ganttPageSize, institutions.length))} / ${fmt(institutions.length)}金融機関（${state.ganttPage}/${totalPages}ページ）` : "0金融機関";
  $("#ganttPrev").disabled = state.ganttPage <= 1;
  $("#ganttNext").disabled = state.ganttPage >= totalPages;
  $("#ganttInfo").textContent = `絞り込み結果を、金融機関単位でページ分割して描画しています。現在のページ: ${fmt(pageGroups.length)}本のバー候補。`;

  if (!institutions.length || !validStarts.length) {
    $("#gantt").innerHTML = `<div class="gantt-empty">表示できる日付付きキャンペーンがありません。「日付要確認」を確認してください。</div>`;
    return;
  }

  let minDate = new Date(Math.min(...validStarts.map(Number)));
  let maxDate = validEnds.length ? new Date(Math.max(...validEnds.map(Number))) : new Date();
  const today = parseIso(TODAY_ISO);
  const openEnd = groups.some((g) => parseIso(g.start) && !parseIso(g.end));
  if (openEnd) {
    const extension = new Date(today.getTime() + 90 * dayMs);
    if (extension > maxDate) maxDate = extension;
  }
  if (maxDate <= minDate) maxDate = new Date(minDate.getTime() + 30 * dayMs);
  minDate = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
  maxDate = new Date(maxDate.getFullYear(), maxDate.getMonth() + 1, 1);
  const spanDays = Math.max(1, (maxDate - minDate) / dayMs);
  const months = Math.max(1, Math.round(spanDays / 30.44));
  const tickStep = months <= 24 ? 1 : months <= 72 ? 3 : months <= 180 ? 12 : 24;
  const chartWidth = Math.min(4200, Math.max(1100, months * (months <= 36 ? 54 : months <= 120 ? 24 : 12)));

  const ticks = [];
  let cursor = new Date(minDate);
  while (cursor <= maxDate) {
    const monthOffset = (cursor.getFullYear() - minDate.getFullYear()) * 12 + cursor.getMonth() - minDate.getMonth();
    if (monthOffset % tickStep === 0) {
      const left = ((cursor - minDate) / dayMs) / spanDays * 100;
      const label = tickStep < 12 ? `${cursor.getFullYear()}/${String(cursor.getMonth()+1).padStart(2,"0")}` : `${cursor.getFullYear()}年`;
      ticks.push(`<span class="gantt-tick" style="left:${left.toFixed(4)}%">${label}</span>`);
    }
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }

  const html = [];
  html.push(`<div class="gantt-axis"><div class="gantt-axis-label">金融機関 / キャンペーン</div><div class="gantt-axis-time" style="width:${chartWidth}px">${ticks.join("")}</div></div>`);

  pageInstitutions.forEach((institution) => {
    const instGroups = institutionMap.get(institution);
    const first = instGroups[0];
    html.push(`<section class="institution-group"><div class="institution-title"><div class="institution-name">${esc(institution || "（金融機関名なし）")}</div><div class="institution-meta">${esc(first.prefecture)} / ${esc(first.institutionType)} ・ ${fmt(instGroups.length)}期間</div></div>`);
    instGroups.forEach((g) => {
      const start = parseIso(g.start);
      const end = parseIso(g.end);
      let barHtml = "";
      if (start) {
        const anomaly = end && end < start;
        const effectiveEnd = !end ? maxDate : anomaly ? start : end;
        let left = (start - minDate) / dayMs / spanDays * 100;
        let width = (effectiveEnd - start) / dayMs / spanDays * 100;
        left = Math.max(0, Math.min(100, left));
        width = anomaly ? 0.45 : Math.max(.35, Math.min(100 - left, width));
        const classes = ["gantt-bar", statusClass(g.status)];
        if (!end) classes.push("open-ended");
        if (anomaly) classes.push("date-anomaly");
        barHtml = `<button type="button" class="${classes.join(" ")}" style="left:${left.toFixed(4)}%;width:${width.toFixed(4)}%" data-group-key="${esc(g.key)}" aria-label="${esc(g.institution)} ${esc(g.campaign)}">${anomaly ? "" : esc(g.campaign)}</button>`;
      }
      html.push(`<div class="gantt-row"><div class="gantt-label" title="${esc(g.campaign)}">${esc(g.campaign)} <span class="muted">${esc(g.productType)}</span></div><div class="timeline" style="width:${chartWidth}px">${barHtml}</div></div>`);
    });
    html.push("</section>");
  });
  $("#gantt").innerHTML = html.join("");
  $("#gantt").querySelectorAll(".gantt-bar").forEach((bar) => {
    const group = groups.find((g) => g.key === bar.dataset.groupKey);
    bar.addEventListener("mouseenter", (e) => showTooltip(e, group));
    bar.addEventListener("mousemove", moveTooltip);
    bar.addEventListener("mouseleave", hideTooltip);
    bar.addEventListener("focus", (e) => showTooltip(e, group));
    bar.addEventListener("blur", hideTooltip);
    bar.addEventListener("click", () => focusGroup(group));
  });
}

function summarizeUnique(values, limit = 8) {
  const unique = [...new Set(values.map(text).filter(Boolean))];
  if (unique.length <= limit) return unique.join(" / ");
  return `${unique.slice(0, limit).join(" / ")} ほか${unique.length - limit}件`;
}
function showTooltip(event, group) {
  if (!group) return;
  const rows = group.variants;
  const notes = [...group.reviewNotes].join(" / ");
  const tooltip = $("#tooltip");
  const entries = [
    ["金融機関名", group.institution], ["都道府県", group.prefecture], ["金融機関種別", group.institutionType],
    ["商品区分", group.productType], ["キャンペーン名", group.campaign], ["開始日", group.start || "不明"],
    ["終了日", group.end || "未設定"], ["年限", summarizeUnique(rows.map((r) => r.term))],
    ["想定満期", summarizeUnique(rows.map((r) => r.estimated_maturity_period || "推定不可"))],
    ["金利", summarizeUnique(rows.map((r) => r.interest_rate))], ["金利条件", summarizeUnique(rows.map((r) => r.rate_condition))],
    ["対象者・条件", summarizeUnique(rows.map((r) => r.eligibility_conditions), 4)], ["預入金額", summarizeUnique(rows.map((r) => r.deposit_amount), 4)],
    ["開催状況", group.status], ["要確認事項", notes || "なし"]
  ];
  tooltip.innerHTML = `<strong>${esc(group.campaign)}</strong><div class="tooltip-grid">${entries.map(([k,v]) => `<span class="tooltip-key">${esc(k)}</span><span>${esc(v || "—")}</span>`).join("")}</div>`;
  tooltip.style.display = "block";
  moveTooltip(event);
}
function moveTooltip(event) {
  const tooltip = $("#tooltip");
  if (tooltip.style.display !== "block") return;
  const x = event.clientX ?? 20;
  const y = event.clientY ?? 20;
  const gap = 14;
  const rect = tooltip.getBoundingClientRect();
  tooltip.style.left = `${Math.max(8, Math.min(window.innerWidth - rect.width - 8, x + gap))}px`;
  tooltip.style.top = `${Math.max(8, Math.min(window.innerHeight - rect.height - 8, y + gap))}px`;
}
function hideTooltip() { $("#tooltip").style.display = "none"; }

function focusGroup(group) {
  state.focusKey = group.key;
  state.tablePage = 1;
  $("#focusText").textContent = `ガント選択: ${group.institution} / ${group.campaign}（${group.start || "開始日不明"} ～ ${group.end || "終了日未設定"}）`;
  $("#focusBanner").classList.remove("hidden");
  renderTable();
  $("#tablePanel").scrollIntoView({ behavior: "smooth", block: "start" });
}
function clearFocus() {
  state.focusKey = null;
  state.tablePage = 1;
  $("#focusBanner").classList.add("hidden");
  renderTable();
}

function isDateIssue(r) { return Boolean(dateIssueReason(r)); }
function renderDateIssues() {
  const issues = state.filtered.filter(isDateIssue);
  const totalPages = Math.max(1, Math.ceil(issues.length / DATE_ISSUE_PAGE_SIZE));
  state.dateIssuePage = Math.min(Math.max(1, state.dateIssuePage), totalPages);
  const start = (state.dateIssuePage - 1) * DATE_ISSUE_PAGE_SIZE;
  const page = issues.slice(start, start + DATE_ISSUE_PAGE_SIZE);
  $("#dateIssueCount").textContent = `${fmt(issues.length)}件`;
  $("#dateIssuePageInfo").textContent = issues.length ? `${fmt(start + 1)}～${fmt(Math.min(start + DATE_ISSUE_PAGE_SIZE, issues.length))} / ${fmt(issues.length)}件（${state.dateIssuePage}/${totalPages}ページ）` : "0件";
  $("#dateIssuePrev").disabled = state.dateIssuePage <= 1;
  $("#dateIssueNext").disabled = state.dateIssuePage >= totalPages;
  $("#dateIssueBody").innerHTML = page.length ? page.map((r) => `<tr>
    <td>${esc(r.institution_name)}</td><td>${esc(r.campaign_name)}</td><td>${esc(r.campaign_start_date || "不明")}</td><td>${esc(r.campaign_end_date || "未設定")}</td>
    <td><span class="tag ${statusClass(r.status)}">${esc(r.status || "要確認")}</span></td><td class="review-text">${esc([dateIssueReason(r), r.review_notes].filter(Boolean).join(" / "))}</td>
  </tr>`).join("") : `<tr><td colspan="6" class="table-empty">日付要確認データはありません。</td></tr>`;
}

function sortedRecords(records) {
  const dir = state.sortDir === "asc" ? 1 : -1;
  return [...records].sort((a,b) => {
    const av = text(a[state.sortKey]);
    const bv = text(b[state.sortKey]);
    return (av.localeCompare(bv, "ja", { numeric: true, sensitivity: "base" }) || a._index - b._index) * dir;
  });
}
function changeSort(key) {
  if (state.sortKey === key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
  else { state.sortKey = key; state.sortDir = "asc"; }
  state.tablePage = 1;
  renderTable();
}
function renderTable() {
  const base = state.focusKey ? state.filtered.filter((r) => r._groupKey === state.focusKey) : state.filtered;
  const records = sortedRecords(base);
  const totalPages = Math.max(1, Math.ceil(records.length / state.tablePageSize));
  state.tablePage = Math.min(Math.max(1, state.tablePage), totalPages);
  const start = (state.tablePage - 1) * state.tablePageSize;
  const page = records.slice(start, start + state.tablePageSize);
  $("#tablePageInfo").textContent = records.length ? `${fmt(start + 1)}～${fmt(Math.min(start + state.tablePageSize, records.length))} / ${fmt(records.length)}件（${state.tablePage}/${totalPages}ページ）` : "0件";
  $("#tablePrev").disabled = state.tablePage <= 1;
  $("#tableNext").disabled = state.tablePage >= totalPages;
  if (!state.focusKey) $("#focusBanner").classList.add("hidden");
  $$("#detailTable th[data-sort]").forEach((th) => {
    th.classList.toggle("sort-asc", th.dataset.sort === state.sortKey && state.sortDir === "asc");
    th.classList.toggle("sort-desc", th.dataset.sort === state.sortKey && state.sortDir === "desc");
  });
  $("#detailBody").innerHTML = page.length ? page.map(detailRowHtml).join("") : `<tr><td colspan="17" class="table-empty">条件に一致する明細がありません。</td></tr>`;
}
function detailRowHtml(r) {
  const url = r.product_url ? `<a class="url-link" href="${esc(r.product_url)}" target="_blank" rel="noopener noreferrer">開く ↗</a>` : "—";
  return `<tr>
    <td>${esc(r.region)}</td><td>${esc(r.prefecture)}</td><td>${esc(r.institution_name)}</td><td>${esc(r.institution_type)}</td><td>${esc(r.product_type)}</td>
    <td>${esc(r.campaign_name)}</td><td>${esc(r.campaign_start_date || "不明")}</td><td>${esc(r.campaign_end_date || "未設定")}</td><td>${esc(r.term)}</td>
    <td class="maturity-text ${r.estimated_maturity_period ? "" : "unavailable"}" title="${esc(r.maturity_estimation_note)}">${esc(r.estimated_maturity_period || "推定不可")}</td>
    <td class="rate">${esc(r.interest_rate)}</td><td>${esc(r.rate_condition)}</td><td>${esc(r.eligibility_conditions)}</td><td>${esc(r.deposit_amount)}</td>
    <td><span class="tag ${statusClass(r.status)}">${esc(r.status || "要確認")}</span></td><td class="review-text">${esc(r.review_notes)}</td><td>${url}</td>
  </tr>`;
}

function csvEscape(value) {
  const s = text(value).replace(/\r?\n/g, "\n");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function downloadCsv() {
  const headers = ["地域","都道府県","金融機関名","金融機関種別","商品区分","キャンペーン名","キャンペーン開始日","キャンペーン終了日","預入期間・年限","想定満期開始日","想定満期終了日","満期推定注記","預金金利","金利条件","対象者・条件","預入金額","商品URL","開催中／終了済み","要確認事項"];
  const fields = ["region","prefecture","institution_name","institution_type","product_type","campaign_name","campaign_start_date","campaign_end_date","term","estimated_maturity_start_date","estimated_maturity_end_date","maturity_estimation_note","interest_rate","rate_condition","eligibility_conditions","deposit_amount","product_url","status","review_notes"];
  const lines = [headers.map(csvEscape).join(","), ...state.filtered.map((r) => fields.map((f) => csvEscape(r[f])).join(","))];
  const blob = new Blob(["\ufeff", lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `campaign_filtered_${TODAY_ISO.replaceAll("-", "")}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function showWarning(message) {
  $("#warningPanel").textContent = message;
  $("#warningPanel").classList.remove("hidden");
}
function showFatalError(message) {
  $("#errorPanel").textContent = message;
  $("#errorPanel").classList.remove("hidden");
  $("#loadStatus").textContent = "データ読込エラー";
  $("#loadStatus").classList.add("error");
  $("#app").setAttribute("aria-busy", "false");
  ["#gantt","#detailBody","#dateIssueBody","#analyticsResults"].forEach((id) => { const el = $(id); if (el) el.innerHTML = ""; });
}

document.addEventListener("DOMContentLoaded", loadData);
