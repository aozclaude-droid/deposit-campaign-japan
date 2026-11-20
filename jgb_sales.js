/* Ministry of Finance published retail-JGB sales, kept separate from deposit rates. */
(() => {
  'use strict';
  const host = document.getElementById('heatmapTabPanel');
  const deposit = document.getElementById('prefectureHeatmapPanel');
  if (!host || !deposit) return;
  const palette = ['#2166ac','#4393c3','#92c5de','#d1e5f0','#f7f7f7','#fddbc7','#f4a582','#d6604d','#b2182b'];
  const noData = '#e5e9ef';
  const prefectures = ['北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県'];
  const types = ['地方銀行','信用金庫','信用組合','労働金庫','JA等'];
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number = v => Number(v).toLocaleString('ja-JP', {maximumFractionDigits: 1});
  const ui = {data:null, period:null, type:'all', metric:'total', scale:'common', prefecture:null, loading:null};
  const switcher = document.createElement('div');
  switcher.className = 'jgb-view-switch';
  switcher.setAttribute('role','group');
  switcher.setAttribute('aria-label','ヒートマップの表示内容');
  switcher.innerHTML = '<button type="button" data-map-view="deposit" aria-pressed="true">預金・貯金金利</button><button type="button" data-map-view="jgb" aria-pressed="false">個人向け国債等の販売実績</button>';
  const section = document.createElement('section');
  section.id = 'jgbSalesPanel'; section.className = 'panel jgb-panel'; section.hidden = true;
  section.innerHTML = `
    <div class="panel-header"><div><p class="section-kicker">RETAIL JGB SALES</p><h2>個人向け国債等 販売実績ヒートマップ</h2></div><span class="jgb-badge">財務省公表資料</span></div>
    <div class="panel-body">
      <p class="jgb-intro">地域金融機関の<strong>公表販売額を、本店所在地別に集計</strong>します。対象は個人向け国債と新窓販国債の合計です。</p>
      <div class="jgb-controls">
        <label>対象半期（暦年）<select id="jgbPeriod" disabled aria-label="国債販売実績の対象半期"></select></label>
        <label>金融機関種別<select id="jgbType"><option value="all">すべての地域金融機関</option>${types.map(t=>`<option>${t}</option>`).join('')}</select></label>
        <label>地図に表示する値<select id="jgbMetric"><option value="total">公表販売額の合計（億円）</option><option value="average">掲載1機関当たり（億円）</option></select></label>
        <label>色の比較基準<select id="jgbScale"><option value="common">全7半期で共通（時系列比較）</option><option value="period">選択半期の中で比較</option></select></label>
      </div>
      <div class="jgb-important"><strong>地域全体の販売総額ではありません。</strong>公表対象は上位機関のみで、未掲載は販売ゼロを意味しません。購入者・販売支店の所在地別でもありません。労働金庫など複数県で営業する機関も、本店所在県に全額を集計します。</div>
      <p id="jgbStatus" class="muted" role="status" aria-live="polite">国債販売実績を読み込み中…</p>
      <div id="jgbCards" class="heatmap-summary-grid"></div>
      <div class="jgb-main-grid">
        <section class="heatmap-map-card"><div class="heatmap-card-heading"><div><h3 id="jgbMapTitle">本店所在地別・公表販売額合計</h3><p class="muted" id="jgbMapSubtitle">都道府県を選ぶと、下に金融機関別の実績を表示します。</p></div><div id="jgbLegend" class="jgb-legend"></div></div><div id="jgbMap" class="jgb-map-wrap" aria-label="国債販売実績の日本地図"></div></section>
        <section class="heatmap-map-card"><div class="heatmap-card-heading"><div><h3>都道府県ランキング</h3><p class="muted">同額は同順位。未掲載県は順位を付けません。</p></div></div><div id="jgbRanking" class="jgb-ranking"></div></section>
      </div>
      <section class="jgb-detail" id="jgbDetail" aria-live="polite"><p class="muted">地図またはランキングから都道府県を選択してください。</p></section>
      <div class="jgb-source"><a id="jgbSource" target="_blank" rel="noopener">選択半期の財務省原本PDF</a><a id="jgbCsv" href="r1_data/retail_jgb_sales.csv" download>全半期の明細CSV</a><span id="jgbPeriodNote"></span></div>
      <details class="jgb-method"><summary>集計方法とデータの範囲</summary><ul><li>販売額は財務省が公表する「個人向け国債及び新窓販国債」の合計。金額は億円単位の四捨五入値です。</li><li>地方銀行（第二地方銀行を含む）・信用金庫・信用組合・労働金庫・JA等を収録。都市銀行・信託銀行・ゆうちょ銀行・証券会社はこの地図には含めません。</li><li>各半期の公表基準・掲載機関は異なります。未掲載の金融機関・県は実績不明として扱います。</li><li>証券仲介による販売額は委託側の証券会社に計上されるため、地域金融機関の販売額に含まれない場合があります。</li><li>合併・名称変更前の機関名は原本どおり保持。本店所在地への配分は地域別需要の近似指標であり、実際の購入地域を示すものではありません。</li><li>公表額カバー率は、選択業態の掲載明細合計÷原本の当該業態全体総額。都道府県ごとのカバー率ではありません。</li><li>地図形状：Geolonia Japanese Prefectures（GFDL）。</li></ul></details>
    </div>`;
  host.insertBefore(switcher, deposit); host.appendChild(section);
  const $ = s => section.querySelector(s);
  function aggregate(period, type=ui.type) {
    const buckets = new Map();
    for (const r of ui.data.records) {
      if (r.period_id !== period || (type!=='all' && r.institution_type!==type)) continue;
      if (!buckets.has(r.prefecture)) buckets.set(r.prefecture,{prefecture:r.prefecture,total:0,records:[]});
      const b=buckets.get(r.prefecture); b.total+=r.sales_amount_oku_yen; b.records.push(r);
    }
    return [...buckets.values()].map(b=>({...b,count:b.records.length,average:b.total/b.records.length}));
  }
  function color(value, max) { return !Number.isFinite(value) ? noData : palette[max<=0?4:Math.min(8,Math.floor(Math.max(0,value/max)*9))]; }
  async function load() {
    if (ui.loading) return ui.loading;
    ui.loading=(async()=>{
      const [dataRes,mapRes]=await Promise.all([fetch('r1_data/retail_jgb_sales.json?v=20261121-1',{cache:'no-store'}),fetch('r1_assets/japan-prefectures.svg')]);
      if (!dataRes.ok || !mapRes.ok) throw Error('資料を読み込めませんでした。ページを再読み込みしてください。');
      const [data,mapText]=await Promise.all([dataRes.json(),mapRes.text()]);
      if (!data.periods?.length || data.records?.length!==data.metadata.record_count) throw Error('販売実績の件数に不整合があります。');
      ui.data=data;
      $('#jgbScale option[value="common"]').textContent=`全${data.periods.length}半期で共通（時系列比較）`;
      $('#jgbCsv').textContent=`全${data.periods.length}半期の明細CSV`;
      const params=new URLSearchParams(location.search); const requested=params.get('jgb_period');
      ui.period=data.periods.some(p=>p.id===requested)?requested:data.periods[0].id;
      $('#jgbPeriod').innerHTML=data.periods.map(p=>`<option value="${p.id}">${esc(p.label)}</option>`).join(''); $('#jgbPeriod').disabled=false; $('#jgbPeriod').value=ui.period;
      const svgDoc=new DOMParser().parseFromString(mapText,'image/svg+xml'); const svg=svgDoc.documentElement;
      if (svg.localName!=='svg' || svgDoc.querySelector('parsererror')) throw Error('地図の読み込みに失敗しました。');
      svg.querySelectorAll('script,foreignObject').forEach(e=>e.remove());
      svg.querySelectorAll('[id]').forEach(e=>e.removeAttribute('id'));
      svg.setAttribute('class','jgb-japan-map');svg.setAttribute('role','group');svg.setAttribute('aria-label','金融機関本店所在地別の公表国債販売額');
      svg.querySelectorAll('[data-code]').forEach(g=>{
        const pref=prefectures[Number(g.dataset.code)-1];g.setAttribute('class','jgb-prefecture');g.dataset.prefecture=pref;g.setAttribute('tabindex','0');g.setAttribute('role','button');
        g.addEventListener('click',()=>selectPrefecture(pref));g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectPrefecture(pref);}});
      });
      $('#jgbMap').appendChild(document.importNode(svg,true));
      // DOM import does not copy event handlers.
      $('#jgbMap').querySelectorAll('[data-code]').forEach(g=>{g.addEventListener('click',()=>selectPrefecture(g.dataset.prefecture));g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectPrefecture(g.dataset.prefecture);}});});
      render();
    })().catch(e=>{ui.loading=null;$('#jgbStatus').textContent=e.message;$('#jgbStatus').classList.add('jgb-error');throw e;});
    return ui.loading;
  }
  function selectPrefecture(pref) {ui.prefecture=pref;render();}
  function card(label,value,detail) {return `<article class="heatmap-summary-card"><div class="heatmap-summary-label">${esc(label)}</div><div class="heatmap-summary-value">${value}</div><div class="heatmap-summary-detail">${esc(detail)}</div></article>`;}
  function render() {
    if (!ui.data) return;
    const period=ui.data.periods.find(p=>p.id===ui.period), rows=aggregate(ui.period), byPref=new Map(rows.map(r=>[r.prefecture,r]));
    const current=ui.metric==='total'?'total':'average';
    const scaleRows=ui.scale==='common'?ui.data.periods.flatMap(p=>aggregate(p.id)):rows;
    const max=Math.max(0,...scaleRows.map(r=>r[current]));
    const sum=rows.reduce((n,r)=>n+r.total,0),count=rows.reduce((n,r)=>n+r.count,0);
    const sourceTypes=ui.type==='all'?Object.keys(period.source_industries):ui.type==='地方銀行'?['地方銀行','第二地方銀行']:[ui.type];
    const sourceTotal=sourceTypes.reduce((n,t)=>n+(period.source_industries[t]?.all_institutions_sales_oku_yen||0),0);
    const population=sourceTypes.reduce((n,t)=>n+(period.source_industries[t]?.participating_institution_count||0),0);
    $('#jgbStatus').textContent=`${period.label} ／ ${ui.type==='all'?'全地域業態':ui.type} ／ 公表掲載 ${count}先（取扱 ${population}先）`;
    $('#jgbCards').innerHTML=card('掲載機関の公表販売額',`${number(sum)}<small> 億円</small>`,'本店所在地別に合算')+card('掲載金融機関',`${number(count)}<small> 先</small>`,`対象業態の取扱機関 ${population}先`)+card('公表実績がある都道府県',`${rows.length}<small> / 47</small>`,'未掲載県は販売額不明')+card('公表額のカバー率',sourceTotal?`${number(sum/sourceTotal*100)}<small> %</small>`:'—',`対象業態全体 ${number(sourceTotal)}億円に対する比率`);
    $('#jgbMapTitle').textContent=current==='total'?'本店所在地別・公表販売額合計':'本店所在地別・掲載1機関当たり販売額';
    $('#jgbMapSubtitle').textContent=`${period.label} ／ ${ui.scale==='common'?`全${ui.data.periods.length}半期で共通の色尺度`:'選択半期の中で色を比較'}`;
    $('#jgbLegend').innerHTML=`<span>少ない 0</span><span class="jgb-swatches">${palette.map(c=>`<i style="background:${c}"></i>`).join('')}</span><span>多い ${number(max)}億円</span><span class="jgb-no-data"><i></i>掲載なし（額不明）</span>`;
    $('#jgbMap').querySelectorAll('[data-code]').forEach(g=>{
      const row=byPref.get(g.dataset.prefecture),selected=ui.prefecture===g.dataset.prefecture,fill=row?color(row[current],max):noData;
      g.style.fill=fill;g.setAttribute('aria-pressed',String(selected));const label=`${g.dataset.prefecture}：${row?`${number(row[current])}億円、掲載${row.count}機関`:'公表対象の掲載なし・販売額不明'}`;g.setAttribute('aria-label',label);
      let title=g.querySelector('title');if(!title){title=document.createElementNS('http://www.w3.org/2000/svg','title');g.prepend(title);}title.textContent=label;
      g.querySelectorAll('path,polygon,polyline,rect').forEach(shape=>{shape.style.setProperty('fill',fill,'important');shape.style.stroke=selected?'#f59e0b':'#ffffff';shape.style.strokeWidth=selected?'3':'1';});
    });
    const sorted=[...rows].sort((a,b)=>b[current]-a[current]||prefectures.indexOf(a.prefecture)-prefectures.indexOf(b.prefecture));let rank=0,previous=null;
    $('#jgbRanking').innerHTML=sorted.map((r,i)=>{if(previous===null||Math.abs(previous-r[current])>1e-9)rank=i+1;previous=r[current];return `<button class="jgb-ranking-row${ui.prefecture===r.prefecture?' is-selected':''}" type="button" data-prefecture="${r.prefecture}"><span class="jgb-rank">${rank}</span><span><strong>${r.prefecture}</strong><small>掲載 ${r.count}機関</small></span><b>${number(r[current])}<small> 億円</small></b></button>`;}).join('')||'<p class="muted">この条件の公表実績はありません。</p>';
    $('#jgbRanking').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>selectPrefecture(b.dataset.prefecture)));
    if(ui.prefecture){
      const row=byPref.get(ui.prefecture),items=[...(row?.records||[])].sort((a,b)=>b.sales_amount_oku_yen-a.sales_amount_oku_yen||a.institution_name.localeCompare(b.institution_name,'ja'));let n=0,prev=null;
      $('#jgbDetail').innerHTML=`<div class="jgb-detail-heading"><div><h3>${ui.prefecture}の金融機関別実績</h3><p class="muted">${period.label} ／ ${items.length}掲載機関 ／ ${row?number(row.total):'—'}億円</p></div><button type="button" id="jgbClearPref" class="btn btn-secondary">選択を解除</button></div>`+(items.length?`<div class="jgb-table-scroll"><table><thead><tr><th>県内掲載順位</th><th>金融機関（原本名）</th><th>業態</th><th>販売額（億円）</th><th>原本の業態内順位</th><th>根拠</th></tr></thead><tbody>${items.map((r,i)=>{if(prev!==r.sales_amount_oku_yen)n=i+1;prev=r.sales_amount_oku_yen;return `<tr><td>${n}位</td><th scope="row">${esc(r.institution_name)}</th><td>${esc(r.institution_type)}</td><td class="jgb-amount">${number(r.sales_amount_oku_yen)}</td><td>${esc(r.source_institution_type)} ${r.source_rank}位</td><td><a target="_blank" rel="noopener" href="${esc(r.source_url)}">財務省PDF</a></td></tr>`;}).join('')}</tbody></table></div>`:'<p class="muted">この条件では公表対象の掲載がありません。販売ゼロとは判断できません。</p>');
      $('#jgbClearPref').addEventListener('click',()=>{ui.prefecture=null;$('#jgbDetail').innerHTML='<p class="muted">地図またはランキングから都道府県を選択してください。</p>';render();});
    }
    $('#jgbSource').href=period.source_url;
    $('#jgbPeriodNote').textContent='単位：億円。公表基準の詳細は原本の注記をご覧ください。';
    const url=new URL(location.href);if(!section.hidden){url.searchParams.set('map','jgb');url.searchParams.set('jgb_period',ui.period);history.replaceState(null,'',url);}
  }
  async function chooseView(view) {
    const jgb=view==='jgb';deposit.hidden=jgb;section.hidden=!jgb;
    switcher.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mapView===view)));
    const url=new URL(location.href);if(!jgb){url.searchParams.delete('map');url.searchParams.delete('jgb_period');history.replaceState(null,'',url);}
    if(jgb){try{await load();render();}catch{/* visible error is rendered by load */}}
  }
  switcher.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>chooseView(b.dataset.mapView)));
  $('#jgbPeriod').addEventListener('change',e=>{ui.period=e.target.value;render();});
  $('#jgbType').addEventListener('change',e=>{ui.type=e.target.value;render();});
  $('#jgbMetric').addEventListener('change',e=>{ui.metric=e.target.value;render();});
  $('#jgbScale').addEventListener('change',e=>{ui.scale=e.target.value;render();});
  window.RetailJgbSales=Object.freeze({get data(){return ui.data;},get selection(){return {period:ui.period,type:ui.type,metric:ui.metric,scale:ui.scale,prefecture:ui.prefecture};},aggregate});
  if(new URLSearchParams(location.search).get('map')==='jgb') chooseView('jgb');
})();
