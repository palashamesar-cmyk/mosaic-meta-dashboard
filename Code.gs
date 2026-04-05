// ============================================================
// MM25 Meta Ads Dashboard — Google Apps Script Backend
// Deploy as Web App: Execute as "Me", Access "Anyone"
// ============================================================

// ── Column indices (0-based, DD sheet starts at row 2) ──────
const COL = {
  DAY:              0,   // A  - Date
  ACCOUNT:          1,   // B  - Account Name
  CAMPAIGN:         2,   // C  - Campaign Name
  ADSET:            3,   // D  - Ad Set Name
  AD:               4,   // E  - Ad Name
  CURRENCY:         5,   // F  - Currency
  SPENDS:           6,   // G  - Amount Spent (INR)
  IMPRESSIONS:      7,   // H  - Impressions
  CLICKS:           8,   // I  - Link Clicks
  LPV:              9,   // J  - Landing Page Views
  ATC:              10,  // K  - Add To Cart
  PURCHASES:        11,  // L  - Purchases
  REVENUE:          12,  // M  - Purchase Value
  HOOK_VIEWS:       13,  // N  - 3-Sec Video Views (for Hook Rate)
  // N–AA (13–26): video & other Meta metrics
  PARTIAL_PREPAID:  27,  // AB - Partial Prepaid NCs
  TOTAL_NCS:        28,  // AC - Total NCs (Mixpanel)
  PDP_VIEWED:       29,  // AD - PDP Viewed
  ATC_BN:           30,  // AE - ATC / BN
  NCS_FUNNEL:       31,  // AF - NCs (Funnel)
  CATEGORY:         32,  // AG - Category
  PRODUCT:          33,  // AH - Product
  REGION:           34,  // AI - Region
  PERSON:           35,  // AJ - Person
  AD_TYPE:          36,  // AK - Ad Type (Reel / Static / Carousel …)
  CAMPAIGN_TYPE:    37,  // AL - Campaign Type
  AD_SOURCE:        38,  // AM - Ad Source (INF / INT)
  NARRATIVE:        39,  // AN - Creative Narrative
  BCA:              40,  // AO - BCA
  LANGUAGE:         42,  // AQ - Language
  INFLUENCE_BUCKET: 43   // AR - Influence Bucket
};

// ── Entry point ──────────────────────────────────────────────
function doGet(e) {
  const out = ContentService.createTextOutput();
  out.setMimeType(ContentService.MimeType.JSON);

  try {
    const p      = e.parameter || {};
    const action = p.action || 'overall';

    let result;
    switch (action) {
      case 'overall':  result = getOverallData(p);  break;
      case 'product':  result = getProductData(p);  break;
      case 'filters':  result = getFilterOptions();  break;
      default:         result = { error: 'Unknown action: ' + action };
    }

    out.setContent(JSON.stringify({
      success:   true,
      data:      result,
      updatedAt: new Date().toISOString()
    }));

  } catch (err) {
    out.setContent(JSON.stringify({ success: false, error: err.message }));
  }

  return out;
}

// ── Read raw DD data ─────────────────────────────────────────
function getRawData() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('DD');
  if (!sheet) throw new Error('DD sheet not found');

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const numRows = Math.min(lastRow - 1, 150000);
  return sheet.getRange(2, 1, numRows, 44).getValues();
}

// ── Helpers ──────────────────────────────────────────────────
function toDateStr(val) {
  if (!val) return null;
  const d = val instanceof Date ? val : new Date(val);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
}

function n(v) { return parseFloat(v) || 0; }

function str(v) { return String(v || '').trim() || 'Unknown'; }

function accumulate(obj, key, row, extra) {
  if (!obj[key]) {
    obj[key] = {
      spends: 0, impressions: 0, clicks: 0, lpv: 0,
      atc: 0, purchases: 0, revenue: 0,
      hookViews: 0, ncs: 0, prepaid: 0,
      ...extra
    };
  }
  const o = obj[key];
  o.spends      += n(row[COL.SPENDS]);
  o.impressions += n(row[COL.IMPRESSIONS]);
  o.clicks      += n(row[COL.CLICKS]);
  o.lpv         += n(row[COL.LPV]);
  o.atc         += n(row[COL.ATC]);
  o.purchases   += n(row[COL.PURCHASES]);
  o.revenue     += n(row[COL.REVENUE]);
  o.hookViews   += n(row[COL.HOOK_VIEWS]);
  o.ncs         += n(row[COL.TOTAL_NCS]);
  o.prepaid     += n(row[COL.PARTIAL_PREPAID]);
}

function addMetrics(o) {
  return {
    ...o,
    cac:        o.ncs > 0         ? o.spends / o.ncs                    : 0,
    roas:       o.spends > 0      ? o.revenue / o.spends                 : 0,
    ctr:        o.impressions > 0 ? (o.clicks / o.impressions) * 100     : 0,
    atcRate:    o.clicks > 0      ? (o.atc / o.clicks) * 100             : 0,
    pRate:      o.clicks > 0      ? (o.purchases / o.clicks) * 100       : 0,
    prepaidPct: o.ncs > 0         ? (o.prepaid / o.ncs) * 100            : 0,
    cpm:        o.impressions > 0 ? (o.spends / o.impressions) * 1000    : 0,
    hookRate:   o.impressions > 0 ? (o.hookViews / o.impressions) * 100  : 0
  };
}

function inRange(dayStr, from, to) {
  if (!dayStr) return false;
  if (from && dayStr < from) return false;
  if (to   && dayStr > to)   return false;
  return true;
}

// ── Overall Dashboard ────────────────────────────────────────
function getOverallData(p) {
  const rows    = getRawData();
  const from    = p.from || '';
  const to      = p.to   || '';

  const byDay      = {};
  const byProduct  = {};
  const byCategory = {};

  rows.forEach(row => {
    const day = toDateStr(row[COL.DAY]);
    if (!inRange(day, from, to)) return;

    const product  = str(row[COL.PRODUCT]);
    const category = str(row[COL.CATEGORY]);

    accumulate(byDay,      day,      row, { date: day });
    accumulate(byProduct,  product,  row, { name: product,  category });
    accumulate(byCategory, category, row, { name: category });
  });

  const sortSpends = arr => arr.sort((a, b) => b.spends - a.spends);

  const daily = Object.values(byDay)
    .map(d => addMetrics(d))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Week-over-week helper: attach WoW delta to each day
  const dateToIdx = {};
  daily.forEach((d, i) => { dateToIdx[d.date] = i; });
  daily.forEach(d => {
    const prev = new Date(d.date);
    prev.setDate(prev.getDate() - 7);
    const prevKey = prev.toISOString().split('T')[0];
    const p7 = daily[dateToIdx[prevKey]];
    d.wowSpends = p7 ? ((d.spends - p7.spends) / p7.spends) * 100 : null;
    d.wowNcs    = p7 ? ((d.ncs   - p7.ncs)   / p7.ncs)   * 100 : null;
  });

  const products  = sortSpends(Object.values(byProduct).map(addMetrics));
  const categories = sortSpends(Object.values(byCategory).map(addMetrics));

  // Period totals
  const totals = daily.reduce((acc, d) => {
    acc.spends      += d.spends;
    acc.impressions += d.impressions;
    acc.clicks      += d.clicks;
    acc.atc         += d.atc;
    acc.purchases   += d.purchases;
    acc.revenue     += d.revenue;
    acc.ncs         += d.ncs;
    acc.prepaid     += d.prepaid;
    return acc;
  }, { spends:0, impressions:0, clicks:0, atc:0, purchases:0, revenue:0, ncs:0, prepaid:0 });

  return { daily, products, categories, totals: addMetrics(totals) };
}

// ── Product / Category Dashboard ────────────────────────────
function getProductData(p) {
  const rows       = getRawData();
  const from       = p.from     || '';
  const to         = p.to       || '';
  const filterCat  = p.category || '';
  const filterProd = p.product  || '';

  const byCampaign = {}, byAdset = {}, byAd = {};
  const byNarrative = {}, byAdType = {}, byAdSource = {}, byInfBucket = {};
  const byDay = {};

  rows.forEach(row => {
    const day = toDateStr(row[COL.DAY]);
    if (!inRange(day, from, to)) return;
    if (filterCat  && str(row[COL.CATEGORY]) !== filterCat)  return;
    if (filterProd && str(row[COL.PRODUCT])  !== filterProd) return;

    const campaign  = str(row[COL.CAMPAIGN]);
    const adset     = str(row[COL.ADSET]);
    const ad        = str(row[COL.AD]);
    const narrative = str(row[COL.NARRATIVE]);
    const adType    = str(row[COL.AD_TYPE]);
    const adSource  = str(row[COL.AD_SOURCE]);
    const infBucket = str(row[COL.INFLUENCE_BUCKET]);

    accumulate(byDay,       day,       row, { date: day });
    accumulate(byCampaign,  campaign,  row, { name: campaign });
    accumulate(byAdset,     adset,     row, { name: adset, campaign });
    accumulate(byAd,        ad,        row, { name: ad, adset, campaign });
    accumulate(byNarrative, narrative, row, { name: narrative });
    accumulate(byAdType,    adType,    row, { name: adType });
    accumulate(byAdSource,  adSource,  row, { name: adSource });
    accumulate(byInfBucket, infBucket, row, { name: infBucket });
  });

  const sortBySpends = obj =>
    Object.values(obj).map(addMetrics).sort((a, b) => b.spends - a.spends);

  const daily = Object.values(byDay).map(addMetrics)
    .sort((a, b) => a.date.localeCompare(b.date));

  // Period totals for this filter
  const totals = daily.reduce((acc, d) => {
    acc.spends += d.spends; acc.ncs += d.ncs;
    acc.impressions += d.impressions; acc.clicks += d.clicks;
    acc.atc += d.atc; acc.purchases += d.purchases;
    acc.revenue += d.revenue; acc.prepaid += d.prepaid;
    return acc;
  }, { spends:0, ncs:0, impressions:0, clicks:0, atc:0, purchases:0, revenue:0, prepaid:0 });

  return {
    daily,
    totals:     addMetrics(totals),
    campaigns:  sortBySpends(byCampaign),
    adsets:     sortBySpends(byAdset),
    ads:        sortBySpends(byAd).slice(0, 100),
    narratives: sortBySpends(byNarrative),
    adTypes:    sortBySpends(byAdType),
    adSources:  sortBySpends(byAdSource),
    infBuckets: sortBySpends(byInfBucket)
  };
}

// ── Filter options ───────────────────────────────────────────
function getFilterOptions() {
  const rows       = getRawData();
  const categories = new Set();
  const products   = new Set();

  rows.forEach(row => {
    const cat  = str(row[COL.CATEGORY]);
    const prod = str(row[COL.PRODUCT]);
    if (cat  !== 'Unknown') categories.add(cat);
    if (prod !== 'Unknown') products.add(prod);
  });

  return {
    categories: [...categories].sort(),
    products:   [...products].sort()
  };
}
