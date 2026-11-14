"use strict";

(() => {
  const DATA_URL = "./r1_assets/aichi_municipalities.geojson?v=20261114-1";
  const FSA_SOURCE = "https://www.fsa.go.jp/menkyo/menkyoj/shinkin.pdf";
  const MAP_SOURCE = "https://github.com/geolonia/japanese-admins";
  const HEADQUARTERS = {
    "愛知信用金庫": { code: "23106", municipality: "名古屋市中区", address: "愛知県名古屋市中区錦3-15-25" },
    "いちい信用金庫": { code: "23203", municipality: "一宮市", address: "愛知県一宮市若竹3-2-2" },
    "岡崎信用金庫": { code: "23202", municipality: "岡崎市", address: "愛知県岡崎市菅生町字元菱41" },
    "蒲郡信用金庫": { code: "23214", municipality: "蒲郡市", address: "愛知県蒲郡市神明町4-25" },
    "瀬戸信用金庫": { code: "23204", municipality: "瀬戸市", address: "愛知県瀬戸市東横山町119-1" },
    "知多信用金庫": { code: "23205", municipality: "半田市", address: "愛知県半田市星崎町3-39-10" },
    "中日信用金庫": { code: "23103", municipality: "名古屋市北区", address: "愛知県名古屋市北区清水2-9-5" },
    "東春信用金庫": { code: "23219", municipality: "小牧市", address: "愛知県小牧市中央1-231-1" },
    "豊川信用金庫": { code: "23207", municipality: "豊川市", address: "愛知県豊川市末広通3-34-1" },
    "豊田信用金庫": { code: "23211", municipality: "豊田市", address: "愛知県豊田市元城町1-48" },
    "豊橋信用金庫": { code: "23201", municipality: "豊橋市", address: "愛知県豊橋市小畷町579" },
    "西尾信用金庫": { code: "23213", municipality: "西尾市", address: "愛知県西尾市寄住町洲田51" },
    "半田信用金庫": { code: "23205", municipality: "半田市", address: "愛知県半田市御幸町8" },
    "尾西信用金庫": { code: "23203", municipality: "一宮市", address: "愛知県一宮市篭屋1-4-3" },
    "碧海信用金庫": { code: "23212", municipality: "安城市", address: "愛知県安城市御幸本町15-1" }
  };

  let geoPromise = null;
  let selectedMunicipality = "";

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
  style.id = "aichiShinkinMunicipalityPrototypeStyle";
  style.textContent = `
    .municipality-prototype{margin-top:1rem;border-top:1px solid #d8e2ef;padding-top:1rem}
    .municipality-prototype-head{display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;margin-bottom:.85rem}
    .municipality-prototype-head h4{margin:.15rem 0 .25rem;font-size:1.05rem;color:#123b70}
    .municipality-prototype-head p{margin:0}
    .municipality-prototype-badge{flex:0 0 auto;border:1px solid #9dc2f7;background:#eaf3ff;color:#1d5aa7;border-radius:999px;padding:.35rem .65rem;font-size:.72rem;font-weight:800}
    .municipality-prototype-layout{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(250px,.8fr);gap:.9rem}
    .municipality-map-card,.municipality-ranking-card,.municipality-selected-card{border:1px solid #d7e2ef;border-radius:12px;background:#fff;overflow:hidden}
    .municipality-map-toolbar{display:flex;justify-content:space-between;align-items:center;gap:.75rem;padding:.65rem .8rem;border-bottom:1px solid #e4ebf4;background:#f8fbff;font-size:.76rem;color:#53657c}
    .municipality-map-legend{display:flex;align-items:center;gap:.4rem;white-space:nowrap}
    .municipality-map-gradient{width:90px;height:9px;border-radius:999px;background:linear-gradient(90deg,#dbeafe,#1d4ed8)}
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
    @media (max-width:600px){.municipality-prototype-head{display:block}.municipality-prototype-badge{display:inline-block;margin-top:.6rem}.municipality-map-toolbar{align-items:flex-start;flex-direction:column}.municipality-map{min-height:270px}}
  `;
  document.head.appendChild(style);

  function loadGeoJson() {
    if (!geoPromise) {
      geoPromise = fetch(DATA_URL).then((response) => {
        if (!response.ok) throw new Error(`市区町村境界を取得できませんでした（${response.status}）`);
        return response.json();
      });
    }
    return geoPromise;
  }

  function institutionType(item) {
    return item.institution_type || item.records?.[0]?.institution_type || "";
  }

  function buildMunicipalities(item) {
    const institutions = (item?.institutions || [])
      .filter((institution) => institutionType(institution) === "信用金庫")
      .map((institution) => ({ ...institution, headquarters: HEADQUARTERS[institution.institution] }))
      .filter((institution) => institution.headquarters && Number.isFinite(institution.averageRate));
    const grouped = new Map();
    institutions.forEach((institution) => {
      const { code, municipality, address } = institution.headquarters;
      if (!grouped.has(code)) grouped.set(code, { code, municipality, address, institutions: [] });
      grouped.get(code).institutions.push(institution);
    });
    return [...grouped.values()].map((group) => ({
      ...group,
      averageRate: average(group.institutions.map((institution) => institution.averageRate)),
      maximumRate: Math.max(...group.institutions.map((institution) => institution.maximumRate ?? institution.averageRate)),
      institutionCount: group.institutions.length
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
    if (!Number.isFinite(value)) return "#e5ebf2";
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return "#3b82f6";
    const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
    const start = [219, 234, 254];
    const end = [29, 78, 216];
    const rgb = start.map((channel, index) => Math.round(channel + (end[index] - channel) * t));
    return `rgb(${rgb.join(",")})`;
  }

  function selectedTable(group, data) {
    if (!group) return '<div class="heatmap-empty">地図またはランキングから市区町村を選択してください。</div>';
    const sorted = group.institutions.slice().sort((a, b) => b.averageRate - a.averageRate || a.institution.localeCompare(b.institution, "ja"));
    const rows = sorted.map((institution, index) => {
      const address = institution.headquarters.address;
      const count = institution.records?.length || 0;
      return `<tr><td>${index + 1}</td><th scope="row">${escapeHtml(institution.institution)}</th><td>${escapeHtml(address)}</td><td class="rate">${formatRate(institution.averageRate)}</td><td>${formatRate(institution.maximumRate)}</td><td>${count}件</td></tr>`;
    }).join("");
    return `<div class="municipality-selected-head"><div><h5>${escapeHtml(group.municipality)}・金融機関別内訳</h5><span>本店所在地が同じ信用金庫を表示</span></div><strong>${formatRate(group.averageRate)}</strong></div><div class="table-scroll"><table class="heatmap-detail-table"><thead><tr><th>順位</th><th>金融機関</th><th>本店所在地</th><th>${escapeHtml(data.rateLabel)}</th><th>最高金利</th><th>明細数</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function draw(root, geoJson, municipalities, data) {
    if (!root.isConnected) return;
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
      const name = String(feature.properties.name || "").replace(/^愛知県/, "");
      const label = group ? `${group.municipality} ${formatRate(group.averageRate)} ${group.institutionCount}金融機関` : `${name} 対象データなし`;
      return `<path class="municipality-shape${group ? " has-data" : ""}${selected ? " is-selected" : ""}" data-code="${feature.properties.code}" d="${geometryPath(feature.geometry, project)}" fill="${colorFor(group?.averageRate, min, max)}" fill-rule="evenodd" role="${group ? "button" : "img"}" tabindex="${group ? "0" : "-1"}" aria-label="${escapeHtml(label)}"><title>${escapeHtml(label)}</title></path>`;
    }).join("");
    const labels = geoJson.features.filter((feature) => byCode.has(feature.properties.code)).map((feature) => {
      const [x, y] = labelPoint(feature.geometry, project);
      const group = byCode.get(feature.properties.code);
      return `<text class="municipality-label" x="${x.toFixed(1)}" y="${y.toFixed(1)}">${escapeHtml(group.municipality.replace(/^名古屋市/, "名古屋・"))}</text>`;
    }).join("");
    const ranking = municipalities.map((group, index) => `<button type="button" class="municipality-ranking-row${group.code === selectedMunicipality ? " is-selected" : ""}" data-code="${group.code}"><span class="rank">${index + 1}</span><span><span class="name">${escapeHtml(group.municipality)}</span><span class="meta">${group.institutionCount}金融機関</span></span><span class="rate">${formatRate(group.averageRate)}</span></button>`).join("");
    const tied = Number.isFinite(min) && min === max;
    root.innerHTML = `<div class="municipality-prototype-head"><div><p class="section-kicker">MUNICIPALITY PROTOTYPE</p><h4>愛知県・信用金庫 市区町村金利ヒートマップ</h4><p class="muted">信用金庫の本店が所在する市区町村を、現在の選択条件の金融機関均等平均で着色します。</p></div><span class="municipality-prototype-badge">試作版・本店所在地ベース</span></div><div class="municipality-prototype-layout"><div class="municipality-map-card"><div class="municipality-map-toolbar"><span>${municipalities.length}市区 / 比較可能 ${municipalities.reduce((sum, group) => sum + group.institutionCount, 0)}先（母集団15先）</span><span class="municipality-map-legend"><span>低 ${formatRate(min)}</span><span class="municipality-map-gradient"></span><span>高 ${formatRate(max)}</span>${tied ? "<strong>（同率）</strong>" : ""}</span></div><svg class="municipality-map" viewBox="0 0 ${width} ${height}" role="img" aria-label="愛知県信用金庫の市区町村別金利ヒートマップ">${paths}${labels}</svg></div><div class="municipality-ranking-card"><div class="municipality-ranking-title"><strong>本店所在市区ランキング</strong><span>市区内は金融機関均等平均</span></div><div class="municipality-ranking-list">${ranking || '<div class="heatmap-empty">比較可能な信用金庫データがありません。</div>'}</div></div></div><div class="municipality-selected-card">${selectedTable(byCode.get(selectedMunicipality), data)}</div><p class="municipality-source-note">本店所在地は<a href="${FSA_SOURCE}" target="_blank" rel="noopener">金融庁「免許・登録業者一覧」</a>、境界形状は<a href="${MAP_SOURCE}" target="_blank" rel="noopener">Geolonia japanese-admins</a>（国土数値情報を加工）を使用しています。本店所在地による比較であり、営業区域・申込可能地域を示すものではありません。</p>`;

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
  }

  window.renderAichiShinkinMunicipalityPrototype = ({ data, item, termLabel, detail }) => {
    detail.querySelector("#aichiShinkinMunicipalityPrototype")?.remove();
    const types = Array.isArray(data?.institutionTypes) ? data.institutionTypes : [];
    if (item?.prefecture !== "愛知県" || !types.includes("信用金庫")) return;
    const municipalities = buildMunicipalities(item);
    const root = document.createElement("section");
    root.id = "aichiShinkinMunicipalityPrototype";
    root.className = "municipality-prototype";
    root.setAttribute("aria-live", "polite");
    root.innerHTML = `<div class="heatmap-empty">愛知県の市区町村境界と${escapeHtml(termLabel)}データを読み込んでいます…</div>`;
    detail.appendChild(root);
    loadGeoJson()
      .then((geoJson) => draw(root, geoJson, municipalities, data))
      .catch((error) => {
        if (root.isConnected) root.innerHTML = `<div class="heatmap-empty">市区町村ヒートマップを読み込めませんでした。${escapeHtml(error.message)}</div>`;
      });
  };
})();
