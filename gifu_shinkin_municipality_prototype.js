"use strict";

(() => {
  const DATA_URL = "./r1_assets/gifu_municipalities.geojson?v=20261114-1";
  const BRANCH_URL = "./r1_assets/gifu_shinkin_branch_coverage.json?v=20261114-1";
  const FSA_SOURCE = "https://www.fsa.go.jp/menkyo/menkyoj/shinkin.pdf";
  const MAP_SOURCE = "https://github.com/geolonia/japanese-admins";
  const HEADQUARTERS = {
    "岐阜信用金庫": { code: "21201", municipality: "岐阜市", address: "岐阜県岐阜市神田町6-11" },
    "大垣西濃信用金庫": { code: "21202", municipality: "大垣市", address: "岐阜県大垣市恵比寿町1-1" },
    "高山信用金庫": { code: "21203", municipality: "高山市", address: "岐阜県高山市下一之町63" },
    "東濃信用金庫": { code: "21204", municipality: "多治見市", address: "岐阜県多治見市本町2-5-1" },
    "関信用金庫": { code: "21205", municipality: "関市", address: "岐阜県関市東貸上12-1" },
    "八幡信用金庫": { code: "21219", municipality: "郡上市", address: "岐阜県郡上市八幡町新町968-1" }
  };

  let geoPromise = null;
  let branchPromise = null;
  let selectedMunicipality = "";
  let selectedLocationMode = "branches";

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
  const formatRate = (value) => Number.isFinite(value)
    ? `${Number(value.toFixed(3)).toLocaleString("ja-JP", { maximumFractionDigits: 3 })}%`
    : "—";
  const average = (values) => {
    const valid = values.filter(Number.isFinite);
    return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
  };

  const style = document.createElement("style");
  style.id = "gifuShinkinMunicipalityPrototypeStyle";
  style.textContent = `
    .municipality-prototype{margin-top:1rem;border-top:1px solid #d8e2ef;padding-top:1rem}
    .municipality-prototype-head{display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;margin-bottom:.85rem}
    .municipality-prototype-head h4{margin:.15rem 0 .25rem;font-size:1.05rem;color:#123b70}
    .municipality-prototype-head p{margin:0}
    .municipality-prototype-badge{flex:0 0 auto;border:1px solid #9dc2f7;background:#eaf3ff;color:#1d5aa7;border-radius:999px;padding:.35rem .65rem;font-size:.72rem;font-weight:800}
    .municipality-mode-row{display:flex;align-items:center;justify-content:space-between;gap:.75rem;margin:.7rem 0 .85rem;padding:.65rem .75rem;border:1px solid #d7e2ef;border-radius:11px;background:#f8fbff}
    .municipality-mode-row>span{font-size:.75rem;font-weight:800;color:#41546c}
    .municipality-mode-switch{display:flex;gap:.3rem;padding:.22rem;border:1px solid #cbd9e9;border-radius:9px;background:#fff}
    .municipality-mode-button{border:0;background:transparent;color:#53657c;border-radius:7px;padding:.42rem .72rem;font-size:.75rem;font-weight:800;cursor:pointer}
    .municipality-mode-button.is-active{background:#1759b7;color:#fff;box-shadow:0 2px 6px rgba(23,89,183,.22)}
    .municipality-prototype-layout{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(250px,.8fr);gap:.9rem}
    .municipality-map-card,.municipality-ranking-card,.municipality-selected-card{border:1px solid #d7e2ef;border-radius:12px;background:#fff;overflow:hidden}
    .municipality-map-toolbar{display:flex;justify-content:space-between;align-items:center;gap:.75rem;padding:.65rem .8rem;border-bottom:1px solid #e4ebf4;background:#f8fbff;font-size:.76rem;color:#53657c}
    .municipality-map-legend{display:flex;align-items:center;gap:.4rem;white-space:nowrap}
    .municipality-map-gradient{width:112px;height:9px;border-radius:999px;background:linear-gradient(90deg,#2166ac 0%,#4393c3 12.5%,#92c5de 25%,#d1e5f0 37.5%,#f7f7f7 50%,#fddbc7 62.5%,#f4a582 75%,#d6604d 87.5%,#b2182b 100%)}
    .municipality-map{display:block;width:100%;height:auto;min-height:390px;background:#f4f8fc}
    .municipality-shape{fill:#e5ebf2;stroke:#fff;stroke-width:1.1;vector-effect:non-scaling-stroke;transition:filter .15s,stroke .15s,stroke-width .15s;cursor:default}
    .municipality-shape.has-data{cursor:pointer}
    .municipality-shape.has-data:hover,.municipality-shape.has-data:focus{filter:brightness(.93);stroke:#0f3d77;stroke-width:2;outline:none}
    .municipality-shape.is-selected{stroke:#f59e0b;stroke-width:3;filter:drop-shadow(0 1px 2px rgba(15,61,119,.28))}
    .municipality-label{font-size:10px;font-weight:800;fill:#123b70;text-anchor:middle;paint-order:stroke;stroke:#fff;stroke-width:3px;stroke-linejoin:round;pointer-events:none}
    .municipality-ranking-card{display:flex;flex-direction:column;min-height:390px}
    .municipality-ranking-title{padding:.7rem .8rem;border-bottom:1px solid #e4ebf4;background:#f8fbff}
    .municipality-ranking-title strong{display:block;color:#123b70;font-size:.88rem}
    .municipality-ranking-title span{font-size:.72rem;color:#67788f}
    .municipality-ranking-list{overflow:auto;max-height:430px;padding:.35rem}
    .municipality-ranking-row{width:100%;display:grid;grid-template-columns:26px minmax(0,1fr) auto;gap:.45rem;align-items:center;border:1px solid transparent;background:transparent;border-radius:9px;padding:.48rem .52rem;text-align:left;color:#1e3048;cursor:pointer}
    .municipality-ranking-row:hover,.municipality-ranking-row:focus{background:#eef5ff;outline:none}
    .municipality-ranking-row.is-selected{border-color:#f5b84c;background:#fff7e8}
    .municipality-ranking-row .rank{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;background:#eaf2fd;color:#1d5aa7;font-size:.68rem;font-weight:800}
    .municipality-ranking-row .name{font-weight:800;font-size:.8rem}
    .municipality-ranking-row .meta{display:block;font-size:.66rem;font-weight:500;color:#6c7b8e;margin-top:.1rem}
    .municipality-ranking-row .rate{font-weight:900;color:#075e97;font-size:.84rem}
    .municipality-selected-card{margin-top:.85rem}
    .municipality-selected-head{display:flex;justify-content:space-between;gap:.75rem;align-items:center;padding:.7rem .85rem;background:#f8fbff;border-bottom:1px solid #e4ebf4}
    .municipality-selected-head h5{margin:0;color:#123b70;font-size:.9rem}
    .municipality-selected-head span{font-size:.73rem;color:#607188}
    .municipality-source-note{font-size:.7rem;color:#68788d;margin:.65rem 0 0;line-height:1.55}
    .municipality-source-note a{color:#1d5aa7}
    @media (max-width:900px){.municipality-prototype-layout{grid-template-columns:1fr}.municipality-ranking-card{min-height:0}.municipality-ranking-list{max-height:260px}.municipality-map{min-height:320px}}
    @media (max-width:600px){.municipality-prototype-head{display:block}.municipality-prototype-badge{display:inline-block;margin-top:.6rem}.municipality-mode-row,.municipality-map-toolbar{align-items:flex-start;flex-direction:column}.municipality-map{min-height:270px}}
  `;
  if (!document.getElementById("aichiShinkinMunicipalityPrototypeStyle")) document.head.appendChild(style);

  function loadGeoJson() {
    if (!geoPromise) {
      geoPromise = fetch(DATA_URL).then((response) => {
        if (!response.ok) throw new Error(`市区町村境界を取得できませんでした（${response.status}）`);
        return response.json();
      });
    }
    return geoPromise;
  }

  function loadBranchData() {
    if (!branchPromise) {
      branchPromise = fetch(BRANCH_URL).then((response) => {
        if (!response.ok) throw new Error(`支店所在地マスターを取得できませんでした（${response.status}）`);
        return response.json();
      });
    }
    return branchPromise;
  }

  function institutionType(item) {
    return item.institution_type || item.records?.[0]?.institution_type || "";
  }

  function buildMunicipalities(item, branchData, geoJson, data) {
    const headquartersInstitutions = (item?.institutions || [])
      .filter((institution) => institutionType(institution) === "信用金庫")
      .filter((institution) => Number.isFinite(institution.averageRate));
    const branchInstitutions = (data?.selectedTypeRankingInstitutions || data?.regionalInstitutions || [])
      .filter((institution) => institutionType(institution) === "信用金庫")
      .filter((institution) => Number.isFinite(institution.averageRate));
    const institutions = selectedLocationMode === "branches" ? branchInstitutions : headquartersInstitutions;
    const institutionMap = new Map(institutions.map((institution) => [institution.institution, institution]));
    const nameByCode = new Map((geoJson?.features || []).map((feature) => [feature.properties.code, String(feature.properties.name || "").replace(/^岐阜県/, "")]));
    const grouped = new Map();
    if (selectedLocationMode === "headquarters") {
      institutions.map((institution) => ({ ...institution, headquarters: HEADQUARTERS[institution.institution] }))
        .filter((institution) => institution.headquarters)
        .forEach((institution) => {
          const { code, municipality, address } = institution.headquarters;
          if (!grouped.has(code)) grouped.set(code, { code, municipality, address, institutions: [] });
          grouped.get(code).institutions.push(institution);
        });
    } else {
      (branchData?.institutions || []).forEach((source) => {
        const institution = institutionMap.get(source.institution);
        if (!institution) return;
        Object.entries(source.coverage || {}).forEach(([code, branchCount]) => {
          const municipality = nameByCode.get(code);
          if (!municipality) return;
          if (!grouped.has(code)) grouped.set(code, { code, municipality, institutions: [] });
          grouped.get(code).institutions.push({
            ...institution,
            branchCoverage: { branchCount, exact: Number.isFinite(branchCount), sourceUrl: source.source_url }
          });
        });
      });
    }
    return [...grouped.values()].map((group) => ({
      ...group,
      averageRate: average(group.institutions.map((institution) => institution.averageRate)),
      maximumRate: Math.max(...group.institutions.map((institution) => institution.maximumRate ?? institution.averageRate)),
      institutionCount: group.institutions.length,
      confirmedBranchCount: group.institutions.reduce((sum, institution) => sum + (institution.branchCoverage?.branchCount || 0), 0),
      unconfirmedBranchCounts: group.institutions.filter((institution) => institution.branchCoverage && !institution.branchCoverage.exact).length
    })).sort((a, b) => b.averageRate - a.averageRate || a.municipality.localeCompare(b.municipality, "ja"));
  }

  function walkCoordinates(value, callback) {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
      callback(value);
      return;
    }
    value.forEach((child) => walkCoordinates(child, callback));
  }

  function projection(geoJson, width, height, padding) {
    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;
    geoJson.features.forEach((feature) => walkCoordinates(feature.geometry.coordinates, ([lon, lat]) => {
      minLon = Math.min(minLon, lon);
      minLat = Math.min(minLat, lat);
      maxLon = Math.max(maxLon, lon);
      maxLat = Math.max(maxLat, lat);
    }));
    const lonRange = maxLon - minLon || 1;
    const latRange = maxLat - minLat || 1;
    const scale = Math.min((width - padding * 2) / lonRange, (height - padding * 2) / latRange);
    const offsetX = (width - lonRange * scale) / 2;
    const offsetY = (height - latRange * scale) / 2;
    return ([lon, lat]) => [offsetX + (lon - minLon) * scale, offsetY + (maxLat - lat) * scale];
  }

  function geometryPath(geometry, project) {
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    return polygons.map((polygon) => polygon.map((ring) => ring.map((point, index) => {
      const [x, y] = project(point);
      return `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join("") + "Z").join("")).join("");
  }

  function ringArea(ring) {
    let area = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    }
    return Math.abs(area / 2);
  }

  function labelPoint(geometry, project) {
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    const outer = polygons.map((polygon) => polygon[0]).sort((a, b) => ringArea(b) - ringArea(a))[0] || [];
    if (!outer.length) return [0, 0];
    const bounds = outer.reduce((box, point) => ({
      minX: Math.min(box.minX, point[0]), maxX: Math.max(box.maxX, point[0]),
      minY: Math.min(box.minY, point[1]), maxY: Math.max(box.maxY, point[1])
    }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
    return project([(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2]);
  }

  function colorFor(value, min, max) {
    const colors = ["#2166ac", "#4393c3", "#92c5de", "#d1e5f0", "#f7f7f7", "#fddbc7", "#f4a582", "#d6604d", "#b2182b"];
    if (!Number.isFinite(value)) return "#e5e9ef";
    value = Number(value.toFixed(6));
    min = Number.isFinite(min) ? Number(min.toFixed(6)) : null;
    max = Number.isFinite(max) ? Number(max.toFixed(6)) : null;
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return colors[3];
    const ratio = Math.max(0, Math.min(1, (value - min) / (max - min)));
    return colors[Math.min(colors.length - 1, Math.floor(ratio * colors.length))];
  }

  function labelColor(backgroundColor) {
    const hex = String(backgroundColor || "").replace("#", "");
    if (!/^[0-9a-f]{6}$/i.test(hex)) return "#26384f";
    const channel = (offset) => {
      const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
    return luminance < 0.34 ? "#ffffff" : "#26384f";
  }

  function selectedTable(group, data) {
    if (!group) return '<div class="heatmap-empty">地図またはランキングから市区町村を選択してください。</div>';
    const sorted = group.institutions.slice().sort((a, b) => b.averageRate - a.averageRate || a.institution.localeCompare(b.institution, "ja"));
    const rows = sorted.map((institution, index) => {
      const count = institution.records?.length || 0;
      const location = selectedLocationMode === "headquarters"
        ? escapeHtml(institution.headquarters.address)
        : institution.branchCoverage.exact
          ? `${institution.branchCoverage.branchCount}店`
          : "1店以上（件数確認中）";
      const source = selectedLocationMode === "branches"
        ? `<a href="${escapeHtml(institution.branchCoverage.sourceUrl)}" target="_blank" rel="noopener">公式一覧</a>`
        : "—";
      return `<tr><td>${index + 1}</td><th scope="row">${escapeHtml(institution.institution)}</th><td>${location}</td><td class="rate">${formatRate(institution.averageRate)}</td><td>${formatRate(institution.maximumRate)}</td><td>${count}件</td>${selectedLocationMode === "branches" ? `<td>${source}</td>` : ""}</tr>`;
    }).join("");
    const locationHeading = selectedLocationMode === "headquarters" ? "本店所在地" : "市町村内店舗数";
    const description = selectedLocationMode === "headquarters" ? "本店所在地が同じ信用金庫を表示" : "店舗がある信用金庫を表示（金融機関均等平均）";
    return `<div class="municipality-selected-head"><div><h5>${escapeHtml(group.municipality)}・金融機関別内訳</h5><span>${description}</span></div><strong>${formatRate(group.averageRate)}</strong></div><div class="table-scroll"><table class="heatmap-detail-table"><thead><tr><th>順位</th><th>金融機関</th><th>${locationHeading}</th><th>${escapeHtml(data.rateLabel)}</th><th>最高金利</th><th>明細数</th>${selectedLocationMode === "branches" ? "<th>店舗情報</th>" : ""}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function draw(root, geoJson, branchData, item, data) {
    if (!root.isConnected) return;
    const municipalities = buildMunicipalities(item, branchData, geoJson, data);
    const byCode = new Map(municipalities.map((group) => [group.code, group]));
    const rates = municipalities.map((group) => group.averageRate).filter(Number.isFinite);
    const min = rates.length ? Math.min(...rates) : null;
    const max = rates.length ? Math.max(...rates) : null;
    if (!selectedMunicipality || !byCode.has(selectedMunicipality)) selectedMunicipality = municipalities[0]?.code || "";
    const width = 780;
    const height = 560;
    const project = projection(geoJson, width, height, 22);
    const paths = geoJson.features.map((feature) => {
      const group = byCode.get(feature.properties.code);
      const selected = feature.properties.code === selectedMunicipality;
      const name = String(feature.properties.name || "").replace(/^岐阜県/, "");
      const label = group ? `${group.municipality} ${formatRate(group.averageRate)} ${group.institutionCount}金融機関` : `${name} 対象データなし`;
      const fill = colorFor(group?.averageRate, min, max);
      return `<path class="municipality-shape${group ? " has-data" : ""}${selected ? " is-selected" : ""}" data-code="${feature.properties.code}" d="${geometryPath(feature.geometry, project)}" style="fill:${fill}" fill-rule="evenodd" role="${group ? "button" : "img"}" tabindex="${group ? "0" : "-1"}" aria-label="${escapeHtml(label)}"><title>${escapeHtml(label)}</title></path>`;
    }).join("");
    const labels = geoJson.features.filter((feature) => byCode.has(feature.properties.code)).map((feature) => {
      const [x, y] = labelPoint(feature.geometry, project);
      const group = byCode.get(feature.properties.code);
      const fill = colorFor(group.averageRate, min, max);
      const textColor = labelColor(fill);
      const textStroke = textColor === "#ffffff" ? "#6f1d2a" : "#ffffff";
      return `<text class="municipality-label" x="${x.toFixed(1)}" y="${y.toFixed(1)}" style="fill:${textColor};stroke:${textStroke}">${escapeHtml(group.municipality)}</text>`;
    }).join("");
    const ranking = municipalities.map((group, index) => `<button type="button" class="municipality-ranking-row${group.code === selectedMunicipality ? " is-selected" : ""}" data-code="${group.code}"><span class="rank">${index + 1}</span><span><span class="name">${escapeHtml(group.municipality)}</span><span class="meta">${group.institutionCount}金融機関${selectedLocationMode === "branches" ? ` / ${group.confirmedBranchCount}店${group.unconfirmedBranchCounts ? "+" : ""}` : ""}</span></span><span class="rate">${formatRate(group.averageRate)}</span></button>`).join("");
    const tied = Number.isFinite(min) && min === max;
    const isBranchMode = selectedLocationMode === "branches";
    const coverageLinks = municipalities.reduce((sum, group) => sum + group.institutionCount, 0);
    const confirmedBranches = municipalities.reduce((sum, group) => sum + group.confirmedBranchCount, 0);
    const pendingCounts = municipalities.reduce((sum, group) => sum + group.unconfirmedBranchCounts, 0);
    const summary = isBranchMode
      ? `${municipalities.length}市町村 / 延べ${coverageLinks}金融機関 / 確認済み${confirmedBranches}店${pendingCounts ? `・件数確認中${pendingCounts}組` : ""}`
      : `${municipalities.length}市町村 / 比較可能 ${coverageLinks}先（母集団6先）`;
    root.innerHTML = `<div class="municipality-prototype-head"><div><p class="section-kicker">MUNICIPALITY PROTOTYPE</p><h4>岐阜県・信用金庫 市町村金利ヒートマップ</h4><p class="muted">${isBranchMode ? "店舗が所在する市町村を、支店数では加重せず金融機関均等平均で着色します。" : "信用金庫の本店が所在する市町村を、現在の選択条件の金融機関均等平均で着色します。"}</p></div><span class="municipality-prototype-badge">試作版・${isBranchMode ? "支店所在地" : "本店所在地"}ベース</span></div><div class="municipality-mode-row"><span>地図の基準</span><div class="municipality-mode-switch" role="group" aria-label="市町村ヒートマップの所在地基準"><button type="button" class="municipality-mode-button${!isBranchMode ? " is-active" : ""}" data-mode="headquarters">本店所在地</button><button type="button" class="municipality-mode-button${isBranchMode ? " is-active" : ""}" data-mode="branches">支店所在地</button></div></div><div class="municipality-prototype-layout"><div class="municipality-map-card"><div class="municipality-map-toolbar"><span>${summary}</span><span class="municipality-map-legend"><span>低（濃い青） ${formatRate(min)}</span><span class="municipality-map-gradient"></span><span>高（濃い赤） ${formatRate(max)}</span>${tied ? "<strong>（同率）</strong>" : ""}</span></div><svg class="municipality-map" viewBox="0 0 ${width} ${height}" role="img" aria-label="岐阜県信用金庫の市町村別金利ヒートマップ">${paths}${labels}</svg></div><div class="municipality-ranking-card"><div class="municipality-ranking-title"><strong>${isBranchMode ? "店舗所在" : "本店所在"}市町村ランキング</strong><span>市町村内は金融機関均等平均</span></div><div class="municipality-ranking-list">${ranking || '<div class="heatmap-empty">比較可能な信用金庫データがありません。</div>'}</div></div></div><div class="municipality-selected-card">${selectedTable(byCode.get(selectedMunicipality), data)}</div><p class="municipality-source-note">${isBranchMode ? `店舗所在地は各信用金庫の公式店舗一覧・店舗検索・ディスクロージャー誌を使用。${escapeHtml(branchData?.metadata?.methodology || "")} 店舗の存在は営業区域や当該金利商品の申込可否を保証しません。` : `本店所在地は<a href="${FSA_SOURCE}" target="_blank" rel="noopener">金融庁「免許・登録業者一覧」</a>を使用。本店所在地による比較であり、営業区域・申込可能地域を示すものではありません。`} 境界形状は<a href="${MAP_SOURCE}" target="_blank" rel="noopener">Geolonia japanese-admins</a>（国土数値情報を加工）を使用しています。</p>`;

    const select = (code) => {
      if (!byCode.has(code)) return;
      selectedMunicipality = code;
      root.querySelectorAll(".municipality-shape").forEach((element) => element.classList.toggle("is-selected", element.dataset.code === code));
      root.querySelectorAll(".municipality-ranking-row").forEach((element) => element.classList.toggle("is-selected", element.dataset.code === code));
      const detail = root.querySelector(".municipality-selected-card");
      if (detail) detail.innerHTML = selectedTable(byCode.get(code), data);
    };
    root.querySelectorAll(".municipality-shape.has-data").forEach((element) => {
      element.addEventListener("click", () => select(element.dataset.code));
      element.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          select(element.dataset.code);
        }
      });
    });
    root.querySelectorAll(".municipality-ranking-row").forEach((element) => element.addEventListener("click", () => select(element.dataset.code)));
    root.querySelectorAll(".municipality-mode-button").forEach((button) => button.addEventListener("click", () => {
      if (button.dataset.mode === selectedLocationMode) return;
      selectedLocationMode = button.dataset.mode;
      selectedMunicipality = "";
      draw(root, geoJson, branchData, item, data);
    }));
  }

  window.renderGifuShinkinMunicipalityPrototype = ({ data, item, termLabel, detail }) => {
    detail.querySelector("#gifuShinkinMunicipalityPrototype")?.remove();
    const types = Array.isArray(data?.institutionTypes) ? data.institutionTypes : [];
    if (item?.prefecture !== "岐阜県" || !types.includes("信用金庫")) return;
    const root = document.createElement("section");
    root.id = "gifuShinkinMunicipalityPrototype";
    root.className = "municipality-prototype";
    root.setAttribute("aria-live", "polite");
    root.innerHTML = `<div class="heatmap-empty">岐阜県の市町村境界と${escapeHtml(termLabel)}データを読み込んでいます…</div>`;
    detail.appendChild(root);
    Promise.all([loadGeoJson(), loadBranchData()])
      .then(([geoJson, branchData]) => draw(root, geoJson, branchData, item, data))
      .catch((error) => {
        if (root.isConnected) root.innerHTML = `<div class="heatmap-empty">市区町村ヒートマップを読み込めませんでした。${escapeHtml(error.message)}</div>`;
      });
  };
})();
