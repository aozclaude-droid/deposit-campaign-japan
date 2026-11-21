"use strict";

const INSTITUTION_TIBOR_URL = "tibor_monthly.json?v=20261114-1";
const INSTITUTION_TIBOR_DAILY_URL = "tibor_daily.json?v=20261114-1";
const institutionDetailState = {
  institution: "",
  tiborMetadata: {},
  tiborRecords: [],
  tiborDailyMetadata: {},
  tiborDailyRecords: [],
  seriesKey: "",
  termKey: "all",
  tiborTenor: "one_month",
  comparisonFrequency: "weekly",
  nearbyInstitutionType: ""
};

const institutionDetailText = (value) => value == null ? "" : String(value);
const institutionDetailDate = (row) => institutionDetailText(row.effective_from || row.source_as_of_date || row.observation_date).slice(0, 10);
const institutionDetailRate = (row) => {
  const value = Number(row.rate_percent);
  return Number.isFinite(value) ? value : null;
};
const institutionDetailMonth = (value) => /^\d{4}-\d{2}/.test(institutionDetailText(value)) ? institutionDetailText(value).slice(0, 7) : "";
const institutionDetailPercent = (value, digits = 3) => Number.isFinite(value) ? `${Number(value.toFixed(digits))}%` : "—";
const institutionDetailPrefecture = (value) => {
  const raw = institutionDetailText(value).trim();
  if (!raw || raw === "全国") return raw;
  if (/[都道府県]$/.test(raw)) return raw;
  if (raw === "東京") return "東京都";
  if (raw === "大阪" || raw === "京都") return `${raw}府`;
  if (raw === "北海道") return raw;
  return `${raw}県`;
};

const INSTITUTION_NEIGHBOR_PREFECTURES = {
  "北海道": ["青森県"], "青森県": ["北海道", "岩手県", "秋田県"], "岩手県": ["青森県", "秋田県", "宮城県"],
  "宮城県": ["岩手県", "秋田県", "山形県", "福島県"], "秋田県": ["青森県", "岩手県", "宮城県", "山形県"], "山形県": ["秋田県", "宮城県", "福島県", "新潟県"],
  "福島県": ["宮城県", "山形県", "新潟県", "群馬県", "栃木県", "茨城県"], "茨城県": ["福島県", "栃木県", "埼玉県", "千葉県"],
  "栃木県": ["福島県", "茨城県", "群馬県", "埼玉県"], "群馬県": ["福島県", "栃木県", "埼玉県", "新潟県", "長野県"],
  "埼玉県": ["茨城県", "栃木県", "群馬県", "千葉県", "東京都", "山梨県", "長野県"], "千葉県": ["茨城県", "埼玉県", "東京都"],
  "東京都": ["埼玉県", "千葉県", "神奈川県", "山梨県"], "神奈川県": ["東京都", "山梨県", "静岡県"], "新潟県": ["山形県", "福島県", "群馬県", "長野県", "富山県"],
  "富山県": ["新潟県", "長野県", "岐阜県", "石川県"], "石川県": ["富山県", "岐阜県", "福井県"], "福井県": ["石川県", "岐阜県", "滋賀県", "京都府"],
  "山梨県": ["埼玉県", "東京都", "神奈川県", "長野県", "静岡県"], "長野県": ["群馬県", "埼玉県", "新潟県", "富山県", "山梨県", "岐阜県", "静岡県", "愛知県"],
  "岐阜県": ["富山県", "石川県", "福井県", "長野県", "愛知県", "三重県", "滋賀県"], "静岡県": ["神奈川県", "山梨県", "長野県", "愛知県"],
  "愛知県": ["長野県", "岐阜県", "静岡県", "三重県"], "三重県": ["岐阜県", "愛知県", "滋賀県", "京都府", "奈良県", "和歌山県"],
  "滋賀県": ["福井県", "岐阜県", "三重県", "京都府"], "京都府": ["福井県", "三重県", "滋賀県", "大阪府", "兵庫県", "奈良県"],
  "大阪府": ["京都府", "兵庫県", "奈良県", "和歌山県"], "兵庫県": ["京都府", "大阪府", "鳥取県", "岡山県", "徳島県"], "奈良県": ["三重県", "京都府", "大阪府", "和歌山県"],
  "和歌山県": ["三重県", "大阪府", "奈良県", "徳島県"], "鳥取県": ["兵庫県", "島根県", "岡山県", "広島県"], "島根県": ["鳥取県", "広島県", "山口県"],
  "岡山県": ["兵庫県", "鳥取県", "広島県", "香川県"], "広島県": ["鳥取県", "島根県", "岡山県", "山口県", "愛媛県"], "山口県": ["島根県", "広島県", "福岡県", "大分県"],
  "徳島県": ["兵庫県", "和歌山県", "香川県", "愛媛県", "高知県"], "香川県": ["岡山県", "徳島県", "愛媛県"], "愛媛県": ["広島県", "徳島県", "香川県", "高知県", "大分県"],
  "高知県": ["徳島県", "愛媛県"], "福岡県": ["山口県", "佐賀県", "熊本県", "大分県"], "佐賀県": ["福岡県", "長崎県", "熊本県"],
  "長崎県": ["佐賀県", "熊本県"], "熊本県": ["福岡県", "佐賀県", "長崎県", "大分県", "宮崎県", "鹿児島県"], "大分県": ["山口県", "福岡県", "熊本県", "宮崎県", "愛媛県"],
  "宮崎県": ["大分県", "熊本県", "鹿児島県"], "鹿児島県": ["熊本県", "宮崎県", "沖縄県"], "沖縄県": ["鹿児島県"]
};

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
  return rows.filter(row => predicate(row) && baseRateCurrentSnapshotEligible(row) && institutionDetailDate(row) <= TODAY_ISO).slice().sort((a, b) => institutionDetailRowDate(b).localeCompare(institutionDetailRowDate(a)) || Number(b.rate_percent) - Number(a.rate_percent))[0] || null;
}

function institutionDetailFamily(row) {
  return institutionDetailText(row.product_family).toUpperCase();
}

function institutionDetailTermLabel(row) {
  return institutionDetailText(row.term_label || (row.term_months ? `${row.term_months}か月` : ""));
}

function institutionDetailTermInfo(value) {
  const raw = institutionDetailText(value).trim();
  const normalized = raw.replace(/[ヵカケ箇]月/g, "か月").replace(/\s+/g, "");
  let match = normalized.match(/^(\d+(?:\.\d+)?)か月$/);
  if (match) return { key: `month:${match[1]}`, label: `${match[1]}か月`, order: Number(match[1]) * 30 };
  match = normalized.match(/^(\d+(?:\.\d+)?)年$/);
  if (match) return { key: `year:${match[1]}`, label: `${match[1]}年`, order: Number(match[1]) * 365 };
  match = normalized.match(/^(\d+(?:\.\d+)?)日$/);
  if (match) return { key: `day:${match[1]}`, label: `${match[1]}日`, order: Number(match[1]) };
  return { key: `other:${normalized || "期間記載なし"}`, label: raw || "期間記載なし", order: 100000 };
}

function institutionDetailCampaignTerms(campaigns) {
  const terms = new Map();
  campaigns.filter((row) => row.campaign_start_date && row._comparableRate != null).forEach((row) => {
    const info = institutionDetailTermInfo(row.term);
    if (!terms.has(info.key)) terms.set(info.key, info);
  });
  return [...terms.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, "ja"));
}

function institutionDetailAmountLabel(row) {
  const original = institutionDetailText(row.amount_band_label);
  if (/円|万円|億|以上|未満|以下/.test(original)) return original;
  const key = institutionDetailText(row.amount_band);
  const labels = {GENERAL_OR_UNSPECIFIED:"金額条件未特定",SMALL_LT_3M:"300万円未満",MID_GE_3M:"300万円以上",GENERAL_LT_10M:"1,000万円未満",LARGE_GE_10M:"1,000万円以上",MID_GE_3M_LT_10M:"300万円以上1,000万円未満"};
  if (labels[key]) return labels[key];
  if (/^[A-Z0-9_]+$/.test(key)) return "原文の金額条件を参照";
  return key || original || "原文の金額条件を参照";
}

function institutionDetailProductCategory(row) {
  const family = institutionDetailFamily(row);
  if (family === "ORDINARY_DEPOSIT") return "普通預金";
  if (/STANDARD_TERM|SUPER_TERM|LARGE_TERM|COMPOUND_TERM|VARIABLE_TERM|MATURITY_DESIGNATED_TERM|TIME_DEPOSIT/.test(family)) return "定期預金";
  if (family === "INSTALLMENT_DEPOSIT") return "定期積金";
  if (family.includes("SAVINGS")) return "貯蓄預金";
  if (family === "STRUCTURED_DEPOSIT") return "仕組預金";
  if (family === "INVESTMENT_LINKED_TERM") return "投資信託セット定期";
  if (family === "SETTLEMENT_DEPOSIT") return "決済用預金";
  if (family === "ZAKEI_DEPOSIT") return "財形預金";
  if (family === "OTHER_DEPOSIT") return "その他預金";
  return institutionDetailText(row.product_family || row.product_type || "その他");
}

function institutionDetailAvailableSeries(campaigns, baseRows) {
  const options = [];
  const ordinary = baseRows.filter((row) => institutionDetailFamily(row) === "ORDINARY_DEPOSIT" && institutionDetailRate(row) != null);
  const terms = baseRows.filter((row) => (institutionDetailFamily(row).includes("STANDARD_TERM") || institutionDetailFamily(row).includes("TIME_DEPOSIT")) && institutionDetailRate(row) != null);
  const campaignRates = campaigns.filter((row) => row._comparableRate != null && row.campaign_start_date);
  if (ordinary.length) options.push({ key: "ordinary", label: "普通預金（各時点の最高金利）" });
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
    return institutionDetailGroupedPoints(campaigns.filter((row) => {
      const termMatches = institutionDetailState.termKey === "all" || institutionDetailTermInfo(row.term).key === institutionDetailState.termKey;
      return termMatches && row.campaign_start_date && row._comparableRate != null && row._comparableRate >= 0 && row._comparableRate <= 10;
    }).map((row) => ({
      date: campaignRateComparisonDate(row),
      dateKind: row.rate_effective_from ? "REVISION_DATE" : row.rate_confirmed_from ? "PUBLISHED_REFERENCE_DATE" : "CAMPAIGN_START",
      rateSourceDateLabel: row.rate_confirmed_from ? `募集開始 ${row.campaign_start_date}／金利${row.rate_effective_from ? "見直し" : "確認基準日"} ${row.rate_effective_from || row.rate_confirmed_from}` : "",
      rate: row._comparableRate,
      label: `${row.campaign_name} / ${row.term || "年限記載なし"}`,
      source: row.product_url
    })));
  }
  const base = baseRows.filter((row) => {
    const rate = institutionDetailRate(row);
    const usableHistory = institutionDetailText(row.record_eligible) !== "0" || institutionDetailText(row.history_date_eligible) === "1";
    return rate != null && rate >= 0 && rate <= 10 && usableHistory && row.base_rate_role !== "CLOSED_PRODUCT_REFERENCE" && !row.reference_only;
  });
  const selected = seriesKey === "ordinary"
    ? base.filter((row) => institutionDetailFamily(row) === "ORDINARY_DEPOSIT")
    : base.filter((row) => institutionDetailFamily(row).includes("STANDARD_TERM") || institutionDetailFamily(row).includes("TIME_DEPOSIT"));
  return institutionDetailGroupedPoints(selected.map((row) => {
    const rawCondition = institutionDetailText(row.amount_band || row.evidence_context);
    return {
      date: institutionDetailDate(row),
      dateKind: row.record_date_kind || "SOURCE_DATE",
      rateSourceDateLabel: baseRateDateLabel(row),
      rate: institutionDetailRate(row),
      label: `${institutionDetailText(row.product_label || institutionDetailProductCategory(row))} / ${institutionDetailTermLabel(row) || "期間なし"}`,
      condition: rawCondition === "GENERAL_OR_UNSPECIFIED" ? "" : rawCondition,
      source: row.source_url
    };
  }));
}

function institutionDetailTiborForDate(date, key, useDaily = false) {
  const month = institutionDetailMonth(date);
  if (!month) return null;
  if (useDaily) {
    const eligible = institutionDetailState.tiborDailyRecords.filter((row) => row.date <= date && Number.isFinite(Number(row[key])));
    if (!eligible.length) return null;
    const row = eligible[eligible.length - 1];
    return { value: Number(row[key]), date: row.date, month: row.date.slice(0, 7), exact: row.date === date };
  }
  if (!institutionDetailState.tiborRecords.length) return null;
  const eligible = institutionDetailState.tiborRecords.filter((row) => row.month <= month && Number.isFinite(Number(row[key])));
  if (!eligible.length) return null;
  const row = eligible[eligible.length - 1];
  return { value: Number(row[key]), month: row.month };
}

function institutionDetailSeriesWithTibor(points) {
  if (institutionDetailState.comparisonFrequency !== "event") {
    return institutionDetailExpandedDailySeries(points, institutionDetailState.comparisonFrequency);
  }
  const useDaily = institutionDetailState.seriesKey === "campaign";
  return points.map((point) => ({ ...point, tibor: institutionDetailTiborForDate(point.date, institutionDetailState.tiborTenor, useDaily) }));
}

function institutionDetailWeekKey(date) {
  const value = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(value.getTime())) return date;
  const day = (value.getUTCDay() + 6) % 7;
  value.setUTCDate(value.getUTCDate() - day);
  return value.toISOString().slice(0, 10);
}

function institutionDetailExpandedDailySeries(points, frequency) {
  const events = points.slice().sort((a, b) => a.date.localeCompare(b.date));
  if (!events.length) return [];
  if (!institutionDetailState.tiborDailyRecords.length) return events.map(event=>({...event,tibor:null}));
  const firstDate = events[0].date;
  const daily = institutionDetailState.tiborDailyRecords
    .filter((row) => row.date >= firstDate && Number.isFinite(Number(row[institutionDetailState.tiborTenor])))
    .sort((a, b) => a.date.localeCompare(b.date));
  const observations = frequency === "weekly"
    ? [...daily.reduce((weeks, row) => weeks.set(institutionDetailWeekKey(row.date), row), new Map()).values()]
    : daily;
  let eventIndex = -1;
  const expanded = [];
  observations.forEach((row) => {
    while (eventIndex + 1 < events.length && events[eventIndex + 1].date <= row.date) eventIndex += 1;
    if (eventIndex < 0) return;
    const event = events[eventIndex];
    expanded.push({
      ...event,
      date: row.date,
      rateEffectiveDate: event.dateKind === "OBSERVATION" ? null : event.date,
      tibor: { value: Number(row[institutionDetailState.tiborTenor]), date: row.date, month: row.date.slice(0, 7), exact: true }
    });
  });
  const lastTiborDate = daily.at(-1)?.date || "";
  events.filter(event=>event.date>lastTiborDate).forEach(event=>expanded.push({...event,tibor:null,rateEffectiveDate:event.dateKind === "OBSERVATION" ? null : event.date}));
  return expanded;
}

function institutionDetailChart(points) {
  const target = document.querySelector("#institutionRateChart");
  if (!target) return;
  if (!points.length) {
    target.innerHTML = `<div class="institution-chart-empty">この区分には数値化できる金利履歴がありません。</div>`;
    return;
  }
  const parsed = points.map((point) => ({ ...point, time: Date.parse(`${point.date}T00:00:00`) })).filter((point) => Number.isFinite(point.time)).map((point, index) => ({ ...point, chartIndex: index }));
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
  const spreadPoints = parsed.filter((point) => point.tibor).map((point) => ({ ...point, spread: point.rate - point.tibor.value }));
  const values = parsed.flatMap((point) => [point.rate, point.tibor?.value, point.tibor ? point.rate - point.tibor.value : null]).filter(Number.isFinite);
  let minValue = Math.min(0, ...values);
  let maxValue = Math.max(...values);
  const padding = Math.max(0.1, (maxValue - minValue) * 0.12);
  minValue = Math.floor((minValue - padding) * 10) / 10;
  maxValue = Math.ceil((maxValue + padding) * 10) / 10;
  if (maxValue <= minValue) maxValue = minValue + 0.5;
  const x = (time) => margin.left + ((time - minTime) / (maxTime - minTime)) * plotWidth;
  const y = (value) => margin.top + (1 - (value - minValue) / (maxValue - minValue)) * plotHeight;
  const line = (items, accessor, stepped = false) => {
    const valid = items.filter((item) => Number.isFinite(accessor(item)));
    return valid.map((item, index) => {
      const px = x(item.time).toFixed(1);
      const py = y(accessor(item)).toFixed(1);
      if (!index) return `M${px},${py}`;
      return stepped ? `H${px} V${py}` : `L${px},${py}`;
    }).join(" ");
  };
  const depositPath = line(parsed, (point) => point.rate, true);
  const tiborPoints = parsed.filter((point) => point.tibor);
  const tiborPath = line(tiborPoints, (point) => point.tibor.value);
  const spreadPath = line(spreadPoints, (point) => point.spread);
  const yTicks = Array.from({ length: 6 }, (_, index) => minValue + ((maxValue - minValue) * index) / 5);
  const xTickCount = Math.min(6, parsed.length);
  const xTicks = Array.from({ length: xTickCount }, (_, index) => parsed[Math.round((parsed.length - 1) * index / Math.max(1, xTickCount - 1))]);
  target.innerHTML = `<svg class="institution-rate-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="預金金利と日本円TIBORの時系列比較">
    ${yTicks.map((tick) => `<line class="institution-grid-line" x1="${margin.left}" x2="${width - margin.right}" y1="${y(tick)}" y2="${y(tick)}"></line><text class="institution-axis-label" x="${margin.left - 12}" y="${y(tick) + 4}" text-anchor="end">${Number(tick.toFixed(2))}%</text>`).join("")}
    <line class="institution-axis" x1="${margin.left}" x2="${margin.left}" y1="${margin.top}" y2="${height - margin.bottom}"></line>
    <line class="institution-axis" x1="${margin.left}" x2="${width - margin.right}" y1="${height - margin.bottom}" y2="${height - margin.bottom}"></line>
    ${xTicks.map((tick) => `<text class="institution-axis-label" x="${x(tick.time)}" y="${height - 24}" text-anchor="middle">${esc(institutionDetailState.comparisonFrequency === "event" ? tick.date.slice(0, 7) : tick.date.slice(2, 10))}</text>`).join("")}
    ${tiborPath ? `<path class="institution-tibor-path" d="${tiborPath}"></path>` : ""}
    <path class="institution-deposit-path" d="${depositPath}"></path>
    ${spreadPath ? `<path class="institution-spread-path" d="${spreadPath}"></path>` : ""}
    ${parsed.map((point) => `<circle class="institution-deposit-point" cx="${x(point.time)}" cy="${y(point.rate)}" r="5"></circle>`).join("")}
    ${tiborPoints.map((point) => `<circle class="institution-tibor-point" cx="${x(point.time)}" cy="${y(point.tibor.value)}" r="4"></circle>`).join("")}
    ${spreadPoints.map((point) => `<circle class="institution-spread-point" cx="${x(point.time)}" cy="${y(point.spread)}" r="4"></circle>`).join("")}
    ${parsed.flatMap((point) => {
      const positions = [[x(point.time), y(point.rate), "預金金利"]];
      if (point.tibor) positions.push([x(point.time), y(point.tibor.value), "TIBOR"]);
      if (point.tibor) positions.push([x(point.time), y(point.rate - point.tibor.value), "金利差"]);
      return positions.map(([cx, cy, series]) => `<circle class="institution-chart-hit" cx="${cx}" cy="${cy}" r="11" tabindex="0" role="button" data-point-index="${point.chartIndex}" aria-label="${esc(`${point.date} ${point.label} ${series}`)}"></circle>`);
    }).join("")}
  </svg><div class="institution-chart-tooltip" id="institutionChartTooltip" role="tooltip" aria-hidden="true"></div>`;

  const tooltip = target.querySelector("#institutionChartTooltip");
  const tooltipHtml = (point) => {
    const isCampaign = institutionDetailState.seriesKey === "campaign";
    const tiborBasis = point.tibor
      ? (point.tibor.date ? `${point.tibor.date}${point.tibor.exact ? "（開始日）" : "（直前営業日）"}` : `${point.tibor.month}月平均`)
      : "対応データなし";
    const spread = point.tibor ? point.rate - point.tibor.value : null;
    return `<strong>${esc(isCampaign ? point.label : point.label)}</strong>
      <span>${institutionDetailState.comparisonFrequency === "event" ? (isCampaign ? "キャンペーン開始日" : "基準日") : "比較日"}：${esc(point.date)}</span>
      ${point.dateKind === "OBSERVATION" ? `<span>掲載金利の取得日：${esc(point.rateSourceDateLabel)}。金利改定日は未確認</span>` : ""}
      ${point.rateEffectiveDate && point.rateEffectiveDate !== point.date ? `<span>金利の適用開始日：${esc(point.rateEffectiveDate)}</span>` : ""}
      <span>預金金利：${institutionDetailPercent(point.rate)}</span>
      ${point.condition ? `<span>採用条件：${esc(point.condition)}</span>` : ""}
      <span>比較TIBOR：${point.tibor ? institutionDetailPercent(point.tibor.value) : "—"} <small>${esc(tiborBasis)}</small></span>
      <span>金利差：${Number.isFinite(spread) ? `${spread >= 0 ? "+" : ""}${Math.round(spread * 100)}bp` : "—"}</span>`;
  };
  const showTooltip = (event, point) => {
    if (!tooltip || !point) return;
    tooltip.innerHTML = tooltipHtml(point);
    tooltip.classList.add("visible");
    tooltip.setAttribute("aria-hidden", "false");
    const rect = target.getBoundingClientRect();
    const hitRect = event.currentTarget.getBoundingClientRect();
    const clientX = Number.isFinite(event.clientX) && event.clientX ? event.clientX : hitRect.left + hitRect.width / 2;
    const clientY = Number.isFinite(event.clientY) && event.clientY ? event.clientY : hitRect.top + hitRect.height / 2;
    const rawLeft = clientX - rect.left + target.scrollLeft;
    const rawTop = clientY - rect.top + target.scrollTop;
    const halfWidth = tooltip.offsetWidth / 2;
    const minLeft = target.scrollLeft + halfWidth + 10;
    const maxLeft = target.scrollLeft + target.clientWidth - halfWidth - 10;
    const left = Math.max(minLeft, Math.min(rawLeft, Math.max(minLeft, maxLeft)));
    const top = Math.max(rawTop, tooltip.offsetHeight + 22);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  };
  const hideTooltip = () => {
    if (!tooltip) return;
    tooltip.classList.remove("visible");
    tooltip.setAttribute("aria-hidden", "true");
  };
  target.querySelectorAll(".institution-chart-hit").forEach((hit) => {
    const point = parsed[Number(hit.dataset.pointIndex)];
    hit.addEventListener("pointerenter", (event) => showTooltip(event, point));
    hit.addEventListener("pointermove", (event) => showTooltip(event, point));
    hit.addEventListener("pointerleave", hideTooltip);
    hit.addEventListener("focus", (event) => showTooltip(event, point));
    hit.addEventListener("blur", hideTooltip);
  });
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
  const tiborBasis = latest.tibor.date
    ? `${latest.tibor.date}${latest.tibor.exact ? "（開始日）" : "（開始日の直前営業日）"}`
    : `${latest.tibor.month}月平均`;
  target.innerHTML = `<article><span>直近の預金金利</span><strong>${institutionDetailPercent(latest.rate)}</strong><small>${esc(latest.date)}</small></article>
    <article><span>比較TIBOR</span><strong>${institutionDetailPercent(latest.tibor.value)}</strong><small>${esc(tiborBasis)}</small></article>
    <article class="${latestSpread >= 0 ? "positive" : "negative"}"><span>直近の金利差</span><strong>${latestSpread >= 0 ? "+" : ""}${Math.round(latestSpread * 100)}bp</strong><small>預金金利 - TIBOR</small></article>
    <article><span>期間中央値の金利差</span><strong>${medianSpread >= 0 ? "+" : ""}${Math.round(medianSpread * 100)}bp</strong><small>${fmt(compared.length)}時点</small></article>`;
}

function institutionDetailRenderSpreadDetails(points) {
  const target = document.querySelector("#institutionSpreadDetails");
  if (!target) return;
  const eventMode = institutionDetailState.comparisonFrequency === "event";
  if (eventMode && institutionDetailState.seriesKey !== "campaign") {
    target.innerHTML = "";
    target.classList.add("hidden");
    return;
  }
  const compared = points.filter((point) => point.tibor && Number.isFinite(point.rate)).slice().reverse().slice(0, 60);
  target.classList.remove("hidden");
  const termSelect = document.querySelector("#institutionTermSelect");
  const selectedTerm = termSelect?.selectedOptions?.[0]?.textContent || "全年限";
  const frequencyLabel = institutionDetailState.comparisonFrequency === "daily" ? "日次" : institutionDetailState.comparisonFrequency === "weekly" ? "週次" : "開始日";
  const description = eventMode
    ? (institutionDetailState.termKey === "all" ? "同じ開始日に複数年限がある場合は、その日の最高キャンペーン金利を表示します。" : `${esc(selectedTerm)}に絞り込み、同じ開始日の最高キャンペーン金利を表示します。`)
    : `預金金利は次の確認時点まで据え置き（改定日不明のデータは取得日の観測点として表示）、${frequencyLabel}のTIBORと比較します。直近60時点を表示します。`;
  target.innerHTML = `<h4>${frequencyLabel}のTIBOR差</h4>
    <p>${description}</p>
    <div class="institution-spread-table-wrap"><table class="institution-spread-table"><thead><tr><th>比較日</th><th>金利の日付と区分</th><th>預金金利</th><th>TIBOR</th><th>金利差</th><th>商品・年限</th></tr></thead><tbody>
      ${compared.map((point) => {
        const spread = point.rate - point.tibor.value;
        return `<tr><td>${esc(point.date)}</td><td>${esc(point.rateSourceDateLabel || point.rateEffectiveDate || point.date)}</td><td class="rate">${institutionDetailPercent(point.rate)}</td><td>${institutionDetailPercent(point.tibor.value)}</td><td class="rate ${spread >= 0 ? "positive" : "negative"}">${spread >= 0 ? "+" : ""}${Math.round(spread * 100)}bp</td><td>${esc(point.label)}</td></tr>`;
      }).join("")}
    </tbody></table></div>`;
}

function institutionDetailRenderChart(campaigns, baseRows) {
  const options = institutionDetailAvailableSeries(campaigns, baseRows);
  const select = document.querySelector("#institutionSeriesSelect");
  if (!options.some((option) => option.key === institutionDetailState.seriesKey)) institutionDetailState.seriesKey = options[0]?.key || "";
  select.innerHTML = options.length ? options.map((option) => `<option value="${esc(option.key)}"${option.key === institutionDetailState.seriesKey ? " selected" : ""}>${esc(option.label)}</option>`).join("") : `<option value="">比較可能な履歴なし</option>`;
  select.disabled = !options.length;
  const termControl = document.querySelector("#institutionTermControl");
  const termSelect = document.querySelector("#institutionTermSelect");
  const termOptions = institutionDetailCampaignTerms(campaigns);
  if (institutionDetailState.termKey !== "all" && !termOptions.some((term) => term.key === institutionDetailState.termKey)) institutionDetailState.termKey = "all";
  termSelect.innerHTML = `<option value="all">全年限（各時点の最高金利）</option>${termOptions.map((term) => `<option value="${esc(term.key)}"${term.key === institutionDetailState.termKey ? " selected" : ""}>${esc(term.label)}</option>`).join("")}`;
  termControl.hidden = institutionDetailState.seriesKey !== "campaign";
  const points = institutionDetailSeriesWithTibor(institutionDetailRatePoints(campaigns, baseRows, institutionDetailState.seriesKey));
  institutionDetailChart(points);
  institutionDetailRenderSpread(points);
  institutionDetailRenderSpreadDetails(points);
  const note = document.querySelector("#institutionTiborNote");
  const meta = institutionDetailState.tiborMetadata;
  const dailyMeta = institutionDetailState.tiborDailyMetadata;
  const frequencyText = institutionDetailState.comparisonFrequency === "daily" ? "各公表営業日" : institutionDetailState.comparisonFrequency === "weekly" ? "各週の最終公表営業日" : "金利の改定日・キャンペーン開始日";
  note.innerHTML = meta.period_start
    ? `<a href="${esc(meta.source_page)}" target="_blank" rel="noopener noreferrer">全銀協TIBOR運営機関の公式履歴</a>を使用しています。現在は${frequencyText}で比較し、預金金利は次の改定・開始日まで据え置く階段状系列です（日次データ ${esc(dailyMeta.period_start || "—")}～${esc(dailyMeta.period_end || "—")}）。「改定・開始日」を選んだ場合、通常金利は月次平均、キャンペーンは金利見直し日・確認基準日（記載がない場合は募集開始日）の日次TIBOR（非公表日は直前営業日）と比較します。金利差は「預金金利－TIBOR」で、100bp＝1％ポイントです。改定日が不明な掲載金利は取得日の観測点として区別して表示します。比較は参考値です。`
    : `TIBOR比較データを読み込めませんでした。<a href="https://www.jbatibor.or.jp/rate/log.html" target="_blank" rel="noopener noreferrer">公式履歴</a>をご確認ください。`;
}

// Match only a known single tenor: never spread a range or ambiguous multi-rate table.
function institutionDetailCampaignMatrixGroups(campaigns, today) {
  const groups = new Map();
  const terms = new Map();
  let unmatched = 0;
  for (const row of campaigns) {
    if (effectiveStatus({...row, status:row._sourceStatus || row.status}) !== '開催中') continue;
    if ((row.campaign_start_date && row.campaign_start_date > today) || (row.campaign_end_date && row.campaign_end_date < today)) continue;
    if (row.campaign_start_date && row.campaign_end_date && row.campaign_start_date > row.campaign_end_date) continue;
    if (campaignRateComparisonDate(row) > today) continue;
    if (!['普通預金','普通貯金','定期預金','定期貯金'].includes(row.product_type)) continue;
    if (row.currency && !/^(JPY|YEN|円|円貨|日本円)$/i.test(String(row.currency).trim())) continue;
    if (/AFTER_TAX|税引後/i.test(row.tax_basis || '') || row.ranking_eligible === false || row.ranking_eligible === 'false' || row.ranking_eligible === '0' || Number(row.renewal_stage || 1) > 1) continue;
    if (!row.currency && /外貨|米ドル|豪ドル|NZドル|ユーロ|南アフリカランド/.test([row.product_type,row.campaign_name,row.interest_rate].join(' '))) continue;
    const rate = selectedRateValue(row, 'maximum');
    if (!Number.isFinite(rate) || rate < 0 || rate > 10) { unmatched++; continue; }
    let term = {key:'ordinary',label:'普通預金',order:0,months:null};
    if (!/^普通/.test(row.product_type)) {
      const parsed = parseTermDurations(String(row.term || '').replace(/[０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xfee0)).replace(/箇月/g,'か月'));
      if (parsed?.kind !== 'exact' || parsed.durations.length !== 1) { unmatched++; continue; }
      const duration = parsed.durations[0];
      if (duration.months > 0) term = {key:`term-${duration.months}`,label:duration.months % 12 === 0 ? `${duration.months/12}年` : `${duration.months}か月`,order:duration.months*31,months:duration.months};
      else if (duration.days > 0) term = {key:`term-day-${duration.days}`,label:`${duration.days}日`,order:duration.days,months:null};
      else { unmatched++; continue; }
    }
    terms.set(term.key,term);
    if (!groups.has(term.key)) groups.set(term.key,[]);
    const rows=groups.get(term.key);
    const key=[row.campaign_name,row.campaign_start_date,row.campaign_end_date,row.term,rate,row.rate_condition,row.eligibility_conditions,row.deposit_amount,row.product_url].join('\u241f');
    if (!rows.some(item=>item.key===key)) rows.push({row,rate,key});
  }
  for (const rows of groups.values()) rows.sort((a,b)=>b.rate-a.rate || String(b.row.campaign_start_date||'').localeCompare(String(a.row.campaign_start_date||'')) || a.row.campaign_name.localeCompare(b.row.campaign_name,'ja'));
  return {groups,terms,unmatched};
}

function institutionDetailCampaignMatrixCondition(row) {
  return [row.campaign_name,row.deposit_amount,row.eligibility_conditions,row.rate_condition].filter(Boolean).join(' / ');
}

function institutionDetailRenderMatrixCampaignEvidence(column, targetSelector = '#institutionCurrentRateEvidence', bankName = '') {
  const items=column.campaigns || [];
  document.querySelector(targetSelector).innerHTML=`<h4>${bankName?esc(bankName)+' / ':''}${esc(column.key==='ordinary'?'普通預金':`定期預金 ${column.label}`)}・現在実施中のキャンペーン ${items.length}明細</h4><p class="muted">金利の高い順です。対象者・金額帯などが異なるため、同じ条件で利用できるとは限りません。</p>${items.map(({row,rate})=>{
    const delta=column.standard ? rate-Number(column.standard.rate_percent) : null;
    const period=`${row.campaign_start_date || '開始日未設定'} ～ ${row.campaign_end_date || '終了日未設定'}`;
    return `<article class="institution-matrix-campaign-detail"><h5>${esc(row.campaign_name)} <strong>${institutionDetailPercent(rate,5)}</strong></h5><dl><div><dt>募集期間</dt><dd>${esc(period)}</dd></div><div><dt>預入期間</dt><dd>${esc(row.term || '期間なし')}</dd></div><div><dt>通常標準金利との差</dt><dd>${delta===null?'比較対象の通常金利なし':`${delta>=0?'+':''}${Number(delta.toFixed(5))}ポイント`}</dd></div><div><dt>金額・対象者・条件</dt><dd>${esc(institutionDetailCampaignMatrixCondition(row))}</dd></div><div><dt>確認根拠</dt><dd>${institutionDetailUrl(row.product_url)}${row.review_notes?`<p>${esc(row.review_notes)}</p>`:''}</dd></div></dl></article>`;
  }).join('')}`;
}

// Uses the same current-rate selection as the nationwide ranking and heatmap.
function institutionDetailCurrentRateModel(name, baseRows) {
  const api = window.DepositRateComparison;
  if (!api) return { columns: [], ready: false, error: '金利比較の処理を読み込めませんでした。' };
  const snapshot = window.DepositCurrentRates;
  const standardRows = (snapshot?.rows || []).filter(row => institutionDetailText(row.institution_name).trim() === name);
  const termHistory = baseRows.filter(row => /^CURRENT_(STANDARD|CONDITIONAL)$/.test(row.comparison_category || ''));
  const today = api.todayInJapan();
  const campaignModel = institutionDetailCampaignMatrixGroups(institutionDetailCampaignRows(name), today);
  function column(key, label, family, termMonths) {
    const source = family === 'ordinary' ? baseRows : [...standardRows, ...termHistory];
    const options = { family, today, termMonths };
    if (family === 'term') options.standardRows = standardRows;
    const standard = family === 'day' ? null : api.select(source, { ...options, basis: 'standard' })[0] || null;
    const maximum = family === 'day' ? null : api.select(source, { ...options, basis: 'maximum' })[0] || null;
    return { key, label, standard, maximum, campaigns:campaignModel.groups.get(key) || [] };
  }
  const columns = [column('ordinary', '普通預金', 'ordinary', null)];
  const terms = new Map([1,3,6,12,24,36,48,60,72,84,96,108,120].map(months=>[`term-${months}`,{key:`term-${months}`,label:months<12?`${months}か月`:`${months/12}年`,months,order:months*31}]));
  for (const [key,term] of campaignModel.terms) if (key !== 'ordinary') terms.set(key,term);
  for (const term of [...terms.values()].sort((a,b)=>a.order-b.order)) {
    const item = column(term.key,term.label,term.months?'term':'day',term.months);
    if (item.standard || item.maximum || item.campaigns.length) columns.push(item);
  }
  return { columns, ready: Boolean(snapshot?.loaded), error: snapshot?.error || '', today, unmatchedCampaigns:campaignModel.unmatched };
}

function institutionDetailRateCondition(row) {
  if (!row) return '比較可能なデータなし';
  return [...new Set([
    row.product_label,
    institutionDetailAmountLabel(row),
    row.eligibility_conditions,
    row.rate_condition
  ].filter(Boolean))].join(' / ');
}

function institutionDetailRenderCurrentRateMatrix(name, baseRows) {
  const summary = document.querySelector('#institutionSummaryGrid');
  if (!summary) return;
  let panel = document.querySelector('#institutionCurrentRatePanel');
  if (!panel) {
    panel = document.createElement('section');
    panel.id = 'institutionCurrentRatePanel';
    panel.className = 'institution-subpanel institution-current-rate-panel';
    summary.insertAdjacentElement('afterend', panel);
  }
  const model = institutionDetailCurrentRateModel(name, baseRows);
  const columns = model.columns;
  const hasRates = columns.some(c => c.standard || c.maximum || c.campaigns.length);
  const cell = (c, basis) => {
    const row = c[basis];
    if (!row) return '<td class="institution-matrix-missing">—<small>比較データなし</small></td>';
    const higher = basis === 'maximum' && c.standard && Number(row.rate_percent) > Number(c.standard.rate_percent) + 1e-9;
    const date = row.date_display || baseRateDateLabel(row) || '日付情報なし';
    return `<td class="${higher ? 'institution-matrix-preferred' : ''}"><button type="button" class="institution-rate-cell-button" data-column="${esc(c.key)}" data-basis="${basis}" aria-label="${esc(c.label)}・${basis === 'standard' ? '標準金利' : '達成可能な最高金利'} ${esc(institutionDetailPercent(Number(row.rate_percent), 5))}の条件と根拠"><strong>${institutionDetailPercent(Number(row.rate_percent), 5)}</strong><small>${esc(date)}</small></button></td>`;
  };
  const campaignCell = c => {
    const item = c.campaigns[0];
    if (!item) return '<td class="institution-matrix-missing">—<small>比較可能な開催中データなし</small></td>';
    const delta = c.standard ? item.rate-Number(c.standard.rate_percent) : null;
    return `<td class="institution-matrix-campaign"><button type="button" class="institution-rate-cell-button" data-column="${esc(c.key)}" data-basis="campaign" aria-label="${esc(c.label)}の開催中キャンペーンと条件"><strong>${institutionDetailPercent(item.rate,5)}</strong>${delta===null?'<small>通常金利は未収録</small>':`<span class="institution-matrix-delta">標準比 ${delta>=0?'+':''}${Number(delta.toFixed(5))}ポイント</span>`}<small>${esc(item.row.campaign_name)}</small><small>同年限 ${c.campaigns.length}明細・詳細を見る</small></button></td>`;
  };
  panel.innerHTML = `<div class="institution-subpanel-heading"><div><p class="section-kicker">CURRENT DEPOSIT RATES</p><h3>普通預金・定期預金・キャンペーン 金利マトリクス</h3><p class="muted">同じ年限の通常金利と開催中キャンペーンを比較できます。金利を選ぶと、商品・条件・募集期間・公式資料を表示します。</p></div><span class="institution-current-rate-date">${esc(model.today || '')}の比較対象</span></div>
    ${!model.ready ? `<p class="institution-current-rate-status" role="status">${model.error ? '定期預金の比較データを読み込めませんでした。ページを再読み込みしてください。' : '定期預金の比較データを読み込み中です。'}</p>` : ''}
    ${!hasRates && model.ready ? '<p class="institution-current-rate-empty">現在比較できる通常金利・開催中キャンペーン金利は未収録です。過去・参考値は下の通常金利履歴をご確認ください。</p>' : ''}
    <div class="institution-current-matrix-scroll" tabindex="0" aria-label="金融機関の金利マトリクス。横にスクロールできます。"><table class="institution-current-rate-matrix"><caption class="institution-matrix-caption">${esc(name)}の通常金利・現在実施中のキャンペーン金利（年率％）</caption><thead><tr><th scope="col">金利区分</th>${columns.map(c => `<th scope="col">${c.key === 'ordinary' ? '普通預金' : `定期 ${esc(c.label)}`}</th>`).join('')}</tr></thead><tbody>
    <tr data-rate-basis="standard"><th scope="row">通常の標準金利</th>${columns.map(c => cell(c, 'standard')).join('')}</tr>
    <tr data-rate-basis="maximum"><th scope="row">通常の最高金利</th>${columns.map(c => cell(c, 'maximum')).join('')}</tr>
    <tr class="institution-matrix-condition-row"><th scope="row">通常最高の商品・条件</th>${columns.map(c => `<td title="${esc(institutionDetailRateCondition(c.maximum))}"><span>${esc(institutionDetailRateCondition(c.maximum))}</span></td>`).join('')}</tr>
    <tr data-rate-basis="campaign"><th scope="row">開催中キャンペーン<br><small>各年限の最高金利</small></th>${columns.map(c=>campaignCell(c)).join('')}</tr>
    </tbody></table></div>
    <p class="institution-current-matrix-note">通常金利と開催中キャンペーンを行別に表示します。開催状況は収録データと表示日から判定しています。キャンペーンは各年限の比較可能な最高金利を掲載し、クリックで同年限の全明細を確認できます。標準比は「キャンペーン金利－通常標準金利」の差（％ポイント）です。対象者・金額帯などの条件は一致するとは限りません。定期預金は比較可能な年限のみ表示します。開催予定・終了済み・外貨・税引後金利はキャンペーン比較に含めません。「—」は未収録・比較対象外であり、金利ゼロではありません。掲載基準日や取得日は改定日と区別しています。${model.unmatchedCampaigns?` 年限または適用金利を確定できない開催中キャンペーン${model.unmatchedCampaigns}明細は、この表への配置を見送っています。下のキャンペーン一覧で原文を確認できます。`:""}</p>
    <div class="institution-current-rate-evidence" id="institutionCurrentRateEvidence" aria-live="polite"><p class="muted">表の金利を選択すると、この欄に条件と根拠を表示します。</p></div>`;
  panel.querySelectorAll('[data-column]').forEach(button => button.addEventListener('click', () => {
    panel.querySelectorAll('.institution-rate-cell-button').forEach(b => b.classList.toggle('is-selected', b === button));
    const column = columns.find(c => c.key === button.dataset.column);
    if (button.dataset.basis === 'campaign' && column) { institutionDetailRenderMatrixCampaignEvidence(column); return; }
    const row = column?.[button.dataset.basis];
    if (!row) return;
    const tax = row.tax_basis === 'PRE_TAX' ? '税引前' : row.tax_basis === 'AFTER_TAX' ? '税引後' : '税区分は公式資料をご確認ください';
    const dates = [row.date_display || baseRateDateLabel(row), row.observation_date ? `${row.observation_date}取得・確認` : ''].filter(Boolean);
    document.querySelector('#institutionCurrentRateEvidence').innerHTML = `<h4>${esc(column.key === 'ordinary' ? '普通預金' : `定期預金 ${column.label}`)}・${button.dataset.basis === 'standard' ? '標準金利' : '達成可能な最高金利'} <strong>${institutionDetailPercent(Number(row.rate_percent), 5)}</strong></h4><dl><div><dt>商品</dt><dd>${esc(row.product_label || '—')}</dd></div><div><dt>預入金額・条件</dt><dd>${esc(institutionDetailRateCondition(row))}</dd></div><div><dt>日付</dt><dd>${esc(dates.join(' / ') || '日付情報なし')}</dd></div><div><dt>金利の表示</dt><dd>年率・${esc(tax)}</dd></div><div><dt>確認根拠</dt><dd>${institutionDetailUrl(row.source_url)}${row.review_notes ? `<p>${esc(row.review_notes)}</p>` : ''}</dd></div></dl>`;
  }));
}


function institutionDetailRenderSummary(name, campaigns, baseRows) {
  const active = campaigns.filter((row) => ["開催中", "開催予定"].includes(row.status));
  const rateModel = institutionDetailCurrentRateModel(name, baseRows);
  const ordinary = rateModel.columns.find(c => c.key === 'ordinary')?.standard || null;
  const highestCampaign = active.filter((row) => row._comparableRate != null).sort((a, b) => b._comparableRate - a._comparableRate)[0] || null;
  const standardTerm = rateModel.columns.find(c => c.key === 'term-12')?.standard || null;
  const dates = [...campaigns.map((row) => row.campaign_start_date), ...baseRows.map(institutionDetailDate)].filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
  document.querySelector("#institutionSummaryGrid").innerHTML = `
    <article><span>開催中・開催予定</span><strong>${fmt(active.length)}件</strong><small>キャンペーン明細</small></article>
    <article><span>普通預金・直近標準金利</span><strong>${ordinary ? institutionDetailPercent(institutionDetailRate(ordinary)) : "—"}</strong><small>${ordinary ? esc(baseRateDateLabel(ordinary)) : baseRows.some(row => /ORDINARY/.test(String(row.product_family))) ? "参考履歴あり・標準比較対象外" : "履歴なし"}</small></article>
    <article><span>開催中商品の最高金利</span><strong>${highestCampaign ? institutionDetailPercent(highestCampaign._comparableRate) : "—"}</strong><small>${highestCampaign ? esc(highestCampaign.campaign_name) : "数値化可能な商品なし"}</small></article>
    <article><span>定期預金・1年標準金利</span><strong>${standardTerm ? institutionDetailPercent(institutionDetailRate(standardTerm)) : "—"}</strong><small>${standardTerm ? `${esc(institutionDetailTermLabel(standardTerm))} / ${esc(baseRateDateLabel(standardTerm))}` : "比較可能な1年金利なし"}</small></article>
    <article><span>収録履歴</span><strong>${fmt(campaigns.length + baseRows.length)}件</strong><small>${dates.length ? `${esc(dates[0])}～${esc(dates[dates.length - 1])}` : "日付なし"}</small></article>`;
}

function institutionDetailRenderCampaignTable(campaigns) {
  const sorted = campaigns.slice().sort((a, b) => institutionDetailText(b.campaign_start_date).localeCompare(institutionDetailText(a.campaign_start_date)) || a.campaign_name.localeCompare(b.campaign_name, "ja"));
  document.querySelector("#institutionCampaignCount").textContent = `${fmt(sorted.length)}明細。条件・年限・金利が異なるものは別行です。`;
  document.querySelector("#institutionCampaignBody").innerHTML = sorted.length ? sorted.map((row) => {
    const period = `${row.campaign_start_date || "開始日不明"} ～ ${row.campaign_end_date || "終了日未設定"}`;
    const conditions = [row.rate_condition, row.eligibility_conditions, row.deposit_amount, row.review_notes].filter(Boolean).join(" / ");
    return `<tr data-campaign-key="${esc(institutionDetailCampaignKey(row))}"><td data-label="状況"><span class="tag ${statusClass(row.status)}">${esc(row.status || "要確認")}</span></td><td data-label="商品区分">${esc(row.product_type)}</td><td data-label="商品・キャンペーン名">${esc(row.campaign_name)}</td><td data-label="募集・適用期間">${esc(period)}</td><td data-label="年限">${esc(row.term || "—")}</td><td data-label="金利" class="rate">${esc(row.interest_rate || "—")}</td><td data-label="条件" class="review-text">${esc(conditions || "—")}</td><td data-label="公式資料">${institutionDetailUrl(row.product_url)}</td></tr>`;
  }).join("") : `<tr><td colspan="8" class="table-empty">キャンペーン明細はありません。</td></tr>`;
}

function institutionDetailCampaignKey(row) {
  return encodeURIComponent([row.campaign_name, row.campaign_start_date, row.campaign_end_date, row.product_type].map(institutionDetailText).join("\u0000"));
}

function institutionDetailTimelineGroups(campaigns) {
  const groups = new Map();
  campaigns.forEach((row) => {
    const key = institutionDetailCampaignKey(row);
    if (!groups.has(key)) groups.set(key, { key, campaign: row.campaign_name, productType: row.product_type, start: row.campaign_start_date, end: row.campaign_end_date, status: row.status || "要確認", rows: [] });
    groups.get(key).rows.push(row);
  });
  return [...groups.values()].sort((a, b) => institutionDetailText(b.start).localeCompare(institutionDetailText(a.start)) || a.campaign.localeCompare(b.campaign, "ja"));
}

function institutionDetailRenderTimeline(campaigns) {
  const target = document.querySelector("#institutionCampaignTimeline");
  const description = document.querySelector("#institutionTimelineDescription");
  if (!target) return;
  const groups = institutionDetailTimelineGroups(campaigns);
  const dated = groups.filter((group) => parseIso(group.start));
  if (description) description.textContent = `${fmt(groups.length)}キャンペーン期間を表示しています。横棒を選ぶと対応する明細へ移動します。`;
  if (!dated.length) {
    target.innerHTML = `<div class="gantt-empty">開始日を確認できるキャンペーンがありません。</div>`;
    return;
  }
  const starts = dated.map((group) => parseIso(group.start));
  const ends = dated.map((group) => parseIso(group.end)).filter(Boolean);
  let minDate = new Date(Math.min(...starts.map(Number)));
  let maxDate = ends.length ? new Date(Math.max(...ends.map(Number))) : parseIso(TODAY_ISO);
  if (dated.some((group) => !parseIso(group.end))) {
    const extension = new Date(parseIso(TODAY_ISO).getTime() + 90 * dayMs);
    if (extension > maxDate) maxDate = extension;
  }
  if (maxDate <= minDate) maxDate = new Date(minDate.getTime() + 30 * dayMs);
  minDate = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
  maxDate = new Date(maxDate.getFullYear(), maxDate.getMonth() + 1, 1);
  const spanDays = Math.max(1, (maxDate - minDate) / dayMs);
  const months = Math.max(1, Math.round(spanDays / 30.44));
  const tickStep = months <= 24 ? 1 : months <= 72 ? 3 : months <= 180 ? 12 : 24;
  const minChartWidth = isCompactViewport() ? 760 : 1100;
  const monthScale = isCompactViewport() ? (months <= 36 ? 38 : months <= 120 ? 18 : 10) : (months <= 36 ? 54 : months <= 120 ? 24 : 12);
  const chartWidth = Math.min(4200, Math.max(minChartWidth, months * monthScale));
  const ticks = [];
  for (let cursor = new Date(minDate); cursor <= maxDate; cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)) {
    const offset = (cursor.getFullYear() - minDate.getFullYear()) * 12 + cursor.getMonth() - minDate.getMonth();
    if (offset % tickStep !== 0) continue;
    const left = ((cursor - minDate) / dayMs) / spanDays * 100;
    const label = tickStep < 12 ? `${cursor.getFullYear()}/${String(cursor.getMonth() + 1).padStart(2, "0")}` : `${cursor.getFullYear()}年`;
    ticks.push(`<span class="gantt-tick" style="left:${left.toFixed(4)}%">${label}</span>`);
  }
  const html = [`<div class="gantt-axis"><div class="gantt-axis-label">キャンペーン / 商品区分</div><div class="gantt-axis-time" style="width:${chartWidth}px">${ticks.join("")}</div></div>`];
  groups.forEach((group) => {
    const start = parseIso(group.start);
    const end = parseIso(group.end);
    let bar = "";
    if (start) {
      const anomaly = end && end < start;
      const effectiveEnd = !end ? maxDate : anomaly ? start : end;
      let left = (start - minDate) / dayMs / spanDays * 100;
      let width = (effectiveEnd - start) / dayMs / spanDays * 100;
      left = Math.max(0, Math.min(100, left));
      width = anomaly ? 0.45 : Math.max(.35, Math.min(100 - left, width));
      const classes = ["gantt-bar", statusClass(group.status)];
      if (!end) classes.push("open-ended");
      if (anomaly) classes.push("date-anomaly");
      const rates = [...new Set(group.rows.map((row) => row.interest_rate).filter(Boolean))];
      const title = `${group.campaign} / ${group.start || "開始日不明"}～${group.end || "終了日未設定"}${rates.length ? ` / ${rates.slice(0, 4).join("・")}` : ""}`;
      bar = `<button type="button" class="${classes.join(" ")}" style="left:${left.toFixed(4)}%;width:${width.toFixed(4)}%" data-campaign-key="${esc(group.key)}" title="${esc(title)}" aria-label="${esc(title)}">${anomaly ? "" : esc(group.campaign)}</button>`;
    }
    html.push(`<div class="gantt-row" data-campaign-key="${esc(group.key)}"><div class="gantt-label" title="${esc(group.campaign)}">${esc(group.campaign)} <span class="muted">${esc(group.productType)}</span></div><div class="timeline" style="width:${chartWidth}px">${bar}</div></div>`);
  });
  target.innerHTML = html.join("");
  target.querySelectorAll(".gantt-bar").forEach((bar) => bar.addEventListener("click", () => {
    target.querySelectorAll(".gantt-row.is-selected").forEach((row) => row.classList.remove("is-selected"));
    bar.closest(".gantt-row")?.classList.add("is-selected");
    const key = bar.dataset.campaignKey;
    const row = [...document.querySelectorAll("#institutionCampaignBody tr")].find((candidate) => candidate.dataset.campaignKey === key);
    if (!row) return;
    row.classList.remove("institution-campaign-row-highlight");
    void row.offsetWidth;
    row.classList.add("institution-campaign-row-highlight");
    row.scrollIntoView({ behavior: "smooth", block: "center" });
  }));
}

function institutionDetailRenderBaseTable(baseRows) {
  const sorted = baseRows.slice().sort((a, b) => institutionDetailRowDate(b).localeCompare(institutionDetailRowDate(a)) || Number(b.rate_percent) - Number(a.rate_percent));
  document.querySelector("#institutionBaseRateCount").textContent = `${fmt(sorted.length)}明細。普通預金と店頭表示金利の履歴です。`;
  document.querySelector("#institutionBaseRateBody").innerHTML = sorted.length ? sorted.map((row) => {
    const referenceTags = [];
    if (row.reference_only) {
      if (row.tax_basis === "UNSPECIFIED") referenceTags.push("税区分未記載");
      if (row.tax_basis === "AFTER_TAX") referenceTags.push("税引後");
      if (row.base_rate_role === "SIMPLE_COMPOUND_SHARED_REFERENCE") referenceTags.push("単利・複利共通の掲載値");
      if (row.base_rate_role === "MULTIPLE_PRODUCT_RATE_REFERENCE") referenceTags.push("複数商品共通の掲載値");
      if (row.base_rate_role === "CORPORATE_DEPOSIT_REFERENCE") referenceTags.push("法人等向け");
      if (row.base_rate_role === "VARIABLE_RATE_REFERENCE") referenceTags.push("変動金利の掲載値");
      if (row.product_family === "MATURITY_DESIGNATED_TERM") referenceTags.push("期日指定・満期指定");
      if (row.product_family === "STRUCTURED_DEPOSIT") referenceTags.push("仕組預金・外貨で元本払戻の可能性");
      if (row.product_family === "INVESTMENT_LINKED_TERM") referenceTags.push("投資信託セット・定期部分の金利");
      if (row.product_family === "VARIABLE_TERM") referenceTags.push("変動金利");
      if (row.base_rate_role === "CLOSED_PRODUCT_REFERENCE") referenceTags.push("新規受付終了");
      if (row.base_rate_role === "RATE_COMPONENT_REFERENCE") referenceTags.push("金利の内訳・構成要素");
      if (/COMPOUND|YIELD/.test(String(row.base_rate_role) + String(row.rate_measure_type))) referenceTags.push("複利・利回りの掲載値");
      if (row.base_rate_role === "PRE_REVISION_REFERENCE") referenceTags.push("改定前・旧適用期間不明");
    }
    const eligible = row.reference_only ? "参考" + (referenceTags.length ? "・" + referenceTags.join(" / ") : "・条件付きの掲載値") : /^CURRENT_(STANDARD|CONDITIONAL)$/.test(row.comparison_category || "") ? "最高金利の比較対象・条件付き" : institutionDetailText(row.current_ranking_eligible) === "1" ? "標準比較対象" : "条件付き・履歴";
    return `<tr><td data-label="基準日">${esc(baseRateDateLabel(row) || "日付不明")}</td><td data-label="商品分類">${esc(institutionDetailProductCategory(row))}</td><td data-label="商品名">${esc(row.product_label || "—")}</td><td data-label="年限">${esc(institutionDetailTermLabel(row) || "—")}</td><td data-label="金利" class="rate">${institutionDetailPercent(institutionDetailRate(row), 5)}</td><td data-label="金額・条件">${esc(institutionDetailAmountLabel(row))}${row.eligibility_conditions ? `<br><small>${esc(row.eligibility_conditions)}</small>` : ""}</td><td data-label="比較区分">${esc(eligible)}</td><td data-label="公式資料">${institutionDetailUrl(row.source_url)}</td></tr>`;
  }).join("") : `<tr><td colspan="8" class="table-empty">普通預金・店頭金利の履歴はありません。</td></tr>`;
}

function institutionDetailInstitutionType(row) {
  const raw = institutionDetailText(row.institution_type || row.institution_type_normalized || row.institution_type_raw).trim();
  return typeof window.canonicalDepositInstitutionType === "function"
    ? window.canonicalDepositInstitutionType(raw, row.institution_name)
    : raw;
}

function institutionDetailNearbyCampaignGroups(name, prefecture) {
  const canonical = institutionDetailPrefecture(prefecture);
  if (!canonical || canonical === '全国') return [];
  const neighbors = new Set(INSTITUTION_NEIGHBOR_PREFECTURES[canonical] || []);
  const today = window.DepositRateComparison.todayInJapan();
  const banks = new Map();
  for (const row of state.records) {
    if (row.institution_name === name || effectiveStatus({...row,status:row._sourceStatus||row.status}) !== '開催中') continue;
    if (!['普通預金','普通貯金','定期預金','定期貯金'].includes(row.product_type)) continue;
    const pref = institutionDetailPrefecture(row.prefecture);
    const scope = pref === canonical ? 'same' : neighbors.has(pref) ? 'nearby' : '';
    if (!scope) continue;
    const key = [scope,row.institution_name,pref].join('\u241f');
    if (!banks.has(key)) banks.set(key,{key,scope,institution:row.institution_name,prefecture:pref,institutionType:institutionDetailInstitutionType(row)||'業態不明',rows:[]});
    banks.get(key).rows.push(row);
  }
  return [...banks.values()].map(bank=>{
    const model=institutionDetailCampaignMatrixGroups(bank.rows,today);
    return {...bank,model,highest:Math.max(-Infinity,...[...model.groups.values()].flat().map(item=>item.rate))};
  }).sort((a,b)=>b.highest-a.highest || a.institution.localeCompare(b.institution,'ja'));
}

function institutionDetailRenderNearby(name, prefecture) {
  const target=document.querySelector('#institutionNearbyCampaigns');
  if (!target) return;
  const canonical=institutionDetailPrefecture(prefecture);
  const all= institutionDetailNearbyCampaignGroups(name,canonical);
  const typeSelect=document.querySelector('#institutionNearbyTypeFilter');
  const order=Array.isArray(window.DEPOSIT_INSTITUTION_TYPE_ORDER)?window.DEPOSIT_INSTITUTION_TYPE_ORDER:[];
  const types=[...new Set(all.map(b=>b.institutionType))].sort((a,b)=>(order.includes(a)?order.indexOf(a):999)-(order.includes(b)?order.indexOf(b):999)||a.localeCompare(b,'ja'));
  if (typeSelect) {
    typeSelect.innerHTML='<option value="">すべての業態</option>'+types.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join('');
    if (!types.includes(institutionDetailState.nearbyInstitutionType)) institutionDetailState.nearbyInstitutionType='';
    typeSelect.value=institutionDetailState.nearbyInstitutionType;
  }
  const banks=all.filter(b=>!institutionDetailState.nearbyInstitutionType||b.institutionType===institutionDetailState.nearbyInstitutionType);
  const terms=new Map();
  for (const b of banks) for (const [key,term] of b.model.terms) terms.set(key,term);
  if (!terms.size) terms.set('term-12',{key:'term-12',label:'1年',order:372});
  const columns=[...terms.values()].sort((a,b)=>a.order-b.order);
  const typeLabel=institutionDetailState.nearbyInstitutionType||'すべての業態';
  document.querySelector('#institutionNearbyDescription').textContent=canonical&&canonical!=='全国'?`${canonical}・隣接県の${typeLabel}を、金融機関×預入年限で比較します。各セルは開催中キャンペーンの最高金利です。金利を選ぶと同年限の全キャンペーンを確認できます。`:'都道府県を特定できないため、同県・近隣の比較対象はありません。';
  const sections=[{scope:'same',title:`同県（${canonical||'都道府県不明'}）`},{scope:'nearby',title:'近隣県（隣接県）'}];
  function cell(bank,column) {
    const items=bank.model.groups.get(column.key)||[];
    if (!items.length) return '<td class="institution-nearby-missing">—<small>比較データなし</small></td>';
    return `<td><button type="button" class="institution-nearby-rate-button" data-nearby-bank="${esc(bank.key)}" data-nearby-term="${esc(column.key)}" aria-label="${esc(bank.institution)} ${esc(column.label)}のキャンペーン条件"><strong>${institutionDetailPercent(items[0].rate,5)}</strong><small>${items.length}明細・詳細を見る</small></button></td>`;
  }
  target.innerHTML=sections.map(section=>{
    const rows=banks.filter(b=>b.scope===section.scope);
    return `<section class="institution-nearby-group"><div class="institution-nearby-group-heading"><h4>${esc(section.title)}</h4><span>${rows.length}金融機関</span></div>${rows.length?`<div class="institution-nearby-matrix-scroll" tabindex="0" aria-label="${esc(section.title)}のキャンペーン金利比較表。横にスクロールできます。"><table class="institution-nearby-matrix"><caption>${esc(section.title)}・開催中キャンペーンの金利（年率％）</caption><thead><tr><th scope="col">金融機関</th>${columns.map(c=>`<th scope="col">${c.key==='ordinary'?'普通預金':`定期 ${esc(c.label)}`}</th>`).join('')}</tr></thead><tbody>${rows.map(bank=>`<tr><th scope="row"><button type="button" class="institution-table-link institution-detail-trigger" data-institution="${esc(bank.institution)}">${esc(bank.institution)}</button><small>${esc(bank.prefecture)} / ${esc(bank.institutionType)}</small></th>${columns.map(c=>cell(bank,c)).join('')}</tr>`).join('')}</tbody></table></div>`:'<div class="institution-nearby-empty">現在の条件に該当する金融機関はありません。</div>'}</section>`;
  }).join('')+`<p class="institution-nearby-matrix-note">同県・近隣県で同じ年限の列を表示します。金融機関は収録された最高金利の高い順です。対象者・金額帯は各商品で異なります。「—」は比較可能な金利がない状態で、金利ゼロを意味しません。開催予定・終了済み・外貨・税引後金利や、年限・金利が確定できない明細は集計に含めません。開催状況は収録データと表示日で判定しています。</p><div id="institutionNearbyRateEvidence" class="institution-current-rate-evidence" aria-live="polite"><p class="muted">表の金利を選ぶと、キャンペーン名・募集期間・条件をここに表示します。</p></div>`;
  target.querySelectorAll('[data-nearby-term]').forEach(button=>button.addEventListener('click',()=>{
    target.querySelectorAll('.institution-nearby-rate-button').forEach(b=>b.classList.toggle('is-selected',b===button));
    const bank=banks.find(b=>b.key===button.dataset.nearbyBank),term=columns.find(c=>c.key===button.dataset.nearbyTerm);
    if (!bank||!term) return;
    const normal=institutionDetailCurrentRateModel(bank.institution,institutionDetailBaseRows(bank.institution)).columns.find(c=>c.key===term.key);
    institutionDetailRenderMatrixCampaignEvidence({...term,standard:normal?.standard||null,campaigns:bank.model.groups.get(term.key)||[]},'#institutionNearbyRateEvidence',bank.institution);
  }));
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
  institutionDetailRenderCurrentRateMatrix(name, baseRows);
  institutionDetailRenderNearby(name, sample.prefecture || "");
  institutionDetailRenderTimeline(campaigns);
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
  if (institutionDetailState.institution !== name) {
    institutionDetailState.termKey = "all";
    institutionDetailState.nearbyInstitutionType = "";
  }
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
  const load = async (url) => {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  };
  try {
    const [monthly, daily] = await Promise.all([load(INSTITUTION_TIBOR_URL), load(INSTITUTION_TIBOR_DAILY_URL)]);
    institutionDetailState.tiborMetadata = monthly.metadata || {};
    institutionDetailState.tiborRecords = Array.isArray(monthly.records) ? monthly.records : [];
    institutionDetailState.tiborDailyMetadata = daily.metadata || {};
    institutionDetailState.tiborDailyRecords = Array.isArray(daily.records) ? daily.records : [];
  } catch (error) {
    institutionDetailState.tiborMetadata = {};
    institutionDetailState.tiborRecords = [];
    institutionDetailState.tiborDailyMetadata = {};
    institutionDetailState.tiborDailyRecords = [];
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
  document.querySelector("#institutionTermSelect")?.addEventListener("change", (event) => {
    institutionDetailState.termKey = event.target.value;
    renderInstitutionDetail();
  });
  document.querySelector("#institutionTiborTenor")?.addEventListener("change", (event) => {
    institutionDetailState.tiborTenor = event.target.value;
    renderInstitutionDetail();
  });
  document.querySelector("#institutionComparisonFrequency")?.addEventListener("change", (event) => {
    institutionDetailState.comparisonFrequency = event.target.value;
    renderInstitutionDetail();
  });
  document.querySelector("#institutionNearbyTypeFilter")?.addEventListener("change", (event) => {
    institutionDetailState.nearbyInstitutionType = event.target.value;
    const name = institutionDetailState.institution;
    const sample = institutionDetailCampaignRows(name)[0] || institutionDetailBaseRows(name)[0] || {};
    institutionDetailRenderNearby(name, sample.prefecture || "");
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

// Reuse the already loaded current-term snapshot, without an extra network request.
document.addEventListener('deposit-current-rates-ready', () => {
  const name = institutionDetailState.institution;
  if (!name) return;
  const rows = institutionDetailBaseRows(name);
  institutionDetailRenderSummary(name, institutionDetailCampaignRows(name), rows);
  institutionDetailRenderCurrentRateMatrix(name, rows);
});
