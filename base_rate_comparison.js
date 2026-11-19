/* Shared current-rate selection for the matrix, heatmap and institution view. */
(function (root) {
  "use strict";
  const text = value => String(value ?? "").trim();
  const iso = value => /^\d{4}-\d{2}-\d{2}/.test(text(value)) ? text(value).slice(0,10) : "";
  const todayInJapan = () => new Intl.DateTimeFormat("sv-SE", {timeZone:"Asia/Tokyo"}).format(new Date());
  const snapshotDate = row => iso(row.effective_from || row.source_as_of_date || row.observation_date || row.observed_at || row.retrieved_at);
  const number = value => value === null || value === undefined || text(value) === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null;
  const family = row => text(row.product_family).toUpperCase();
  const ordinary = row => family(row) === "ORDINARY_DEPOSIT";
  const fixed = row => /^(STANDARD_TERM|SUPER_TERM|LARGE_TERM|COMPOUND_TERM|TIME_DEPOSIT)$/.test(family(row));
  const standard = row => row.comparison_category === "CURRENT_STANDARD" || text(row.base_rate_role) === "STANDARD_BASE_RATE";
  function active(row, today=todayInJapan()) {
    if (!row || text(row.record_eligible) === "0" || row.reference_only || row.comparison_eligible === "0") return false;
    if (row.comparison_category && !/^CURRENT_(STANDARD|CONDITIONAL)$/.test(row.comparison_category)) return false;
    const rate = number(row.rate_percent);
    if (rate === null || rate < 0 || rate > 10) return false;
    if (row.currency && !/^(JPY|YEN|円)$/i.test(text(row.currency))) return false;
    if (row.tax_basis === "AFTER_TAX" || /YIELD|EQUIVALENT|RATE_COMPONENT/.test(text(row.rate_measure_type))) return false;
    if (/PRE_REVISION|CLOSED_PRODUCT|CORPORATE|COMPONENT/.test(text(row.base_rate_role))) return false;
    // Migrated marketing fragments must not become a current ordinary rate.
    if (row.source_review_status === "MIGRATED_FROM_CAMPAIGN_JSON" && !row.comparison_category) return false;
    const from = iso(row.published_valid_from || row.effective_from);
    const to = iso(row.published_valid_to || row.effective_to);
    if ((from && from > today) || (to && to < today) || snapshotDate(row) > today) return false;
    return ordinary(row) || fixed(row);
  }
  function withoutSuperseded(rows) {
    const superseded = new Set(rows.flatMap(r => [r.supersedes_record_id,...(Array.isArray(r.supersedes_record_ids) ? r.supersedes_record_ids : [])]).filter(Boolean).map(String));
    return rows.filter(r => !superseded.has(text(r.base_rate_record_id)));
  }
  function months(row) {
    const n = number(row.term_months);
    if (n !== null && n > 0) return n;
    if (row.term_kind === "RANGE") return null;
    const s=text(row.term_label).normalize("NFKC");
    let m=s.match(/(\d+)\s*(?:か月|ヶ月|ヵ月|カ月)/);
    if(m)return Number(m[1]);
    m=s.match(/^(\d+)\s*年$/);return m ? Number(m[1])*12 : null;
  }
  function matchesTerm(row, term) {
    if (row.term_kind !== "RANGE") return months(row) === term;
    const lo=number(row.term_min_months), hi=number(row.term_max_months);
    return lo!==null && term>=lo && (hi===null || (row.term_max_exclusive ? term<hi : term<=hi));
  }
  function amountScore(row) {
    const raw=text(row.amount_band_label || row.rate_condition || row.amount_band).replace(/[,，\s]/g,"");
    if (/100万円以下|100万円まで|百万円以下/.test(raw)) return 0;
    if (/300万円未満|SMALL_LT_3M/.test(raw)) return 1;
    if (/未満|以下/.test(raw)) return 2;
    if (/GENERAL_OR_UNSPECIFIED|一般|指定なし/.test(raw) || !raw) return 3;
    return 4;
  }
  function stableKey(row) {
    return row.comparison_variant_key || row.condition_product_key || [row.base_rate_role,row.product_label,row.amount_band_label || row.amount_band,row.rate_condition,row.eligibility_conditions].map(text).join("\u241f");
  }
  function latestVariants(rows) {
    const m=new Map();
    for (const r of rows) {
      const key=stableKey(r), current=m.get(key);
      if (!current || snapshotDate(r)>snapshotDate(current) || (snapshotDate(r)===snapshotDate(current) && text(r.comparison_verified_on)>text(current.comparison_verified_on))) m.set(key,r);
    }
    return [...m.values()];
  }
  function conditionLabel(row) {
    if (!row) return "";
    const parts=[row.product_label,row.amount_band_label,row.eligibility_conditions,row.rate_condition,row.comparison_tax_note].map(text).filter(Boolean);
    return [...new Set(parts)].join(" / ");
  }
  function select(rows, options={}) {
    const today=options.today || todayInJapan(), basis=options.basis || "maximum", kind=options.family || "ordinary", term=Number(options.termMonths);
    const clean=withoutSuperseded(rows), groups=new Map();
    for (const r of clean) {
      if (!active(r,today) || (kind==="ordinary" ? !ordinary(r) : !fixed(r) || !matchesTerm(r,term))) continue;
      const key=text(r.institution_name);
      if (!text(r.institution_name)) continue;
      if (!groups.has(key)) groups.set(key,[]);
      groups.get(key).push(r);
    }
    const result=[];
    for (const rs of groups.values()) {
      const variants=latestVariants(rs);
      const stds=options.standardRows ? latestVariants(withoutSuperseded(options.standardRows).filter(r=>text(r.institution_name)===text(rs[0].institution_name) && active(r,today) && standard(r) && (kind==="ordinary"?ordinary(r):fixed(r)&&matchesTerm(r,term)))) : variants.filter(standard);
      const newest=stds.reduce((d,r)=>snapshotDate(r)>d?snapshotDate(r):d,"");
      const std=stds.filter(r=>snapshotDate(r)===newest).sort((a,b)=>amountScore(a)-amountScore(b) || Number(b.rate_percent)-Number(a.rate_percent))[0] || null;
      // A current, independently checked condition remains valid even if the
      // ordinary standard rate was published on a different day.
      const conditional=variants.filter(r=>!standard(r) && (r.comparison_category==="CURRENT_CONDITIONAL" || snapshotDate(r)>=newest));
      const currentAmountTiers=variants.filter(r=>r.comparison_category==="CURRENT_STANDARD");
      const maximum=[...(std?[std]:[]),...conditional,...currentAmountTiers].sort((a,b)=>Number(b.rate_percent)-Number(a.rate_percent) || snapshotDate(b).localeCompare(snapshotDate(a)))[0] || null;
      const chosen=basis==="standard"?std:maximum;
      if (!chosen) continue;
      const selected={...chosen,_standardComparableRate:std?Number(std.rate_percent):null,_maximumComparableRate:maximum?Number(maximum.rate_percent):null,_comparableRate:Number(chosen.rate_percent),_comparisonStandardRow:std,_comparisonMaximumRow:maximum,selected_condition_label:conditionLabel(chosen),comparison_basis:basis,comparison_source_count:variants.length};
      if (kind==="term" && chosen.term_kind==="RANGE") selected.comparison_term_months=term;
      result.push(selected);
    }
    return result;
  }
  root.DepositRateComparison=Object.freeze({select,active,withoutSuperseded,snapshotDate,conditionLabel,matchesTerm,todayInJapan});
})(typeof window!=="undefined"?window:globalThis);
