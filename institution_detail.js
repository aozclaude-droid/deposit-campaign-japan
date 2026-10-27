"use strict";

const INSTITUTION_TIBOR_URL = "tibor_monthly.json?v=20261028-1";
const institutionDetailState = {
  institution: "",
  tiborMetadata: {},
  tiborRecords: [],
  seriesKey: "",
  tiborTenor: "three_month"
};

const institutionDetailText = (value) => value == null ? "" : String(value);
const institutionDetailDate = (row) => institutionDetailText(row.effective_from || row.source_as_of_date || row.observation_date).slice(0, 10);
const institutionDetailRate = (row) => {
  const value = Number(row.rate_percent);
  return Number.isFinite(value) ? value : null;
};
const institutionDetailMonth = (value) => /^\d{4}-\d{2}/.test(institutionDetailText(value)) ? institutionDetailText(value).slice(0, 7) : "";
const institutionDetailPercent = (value, digits = 3) => Number.isFinite(value) ? `${Number(value.toFixed(digits))}%` : "—";

function institutionDetailUrl(url) {
  return url ? `<a class="url-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">開く ↗</a>` : "—";
}

function institutionDetailBaseRows(name) {
  return state.baseRateHistory.filter((row) => institutionDetailText(row.institution_name).trim() === name);
}

function institutionDetailCampaignRows(name) {
  return state.records.filter((row) => row.institution_name === name);
}

function institutionDetailRowDate(row) {
  return institutionDetailDate(row) || "0000-00-00";
}

function institutionDetailLatest(rows, predicate = () => true) {
  return rows.filter(predicate).slice().sort((a, b) => institutionDetailRowDate(b).localeCompare(institutionDetailRowDate(a)) || Number(b.rate_percent) - Number(a.rate_percent))[0] || null;
}

function institutionDetailFamily(row) {
  return institutionDetailText(row.product_family).toUpperCase();
}

function institutionDetailTermLabel(row) {
  return institutionDetailText(row.term_label || (row.term_months ? `${row.term_months}か月` : ""));
}

function institutionDetailProductCategory(row) {
  const family = institutionDetailFamily(row);
  if (family === "ORDINARY_DEPOSIT") return "普通預金";
  if (family.includes("STANDARD_TERM") || family.includes("TIME_DEPOSIT")) return "定期預金";
  if (family.includes("SAVINGS")) return "貯蓄預金";
  return institutionDetailText(row.product_family || row.product_type || "その他");
}

function institutionDetailAvailableSeries(campaigns, baseRows) {
  const options = [];
  const ordinary = baseRows.filter((row) => institutionDetailFamily(row) === "ORDINARY_DEPOSIT" && institutionDetailRate(row) != null);
  const terms = baseRows.filter((row) => (institutionDetailFamily(row).includes("STANDARD_TERM") || institutionDetailFamily(row).includes("TIME_DEPOSIT")) && institutionDetailRate(row) != null);
  const campaignRates = campaigns.filter((row) => row._comparableRate != null && row.campaign_start_date);
  if (ordinary.length) options.push({ key: "ordinary", label: "普通預金（標準金利）" });
  if (terms.length) options.push({ key: "term", label: "定期預金（各時点の最高金利）" });
  if (campaignRates.length) options.push({ key: "campaign", label: "キャンペーン預金（各時点の最高金利）" });
  return options;
}

function institutionDetailGroupedPoints(rows) {
  const byDate = new Map();
  rows.forEach((point) => {
    if (!point.date || !Number.isFinite(point.rate)) return;
    const current = byDate.get(point.date);
    if (!current || point.rate > current.rate) byDate.set(point.date, point);
  });
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function institutionDetailRatePoints(campaigns, baseRows, seriesKey) {
  if (seriesKey === "campaign") {
    return institutionDetailGroupedPoints(campaigns.filter((row) => row.campaign_start_date && row._comparableRate != null && row._comparableRate >= 0 && row._comparableRate <= 10).map((row) => ({
      date: row.campaign_start_date,
      rate: row._comparableRate,
      label: `${row.campaign_name} / ${row.term || "年限記載なし"}`,
      source: row.product_url
    })));
  }
  const base = baseRows.filter((row) => institutionDetailRate(row) != null && institutionDetailRate(row) >= 0 && institutionDetailRate(row) <= 10 && institutionDetailText(row.record_eligible) !== "0");
  const selected = seriesKey === "ordinary"
    ? base.filter((row) => institutionDetailFamily(row) === "ORDINARY_DEPOSIT" && (institutionDetailText(row.base_rate_role) === "STANDARD_BASE_RATE" || institutionDetailText(row.current_ranking_eligible) === "1"))
    : base.filter((row) => institutionDetailFamily(row).includes("STANDARD_TERM") || institutionDetailFamily(row).includes("TIME_DEPOSIT"));
  return institutionDetailGroupedPoints(selected.map((row) => ({
    date: institutionDetailDate(row),
    rate: institutionDetailRate(row),
    label: `${institutionDetailText(row.product_label || institutionDetailProductCategory(row))} / ${institutionDetailTermLabel(row) || "期間なし"}`,
    source: row.source_url
  })));
}

function institutionDetailTiborForDate(date, key) {
  const month = institutionDetailMonth(date);
  if (!month || !institutionDetailState.tiborRecords.length) return null;
  const eligible = institutionDetailState.tiborRecords.filter((row) => row.month <= month && Number.isFinite(Number(row[key])));
  if (!eligible.length) return null;
  const row = eligible[eligible.length - 1];
  return { value: Number(row[key]), month: row.month };
}

function institutionDetailSeriesWithTibor(points) {
  return points.map((point) => ({ ...point, tibor: institutionDetailTiborForDate(point.date, institutionDetailState.tiborTenor) }));
}

function institutionDetailChart(points) {
  const target = document.querySelector("#institutionRateChart");
  if (!target) return;
  if (!points.length) {
    target.innerHTML = `<div class="institution-chart-empty">この区分には数値化できる金利履歴がありません。</div>`;
    return;
  }
  const parsed = points.map((point) => ({ ...point, time: Date.parse(`${point.date}T00:00:00`) })).filter((point) => Number.isFinite(point.time));
  if (!parsed.length) {
    target.innerHTML = `<div class="institution-chart-empty">日付付きの金利履歴がありません。</div>`;
    return;
  }
  const width = 1040;
  const height = 370;
  const margin = { top: 24, right: 34, bottom: 56, left: 68 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const minTime = Math.min(...parsed.map((point) => point.time));
  const maxTimeRaw = Math.max(...parsed.map((point) => point.time));
  const maxTime = maxTimeRaw === minTime ? minTime + 86400000 * 31 : maxTimeRaw;
  const values = parsed.flatMap((point) => [point.rate, point.tibor?.value]).filter(Number.isFinite);
  let minValue = Math.min(0, ...values);
  let maxValue = Math.max(...values);
  const padding = Math.max(0.1, (maxValue - minValue) * 0.12);
  minValue = Math.floor((minValue - padding) * 10) / 10;
  maxValue = Math.ceil((maxValue + padding) * 10) / 10;
  if (maxValue <= minValue) maxValue = minValue + 0.5;
  const x = (time) => margin.left + ((time - minTime) / (maxTime - minTime)) * plotWidth;
  const y = (value) => margin.top + (1 - (value - minValue) / (maxValue - minValue)) * plotHeight;
  const line = (items, accessor) => items.filter((item) => Number.isFinite(accessor(item))).map((item, index) => `${index ? "L" : "M"}${x(item.time).toFixed(1)},${y(accessor(item)).toFixed(1)}`).join(" ");
  const depositPath = line(parsed, (point) => point.rate);
  const tiborPoints = parsed.filter((point) => point.tibor);
  const tiborPath = line(tiborPoints, (point) => point.tibor.value);
  const yTicks = Array.from({ length: 6 }, (_, index) => minValue + ((maxValue - minValue) * index) / 5);
  const xTickCount = Math.min(6, parsed.length);
  const xTicks = Array.from({ length: xTickCount }, (_, index) => parsed[Math.round((parsed.length - 1) * index / Math.max(1, xTickCount - 1))]);
  target.innerHTML = `<svg class="institution-rate-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="預金金利と日本円TIBORの時系列比較">
    ${yTicks.map((tick) => `<line class="institution-grid-line" x1="${margin.left}" x2="${width - margin.right}" y1="${y(tick)}" y2="${y(tick)}"></line><text class="institution-axis-label" x="${margin.left - 12}" y="${y(tick) + 4}" text-anchor="end">${Number(tick.toFixed(2))}%</text>`).join("")}
    <line class="institution-axis" x1="${margin.left}" x2="${margin.left}" y1="${margin.top}" y2="${height - margin.bottom}"></line>
    <line class="institution-axis" x1="${margin.left}" x2="${width - margin.right}" y1="${height - margin.bottom}" y2="${height - margin.bottom}"></line>
    ${xTicks.map((tick) => `<text class="institution-axis-label" x="${x(tick.time)}" y="${height - 24}" text-anchor="middle">${esc(tick.date.slice(0, 7))}</text>`).join("")}
    ${tiborPath ? `<path class="institution-tibor-path" d="${tiborPath}"></path>` : ""}
    <path class="institution-deposit-path" d="${depositPath}"></path>
    ${parsed.map((point) => `<circle class="institution-deposit-point" cx="${x(point.time)}" cy="${y(point.rate)}" r="5"><title>${esc(point.date)} ${esc(point.label)} ${institutionDetailPercent(point.rate)}</title></circle>`).join("")}
    ${tiborPoints.map((point) => `<circle class="institution-tibor-point" cx="${x(point.time)}" cy="${y(point.tibor.value)}" r="4"><title>${esc(point.tibor.month)} TIBOR ${institutionDetailPercent(point.tibor.value)}</title></circle>`).join("")}
  </svg>`;
}

function institutionDetailRenderSpread(points) {
  const target = document.querySelector("#institutionSpreadSummary");
  const compared = points.filter((point) => point.tibor && Number.isFinite(point.rate));
  if (!compared.length) {
    target.innerHTML = `<div class="institution-spread-empty">この金利履歴と対応するTIBOR月次データがありません。</div>`;
    return;
  }
  const latest = compared[compared.length - 1];
  const spreads = compared.map((point) => point.rate - point.tibor.value);
  const latestSpread = latest.rate - latest.tibor.value;
  const orderedSpreads = spreads.slice().sort((a, b) => a - b);
  const middle = Math.floor(orderedSpreads.length / 2);
  const medianSpread = orderedSpreads.length % 2 ? orderedSpreads[middle] : (orderedSpreads[middle - 1] + orderedSpreads[middle]) / 2;
  target.innerHTML = `<article><span>直近の預金金利</span><strong>${institutionDetailPercent(latest.rate)}</strong><small>${esc(latest.date)}</small></article>
    <article><span>比較TIBOR</span><strong>${institutionDetailPercent(latest.tibor.value)}</strong><small>${esc(latest.tibor.month)}月平均</small></article>
    <article class="${latestSpread >= 0 ? "positive" : "negative"}"><span>直近の金利差</span><strong>${latestSpread >= 0 ? "+" : ""}${Math.round(latestSpread * 100)}bp</strong><small>預金金利 - TIBOR</small></article>
    <article><span>期間中央値の金利差</span><strong>${medianSpread >= 0 ? "+" : ""}${Math.round(medianSpread * 100)}bp</strong><small>${fmt(compared.length)}時点</small></article>`;
}

function institutionDetailRenderChart(campaigns, baseRows) {
  const options = institutionDetailAvailableSeries(campaigns, baseRows);
  const select = document.querySelector("#institutionSeriesSelect");
  if (!options.some((option) => option.key === institutionDetailState.seriesKey)) institutionDetailState.seriesKey = options[0]?.key || "";
  select.innerHTML = options.length ? options.map((option) => `<option value="${esc(option.key)}"${option.key === institutionDetailState.seriesKey ? " selected" : ""}>${esc(option.label)}</option>`).join("") : `<option value="">比較可能な履歴なし</option>`;
  select.disabled = !options.length;
  const points = institutionDetailSeriesWithTibor(institutionDetailRatePoints(campaigns, baseRows, institutionDetailState.seriesKey));
  institutionDetailChart(points);
  institutionDetailRenderSpread(points);
  const note = document.querySelector("#institutionTiborNote");
  const meta = institutionDetailState.tiborMetadata;
  note.innerHTML = meta.period_start
    ? `TIBORは、<a href="${esc(meta.source_page)}" target="_blank" rel="noopener noreferrer">全銀協TIBOR運営機関の公式履歴</a>から作成した${esc(meta.period_start)}～${esc(meta.period_end)}の月次算術平均です。比較は参考値で、預金商品の収益性や金融機関の調達原価を直接示すものではありません。チャートは特典率などの混入による縮尺崩れを防ぐため年10％超を除外しますが、明細表には表示します。公式資料には再配信時の問い合わせ案内があります。`
    : `TIBOR比較データを読み込めませんでした。<a href="https://www.jbatibor.or.jp/rate/log.html" target="_blank" rel="noopener noreferrer">公式履歴</a>をご確認ください。`;
}

function institutionDetailRenderSummary(name, campaigns, baseRows) {
  const active = campaigns.filter((row) => ["開催中", "開催予定"].includes(row.status));
  const ordinary = institutionDetailLatest(baseRows, (row) => institutionDetailFamily(row) === "ORDINARY_DEPOSIT" && (institutionDetailText(row.base_rate_role) === "STANDARD_BASE_RATE" || institutionDetailText(row.current_ranking_eligible) === "1"));
  const highestCampaign = active.filter((row) => row._comparableRate != null).sort((a, b) => b._comparableRate - a._comparableRate)[0] || null;
  const standardTerm = institutionDetailLatest(baseRows, (row) => institutionDetailFamily(row).includes("STANDARD_TERM") || institutionDetailFamily(row).includes("TIME_DEPOSIT"));
  const dates = [...campaigns.map((row) => row.campaign_start_date), ...baseRows.map(institutionDetailDate)].filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
  document.querySelector("#institutionSummaryGrid").innerHTML = `
    <article><span>開催中・開催予定</span><strong>${fmt(active.length)}件</strong><small>キャンペーン明細</small></article>
    <article><span>普通預金・直近標準金利</span><strong>${ordinary ? institutionDetailPercent(institutionDetailRate(ordinary)) : "—"}</strong><small>${ordinary ? esc(institutionDetailDate(ordinary)) : "履歴なし"}</small></article>
    <article><span>開催中商品の最高金利</span><strong>${highestCampaign ? institutionDetailPercent(highestCampaign._comparableRate) : "—"}</strong><small>${highestCampaign ? esc(highestCampaign.campaign_name) : "数値化可能な商品なし"}</small></article>
    <article><span>定期預金・直近収録金利</span><strong>${standardTerm ? institutionDetailPercent(institutionDetailRate(standardTerm)) : "—"}</strong><small>${standardTerm ? `${esc(institutionDetailTermLabel(standardTerm))} / ${esc(institutionDetailDate(standardTerm))}` : "履歴なし"}</small></article>
    <article><span>収録履歴</span><strong>${fmt(campaigns.length + baseRows.length)}件</strong><small>${dates.length ? `${esc(dates[0])}～${esc(dates[dates.length - 1])}` : "日付なし"}</small></article>`;
}

function institutionDetailRenderCampaignTable(campaigns) {
  const sorted = campaigns.slice().sort((a, b) => institutionDetailText(b.campaign_start_date).localeCompare(institutionDetailText(a.campaign_start_date)) || a.campaign_name.localeCompare(b.campaign_name, "ja"));
  document.querySelector("#institutionCampaignCount").textContent = `${fmt(sorted.length)}明細。条件・年限・金利が異なるものは別行です。`;
  document.querySelector("#institutionCampaignBody").innerHTML = sorted.length ? sorted.map((row) => {
    const period = `${row.campaign_start_date || "開始日不明"} ～ ${row.campaign_end_date || "終了日未設定"}`;
    const conditions = [row.rate_condition, row.eligibility_conditions, row.deposit_amount, row.review_notes].filter(Boolean).join(" / ");
    return `<tr><td data-label="状況"><span class="tag ${statusClass(row.status)}">${esc(row.status || "要確認")}</span></td><td data-label="商品区分">${esc(row.product_type)}</td><td data-label="商品・キャンペーン名">${esc(row.campaign_name)}</td><td data-label="募集・適用期間">${esc(period)}</td><td data-label="年限">${esc(row.term || "—")}</td><td data-label="金利" class="rate">${esc(row.interest_rate || "—")}</td><td data-label="条件" class="review-text">${esc(conditions || "—")}</td><td data-label="公式資料">${institutionDetailUrl(row.product_url)}</td></tr>`;
  }).join("") : `<tr><td colspan="8" class="table-empty">キャンペーン明細はありません。</td></tr>`;
}

function institutionDetailRenderBaseTable(baseRows) {
  const sorted = baseRows.slice().sort((a, b) => institutionDetailRowDate(b).localeCompare(institutionDetailRowDate(a)) || Number(b.rate_percent) - Number(a.rate_percent));
  document.querySelector("#institutionBaseRateCount").textContent = `${fmt(sorted.length)}明細。普通預金と店頭表示金利の履歴です。`;
  document.querySelector("#institutionBaseRateBody").innerHTML = sorted.length ? sorted.map((row) => {
    const eligible = institutionDetailText(row.current_ranking_eligible) === "1" ? "標準比較対象" : "条件付き・履歴";
    return `<tr><td data-label="基準日">${esc(institutionDetailDate(row) || "日付不明")}</td><td data-label="商品分類">${esc(institutionDetailProductCategory(row))}</td><td data-label="商品名">${esc(row.product_label || "—")}</td><td data-label="年限">${esc(institutionDetailTermLabel(row) || "—")}</td><td data-label="金利" class="rate">${institutionDetailPercent(institutionDetailRate(row), 5)}</td><td data-label="金額・条件">${esc(row.amount_band || row.evidence_context || "—")}</td><td data-label="比較区分">${esc(eligible)}</td><td data-label="公式資料">${institutionDetailUrl(row.source_url)}</td></tr>`;
  }).join("") : `<tr><td colspan="8" class="table-empty">普通預金・店頭金利の履歴はありません。</td></tr>`;
}

function renderInstitutionDetail() {
  const name = institutionDetailState.institution;
  if (!name) return;
  const campaigns = institutionDetailCampaignRows(name);
  const baseRows = institutionDetailBaseRows(name);
  const sample = campaigns[0] || baseRows[0] || {};
  document.querySelector("#institutionDetailTitle").textContent = name;
  document.querySelector("#institutionDetailMeta").textContent = [sample.prefecture, sample.region, sample.institution_type || sample.institution_type_normalized || sample.institution_type_raw].filter(Boolean).join(" / ");
  institutionDetailRenderSummary(name, campaigns, baseRows);
  institutionDetailRenderChart(campaigns, baseRows);
  institutionDetailRenderCampaignTable(campaigns);
  institutionDetailRenderBaseTable(baseRows);
}

function institutionDetailSetQuery(name) {
  const url = new URL(window.location.href);
  if (name) url.searchParams.set("institution", name);
  else url.searchParams.delete("institution");
  history.pushState({ institution: name }, "", url);
}

function openInstitutionDetail(name, options = {}) {
  if (!name) return;
  institutionDetailState.institution = name;
  if (typeof setActiveView === "function") setActiveView("timeline", { updateHash: false, render: false });
  document.body.classList.add("institution-detail-mode");
  document.querySelector("#institutionDetailPanel")?.classList.remove("hidden");
  renderInstitutionDetail();
  if (options.updateUrl !== false) institutionDetailSetQuery(name);
  if (options.scroll !== false) document.querySelector("#institutionDetailPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeInstitutionDetail(options = {}) {
  institutionDetailState.institution = "";
  document.body.classList.remove("institution-detail-mode");
  document.querySelector("#institutionDetailPanel")?.classList.add("hidden");
  if (options.updateUrl !== false) institutionDetailSetQuery("");
  if (options.scroll !== false) document.querySelector("#ganttPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function institutionDetailLoadTibor() {
  try {
    const response = await fetch(INSTITUTION_TIBOR_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    institutionDetailState.tiborMetadata = payload.metadata || {};
    institutionDetailState.tiborRecords = Array.isArray(payload.records) ? payload.records : [];
  } catch (error) {
    institutionDetailState.tiborMetadata = {};
    institutionDetailState.tiborRecords = [];
  }
  if (institutionDetailState.institution) renderInstitutionDetail();
}

document.addEventListener("DOMContentLoaded", () => {
  institutionDetailLoadTibor();
  document.querySelector("#institutionDetailClose")?.addEventListener("click", () => closeInstitutionDetail());
  document.querySelector("#institutionSeriesSelect")?.addEventListener("change", (event) => {
    institutionDetailState.seriesKey = event.target.value;
    renderInstitutionDetail();
  });
  document.querySelector("#institutionTiborTenor")?.addEventListener("change", (event) => {
    institutionDetailState.tiborTenor = event.target.value;
    renderInstitutionDetail();
  });
  document.addEventListener("click", (event) => {
    const trigger = event.target.closest(".institution-detail-trigger");
    if (trigger) openInstitutionDetail(trigger.dataset.institution);
  });
});

document.addEventListener("deposit-data-ready", () => {
  const requested = new URL(window.location.href).searchParams.get("institution");
  if (requested) openInstitutionDetail(requested, { updateUrl: false, scroll: false });
});

window.addEventListener("popstate", () => {
  const requested = new URL(window.location.href).searchParams.get("institution");
  if (requested) openInstitutionDetail(requested, { updateUrl: false, scroll: false });
  else closeInstitutionDetail({ updateUrl: false, scroll: false });
});
