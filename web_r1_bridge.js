"use strict";

(() => {
  const R1 = {
    dataRoot: "./r1_data",
    mapUrl: "./r1_assets/japan-prefectures.svg",
    data: {},
    selectedTerm: 12,
    view: "base",
    loaded: false,
    error: "",
    mapSvgText: "",
    mapLoadError: "",
    analyticsMatrixMode: "base"
  };

  const $ = (sel, root=document) => root.querySelector(sel);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[c]);

  const num = (v) => {
    const s = String(v ?? "").replace(/[,%％\s]/g, "");
    const x = Number(s);
    return Number.isFinite(x) ? x : null;
  };

  const pick = (row, ...keys) => {
    for (const k of keys) {
      if (row && row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== "") return row[k];
    }
    return "";
  };

  const termMonths = (row) => {
    const direct = num(pick(row, "term_months", "term_month", "months"));
    if (direct !== null) return Math.round(direct);
    const label = String(pick(row, "term_label", "term", "預入期間・年限")).trim();
    let m = label.match(/(\d+)\s*(?:か月|ヶ月|ヵ月|カ月|月)/);
    if (m) return Number(m[1]);
    m = label.match(/(\d+)\s*年/);
    return m ? Number(m[1]) * 12 : null;
  };

  const rateValue = (row) => num(pick(
    row, "rate_percent", "effective_rate_percent", "resolved_effective_rate_percent",
    "effective_rate", "interest_rate_numeric", "interest_rate"
  ));

  const inst = (row) => String(pick(row, "institution_name", "金融機関名")).trim();
  const instType = (row) => String(pick(row, "institution_type", "金融機関種別")).trim();
  const pref = (row) => String(pick(row, "prefecture", "都道府県")).trim();
  const region = (row) => String(pick(row, "region", "地域")).trim();
  const sourceDate = (row) => String(pick(row, "source_as_of_date", "effective_from", "base_rate_source_date")).trim();

  const fmtRate = (v) => v === null || !Number.isFinite(v) ? "—" : `${v.toFixed(3).replace(/0+$/,"").replace(/\.$/,"")}%`;
  const fmt = (v) => Number(v || 0).toLocaleString("ja-JP");

  function isNetBank(row) {
    const t = instType(row);
    const p = pref(row);
    const r = region(row);
    return /ネット銀行|インターネット銀行/.test(t) || /全国/.test(p) || /全国/.test(r);
  }

  async function loadJson(name) {
    const res = await fetch(`${R1.dataRoot}/${name}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    return res.json();
  }

  function ensureShell() {
    if ($("#r1BridgeShell")) return;
    const shell = document.createElement("section");
    shell.id = "r1BridgeShell";
    shell.className = "r1-shell";
    shell.innerHTML = `
      <div class="r1-head">
        <div>
          <div class="r1-kicker">BASE RATE / EFFECTIVE RATE</div>
          <h2>通常金利・実効金利（R1）</h2>
          <p>R1完成版の通常金利DBと実効金利計算結果を表示します。既存のキャンペーン検索DBとは分離して読み込んでいます。</p>
        </div>
        <div id="r1ReleaseBadge" class="r1-release-badge">読込中</div>
      </div>
      <div id="r1Error" class="r1-error" hidden></div>
      <div id="r1Stats" class="r1-stats"></div>
      <div class="r1-toolbar">
        <div class="r1-switch" role="tablist" aria-label="R1表示">
          <button type="button" class="r1-switch-btn is-active" data-r1-view="base">通常金利ランキング</button>
          <button type="button" class="r1-switch-btn" data-r1-view="heat">都道府県平均</button>
          <button type="button" class="r1-switch-btn" data-r1-view="effective">キャンペーン実効金利</button>
        </div>
        <label>年限
          <select id="r1Term">
            <option value="6">6か月</option>
            <option value="12" selected>1年</option>
            <option value="36">3年</option>
            <option value="60">5年</option>
          </select>
        </label>
        <label>都道府県
          <select id="r1Pref"><option value="">全国</option></select>
        </label>
        <label>金融機関種別
          <select id="r1Type"><option value="">すべて</option></select>
        </label>
        <label class="r1-search">金融機関
          <input id="r1Search" type="search" placeholder="金融機関名で検索">
        </label>
      </div>
      <div id="r1Content"></div>
      <p class="r1-footnote">※ 通常金利ランキングはR1の current_default_ranking を使用。都道府県平均は金融機関ごとに1セルへ正規化したうえで平均し、ネット銀行は都道府県集計から除外して全国向け別枠で表示します。</p>
    `;

    const anchor =
      $(".workspace-tabs-shell")?.parentElement ||
      $("#rate-analytics")?.parentElement ||
      $("main") ||
      $("#app") ||
      document.body;
    anchor.appendChild(shell);

    shell.addEventListener("click", (e) => {
      const b = e.target.closest("[data-r1-view]");
      if (!b) return;
      R1.view = b.dataset.r1View;
      if (R1.view === "heat" && ![12,36,60].includes(R1.selectedTerm)) {
        R1.selectedTerm = 12;
        if ($("#r1Term")) $("#r1Term").value = "12";
      }
      shell.querySelectorAll("[data-r1-view]").forEach(x => x.classList.toggle("is-active", x === b));
      render();
    });
    $("#r1Term").addEventListener("change", (e) => { R1.selectedTerm = Number(e.target.value); render(); });
    $("#r1Pref").addEventListener("change", render);
    $("#r1Type").addEventListener("change", render);
    $("#r1Search").addEventListener("input", render);
  }

  function populateFilters() {
    const rows = R1.data.current || [];
    const prefs = [...new Set(rows.map(pref).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ja"));
    const types = [...new Set(rows.map(instType).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ja"));
    $("#r1Pref").innerHTML = `<option value="">全国</option>${prefs.map(x=>`<option>${esc(x)}</option>`).join("")}`;
    $("#r1Type").innerHTML = `<option value="">すべて</option>${types.map(x=>`<option>${esc(x)}</option>`).join("")}`;
  }

  function filteredBaseRows({ignorePref=false}={}) {
    const p = $("#r1Pref")?.value || "";
    const t = $("#r1Type")?.value || "";
    const q = ($("#r1Search")?.value || "").trim().toLowerCase();
    return (R1.data.current || []).filter(r => {
      if (termMonths(r) !== R1.selectedTerm) return false;
      if (!ignorePref && p && pref(r) !== p) return false;
      if (t && instType(r) !== t) return false;
      if (q && !inst(r).toLowerCase().includes(q)) return false;
      return rateValue(r) !== null;
    });
  }

  function representativeByInstitution(rows) {
    const map = new Map();
    for (const r of rows) {
      const name = inst(r);
      if (!name) continue;
      if (!map.has(name)) map.set(name, []);
      map.get(name).push(r);
    }
    return [...map.entries()].map(([name, rs]) => {
      const rates = rs.map(rateValue).filter(v => v !== null);
      return {
        institution_name: name,
        institution_type: instType(rs[0]),
        prefecture: pref(rs[0]),
        region: region(rs[0]),
        rate: rates.length ? rates.reduce((a,b)=>a+b,0)/rates.length : null,
        source_date: rs.map(sourceDate).filter(Boolean).sort().at(-1) || "",
        source_count: rs.length
      };
    }).filter(x => x.rate !== null);
  }

  function renderStats() {
    const st = R1.data.status || {};
    $("#r1ReleaseBadge").textContent = st.release_version ? `R1 ${st.release_version}` : "R1 RELEASE";
    const cards = [
      ["通常金利履歴", st.base_rate_history_record_count ?? (R1.data.history || []).length],
      ["金融機関", st.base_rate_institution_count ?? "128"],
      ["解決済みキャンペーン", st.resolved_campaign_count ?? (R1.data.resolved || []).length],
      ["history-linked", st.history_linked_campaign_count ?? (R1.data.historyLinked || []).length]
    ];
    $("#r1Stats").innerHTML = cards.map(([k,v]) => `<div class="r1-stat"><span>${esc(k)}</span><strong>${esc(fmt(v))}</strong></div>`).join("");
  }

  function renderBase() {
    const reps = representativeByInstitution(filteredBaseRows()).sort((a,b)=>b.rate-a.rate || a.institution_name.localeCompare(b.institution_name,"ja"));
    const max = 100;
    const shown = reps.slice(0,max);
    const rows = shown.map((r,i)=>`
      <tr>
        <td class="r1-rank">${i+1}</td>
        <td><strong>${esc(r.institution_name)}</strong><small>${esc(r.institution_type)} / ${esc(r.prefecture || "全国")}</small></td>
        <td class="r1-rate">${fmtRate(r.rate)}</td>
        <td>${esc(r.source_date || "—")}</td>
      </tr>`).join("");
    $("#r1Content").innerHTML = `
      <div class="r1-summaryline">${fmt(reps.length)}金融機関 / ${R1.selectedTerm/12 >= 1 ? (R1.selectedTerm/12)+"年" : R1.selectedTerm+"か月"} / 上位${Math.min(max,reps.length)}件</div>
      <div class="r1-table-wrap"><table class="r1-table"><thead><tr><th>順位</th><th>金融機関</th><th>通常金利</th><th>基準日</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="4" class="r1-empty">条件に一致する通常金利がありません。</td></tr>`}</tbody></table></div>`;
  }

  function heatColor(v,min,max) {
    if (!Number.isFinite(v)) return {bg:"#f1f4f8",fg:"#57657a"};
    const t = max > min ? Math.max(0,Math.min(1,(v-min)/(max-min))) : .5;
    const lo=[224,242,255], hi=[210,48,48];
    const rgb=lo.map((x,i)=>Math.round(x+(hi[i]-x)*t));
    const lum=(0.2126*rgb[0]+0.7152*rgb[1]+0.0722*rgb[2])/255;
    return {bg:`rgb(${rgb.join(",")})`,fg:lum<.55?"#fff":"#10223c"};
  }

  const PREF_CODE_TO_NAME = {
    "01":"北海道","02":"青森県","03":"岩手県","04":"宮城県","05":"秋田県","06":"山形県","07":"福島県",
    "08":"茨城県","09":"栃木県","10":"群馬県","11":"埼玉県","12":"千葉県","13":"東京都","14":"神奈川県",
    "15":"新潟県","16":"富山県","17":"石川県","18":"福井県","19":"山梨県","20":"長野県","21":"岐阜県",
    "22":"静岡県","23":"愛知県","24":"三重県","25":"滋賀県","26":"京都府","27":"大阪府","28":"兵庫県",
    "29":"奈良県","30":"和歌山県","31":"鳥取県","32":"島根県","33":"岡山県","34":"広島県","35":"山口県",
    "36":"徳島県","37":"香川県","38":"愛媛県","39":"高知県","40":"福岡県","41":"佐賀県","42":"長崎県",
    "43":"熊本県","44":"大分県","45":"宮崎県","46":"鹿児島県","47":"沖縄県"
  };

  const shortPref = (p) => p === "北海道" ? "北海道" : p.replace(/[都府県]$/,"");

  function mapTermLabel(months) {
    return months === 12 ? "1年" : months === 36 ? "3年" : months === 60 ? "5年" : `${months}か月`;
  }

  async function ensureMapSvg() {
    if (R1.mapSvgText) return R1.mapSvgText;
    try {
      const res = await fetch(R1.mapUrl, { cache: "force-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const svg = await res.text();
      if (!/geolonia-svg-map/.test(svg) || !/data-code=["']47["']/.test(svg)) {
        throw new Error("SVG structure validation failed");
      }
      R1.mapSvgText = svg;
      return svg;
    } catch (err) {
      R1.mapLoadError = String(err?.message || err);
      throw err;
    }
  }

  function heatDataset() {
    const base = representativeByInstitution(filteredBaseRows({ignorePref:true}));
    const local = base.filter(r => !isNetBank(r) && r.prefecture);
    const byPref = new Map();
    for (const r of local) {
      if (!byPref.has(r.prefecture)) byPref.set(r.prefecture, []);
      byPref.get(r.prefecture).push(r.rate);
    }
    const rows = [];
    for (const [p, arr] of byPref.entries()) {
      rows.push({
        prefecture: p,
        institutionCount: arr.length,
        averageRate: arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null
      });
    }
    const values = rows.map(x=>x.averageRate).filter(Number.isFinite);
    return {
      byPref,
      rows,
      min: values.length ? Math.min(...values) : 0,
      max: values.length ? Math.max(...values) : 0,
      nationwide: base.filter(isNetBank).sort((a,b)=>b.rate-a.rate)
    };
  }

  function setPrefShapesColor(group, bg) {
    const shapes = group.querySelectorAll("path, polygon, rect, circle, ellipse");
    if (shapes.length) {
      shapes.forEach(el => {
        el.style.fill = bg;
        el.style.stroke = "#ffffff";
        el.style.strokeWidth = "0.7";
        el.style.vectorEffect = "non-scaling-stroke";
      });
    } else {
      group.style.fill = bg;
      group.style.stroke = "#ffffff";
    }
  }

  function addPrefLabel(svg, group, code, rate, fg) {
    try {
      const box = group.getBBox();
      if (!box || !Number.isFinite(box.x) || box.width <= 0 || box.height <= 0) return;
      const p = PREF_CODE_TO_NAME[code];
      if (!p) return;
      const label = document.createElementNS("http://www.w3.org/2000/svg","text");
      label.setAttribute("x", String(box.x + box.width/2));
      label.setAttribute("y", String(box.y + box.height/2));
      label.setAttribute("text-anchor","middle");
      label.setAttribute("dominant-baseline","middle");
      label.setAttribute("class","r1-map-label");
      label.setAttribute("fill", fg);
      label.setAttribute("pointer-events","none");
      label.textContent = `${shortPref(p)} ${Number.isFinite(rate) ? fmtRate(rate) : "—"}`;
      svg.appendChild(label);
    } catch (_) {}
  }

  function attachMapTooltip(host, svg, stats) {
    let tip = host.querySelector(".r1-map-tooltip");
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "r1-map-tooltip";
      host.appendChild(tip);
    }
    const update = (e, p, avg, count) => {
      tip.innerHTML = `<strong>${esc(p)}</strong><span>${mapTermLabel(R1.selectedTerm)} 平均 ${avg===null?"—":fmtRate(avg)}</span><small>${count}金融機関</small>`;
      const rect = host.getBoundingClientRect();
      const x = Math.max(8, Math.min(rect.width - 170, e.clientX - rect.left + 12));
      const y = Math.max(8, Math.min(rect.height - 78, e.clientY - rect.top + 12));
      tip.style.transform = `translate(${x}px,${y}px)`;
      tip.classList.add("is-visible");
    };
    svg.querySelectorAll(".prefecture[data-code]").forEach(g => {
      const code = String(g.getAttribute("data-code") || "").padStart(2,"0");
      const p = PREF_CODE_TO_NAME[code];
      if (!p) return;
      const arr = stats.byPref.get(p) || [];
      const avg = arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null;
      g.setAttribute("role","button");
      g.setAttribute("tabindex","0");
      g.setAttribute("aria-label", `${p} ${mapTermLabel(R1.selectedTerm)}平均 ${avg===null?"データなし":fmtRate(avg)}`);
      g.addEventListener("mousemove", e => update(e,p,avg,arr.length));
      g.addEventListener("mouseenter", e => update(e,p,avg,arr.length));
      g.addEventListener("mouseleave", () => tip.classList.remove("is-visible"));
      g.addEventListener("focus", e => {
        const r = g.getBoundingClientRect();
        update({clientX:r.left+r.width/2,clientY:r.top+r.height/2},p,avg,arr.length);
      });
      g.addEventListener("blur", () => tip.classList.remove("is-visible"));
      g.addEventListener("click", () => {
        const prefSel = $("#r1Pref");
        if (prefSel && [...prefSel.options].some(o => o.value === p || o.textContent === p)) prefSel.value = p;
        R1.view = "base";
        document.querySelectorAll("[data-r1-view]").forEach(x => x.classList.toggle("is-active", x.dataset.r1View === "base"));
        render();
      });
    });
  }

  function renderOkinawaInset(host, svg, stats) {
    const okinawa = svg.querySelector('.prefecture[data-code="47"]');
    if (!okinawa) return;
    try {
      const box = okinawa.getBBox();
      const clone = okinawa.cloneNode(true);
      const inset = document.createElement("div");
      inset.className = "r1-okinawa-inset";
      const title = document.createElement("div");
      title.className = "r1-okinawa-title";
      const arr = stats.byPref.get("沖縄県") || [];
      const avg = arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null;
      title.textContent = `沖縄 ${avg===null?"—":fmtRate(avg)} / ${arr.length}先`;
      inset.appendChild(title);
      const mini = document.createElementNS("http://www.w3.org/2000/svg","svg");
      const padX = Math.max(1, box.width * .12);
      const padY = Math.max(1, box.height * .12);
      mini.setAttribute("viewBox", `${box.x-padX} ${box.y-padY} ${box.width+2*padX} ${box.height+2*padY}`);
      mini.setAttribute("aria-label","沖縄県拡大");
      mini.appendChild(clone);
      inset.appendChild(mini);
      host.appendChild(inset);
    } catch (_) {}
  }

  async function paintJapanMap(stats) {
    const host = $("#r1JapanMap");
    if (!host) return;
    try {
      const svgText = await ensureMapSvg();
      host.innerHTML = svgText;
      const svg = host.querySelector("svg");
      if (!svg) throw new Error("SVG root missing");
      svg.classList.add("r1-japan-svg");
      svg.setAttribute("role","img");
      svg.setAttribute("aria-label", `${mapTermLabel(R1.selectedTerm)} 通常金利 都道府県平均ヒートマップ`);

      const labels = [];
      svg.querySelectorAll(".prefecture[data-code]").forEach(g => {
        const code = String(g.getAttribute("data-code") || "").padStart(2,"0");
        const p = PREF_CODE_TO_NAME[code];
        if (!p) return;
        const arr = stats.byPref.get(p) || [];
        const avg = arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null;
        const c = avg === null ? {bg:"#eef2f6",fg:"#64748b"} : heatColor(avg,stats.min,stats.max);
        setPrefShapesColor(g,c.bg);
        labels.push({g,code,avg,fg:c.fg});
      });
      labels.forEach(x => addPrefLabel(svg,x.g,x.code,x.avg,x.fg));
      attachMapTooltip(host,svg,stats);
      renderOkinawaInset(host,svg,stats);
    } catch (err) {
      host.innerHTML = `<div class="r1-map-error">日本地図SVGを読み込めませんでした。${esc(String(err?.message||err))}</div>`;
    }
  }

  function renderHeat() {
    if (![12,36,60].includes(R1.selectedTerm)) {
      R1.selectedTerm = 12;
      if ($("#r1Term")) $("#r1Term").value = "12";
    }
    const stats = heatDataset();
    const chips = [12,36,60].map(m => `<button type="button" class="r1-map-term ${m===R1.selectedTerm?"is-active":""}" data-r1-map-term="${m}">${mapTermLabel(m)}</button>`).join("");
    const net = stats.nationwide;
    $("#r1Content").innerHTML = `
      <div class="r1-map-toolbar">
        <div>
          <strong>通常金利 都道府県平均</strong>
          <span>金融機関ごとに1セルへ正規化した平均</span>
        </div>
        <div class="r1-map-term-switch">${chips}</div>
      </div>
      <div class="r1-map-layout">
        <div>
          <div class="r1-map-legend">
            <span>低</span><i class="r1-map-gradient"></i><span>高</span>
            <b>${fmtRate(stats.min)}</b><span>～</span><b>${fmtRate(stats.max)}</b>
          </div>
          <div id="r1JapanMap" class="r1-japan-map"><div class="r1-map-loading">日本地図を描画中…</div></div>
        </div>
        <aside class="r1-map-side">
          <div class="r1-map-side-card">
            <h3>全国向け（ネット銀行等）</h3>
            <p>都道府県平均には含めません。</p>
            <div class="r1-netbank-list">
              ${net.length ? net.map((r,i)=>`<div><span>${i+1}. ${esc(r.institution_name)}</span><strong>${fmtRate(r.rate)}</strong></div>`).join("") : `<p>該当データなし</p>`}
            </div>
          </div>
          <div class="r1-map-side-card">
            <h3>集計状況</h3>
            <dl>
              <div><dt>年限</dt><dd>${mapTermLabel(R1.selectedTerm)}</dd></div>
              <div><dt>都道府県データ</dt><dd>${stats.rows.length} / 47</dd></div>
              <div><dt>最低平均</dt><dd>${fmtRate(stats.min)}</dd></div>
              <div><dt>最高平均</dt><dd>${fmtRate(stats.max)}</dd></div>
            </dl>
          </div>
        </aside>
      </div>
      <div class="r1-map-attribution">地図SVG: Geolonia japanese-prefectures（Wikipedia「日本地図.svg」を基礎、GFDL）。Web表示時はローカル保存SVGを使用します。</div>`;

    document.querySelectorAll("[data-r1-map-term]").forEach(b => {
      b.addEventListener("click", () => {
        R1.selectedTerm = Number(b.dataset.r1MapTerm);
        if ($("#r1Term")) $("#r1Term").value = String(R1.selectedTerm);
        renderHeat();
      });
    });
    paintJapanMap(stats);
  }

  function effectiveRate(row) {
    return num(pick(row,
      "effective_rate_percent","resolved_effective_rate_percent","effective_rate",
      "calculated_effective_rate_percent","interest_rate_numeric"
    ));
  }

  function renderEffective() {
    const p = $("#r1Pref")?.value || "";
    const q = ($("#r1Search")?.value || "").trim().toLowerCase();
    const t = $("#r1Type")?.value || "";
    const rows=(R1.data.resolved||[]).filter(r=>{
      const tm=termMonths(r);
      if (tm !== null && tm !== R1.selectedTerm) return false;
      if (p && pref(r) && pref(r)!==p) return false;
      if (t && instType(r) && instType(r)!==t) return false;
      if (q && !inst(r).toLowerCase().includes(q)) return false;
      return effectiveRate(r)!==null;
    }).sort((a,b)=>effectiveRate(b)-effectiveRate(a)).slice(0,100);

    const html=rows.map((r,i)=>{
      const campaign=pick(r,"campaign_name","キャンペーン名");
      const rateType=pick(r,"rate_type","campaign_rate_type");
      const base=num(pick(r,"base_rate_percent","matched_base_rate_percent","base_rate"));
      const spread=num(pick(r,"spread_percent","uplift_percent","rate_spread_percent"));
      return `<tr>
        <td class="r1-rank">${i+1}</td>
        <td><strong>${esc(inst(r))}</strong><small>${esc(campaign)}</small></td>
        <td>${esc(pick(r,"term_label","term","預入期間・年限") || "—")}</td>
        <td>${esc(rateType || "—")}</td>
        <td>${fmtRate(base)}</td>
        <td>${fmtRate(spread)}</td>
        <td class="r1-rate">${fmtRate(effectiveRate(r))}</td>
      </tr>`;
    }).join("");
    $("#r1Content").innerHTML=`
      <div class="r1-summaryline">解決済みキャンペーンの実効金利を表示。UNRESOLVED / 相当利回りは含めません。</div>
      <div class="r1-table-wrap"><table class="r1-table"><thead><tr><th>順位</th><th>金融機関 / キャンペーン</th><th>年限</th><th>型</th><th>基準金利</th><th>上乗せ</th><th>実効金利</th></tr></thead>
      <tbody>${html || `<tr><td colspan="7" class="r1-empty">条件に一致する実効金利がありません。</td></tr>`}</tbody></table></div>`;
  }

  function render() {
    if (!R1.loaded) return;
    renderStats();
    if (R1.view === "heat") renderHeat();
    else if (R1.view === "effective") renderEffective();
    else renderBase();
  }

  const R1_MATRIX_TERMS = [
    {months:6,label:"6か月"},
    {months:12,label:"1年"},
    {months:36,label:"3年"},
    {months:60,label:"5年"}
  ];
  const PREFECTURES_NORTH_TO_SOUTH = [
    "北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県","茨城県","栃木県","群馬県","埼玉県","千葉県",
    "東京都","神奈川県","新潟県","富山県","石川県","福井県","山梨県","長野県","岐阜県","静岡県","愛知県","三重県",
    "滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県","鳥取県","島根県","岡山県","広島県","山口県","徳島県",
    "香川県","愛媛県","高知県","福岡県","佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県"
  ];

  function amountMinValue(row) {
    const candidates = [
      pick(row,"amount_min","amount_min_yen","minimum_amount","deposit_amount_min")
    ];
    for (const v of candidates) {
      const x = num(v);
      if (x !== null) return x;
    }
    return null;
  }

  function rateTypeValue(row) {
    return String(pick(row,"rate_type","campaign_rate_type","effective_rate_type")).trim();
  }

  function productTypeValue(row) {
    return String(pick(row,"product_type","商品区分")).trim();
  }

  function representativeBaseCell(rows) {
    const valid = rows.map(r => ({row:r,rate:rateValue(r),amountMin:amountMinValue(r)}))
      .filter(x => x.rate !== null);
    if (!valid.length) return {rate:null,status:"NO_RATE",rows:0};
    const distinct = [...new Set(valid.map(x => x.rate.toFixed(9)))];
    if (distinct.length === 1) {
      return {rate:valid[0].rate,status:"CONSENSUS",rows:valid.length};
    }
    const withAmount = valid.filter(x => x.amountMin !== null)
      .sort((a,b)=>a.amountMin-b.amountMin || a.rate-b.rate);
    if (withAmount.length) {
      const minAmt = withAmount[0].amountMin;
      const smallest = withAmount.filter(x => x.amountMin === minAmt);
      const rates = [...new Set(smallest.map(x => x.rate.toFixed(9)))];
      if (rates.length === 1) {
        return {rate:smallest[0].rate,status:"SMALL_STANDARD_BAND",rows:valid.length,amountMin:minAmt};
      }
    }
    return {rate:null,status:"AMBIGUOUS_AMOUNT_BANDS",rows:valid.length};
  }

  function effectiveCell(rows) {
    const valid = rows.filter(r => {
      const rt = rateTypeValue(r);
      if (/EQUIVALENT_RETURN/i.test(rt)) return false;
      return effectiveRate(r) !== null;
    });
    if (!valid.length) return {rate:null,status:"NO_RATE",rows:0};
    const best = valid.slice().sort((a,b)=>effectiveRate(b)-effectiveRate(a))[0];
    return {
      rate:effectiveRate(best),
      status:"MAX_EFFECTIVE",
      rows:valid.length,
      campaign:pick(best,"campaign_name","キャンペーン名"),
      rateType:rateTypeValue(best)
    };
  }

  function matrixFilters() {
    const ownPref = $("#r1MatrixPref")?.value || "";
    const ownType = $("#r1MatrixType")?.value || "";
    const existingRegions = $("#analyticsRegionFilter")
      ? Array.from($("#analyticsRegionFilter").selectedOptions).map(o=>o.value).filter(Boolean)
      : [];
    const existingProducts = $("#analyticsProductFilter")
      ? Array.from($("#analyticsProductFilter").selectedOptions).map(o=>o.value).filter(Boolean)
      : [];
    const displayMode = $("#analyticsDisplayMode")?.value === "all" ? "all" : "top5";
    return {prefecture:ownPref,institutionType:ownType,regions:new Set(existingRegions),products:new Set(existingProducts),displayMode};
  }

  function buildR1Matrix(mode) {
    const f = matrixFilters();
    const source = mode === "effective" ? (R1.data.resolved || []) : (R1.data.current || []);
    const cellRows = new Map();
    const institutionMeta = new Map();
    let excludedEquivalent = 0;
    let ambiguousBase = 0;

    source.forEach(r => {
      const name = inst(r);
      if (!name) return;
      if (f.prefecture && pref(r) !== f.prefecture) return;
      if (f.institutionType && instType(r) !== f.institutionType) return;
      if (f.regions.size && region(r) && !f.regions.has(region(r))) return;
      if (mode === "effective" && f.products.size) {
        const pt = productTypeValue(r);
        if (pt && !f.products.has(pt)) return;
      }
      if (mode === "effective" && /EQUIVALENT_RETURN/i.test(rateTypeValue(r))) {
        excludedEquivalent++;
        return;
      }
      const tm = termMonths(r);
      if (!R1_MATRIX_TERMS.some(t => t.months === tm)) return;
      const key = `${name}|||${tm}`;
      if (!cellRows.has(key)) cellRows.set(key, []);
      cellRows.get(key).push(r);
      if (!institutionMeta.has(name)) {
        institutionMeta.set(name,{name,prefecture:pref(r),region:region(r),institutionType:instType(r)});
      }
    });

    const cells = new Map();
    const termStats = new Map(R1_MATRIX_TERMS.map(t => [t.months,[]]));
    institutionMeta.forEach((meta,name) => {
      R1_MATRIX_TERMS.forEach(t => {
        const rows = cellRows.get(`${name}|||${t.months}`) || [];
        const cell = mode === "effective" ? effectiveCell(rows) : representativeBaseCell(rows);
        if (mode === "base" && cell.status === "AMBIGUOUS_AMOUNT_BANDS") ambiguousBase++;
        cells.set(`${name}|||${t.months}`,cell);
        if (cell.rate !== null) termStats.get(t.months).push({institution:name,rate:cell.rate,cell});
      });
    });

    const stats = {};
    R1_MATRIX_TERMS.forEach(t => {
      const arr = termStats.get(t.months);
      const rates = arr.map(x=>x.rate);
      const max = rates.length ? Math.max(...rates) : null;
      const topNames = max === null ? [] : arr.filter(x=>Math.abs(x.rate-max)<1e-12).map(x=>x.institution);
      stats[t.months] = {
        count:arr.length,
        average:rates.length ? rates.reduce((a,b)=>a+b,0)/rates.length : null,
        maximum:max,
        maximumInstitutions:topNames
      };
    });

    let institutions = [...institutionMeta.keys()];
    const rowScore = name => Math.max(...R1_MATRIX_TERMS.map(t => cells.get(`${name}|||${t.months}`)?.rate ?? -Infinity));
    institutions.sort((a,b)=>rowScore(b)-rowScore(a) || a.localeCompare(b,"ja"));

    if (f.displayMode === "top5") {
      const wanted = new Set();
      R1_MATRIX_TERMS.forEach(t => {
        const ranked = termStats.get(t.months).slice().sort((a,b)=>b.rate-a.rate || a.institution.localeCompare(b.institution,"ja"));
        ranked.slice(0,5).forEach(x=>wanted.add(x.institution));
      });
      institutions = institutions.filter(x=>wanted.has(x));
    }

    return {mode,filters:f,institutions,institutionMeta,cells,stats,excludedEquivalent,ambiguousBase};
  }

  function r1MatrixCellHtml(model,name,term) {
    const c = model.cells.get(`${name}|||${term.months}`) || {rate:null,status:"NO_RATE"};
    if (c.rate === null) {
      const note = c.status === "AMBIGUOUS_AMOUNT_BANDS" ? "金額帯要確認" : "—";
      return `<td class="r1-matrix-cell is-empty"><span>${esc(note)}</span></td>`;
    }
    const detail = model.mode === "effective"
      ? `${c.rows}件${c.campaign ? ` / ${c.campaign}` : ""}`
      : `${c.status === "CONSENSUS" ? "代表金利" : "標準小口帯"}${c.rows>1 ? ` / ${c.rows}行` : ""}`;
    return `<td class="r1-matrix-cell"><strong>${fmtRate(c.rate)}</strong><small title="${esc(detail)}">${esc(detail)}</small></td>`;
  }

  function r1MatrixHtml(model) {
    const averageCards = R1_MATRIX_TERMS.map(t => {
      const s = model.stats[t.months];
      const names = s.maximumInstitutions.length > 2 ? `${s.maximumInstitutions.slice(0,2).join("・")}ほか` : s.maximumInstitutions.join("・");
      return `<article class="r1-matrix-stat">
        <h4>${esc(t.label)}</h4>
        <div><span>最高</span><strong>${fmtRate(s.maximum)}</strong><small>${esc(names || "—")}</small></div>
        <div><span>平均</span><strong>${fmtRate(s.average)}</strong><small>${fmt(s.count)}金融機関</small></div>
      </article>`;
    }).join("");

    const body = model.institutions.length ? model.institutions.map(name => {
      const meta = model.institutionMeta.get(name);
      return `<tr>
        <th scope="row"><strong>${esc(name)}</strong><small>${esc(meta?.institutionType || "")}${meta?.prefecture ? ` / ${esc(meta.prefecture)}` : ""}</small></th>
        ${R1_MATRIX_TERMS.map(t => r1MatrixCellHtml(model,name,t)).join("")}
      </tr>`;
    }).join("") : `<tr><td colspan="5" class="r1-empty">条件に一致するR1比較データがありません。</td></tr>`;

    const baseNote = model.mode === "base"
      ? `通常金利は同一金融機関・同一年限を1セルへ正規化。判定不能な金額帯 ${fmt(model.ambiguousBase)}セルは推測せず要確認。`
      : `実効金利は解決済みデータのみ。各金融機関・年限の最高実効金利を表示。相当利回り除外 ${fmt(model.excludedEquivalent)}件。`;

    return `<div class="r1-analytics-matrix-summary">
      <span>${model.filters.displayMode === "all" ? `全${fmt(model.institutions.length)}金融機関` : `各年限上位5の金融機関集合 ${fmt(model.institutions.length)}先`}</span>
      <span>${esc(baseNote)}</span>
    </div>
    <div class="r1-matrix-stat-grid">${averageCards}</div>
    <p class="r1-matrix-scroll-hint">横にスクロールして6か月・1年・3年・5年を比較できます。金融機関名は左端に固定されます。</p>
    <div class="r1-matrix-scroll"><table class="r1-analytics-matrix">
      <thead><tr><th>金融機関</th>${R1_MATRIX_TERMS.map(t=>`<th>${esc(t.label)}</th>`).join("")}</tr></thead>
      <tbody>${body}</tbody>
    </table></div>`;
  }

  function populateR1MatrixFilters(shell) {
    const source = [...(R1.data.current||[]),...(R1.data.resolved||[])];
    const availablePrefs = new Set(source.map(pref).filter(Boolean));
    const prefs = PREFECTURES_NORTH_TO_SOUTH.filter(p=>availablePrefs.has(p));
    const types = [...new Set(source.map(instType).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ja"));
    const prefSel = shell.querySelector("#r1MatrixPref");
    const typeSel = shell.querySelector("#r1MatrixType");
    if (prefSel && prefSel.options.length <= 1) {
      prefSel.innerHTML = `<option value="">全国</option>${prefs.map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join("")}`;
    }
    if (typeSel && typeSel.options.length <= 1) {
      typeSel.innerHTML = `<option value="">すべて</option>${types.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join("")}`;
    }
  }

  function renderR1AnalyticsMatrix() {
    const host = $("#r1AnalyticsMatrixBody");
    if (!host || !R1.loaded) return;
    const model = buildR1Matrix(R1.analyticsMatrixMode);
    host.innerHTML = r1MatrixHtml(model);
    document.querySelectorAll("[data-r1-matrix-mode]").forEach(b => {
      b.classList.toggle("is-active", b.dataset.r1MatrixMode === R1.analyticsMatrixMode);
    });
  }

  function ensureR1AnalyticsMatrixShell() {
    const analyticsResults = $("#analyticsResults");
    if (!analyticsResults || !R1.loaded) return;
    let shell = $("#r1AnalyticsMatrixShell");
    if (!shell) {
      shell = document.createElement("section");
      shell.id = "r1AnalyticsMatrixShell";
      shell.className = "r1-analytics-matrix-shell";
      shell.innerHTML = `
        <div class="r1-analytics-matrix-head">
          <div>
            <div class="r1-kicker">R1 MATRIX</div>
            <h3>R1 金利比較マトリクス</h3>
            <p>既存のキャンペーン金利マトリクスと同じ6か月・1年・3年・5年の比較軸で、通常金利と解決済み実効金利を比較します。</p>
          </div>
          <div class="r1-matrix-mode-switch">
            <button type="button" class="r1-matrix-mode is-active" data-r1-matrix-mode="base">通常金利</button>
            <button type="button" class="r1-matrix-mode" data-r1-matrix-mode="effective">実効金利</button>
          </div>
        </div>
        <div class="r1-matrix-filterbar">
          <label>都道府県<select id="r1MatrixPref"><option value="">全国</option></select></label>
          <label>金融機関種別<select id="r1MatrixType"><option value="">すべて</option></select></label>
          <span class="r1-matrix-inherit-note">地域・商品・表示件数は上の既存分析条件を参照します。</span>
        </div>
        <div id="r1AnalyticsMatrixBody"></div>`;
      analyticsResults.insertAdjacentElement("afterend",shell);
      shell.addEventListener("click", e => {
        const b=e.target.closest("[data-r1-matrix-mode]");
        if (!b) return;
        R1.analyticsMatrixMode=b.dataset.r1MatrixMode;
        renderR1AnalyticsMatrix();
      });
      shell.addEventListener("change", e => {
        if (e.target.matches("#r1MatrixPref,#r1MatrixType")) renderR1AnalyticsMatrix();
      });
      populateR1MatrixFilters(shell);
    }
    renderR1AnalyticsMatrix();
  }

  function bindExistingAnalyticsR1Sync() {
    const targets = ["#analyticsRegionFilter","#analyticsProductFilter","#analyticsDisplayMode","#analyticsDateFrom","#analyticsDateTo"];
    targets.forEach(sel => {
      const el=$(sel);
      if (el && !el.dataset.r1MatrixBound) {
        el.dataset.r1MatrixBound="1";
        el.addEventListener("change", () => window.setTimeout(renderR1AnalyticsMatrix,0));
      }
    });
    const analyticsResults=$("#analyticsResults");
    if (analyticsResults && !analyticsResults.dataset.r1ObserverBound) {
      analyticsResults.dataset.r1ObserverBound="1";
      const obs=new MutationObserver(()=>window.setTimeout(ensureR1AnalyticsMatrixShell,0));
      obs.observe(analyticsResults,{childList:true,subtree:false});
    }
  }

  function initR1AnalyticsMatrixIntegration() {
    ensureR1AnalyticsMatrixShell();
    bindExistingAnalyticsR1Sync();
  }

  async function init() {
    ensureShell();
    try {
      const [status, current, history, resolved, historyLinked] = await Promise.all([
        loadJson("release_status.json"),
        loadJson("current_default_ranking.json"),
        loadJson("base_rate_history.json"),
        loadJson("campaign_effective_rate_resolved.json"),
        loadJson("campaign_effective_rate_history_linked.json")
      ]);
      R1.data = {status,current,history,resolved,historyLinked};
      R1.loaded = true;
      populateFilters();
      render();
      initR1AnalyticsMatrixIntegration();
    } catch (err) {
      R1.error = String(err?.message || err);
      const box=$("#r1Error");
      box.hidden=false;
      box.textContent=`R1データを読み込めませんでした: ${R1.error}`;
      $("#r1ReleaseBadge").textContent="読込エラー";
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();