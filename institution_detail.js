"use strict";

const INSTITUTION_TIBOR_URL = "tibor_monthly.json?v=20261028-3";
const INSTITUTION_TIBOR_DAILY_URL = "tibor_daily.json?v=20261028-2";
const institutionDetailState = {
  institution: "",
  tiborMetadata: {},
  tiborRecords: [],
  tiborDailyMetadata: {},
  tiborDailyRecords: [],
  seriesKey: "",
  termKey: "all",
  tiborTenor: "one_month"
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
      date: row.campaign_start_date,
      rate: row._comparableRate,
      label: `${row.campaign_name} / ${row.term || "年限記載なし"}`,
      source: row.product_url
    })));
  }
  const base = baseRows.filter((row) => {
    const rate = institutionDetailRate(row);
    const usableHistory = institutionDetailText(row.record_eligible) !== "0" || institutionDetailText(row.history_date_eligible) === "1";
    return rate != null && rate >= 0 && rate <= 10 && usableHistory;
  });
  const selected = seriesKey === "ordinary"
    ? base.filter((row) => institutionDetailFamily(row) === "ORDINARY_DEPOSIT")
    : base.filter((row) => institutionDetailFamily(row).includes("STANDARD_TERM") || institutionDetailFamily(row).includes("TIME_DEPOSIT"));
  return institutionDetailGroupedPoints(selected.map((row) => {
    const rawCondition = institutionDetailText(row.amount_band || row.evidence_context);
    return {
      date: institutionDetailDate(row),
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
  const useDaily = institutionDetailState.seriesKey === "campaign";
  return points.map((point) => ({ ...point, tibor: institutionDetailTiborForDate(point.date, institutionDetailState.tiborTenor, useDaily) }));
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
  const stepped = institutionDetailState.seriesKey === "campaign";
  const line = (items, accessor) => {
    const valid = items.filter((item) => Number.isFinite(accessor(item)));
    return valid.map((item, index) => {
      const px = x(item.time).toFixed(1);
      const py = y(accessor(item)).toFixed(1);
      if (!index) return `M${px},${py}`;
      return stepped ? `H${px} V${py}` : `L${px},${py}`;
    }).join(" ");
  };
  const depositPath = line(parsed, (point) => point.rate);
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
    ${xTicks.map((tick) => `<text class="institution-axis-label" x="${x(tick.time)}" y="${height - 24}" text-anchor="middle">${esc(tick.date.slice(0, 7))}</text>`).join("")}
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
      <span>${isCampaign ? "キャンペーン開始日" : "基準日"}：${esc(point.date)}</span>
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
  if (institutionDetailState.seriesKey !== "campaign") {
    target.innerHTML = "";
    target.classList.add("hidden");
    return;
  }
  const compared = points.filter((point) => point.tibor && Number.isFinite(point.rate)).slice().reverse();
  target.classList.remove("hidden");
  const termSelect = document.querySelector("#institutionTermSelect");
  const selectedTerm = termSelect?.selectedOptions?.[0]?.textContent || "全年限";
  target.innerHTML = `<h4>キャンペーン開始日ごとのTIBOR差</h4>
    <p>${institutionDetailState.termKey === "all" ? "同じ開始日に複数年限がある場合は、その日の最高キャンペーン金利を表示します。" : `${esc(selectedTerm)}に絞り込み、同じ開始日の最高キャンペーン金利を表示します。`}</p>
    <div class="institution-spread-table-wrap"><table class="institution-spread-table"><thead><tr><th>キャンペーン開始日</th><th>キャンペーン金利</th><th>採用TIBOR日</th><th>TIBOR</th><th>金利差</th><th>商品・年限</th></tr></thead><tbody>
      ${compared.map((point) => {
        const spread = point.rate - point.tibor.value;
        const basis = point.tibor.exact ? point.tibor.date : `${point.tibor.date}（直前営業日）`;
        return `<tr><td>${esc(point.date)}</td><td class="rate">${institutionDetailPercent(point.rate)}</td><td>${esc(basis)}</td><td>${institutionDetailPercent(point.tibor.value)}</td><td class="rate ${spread >= 0 ? "positive" : "negative"}">${spread >= 0 ? "+" : ""}${Math.round(spread * 100)}bp</td><td>${esc(point.label)}</td></tr>`;
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
  note.innerHTML = meta.period_start
    ? `通常金利は、<a href="${esc(meta.source_page)}" target="_blank" rel="noopener noreferrer">全銀協TIBOR運営機関の公式履歴</a>から作成した${esc(meta.period_start)}～${esc(meta.period_end)}の月次算術平均と比較します。キャンペーン預金は開始日の日次TIBORと比較し、開始日が非公表日・休業日の場合のみ直前営業日を採用します（日次データ ${esc(dailyMeta.period_start || "—")}～${esc(dailyMeta.period_end || "—")}）。金利差は「預金金利－TIBOR」で、100bp＝1％ポイントです。比較は参考値です。チャートは年10％超を除外しますが、明細表には表示します。公式資料には再配信時の問い合わせ案内があります。`
    : `TIBOR比較データを読み込めませんでした。<a href="https://www.jbatibor.or.jp/rate/log.html" target="_blank" rel="noopener noreferrer">公式履歴</a>をご確認ください。`;
}

function institutionDetailRenderSummary(name, campaigns, baseRows) {
  const active = campaigns.filter((row) => ["開催中", "開催予定"].includes(row.status));
  const ordinary = institutionDetailLatest(baseRows, (row) => {
    const isOrdinary = institutionDetailFamily(row) === "ORDINARY_DEPOSIT";
    const isStandard = institutionDetailText(row.base_rate_role) === "STANDARD_BASE_RATE" || institutionDetailText(row.current_ranking_eligible) === "1";
    const usableHistory = institutionDetailText(row.record_eligible) !== "0" || institutionDetailText(row.history_date_eligible) === "1";
    return isOrdinary && isStandard && usableHistory;
  });
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
  if (institutionDetailState.institution !== name) institutionDetailState.termKey = "all";
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
