/* [Unverified] Domo HTML Brick — enhanced drills & formatting per feedback */
(function () {
  // Chart.js theme
  Chart.defaults.color = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();
  Chart.defaults.borderColor = "#e3e8e2";
  Chart.defaults.font.family =
    "Gotham, 'Interstate', system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
  Chart.defaults.plugins.legend.labels.boxWidth = 12;
  Chart.defaults.elements.bar.borderRadius = 8;
  Chart.defaults.datasets.bar.maxBarThickness = 36;
  Chart.defaults.responsive = true;
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.elements.point.radius = 4;     // bigger points
  Chart.defaults.elements.point.hoverRadius = 6;

  // Aliases / fields from manifest
  const ALIASES = { MMR: "MMRData", REV: "googlereviews" };
  // in app.js — near the top where FIELDS is declared
  const FIELDS = {
    MMR: [
      "Property","Region","City","State","Status","ConstructionStatus","LatestConstructionStatus",
      "Units","InServiceUnits",
      "OccupancyPercent","CurrentLeasedPercent",
      "BudgetedOccupancyPercentageCurrentMonth","BudgetedLeasedPercentageCurrentMonth",
      "MI","MO","NetLsd","Applied","Denied","ReturnVisitCount","1stVisit",
      "T12LeasesExpired","T12LeasesRenewed",
      "CurrentMonthIncome","BudgetedIncome",
      "OccupiedRent","BudgetedRent","MoveInRent",
      "OccupiedRentPSF","BudgetedRentPSF","MoveinRentPSF",
      "Delinquent","Latitude","Longitude","FullAddress",
      // projections from dataset
      "Week3OccPercentage","Week7OccPercentage",
      "LatestDate","WeekStart","BirthOrder",
      //"ProjectedNetLeased" // ← ADD THIS
    ],
    REV: ["Property","rating","category","ReviewText","reviewdate","reviewername","BirthOrder"],
  };


  // Helpers
  function get(row, key){
    if (!row) return undefined;
    if (key in row) return row[key];
    const norm = s => (s||"").toString().replace(/\s+/g,"").toLowerCase();
    const found = Object.keys(row).find(k => norm(k)===norm(key));
    return found ? row[found] : undefined;
  }
  const asNum = v => (v==null||v==="") ? NaN : +(`${v}`.toString().replace(/[$,%]/g,""));
  const fmtInt = n => isFinite(n) ? Math.round(n).toLocaleString() : "—";
  function fmtPctSmart(n){
    if (!isFinite(n)) return "—";
    const v = (Math.abs(n)<=1 ? n*100 : n);
    return `${v.toFixed(2)}%`;
  }
  const fmtUSD0 = n => isFinite(n) ? `$${Math.round(n).toLocaleString()}` : "—";
  const fmtUSD2 = n => isFinite(n) ? `$${n.toFixed(2)}` : "—";
  const tickUSD0 = v => "$"+Intl.NumberFormat().format(Math.round(v));
  const tickUSD2 = v => "$"+Number(v).toFixed(2);
  function parseDateLike(v){ const d=new Date(v); return isNaN(d)?null:d; }
  function distinct(vals){ return Array.from(new Set(vals)); }
  
  // Format date for display in selectors (e.g., "Oct 20, 2025")
  function formatDateForDisplay(dateStr) {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  }
  
  // Calculate all-time moving average (uses all data, not just visible timeframe)
  function calculateMovingAverage(allData, allLabels, visibleLabels, windowSize = 11) {
    // Calculate MA for all data points
    const ma = [];
    for (let i = 0; i < allData.length; i++) {
      const start = Math.max(0, i - windowSize + 1);
      const slice = allData.slice(start, i + 1);
      const sum = slice.reduce((a, v) => a + (isFinite(v) ? v : 0), 0);
      ma.push(slice.length > 0 ? sum / slice.length : null);
    }
    
    // Map to visible labels only
    return visibleLabels.map(label => {
      const idx = allLabels.indexOf(label);
      return idx >= 0 ? ma[idx] : null;
    });
  }

  async function fetchAlias(alias, fields){
    const qs = new URLSearchParams();
    if (fields?.length) qs.set("fields", fields.join(","));
    qs.set("limit","50000");
    return domo.get(`/data/v2/${encodeURIComponent(alias)}?${qs.toString()}`);
  }

  /** Normalize Status for comparisons (Domo/API sometimes use special hyphens or spacing). */
  function normalizeStatusStr(s) {
    let t = (s || "").toString().trim().toLowerCase();
    t = t.replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-");
    t = t.replace(/\s+/g, " ");
    return t;
  }
  function isLeaseUpOrStabilizedStatus(s) {
    const n = normalizeStatusStr(s);
    return n === "lease-up" || n === "stabilized";
  }

  function byActive(rows){
    return rows.filter(r => isLeaseUpOrStabilizedStatus(get(r,"Status")));
  }
  function constKey(r){ return get(r,"ConstructionStatus")!==undefined ? "ConstructionStatus" : "LatestConstructionStatus"; }
  function byConst(rows, label){
    if (label==="All") return rows;
    return rows.filter(r => (get(r,constKey(r))||"").toString().toLowerCase().includes(label.toLowerCase()));
  }
  function sortByBirth(rows){ return rows.slice().sort((a,b)=>(asNum(get(a,"BirthOrder"))||0)-(asNum(get(b,"BirthOrder"))||0)); }
  /** Order property name strings by BirthOrder using rows that carry BirthOrder (same as tables/charts). */
  function sortPropertyNamesByBirth(names, rows) {
    if (!names || !names.length) return [];
    const set = new Set(names);
    const out = [];
    sortByBirth(rows).forEach(r => {
      const p = get(r, "Property");
      if (!p || !set.has(p)) return;
      set.delete(p);
      out.push(p);
    });
    Array.from(set).sort((a, b) => a.localeCompare(b)).forEach(p => out.push(p));
    return out;
  }
  const sum = (rows,key)=> rows.reduce((a,r)=>a+(isFinite(asNum(get(r,key)))?asNum(get(r,key)):0),0);
  function weightedAvg(rows, key){
    let num=0, den=0;
    rows.forEach(r=>{
      const w = asNum(get(r,"InServiceUnits")) || asNum(get(r,"Units")) || 0;
      const v = asNum(get(r,key));
      if (isFinite(v) && w>0){ num += v*w; den += w; }
    });
    return den>0 ? num/den : NaN;
  }

  // DOM helpers
  function $(sel){ return document.querySelector(sel); }
  function createPanel(host, title, withConstSelector=false){
    const wrap=document.createElement("div"); wrap.className="panel";
    const head=document.createElement("div"); head.className="panel-head";
    const ttl=document.createElement("div"); ttl.className="panel-title"; ttl.textContent=title; head.appendChild(ttl);
    const tools=document.createElement("div"); tools.className="inline-controls";
    if (withConstSelector){
      const s=document.createElement("select"); s.className="select";
      s.innerHTML = `<option value="All">All</option><option value="Completed">Completed</option><option value="Under Construction">Under Construction</option>`;
      tools.appendChild(s); head.appendChild(tools);
      wrap._constSelect = s;
    } else {
      head.appendChild(tools);
    }
    wrap.appendChild(head);
    const body=document.createElement("div"); body.className="panel-body"; wrap.appendChild(body);
    host.appendChild(wrap);
    return {wrap, body, head, tools};
  }
  function createCanvas(container){
    const c=document.createElement("canvas");
    c.style.width="100%"; c.style.height="100%";
    container.innerHTML=""; container.appendChild(c);
    return c.getContext("2d");
  }
  function renderTable(host, columns, rows, onRowClick, totals) {
  const t = document.createElement("table"); t.className = "table";

  // header
  const thead = document.createElement("thead"), trh = document.createElement("tr");
  columns.forEach(c => { const th = document.createElement("th"); th.textContent = c.label; trh.appendChild(th); });
  thead.appendChild(trh); t.appendChild(thead);

  // body
  const tb = document.createElement("tbody");
  rows.forEach(r => {
    const tr = document.createElement("tr");
    columns.forEach(c => {
      const td = document.createElement("td");
      let v = c.value ? c.value(r) : get(r, c.key);
      if (c.format) v = c.format(v, r);
      if (c.class) td.className = c.class;
      td.textContent = v == null ? "" : v;
      tr.appendChild(td);
    });
    if (onRowClick) { tr.style.cursor = "pointer"; tr.addEventListener("click", () => onRowClick(r)); }
    tb.appendChild(tr);
  });
  t.appendChild(tb);

  // footer (Total / averages)
  if (totals) {
    const tf = document.createElement("tfoot");
    const trf = document.createElement("tr");
    columns.forEach((c, i) => {
      const td = document.createElement("td");
      if (i === 0) td.innerHTML = "<strong>Total</strong>";
      else td.textContent = totals[c.label] ?? "";
      if (c.class) td.className = c.class;
      trf.appendChild(td);
    });
    tf.appendChild(trf);
    t.appendChild(tf);
  }

  host.appendChild(t);
}


  // Modal
  const modal = $("#modal"), modalTitle=$("#modal-title"), modalBody=$("#modal-body");
  $("#modal-close").addEventListener("click", closeModal);
  modal.addEventListener("click", (e)=>{ if(e.target===modal) closeModal(); });
  
  // CSV Export utility (ensures Property and Date columns exist)
  function exportToCSV(data, filename) {
    if (!data || data.length === 0) return;
    
    // Normalize rows: ensure Property and Date columns exist for all exports
    const normRows = data.map((row) => {
      const out = { ...row };
      // Property normalization
      const keys = Object.keys(out);
      const findKeyCaseInsensitive = (name) =>
        keys.find(k => k.toLowerCase() === name.toLowerCase());
      const propKey = findKeyCaseInsensitive('Property');
      if (!propKey) {
        out.Property = 'Portfolio';
      } else if (propKey !== 'Property') {
        // Promote to canonical key while preserving original
        out.Property = out[propKey];
      }
      
      // Date normalization: prefer WeekStart/Week/ReviewDate/Month/Period
      const weekStartKey = keys.find(k => k.toLowerCase() === 'weekstart');
      const weekKey = keys.find(k => k.toLowerCase() === 'week');
      const reviewDateKey = keys.find(k => k.toLowerCase() === 'reviewdate');
      const monthKey = keys.find(k => k.toLowerCase() === 'month');
      const periodKey = keys.find(k => k.toLowerCase() === 'period');
      let dateVal = out[weekStartKey] || out[weekKey] || out[reviewDateKey] || out[monthKey] || out[periodKey];
      if (!dateVal && typeof selectedWeek !== 'undefined' && selectedWeek) {
        dateVal = selectedWeek;
      }
      if (dateVal) {
        // Canonical Date column (string, yyyy-mm-dd or source string)
        try {
          const d = new Date(dateVal);
          out.Date = isNaN(d) ? String(dateVal) : d.toISOString().slice(0, 10);
        } catch (_) {
          out.Date = String(dateVal);
        }
      } else if (out.Date == null) {
        out.Date = '';
      }
      return out;
    });
    
    // Build headers with Property and Date first, then the rest in original order (deduped)
    const allKeys = Array.from(
      normRows.reduce((s, r) => { Object.keys(r).forEach(k => s.add(k)); return s; }, new Set())
    );
    const otherKeys = allKeys.filter(k => k !== 'Property' && k !== 'Date');
    const headers = ['Property', 'Date', ...otherKeys];
    
    // Create CSV content
    const csvContent = [
      headers.map(h => `"${h}"`).join(','),
      ...normRows.map(row => 
        headers.map(header => {
          const value = row[header];
          return `"${String(value ?? '').replace(/"/g, '""')}"`;
        }).join(',')
      )
    ].join('\n');
    
    // Create and trigger download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
  
  function openModal(title, renderFn, exportData = null){
    modalTitle.textContent = title; 
    modalBody.innerHTML = "";
    
    // Add export button if data is provided
    if (exportData) {
      const modalHead = modal.querySelector('.modal-head');
      const exportBtn = document.createElement('button');
      exportBtn.className = 'btn';
      exportBtn.textContent = 'Export CSV';
      exportBtn.style.marginRight = '10px';
      exportBtn.onclick = () => {
        const filename = `${title.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_')}.csv`;
        exportToCSV(exportData, filename);
      };
      modalHead.insertBefore(exportBtn, modalHead.querySelector('#modal-close'));
    }
    
    renderFn(modalBody);
    modal.setAttribute("aria-hidden","false");
  }
  function closeModal(){ 
    // Clean up export button
    const exportBtn = modal.querySelector('.modal-head button:not(#modal-close)');
    if (exportBtn) exportBtn.remove();
    modal.setAttribute("aria-hidden","true"); 
  }

  // Map
  function renderMap(host, rows){
    const div=document.createElement("div"); div.id="map"; div.style.height="520px"; host.appendChild(div);
    const map=L.map(div).setView([30.4,-90.9], 6);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"&copy; OpenStreetMap"}).addTo(map);
    rows.forEach(r=>{
      const lat=asNum(get(r,"Latitude")), lon=asNum(get(r,"Longitude"));
      if (!isFinite(lat)||!isFinite(lon)) return;
      const units=asNum(get(r,"Units"));
      L.circleMarker([lat,lon],{
        radius:Math.max(6,Math.min(18,Math.sqrt(units||0)/2)),
        weight:1,color:"#7e8a6b",fillColor:"#7e8a6b",fillOpacity:.75
      }).addTo(map).bindPopup(`<b>${get(r,"Property")}</b><br/>${get(r,"FullAddress")||""}<br/>Units: ${fmtInt(units)}`);
    });
  }

  // ---------- Breadcrumbs (charts only) ----------
  function renderBreadcrumb(panelBody, trail, onClick) {
  let bc = panelBody.parentElement.querySelector(".breadcrumb");
  if (!bc) {
    bc = document.createElement("div");
    bc.className = "breadcrumb";
    bc.style.margin = "0";        // no margin
    bc.style.padding = "0";       // no padding
    bc.style.fontSize = "12px";
    bc.style.color = "var(--muted)";
    panelBody.parentElement.insertBefore(bc, panelBody);
  }

  bc.innerHTML = "";
  trail.forEach((t, i) => {
    const a = document.createElement("span");
    a.textContent = t;
    a.style.cursor = i < trail.length - 1 ? "pointer" : "default";
    a.style.fontWeight = i === trail.length - 1 ? "700" : "600";
    if (i < trail.length - 1) a.addEventListener("click", () => onClick(i));
    bc.appendChild(a);
    if (i < trail.length - 1) bc.appendChild(document.createTextNode(" › "));
  });
}


  // ---------- Stateful drill helpers ----------
// --- REPLACE: propertyWeeklySeries ---
// REPLACE: propertyWeeklySeries
function propertyWeeklySeries(rowsAll, prop){
    const numOrNull = (v) => {
      const n = asNum(v);
      return Number.isFinite(n) ? n : null;
    };

    const rows = sortByBirth(rowsAll.filter(r => get(r,"Property") === prop));
    const byWeek = {};
    rows.forEach(r=>{
      const wk = (get(r,"WeekStart")||"").toString().slice(0,10);
      if(!wk) return;
      (byWeek[wk] ||= {MI:0,MO:0,NetLsd:0,Occ:null,Lea:null,BOcc:null,BLea:null,Proj:null});
      byWeek[wk].MI     = asNum(get(r,"MI")) || 0;
      byWeek[wk].MO     = asNum(get(r,"MO")) || 0;
      byWeek[wk].NetLsd = asNum(get(r,"NetLsd")) || 0;
      byWeek[wk].Occ    = numOrNull(get(r,"OccupancyPercent"));
      byWeek[wk].Lea    = numOrNull(get(r,"CurrentLeasedPercent"));
      byWeek[wk].BOcc   = numOrNull(get(r,"BudgetedOccupancyPercentageCurrentMonth"));
      byWeek[wk].BLea   = numOrNull(get(r,"BudgetedLeasedPercentageCurrentMonth"));
      //byWeek[wk].Proj   = numOrNull(get(r,"ProjectedNetLeased")); // ← key fix: nulls, not NaN
    });

    const weeks = Object.keys(byWeek).sort();
    return {
      labels: weeks,
      mi:    weeks.map(w=>byWeek[w].MI),
      mo:    weeks.map(w=>byWeek[w].MO),
      net:   weeks.map(w=>byWeek[w].NetLsd),
      occ:   weeks.map(w=>byWeek[w].Occ),
      lea:   weeks.map(w=>byWeek[w].Lea),
      bocc:  weeks.map(w=>byWeek[w].BOcc),
      blea:  weeks.map(w=>byWeek[w].BLea),
      proj:  weeks.map(w=>byWeek[w].Proj)      // ← will be null where missing, renders correctly
    };
}

// ---------- Charts (latest week, drillable) ----------
function moveInsVsMoveOuts(rowsLatest, filter = "All") {
  let rows = sortByBirth(byActive(rowsLatest));
  if (filter !== "All") rows = byConst(rows, filter);
  const labels = rows.map(r => get(r, "Property"));
  const mi = rows.map(r => asNum(get(r, "MI")) || 0);
  const mo = rows.map(r => asNum(get(r, "MO")) || 0);

  // --- helpers for units + weeks ---
  const allWeeks = distinct(MMR.map(r => (get(r, "WeekStart") || "").toString().slice(0, 10))).filter(Boolean).sort();
  function activeRowsForWeek(week) {
    let arr = byActive(MMR).filter(r => (get(r, "WeekStart") || "").toString().startsWith(week));
    if (filter !== "All") arr = byConst(arr, filter);
    return arr;
  }
  function activeUnitsForWeek(week) {
    return activeRowsForWeek(week).reduce((a, r) => {
      const u = asNum(get(r, "InServiceUnits")) || asNum(get(r, "Units")) || 0;
      return a + (isFinite(u) ? u : 0);
    }, 0);
  }

  // --- Net Move-Ins (ΣMI - ΣMO) for the visible bars ---
  const sum = arr => arr.reduce((a, b) => a + (+b || 0), 0);
  const netValue = sum(mi) - sum(mo);
  const netText = `Net Move-Ins: ${netValue >= 0 ? "+" : ""}${fmtInt(netValue)}`;

  // ---------- Portfolio weekly net (respects construction filter) ----------
  function portfolioWeeklyNetSeries(weeksRange = null) {
    let all = sortByBirth(byActive(MMR));
    if (filter !== "All") all = byConst(all, filter);
    const byWeek = {};
    all.forEach(r => {
      const wk = (get(r, "WeekStart") || "").toString().slice(0, 10);
      if (!wk) return;
      const MI = asNum(get(r, "MI")) || 0;
      const MO = asNum(get(r, "MO")) || 0;
      const units = asNum(get(r, "InServiceUnits")) || asNum(get(r, "Units")) || 0;
      (byWeek[wk] ||= { mi: 0, mo: 0, units: 0 });
      byWeek[wk].mi += MI;
      byWeek[wk].mo += MO;
      byWeek[wk].units += units;
    });
    let weeks = Object.keys(byWeek).sort();
    if (weeksRange && weeksRange.from && weeksRange.to) weeks = weeks.filter(w => w >= weeksRange.from && w <= weeksRange.to);
    return {
      weeks,
      mi: weeks.map(w => byWeek[w].mi),
      mo: weeks.map(w => byWeek[w].mo),
      net: weeks.map(w => byWeek[w].mi - byWeek[w].mo),
      units: weeks.map(w => byWeek[w].units),
      table: weeks.map(w => ({ WeekStart: w, MI: byWeek[w].mi, MO: byWeek[w].mo, Net: byWeek[w].mi - byWeek[w].mo, Units: byWeek[w].units }))
    };
  }

  // ---------- Clickable callout plugin ----------
  const netCalloutPlugin = {
    id: "netCallout",
    afterDatasetsDraw(chart) {
      const opts = chart.options?.plugins?.netCallout || {};
      if (!opts.show) { chart.$_netCalloutBounds = null; return; }

      const { ctx, chartArea } = chart;
      const padX = 10, boxH = 26, r = 8;
      const txt = opts.text || "";
      ctx.save();
      ctx.font = Chart.helpers.toFont(Chart.defaults.font).string;
      const boxW = ctx.measureText(txt).width + padX * 2;

      const x = chartArea.right - boxW - 6;
      const y = chartArea.top + 6;

      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + boxW, y, x + boxW, y + boxH, r);
      ctx.arcTo(x + boxW, y + boxH, x, y + boxH, r);
      ctx.arcTo(x, y + boxH, x, y, r);
      ctx.arcTo(x, y, x + r, y, r);
      ctx.closePath();
      ctx.fillStyle = "#f5f7f2";
      ctx.strokeStyle = "#a6ad8a";
      ctx.lineWidth = 1;
      ctx.fill(); ctx.stroke();

      ctx.fillStyle = "#2f5d41";
      ctx.textBaseline = "middle";
      ctx.fillText(txt, x + padX, y + boxH / 2);
      ctx.restore();

      chart.$_netCalloutBounds = { x, y, w: boxW, h: boxH };
    }
  };

  // ---------- drill / UI state ----------
  let drillLevel = 0;        // 0 = bars, 1 = property weekly line, 2 = portfolio weekly net line
  let drilledProp = null;
  let portfolioSeries = null;
  let chart = null;

  return (panelBody) => {
    const titleEl = panelBody.parentElement.querySelector(".panel-title");
    const baseTitle = titleEl.textContent;
    const tools = panelBody.parentElement.querySelector(".inline-controls");

    // ------- controls: View toggle & timeline selects -------
    tools?.querySelectorAll("[data-role='mi-view'],[data-role='mi-from'],[data-role='mi-to'],[data-role='mi-back']").forEach(n => n.remove());

    // Back button (true back, prominent)
    const backBtn = document.createElement("button");
    backBtn.className = "btn";
    backBtn.setAttribute("data-role","mi-back");
    backBtn.textContent = "← Back";
    backBtn.style.fontWeight = "800";
    backBtn.style.display = "none";
    tools?.insertBefore(backBtn, tools.firstChild || null);

    const viewSel = document.createElement("select");
    viewSel.className = "select";
    viewSel.setAttribute("data-role", "mi-view");
    viewSel.innerHTML = `<option value="chart">Chart</option><option value="table">Table</option>`;
    tools?.appendChild(viewSel);

    const fromSel = document.createElement("select");
    fromSel.className = "select";
    fromSel.setAttribute("data-role", "mi-from");
    fromSel.title = "From week";
    fromSel.style.display = "none";

    const toSel = document.createElement("select");
    toSel.className = "select";
    toSel.setAttribute("data-role", "mi-to");
    toSel.title = "To week";
    toSel.style.display = "none";

    const opts = allWeeks.map(w => `<option value="${w}">${formatDateForDisplay(w)}</option>`).join("");
    fromSel.innerHTML = opts;
    toSel.innerHTML = opts;
    fromSel.value = allWeeks[Math.max(0, allWeeks.length - 8)];
    toSel.value = allWeeks[allWeeks.length - 1];
    tools?.appendChild(fromSel);
    tools?.appendChild(toSel);

    // Preset date range buttons
    const presetWrap = document.createElement("div");
    presetWrap.setAttribute("data-role", "mi-presets");
    presetWrap.style.display = "none";
    presetWrap.style.display = "flex";
    presetWrap.style.gap = "6px";
    presetWrap.style.alignItems = "center";
    
    function setPresetRange(months) {
      if (!allWeeks.length) return;
      const endDate = new Date(allWeeks[allWeeks.length - 1]);
      const startDate = new Date(endDate);
      startDate.setMonth(startDate.getMonth() - months);
      const startStr = startDate.toISOString().slice(0, 10);
      // Find closest available weeks
      const closestStart = allWeeks.find(w => w >= startStr) || allWeeks[0];
      const closestEnd = allWeeks[allWeeks.length - 1];
      fromSel.value = closestStart;
      toSel.value = closestEnd;
      // Trigger change event
      fromSel.dispatchEvent(new Event('change'));
      toSel.dispatchEvent(new Event('change'));
    }
    
    ["1m", "3m", "6m", "12m"].forEach(label => {
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = label;
      btn.style.fontSize = "11px";
      btn.style.padding = "6px 10px";
      btn.onclick = () => {
        const months = { "1m": 1, "3m": 3, "6m": 6, "12m": 12 }[label];
        setPresetRange(months);
      };
      presetWrap.appendChild(btn);
    });
    tools?.appendChild(presetWrap);

    function setRangeVisible(v) {
      const disp = v ? "" : "none";
      fromSel.style.display = disp;
      toSel.style.display = disp;
      presetWrap.style.display = v ? "flex" : "none";
    }
    function currentRange() {
      const a = fromSel.value, b = toSel.value;
      if (!a || !b) return null;
      const from = a <= b ? a : b, to = b >= a ? b : a;
      return { from, to };
    }
    function clearPanel() { panelBody.innerHTML = ""; chart = null; }
    function styleCrumbs() {
      const bc = panelBody.parentElement.querySelector(".breadcrumb");
      if (bc) { bc.style.fontSize = "13px"; bc.style.fontWeight = "800"; bc.style.padding = "2px 0 6px"; }
    }
    function updateBackBtn() {
      backBtn.style.display = (viewSel.value === "chart" && drillLevel > 0) ? "" : "none";
    }
    function backToBase() {
      drilledProp = null; drillLevel = 0;
      titleEl.textContent = baseTitle;
      setRangeVisible(false);
      renderChart(); // re-render base
    }
    backBtn.onclick = backToBase;

    // ---------- TABLE VIEW (scrollable) ----------
    function renderTableView() {
      clearPanel();
      setRangeVisible(false);
      renderBreadcrumb(panelBody, [baseTitle, "Table"], () => {});
      styleCrumbs();
      updateBackBtn();

      const scroller = document.createElement("div");
      scroller.style.height = "100%"; scroller.style.overflow = "auto"; scroller.style.paddingRight = "2px";
      panelBody.appendChild(scroller);

      const week = (selectedWeek || "").toString().slice(0, 10);
      const activeWeekRows = sortByBirth(byActive(rowsLatest));

      const rowsTbl = activeWeekRows.map(r => {
        const MIv = asNum(get(r, "MI")) || 0;
        const MOv = asNum(get(r, "MO")) || 0;
        const Net = MIv - MOv;
        const UnitsProp = asNum(get(r, "InServiceUnits")) || asNum(get(r, "Units")) || 0;
        return { Property: get(r, "Property"), MI: MIv, MO: MOv, Net, UnitsProp };
      });

      const portfolioUnits = activeUnitsForWeek(week);
      const totals = {
        "Move-Ins": fmtInt(sum(rowsTbl.map(x => x.MI))),
        "Move-Outs": fmtInt(sum(rowsTbl.map(x => x.MO))),
        "Net": fmtInt(sum(rowsTbl.map(x => x.Net))),
        "% Gain/Loss": fmtPctSmart(portfolioUnits > 0 ? (sum(rowsTbl.map(x => x.Net)) / portfolioUnits) : NaN)
      };

      // Add export button for table view
      const exportBtn = document.createElement('button');
      exportBtn.className = 'btn';
      exportBtn.textContent = 'Export CSV';
      exportBtn.style.marginBottom = '10px';
      exportBtn.onclick = () => {
        const exportData = rowsTbl.map(r => ({
          Property: r.Property,
          Week: week,
          "Move-Ins": r.MI,
          "Move-Outs": r.MO,
          "Net": r.Net,
          "% Gain/Loss": (r.UnitsProp > 0) ? (r.Net / r.UnitsProp) : NaN
        }));
        const filename = `Move-Ins_vs_Move-Outs_Table_${week}.csv`;
        exportToCSV(exportData, filename);
      };
      scroller.insertBefore(exportBtn, scroller.firstChild);

      renderTable(scroller, [
        { label: "Property", key: "Property" },
        { label: "Move-Ins", value: r => fmtInt(r.MI), class: "num" },
        { label: "Move-Outs", value: r => fmtInt(r.MO), class: "num" },
        { label: "Net", value: r => fmtInt(r.Net), class: "num" },
        { label: "% Gain/Loss", value: r => fmtPctSmart((r.UnitsProp > 0) ? (r.Net / r.UnitsProp) : NaN), class: "num" }
      ], rowsTbl, (r) => {
        const prop = r.Property;
        const hist = sortByBirth(MMR.filter(x => get(x, "Property") === prop))
          .sort((a, b) => (get(b, "WeekStart") || "").localeCompare((get(a, "WeekStart") || "")));
        const rows = hist.map(x => {
          const wk = (get(x, "WeekStart") || "").toString().slice(0, 10);
          const MIv = asNum(get(x, "MI")) || 0;
          const MOv = asNum(get(x, "MO")) || 0;
          const Net = MIv - MOv;
          const den = asNum(get(x, "InServiceUnits")) || asNum(get(x, "Units")) || 0;
          return { Property: prop, WeekStart: wk, MI: MIv, MO: MOv, Net, Den: den };
        });
        openModal(`Move-Ins vs Move-Outs — ${prop} — Weekly`, b => {
          const totMI = sum(rows.map(x => x.MI));
          const totMO = sum(rows.map(x => x.MO));
          const totNet = sum(rows.map(x => x.Net));
          let propUnitsRef = NaN; for (const x of rows) { if (isFinite(x.Den) && x.Den > 0) { propUnitsRef = x.Den; break; } }

          renderTable(b, [
            { label: "WeekStart", value: x => x.WeekStart },
            { label: "Move-Ins",  value: x => fmtInt(x.MI), class: "num" },
            { label: "Move-Outs", value: x => fmtInt(x.MO), class: "num" },
            { label: "Net",       value: x => fmtInt(x.Net), class: "num" },
            { label: "% Gain/Loss", value: x => fmtPctSmart((x.Den > 0) ? (x.Net / x.Den) : NaN), class: "num" }
          ], rows, undefined, {
            "Move-Ins": fmtInt(totMI),
            "Move-Outs": fmtInt(totMO),
            "Net": fmtInt(totNet),
            "% Gain/Loss": fmtPctSmart((isFinite(propUnitsRef) && propUnitsRef > 0) ? (totNet / propUnitsRef) : NaN)
          });
        }, rows);
      }, totals);
    }

    // ---------- CHART VIEW ----------
    function renderChart() {
      clearPanel();
      setRangeVisible(false);
      renderBreadcrumb(panelBody, [baseTitle], () => {});
      styleCrumbs();
      updateBackBtn();

      const ctx = createCanvas(panelBody);
      const maxX_MI_MO = (()=>{
        const safe = [...mi, ...mo].map(v => +v || 0);
        const mv = safe.length ? Math.max(...safe) : 0;
        return Math.max(10, mv);
      })();
      chart = new Chart(ctx, {
        type: "bar",
        data: { labels, datasets: [
          { label: "Move-Ins",  data: mi, backgroundColor: "#a6ad8a", categoryPercentage: 0.55, barPercentage: 0.7 },
          { label: "Move-Outs", data: mo, backgroundColor: "#bdc2ce", categoryPercentage: 0.55, barPercentage: 0.7 }
        ]},
        options: {
          indexAxis: "y", // HORIZONTAL BARS (only first chart)
          plugins: {
            legend: { position: "bottom" },
            netCallout: { show: true, text: netText },
            tooltip: {
              callbacks: {
                title: (items) => `Property: ${items[0]?.label ?? ''}`,
                label: (c) => {
                  const label = c.dataset.label || '';
                  const val = c.parsed.x;
                  const desc = label.includes('Move-Ins')
                    ? 'Leases started this week'
                    : 'Leases ended this week';
                  return `${label}: ${fmtInt(val)} — ${desc}`;
                }
              }
            }
          },
          layout: { padding: { left: 8, right: 16, top: 8, bottom: 8 } },
          scales: { x: { beginAtZero: true, min: 0, max: maxX_MI_MO } },
          onClick: (evt, els) => {
            // callout click => portfolio weekly net line
            const b = chart.$_netCalloutBounds;
            if (b) {
              const pos = Chart.helpers.getRelativePosition(evt, chart);
              if (pos.x >= b.x && pos.x <= b.x + b.w && pos.y >= b.y && pos.y <= b.y + b.h) {
                drillLevel = 2; drilledProp = null;
                titleEl.textContent = `${baseTitle} — Portfolio Net`;
                setRangeVisible(true);
                const rng = currentRange();
                portfolioSeries = portfolioWeeklyNetSeries(rng);
                
                // Get all-time data for moving average calculation
                const allTimeSeries = portfolioWeeklyNetSeries(null);
                const maNet30 = calculateMovingAverage(allTimeSeries.net, allTimeSeries.weeks, portfolioSeries.weeks, 4);
                const maNet90 = calculateMovingAverage(allTimeSeries.net, allTimeSeries.weeks, portfolioSeries.weeks, 13);
                
                // Destroy old chart and create new line chart
                if (chart) chart.destroy();
                const ctx = createCanvas(panelBody);
                chart = new Chart(ctx, {
                  type: "line",
                  data: {
                    labels: portfolioSeries.weeks.map(w => formatDateForDisplay(w)),
                    datasets: [{
                      label: "Net Move-Ins",
                      data: portfolioSeries.net,
                      borderColor: "#2f5d41",
                      backgroundColor: "#2f5d41",
                      tension: .25,
                      pointRadius: 3
                    }, {
                      label: "30-Day Moving Average (All-Time)",
                      data: maNet30,
                      borderColor: "#7e8a6b",
                      backgroundColor: "#7e8a6b",
                      borderDash: [3,3],
                      tension: 0,
                      pointRadius: 1,
                      pointHoverRadius: 3,
                      borderWidth: 1
                    }, {
                      label: "90-Day Moving Average (All-Time)",
                      data: maNet90,
                      borderColor: "#a6ad8a",
                      backgroundColor: "#a6ad8a",
                      borderDash: [4,4],
                      tension: 0,
                      pointRadius: 1.5,
                      pointHoverRadius: 3.5,
                      borderWidth: 1.2
                    }]
                  },
                  options: {
                    scales: { y: { beginAtZero: true } },
                    plugins: {
                      tooltip: {
                        callbacks: {
                          title: (context) => `Week: ${context[0]?.label ?? ''}`,
                          label: (c) => `${c.dataset.label}: ${fmtInt(c.parsed.y)}`
                        }
                      }
                    },
                    onClick: () => {
                      const pf = portfolioWeeklyNetSeries(currentRange());
                      const totals = {
                        "Move-Ins": fmtInt(sum(pf.mi)),
                        "Move-Outs": fmtInt(sum(pf.mo)),
                        "Net": fmtInt(sum(pf.net)),
                        "% Gain/Loss": fmtPctSmart((sum(pf.units) > 0) ? (sum(pf.net) / sum(pf.units)) : NaN)
                      };
                      openModal(`Portfolio Net Move-Ins — Weekly`, b => {
                        renderTable(b, [
                          { label:"WeekStart",  value:r=>r.WeekStart },
                          { label:"Move-Ins",   value:r=>fmtInt(r.MI), class:"num" },
                          { label:"Move-Outs",  value:r=>fmtInt(r.MO), class:"num" },
                          { label:"Net",        value:r=>fmtInt(r.Net), class:"num" },
                          { label:"% Gain/Loss", value:r=>fmtPctSmart((r.Units > 0) ? (r.Net / r.Units) : NaN), class:"num" }
                        ], pf.table, undefined, totals);
                      }, pf.table);
                    }
                  }
                });
                
                const onRangePortfolio = () => {
                  if (drillLevel !== 2) return;
                  const rng = currentRange();
                  portfolioSeries = portfolioWeeklyNetSeries(rng);
                  chart.data.labels = portfolioSeries.weeks.map(w => formatDateForDisplay(w));
                  chart.data.datasets[0].data = portfolioSeries.net;
                  chart.update();
                };
                fromSel.onchange = toSel.onchange = onRangePortfolio;
                
                renderBreadcrumb(panelBody, [baseTitle, "Portfolio Net"], (level)=>{ if (level===0) backToBase(); });
                styleCrumbs();
                updateBackBtn();
                return;
              }
            }

            // NEW: when viewing portfolio net line, a click opens the PORTFOLIO weekly table (not a property drill)
            if (drillLevel === 2) {
              const pf = portfolioWeeklyNetSeries(currentRange());
              const totals = {
                "Move-Ins": fmtInt(sum(pf.mi)),
                "Move-Outs": fmtInt(sum(pf.mo)),
                "Net": fmtInt(sum(pf.net)),
                "% Gain/Loss": fmtPctSmart((sum(pf.units) > 0) ? (sum(pf.net) / sum(pf.units)) : NaN)
              };
              openModal(`Portfolio Net Move-Ins — Weekly`, b => {
                renderTable(b, [
                  { label: "WeekStart",  value: r => r.WeekStart },
                  { label: "Move-Ins",   value: r => fmtInt(r.MI), class: "num" },
                  { label: "Move-Outs",  value: r => fmtInt(r.MO), class: "num" },
                  { label: "Net",        value: r => fmtInt(r.Net), class: "num" },
                  { label: "% Gain/Loss", value: r => fmtPctSmart((r.Units > 0) ? (r.Net / r.Units) : NaN), class: "num" }
                ], pf.table, undefined, totals);
              }, pf.table);
              return;
            }

            // Level 1 (property line) table on click (same property)
            if (drillLevel === 1 && drilledProp) {
              const rng = currentRange();
              const hist = sortByBirth(MMR.filter(r => {
                if (get(r, "Property") !== drilledProp) return false;
                if (!rng) return true;
                const wk = (get(r, "WeekStart") || "").toString().slice(0, 10);
                return wk >= rng.from && wk <= rng.to;
              }))
                .sort((a, b) => (get(b, "WeekStart") || "").localeCompare((get(a, "WeekStart") || "")));
              const rows = hist.map(r => {
                const wk = (get(r, "WeekStart") || "").toString().slice(0, 10);
                const MIv = asNum(get(r, "MI")) || 0;
                const MOv = asNum(get(r, "MO")) || 0;
                const Net = MIv - MOv;
                const den = asNum(get(r, "InServiceUnits")) || asNum(get(r, "Units")) || 0;
                return { Property: drilledProp, WeekStart: wk, MI: MIv, MO: MOv, Net, Den: den };
              });
              openModal(`Move-Ins vs Move-Outs — ${drilledProp}`, b => {
                const tMI = sum(rows.map(x => x.MI));
                const tMO = sum(rows.map(x => x.MO));
                const tNet = sum(rows.map(x => x.Net));
                let propUnitsRef = NaN; for (const x of rows) { if (isFinite(x.Den) && x.Den > 0) { propUnitsRef = x.Den; break; } }

                renderTable(b, [
                  { label: "WeekStart",   value: r => r.WeekStart },
                  { label: "Move-Ins",    value: r => fmtInt(r.MI), class: "num" },
                  { label: "Move-Outs",   value: r => fmtInt(r.MO), class: "num" },
                  { label: "Net",         value: r => fmtInt(r.Net), class: "num" },
                  { label: "% Gain/Loss", value: r => fmtPctSmart((r.Den > 0) ? (r.Net / r.Den) : NaN), class: "num" }
                ], rows, undefined, {
                  "Move-Ins": fmtInt(tMI),
                  "Move-Outs": fmtInt(tMO),
                  "Net": fmtInt(tNet),
                  "% Gain/Loss": fmtPctSmart((isFinite(propUnitsRef) && propUnitsRef > 0) ? (tNet / propUnitsRef) : NaN)
                });
              }, rows);
              return;
            }

            // Level 0 bars -> drill to property weekly line
            if (!els.length) return;
            const i = els[0].index;
            const prop = labels[i];

            drilledProp = prop;
            drillLevel = 1;
            titleEl.textContent = `${baseTitle} — ${prop}`;
            setRangeVisible(true);

            const series = propertyWeeklySeries(MMR, prop);
            function slicePropSeries(sr) {
              const rng = currentRange();
              const indices = sr.labels.map((w, idx) => ({ w, idx }))
                .filter(x => !rng || (x.w >= rng.from && x.w <= rng.to))
                .map(x => x.idx);
              return { labels: indices.map(i => sr.labels[i]), mi: indices.map(i => sr.mi[i]), mo: indices.map(i => sr.mo[i]) };
            }
            let s = slicePropSeries({ labels: series.labels, mi: series.mi, mo: series.mo });
            
            // Calculate all-time moving averages (30-day, 90-day)
            const maMI30 = calculateMovingAverage(series.mi, series.labels, s.labels, 4);
            const maMO30 = calculateMovingAverage(series.mo, series.labels, s.labels, 4);
            const maMI90 = calculateMovingAverage(series.mi, series.labels, s.labels, 13);
            const maMO90 = calculateMovingAverage(series.mo, series.labels, s.labels, 13);

            // Destroy old chart and create new line chart
            if (chart) chart.destroy();
            const ctx = createCanvas(panelBody);
            chart = new Chart(ctx, {
              type: "line",
              data: {
                labels: s.labels.map(l => typeof l === 'string' && l.match(/^\d{4}-\d{2}-\d{2}$/) ? formatDateForDisplay(l) : l),
                datasets: [
                  { label: "Move-Ins",  data: s.mi, borderColor: "#2f5d41", backgroundColor: "#2f5d41", tension: .25, pointRadius: 3 },
                  { label: "Move-Outs", data: s.mo, borderColor: "#9aa796", backgroundColor: "#9aa796", tension: .25, pointRadius: 3 },
                  { label: "30-Day Moving Average Move-Ins (All-Time)", data: maMI30, borderColor: "#7e8a6b", backgroundColor: "#7e8a6b", borderDash: [3,3], tension: 0, pointRadius: 1, pointHoverRadius: 3, borderWidth: 1 },
                  { label: "30-Day Moving Average Move-Outs (All-Time)", data: maMO30, borderColor: "#a6ad8a", backgroundColor: "#a6ad8a", borderDash: [3,3], tension: 0, pointRadius: 1, pointHoverRadius: 3, borderWidth: 1 },
                  { label: "90-Day Moving Average Move-Ins (All-Time)", data: maMI90, borderColor: "#5a6b4a", backgroundColor: "#5a6b4a", borderDash: [4,4], tension: 0, pointRadius: 1.5, pointHoverRadius: 3.5, borderWidth: 1.2 },
                  { label: "90-Day Moving Average Move-Outs (All-Time)", data: maMO90, borderColor: "#8a9578", backgroundColor: "#8a9578", borderDash: [4,4], tension: 0, pointRadius: 1.5, pointHoverRadius: 3.5, borderWidth: 1.2 }
                ]
              },
              options: {
                scales: { y: { beginAtZero: true } },
                plugins: {
                  tooltip: {
                    callbacks: {
                      title: (context) => `Week: ${context[0]?.label ?? ''}`,
                      label: (c) => `${c.dataset.label}: ${fmtInt(c.parsed.y)}`
                    }
                  }
                },
                onClick: (_, elements) => {
                  const rng = currentRange();
                  const hist = sortByBirth(MMR.filter(r => {
                    if (get(r, "Property") !== drilledProp) return false;
                    if (!rng) return true;
                    const wk = (get(r, "WeekStart") || "").toString().slice(0, 10);
                    return wk >= rng.from && wk <= rng.to;
                  }))
                    .sort((a, b) => (get(b, "WeekStart") || "").localeCompare((get(a, "WeekStart") || "")));
                  const rows = hist.map(r => {
                    const wk = (get(r, "WeekStart") || "").toString().slice(0, 10);
                    const MIv = asNum(get(r, "MI")) || 0;
                    const MOv = asNum(get(r, "MO")) || 0;
                    const Net = MIv - MOv;
                    const den = asNum(get(r, "InServiceUnits")) || asNum(get(r, "Units")) || 0;
                    return { Property: drilledProp, WeekStart: wk, MI: MIv, MO: MOv, Net, Den: den };
                  });
                  openModal(`Move-Ins vs Move-Outs — ${drilledProp}`, b => {
                    const tMI = sum(rows.map(x => x.MI));
                    const tMO = sum(rows.map(x => x.MO));
                    const tNet = sum(rows.map(x => x.Net));
                    let propUnitsRef = NaN; for (const x of rows) { if (isFinite(x.Den) && x.Den > 0) { propUnitsRef = x.Den; break; } }

                    renderTable(b, [
                      { label: "WeekStart",   value: r => r.WeekStart },
                      { label: "Move-Ins",    value: r => fmtInt(r.MI), class: "num" },
                      { label: "Move-Outs",   value: r => fmtInt(r.MO), class: "num" },
                      { label: "Net",         value: r => fmtInt(r.Net), class: "num" },
                      { label: "% Gain/Loss", value: r => fmtPctSmart((r.Den > 0) ? (r.Net / r.Den) : NaN), class: "num" }
                    ], rows, undefined, {
                      "Move-Ins": fmtInt(tMI),
                      "Move-Outs": fmtInt(tMO),
                      "Net": fmtInt(tNet),
                      "% Gain/Loss": fmtPctSmart((isFinite(propUnitsRef) && propUnitsRef > 0) ? (tNet / propUnitsRef) : NaN)
                    });
                  }, rows);
                }
              }
            });
            renderBreadcrumb(panelBody, [baseTitle, prop], (level)=>{ if(level===0) backToBase(); });
            styleCrumbs();
            updateBackBtn();

            const onRange = () => {
              const full = propertyWeeklySeries(MMR, prop);
              const sliced = slicePropSeries({ labels: full.labels, mi: full.mi, mo: full.mo });
              const maMI = calculateMovingAverage(full.mi, full.labels, sliced.labels, 11);
              const maMO = calculateMovingAverage(full.mo, full.labels, sliced.labels, 11);
              chart.data.labels = sliced.labels;
              chart.data.datasets[0].data = sliced.mi;
              chart.data.datasets[1].data = sliced.mo;
              chart.data.datasets[2].data = maMI;
              chart.data.datasets[3].data = maMO;
              chart.update();
            };
            fromSel.onchange = toSel.onchange = onRange;
          }
        },
        plugins: [netCalloutPlugin]
      });

                const onRangePortfolio = () => {
                  if (drillLevel !== 2) return;
                  const rng = currentRange();
                  portfolioSeries = portfolioWeeklyNetSeries(rng);
                  const allTimeSeries = portfolioWeeklyNetSeries(null);
                  const maNet30 = calculateMovingAverage(allTimeSeries.net, allTimeSeries.weeks, portfolioSeries.weeks, 4);
                  const maNet90 = calculateMovingAverage(allTimeSeries.net, allTimeSeries.weeks, portfolioSeries.weeks, 13);
                  chart.data.labels = portfolioSeries.weeks.map(w => formatDateForDisplay(w));
                  chart.data.datasets[0].data = portfolioSeries.net;
                  if (chart.data.datasets.length > 1) chart.data.datasets[1].data = maNet30;
                  if (chart.data.datasets.length > 2) chart.data.datasets[2].data = maNet90;
                  chart.update();
                };
      fromSel.onchange = toSel.onchange = onRangePortfolio;
    }

    function render() {
      if (viewSel.value === "table") renderTableView();
      else renderChart();
    }
    viewSel.onchange = () => { drillLevel = 0; drilledProp = null; titleEl.textContent = baseTitle; render(); };
    render();
  };
}


// REPLACE the existing netLeasesBar with this version
function netLeasesBar(rowsLatest, filter = "All") {
    const getVisits  = (r) => (asNum(get(r,"ReturnVisitCount"))||0) + (asNum(get(r,"1stVisit"))||0);
    const getCanceled= (r) => { const keys=["Canceled","Cancelled","Cancel","Cancellations"]; let t=0; for (const k of keys){ const v=asNum(get(r,k)); if(isFinite(v)) t+=v; } return t; };

    let rows = sortByBirth(byActive(rowsLatest));
    if (filter !== "All") rows = byConst(rows, filter);

    const labels = rows.map(r => get(r,"Property"));
    const data   = rows.map(r => asNum(get(r,"NetLsd")) || 0);

    const sum = arr => arr.reduce((a,b)=>a+(+b||0),0);
    const totalNet = sum(data);
    const calloutText = `Total Net Leases: ${totalNet >= 0 ? "+" : ""}${fmtInt(totalNet)}`;

    // callout badge plugin
    const netCalloutPlugin = {
      id:"netCallout",
      afterDatasetsDraw(chart){
        const cfg = chart.options?.plugins?.netCallout || {};
        if (!cfg.show){ chart.$_netCalloutBounds = null; return; }
        const { ctx, chartArea } = chart;
        const padX=10, boxH=26, r=8, txt = cfg.text || "";
        ctx.save();
        ctx.font = Chart.helpers.toFont(Chart.defaults.font).string;
        const w = ctx.measureText(txt).width + padX*2;
        const x = chartArea.right - w - 6, y = chartArea.top + 6;
        ctx.beginPath();
        ctx.moveTo(x+r,y);
        ctx.arcTo(x+w,y,x+w,y+boxH,r);
        ctx.arcTo(x+w,y+boxH,x,y+boxH,r);
        ctx.arcTo(x,y+boxH,x,y,r);
        ctx.arcTo(x,y,x+r,y,r);
        ctx.closePath();
        ctx.fillStyle = "#f5f7f2";
        ctx.strokeStyle = "#a6ad8a";
        ctx.lineWidth = 1;
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#2f5d41";
        ctx.textBaseline="middle";
        ctx.fillText(txt, x+padX, y+boxH/2);
        ctx.restore();
        chart.$_netCalloutBounds = { x, y, w, h: boxH };
      }
    };

    // portfolio weekly (for portfolio line + table)
    function portfolioWeekly(weeksRange = null){
      let all = sortByBirth(byActive(MMR));
      if (filter !== "All") all = byConst(all, filter);
      const byWeek = {};
      all.forEach(r=>{
        const wk = (get(r,"WeekStart")||"").toString().slice(0,10); if(!wk) return;
        (byWeek[wk] ||= { net:0, visits:0, canceled:0, denied:0 });
        byWeek[wk].net      += asNum(get(r,"NetLsd"))||0;
        byWeek[wk].visits   += getVisits(r);
        byWeek[wk].canceled += getCanceled(r);
        byWeek[wk].denied   += asNum(get(r,"Denied"))||0;
      });
      let weeks = Object.keys(byWeek).sort();
      if (weeksRange && weeksRange.from && weeksRange.to) {
        weeks = weeks.filter(w => w >= weeksRange.from && w <= weeksRange.to);
      }
      return {
        weeks,
        net: weeks.map(w=>byWeek[w].net),
        rows: weeks.map(w=>({
          WeekStart: w,
          Visits: byWeek[w].visits,
          Canceled: byWeek[w].canceled,
          Denied: byWeek[w].denied,
          Net: byWeek[w].net,
          Closing: byWeek[w].visits>0 ? byWeek[w].net/byWeek[w].visits : NaN
        }))
      };
    }

    let drillLevel = 0; // 0=bars, 1=property line, 2=portfolio line
    let drilledProp = null;
    let chart = null;

    return (panelBody)=>{
      const titleEl = panelBody.parentElement.querySelector(".panel-title");
      const baseTitle = titleEl.textContent;
      const tools = panelBody.parentElement.querySelector(".inline-controls");

      // wipe old controls
      tools?.querySelectorAll("[data-role='nl-back'],[data-role='nl-view'],[data-role='nl-timeframe'],[data-role='nl-from'],[data-role='nl-to'],[data-role='nl-presets']").forEach(n=>n.remove());

      // back button
      const backBtn = document.createElement("button");
      backBtn.className="btn";
      backBtn.textContent="← Back";
      backBtn.setAttribute("data-role","nl-back");
      backBtn.style.fontWeight="800";
      backBtn.style.display="none";
      tools?.insertBefore(backBtn, tools.firstChild || null);

      // view toggle
      const viewSel = document.createElement("select");
      viewSel.className="select";
      viewSel.setAttribute("data-role","nl-view");
      viewSel.innerHTML = `<option value="chart">Chart</option><option value="table">Table</option>`;
      tools?.appendChild(viewSel);

      // Date range selectors (for portfolio drill level 2)
      const allWeeks = distinct(MMR.map(r => (get(r, "WeekStart") || "").toString().slice(0, 10))).filter(Boolean).sort();
      const fromSel = document.createElement("select");
      fromSel.className = "select";
      fromSel.setAttribute("data-role", "nl-from");
      fromSel.title = "From week";
      fromSel.style.display = "none";

      const toSel = document.createElement("select");
      toSel.className = "select";
      toSel.setAttribute("data-role", "nl-to");
      toSel.title = "To week";
      toSel.style.display = "none";

      const opts = allWeeks.map(w => `<option value="${w}">${formatDateForDisplay(w)}</option>`).join("");
      fromSel.innerHTML = opts;
      toSel.innerHTML = opts;
      fromSel.value = allWeeks[Math.max(0, allWeeks.length - 8)];
      toSel.value = allWeeks[allWeeks.length - 1];
      tools?.appendChild(fromSel);
      tools?.appendChild(toSel);

      function setRangeVisible(v) {
        const disp = v ? "" : "none";
        fromSel.style.display = disp;
        toSel.style.display = disp;
      }
      function currentRange() {
        const a = fromSel.value, b = toSel.value;
        if (!a || !b) return null;
        const from = a <= b ? a : b, to = b >= a ? b : a;
        return { from, to };
      }

      // Preset date range buttons
      const presetWrap = document.createElement("div");
      presetWrap.setAttribute("data-role", "nl-presets");
      presetWrap.style.display = "none";
      presetWrap.style.display = "flex";
      presetWrap.style.gap = "6px";
      presetWrap.style.alignItems = "center";
      
      function setPresetRange(months) {
        if (!allWeeks.length) return;
        const endDate = new Date(allWeeks[allWeeks.length - 1]);
        const startDate = new Date(endDate);
        startDate.setMonth(startDate.getMonth() - months);
        const startStr = startDate.toISOString().slice(0, 10);
        // Find closest available weeks
        const closestStart = allWeeks.find(w => w >= startStr) || allWeeks[0];
        const closestEnd = allWeeks[allWeeks.length - 1];
        fromSel.value = closestStart;
        toSel.value = closestEnd;
        // Trigger change event
        fromSel.dispatchEvent(new Event('change'));
        toSel.dispatchEvent(new Event('change'));
      }
      
      ["1m", "3m", "6m", "12m"].forEach(label => {
        const btn = document.createElement("button");
        btn.className = "btn";
        btn.textContent = label;
        btn.style.fontSize = "11px";
        btn.style.padding = "6px 10px";
        btn.onclick = () => {
          const months = { "1m": 1, "3m": 3, "6m": 6, "12m": 12 }[label];
          setPresetRange(months);
        };
        presetWrap.appendChild(btn);
      });
      tools?.appendChild(presetWrap);

      // timeframe buttons (shown ONLY on single-property drill)
      const timeframeWrap = document.createElement("div");
      timeframeWrap.setAttribute("data-role","nl-timeframe");
      timeframeWrap.style.display="none";
      ["1m","3m","6m","12m","All"].forEach(lbl=>{
        const b=document.createElement("button");
        b.className="btn";
        b.textContent=lbl;
        b.dataset.tf = lbl;
        timeframeWrap.appendChild(b);
      });
      tools?.appendChild(timeframeWrap);

      const setTimeframeVisible = (vis)=>{ timeframeWrap.style.display = vis ? "" : "none"; };
      const setPresetVisible = (vis) => { presetWrap.style.display = vis ? "flex" : "none"; };
      const styleCrumbs = ()=> {
        const bc = panelBody.parentElement.querySelector(".breadcrumb");
        if (bc){ bc.style.fontSize="13px"; bc.style.fontWeight="800"; bc.style.padding="2px 0 6px"; }
      };
      const updateBack = ()=>{ backBtn.style.display = (viewSel.value==="chart" && drillLevel>0) ? "" : "none"; };
      const clearPanel = ()=>{ panelBody.innerHTML=""; chart=null; };

      function backToBase(){
        drilledProp=null; drillLevel=0; updateBack(); setTimeframeVisible(false); setPresetVisible(false); setRangeVisible(false);
        titleEl.textContent=baseTitle;
        renderBreadcrumb(panelBody,[baseTitle],()=>{});
        styleCrumbs();
        if (viewSel.value === "table") { renderTableView(); } else { renderChart(); }
      }
      backBtn.onclick = backToBase;

      // helper to slice a series by "last N weeks" selection
      function sliceByTimeframe(series, tfLabel){
        const weeksCount = ({ "1m":4, "3m":13, "6m":26, "12m":52, "All":Infinity })[tfLabel] ?? 13;
        const len = series.labels.length;
        const start = Math.max(0, len - weeksCount);
        const idxs = series.labels.map((_,i)=>i).slice(start);
        return {
          labels: idxs.map(i=>series.labels[i]),
          net:    idxs.map(i=>series.net[i]),
          proj:   idxs.map(i=>series.proj[i])
        };
      }

      // BASE BAR CLICK HANDLER (includes portfolio drill via callout)
      const baseOnClick = (evt, els) => {
        // click on callout: portfolio net line
        const b = chart.$_netCalloutBounds;
        if (b){
          const pos = Chart.helpers.getRelativePosition(evt, chart);
          if (pos.x>=b.x && pos.x<=b.x+b.w && pos.y>=b.y && pos.y<=b.y+b.h){
            const pf = portfolioWeekly();
            drillLevel=2; updateBack(); setTimeframeVisible(false); setPresetVisible(true); setRangeVisible(true);
            titleEl.textContent = `${baseTitle} — Portfolio Net`;
            
            // Use date range instead of timeframe for portfolio drill
            const rng = currentRange();
            const portfolioSeries = portfolioWeekly(rng);
            const allTimeSeries = portfolioWeekly(null);
            
            // Calculate all-time moving averages (30-day, 90-day)
            const maNet30 = calculateMovingAverage(allTimeSeries.net, allTimeSeries.weeks, portfolioSeries.weeks, 4);
            const maNet90 = calculateMovingAverage(allTimeSeries.net, allTimeSeries.weeks, portfolioSeries.weeks, 13);
            
            // Destroy old chart and create new line chart
            if (chart) chart.destroy();
            const ctx = createCanvas(panelBody);
            chart = new Chart(ctx, {
              type: "line",
              data: {
                labels: portfolioSeries.weeks.map(w => formatDateForDisplay(w)),
                datasets: [{
                  label:"Net Leases",
                  data: portfolioSeries.net,
                  borderColor:"#2f5d41",
                  backgroundColor:"#2f5d41",
                  tension:.25,
                  pointRadius:3
                }, {
                  label:"30-Day Moving Average (All-Time)",
                  data: maNet30,
                  borderColor:"#7e8a6b",
                  backgroundColor:"#7e8a6b",
                  borderDash:[3,3],
                  tension:0,
                  pointRadius:1,
                  pointHoverRadius:3,
                  borderWidth:1
                }, {
                  label:"90-Day Moving Average (All-Time)",
                  data: maNet90,
                  borderColor:"#a6ad8a",
                  backgroundColor:"#a6ad8a",
                  borderDash:[4,4],
                  tension:0,
                  pointRadius:1.5,
                  pointHoverRadius:3.5,
                  borderWidth:1.2
                }]
              },
              options: {
                scales: { y: { beginAtZero:true } },
                plugins: {
                  tooltip: {
                    callbacks: {
                      title: (context) => `Week: ${context[0]?.label ?? ''}`,
                      label: (c) => `${c.dataset.label}: ${fmtInt(c.parsed.y)}`
                    }
                  }
                },
                onClick: () => {
                  const rng = currentRange();
                  const pf2 = portfolioWeekly(rng);
                  const filteredRows = pf2.rows;
                  const tot = {
                    visits: filteredRows.reduce((a,r)=>a+(r.Visits||0),0),
                    canceled: filteredRows.reduce((a,r)=>a+(r.Canceled||0),0),
                    denied: filteredRows.reduce((a,r)=>a+(r.Denied||0),0),
                    net: filteredRows.reduce((a,r)=>a+(r.Net||0),0)
                  };
                  openModal(`Portfolio Net Leases — Weekly`, b => {
                    renderTable(b, [
                      { label:"WeekStart",     value:r=>r.WeekStart },
                      { label:"Visits",        value:r=>fmtInt(r.Visits), class:"num" },
                      { label:"Canceled",      value:r=>fmtInt(r.Canceled), class:"num" },
                      { label:"Denied",        value:r=>fmtInt(r.Denied), class:"num" },
                      { label:"Net Leases",    value:r=>fmtInt(r.Net), class:"num" },
                      { label:"Gross Leases",  value:r=>fmtInt((r.Net||0)+(r.Canceled||0)+(r.Denied||0)), class:"num" },
                      { label:"Closing Ratio", value:r=>fmtPctSmart(r.Closing), class:"num" }
                    ], filteredRows, undefined, {
                      "Visits": fmtInt(tot.visits),
                      "Canceled": fmtInt(tot.canceled),
                      "Denied": fmtInt(tot.denied),
                      "Net Leases": fmtInt(tot.net),
                      "Gross Leases": fmtInt(tot.net + tot.canceled + tot.denied),
                      "Closing Ratio": fmtPctSmart((tot.visits>0? (tot.net/tot.visits):NaN))
                    });
                  }, filteredRows);
                }
              }
            });
            renderBreadcrumb(panelBody,[baseTitle,"Portfolio Net"],(level)=>{ if(level===0) backToBase(); });
            styleCrumbs();

            // Hook up date range selectors for portfolio drill
            const onRangePortfolio = () => {
              if (drillLevel !== 2) return;
              const rng = currentRange();
              const pfCurr = portfolioWeekly(rng);
              const allTimeSeries = portfolioWeekly(null);
              const maNet30 = calculateMovingAverage(allTimeSeries.net, allTimeSeries.weeks, pfCurr.weeks, 4);
              const maNet90 = calculateMovingAverage(allTimeSeries.net, allTimeSeries.weeks, pfCurr.weeks, 13);
              chart.data.labels = pfCurr.weeks.map(w => formatDateForDisplay(w));
              chart.data.datasets[0].data = pfCurr.net;
              if (chart.data.datasets.length > 1) chart.data.datasets[1].data = maNet30;
              if (chart.data.datasets.length > 2) chart.data.datasets[2].data = maNet90;
              chart.update();
            };
            fromSel.onchange = toSel.onchange = onRangePortfolio;
            return;
          }
        }

        // normal bar → drill to single property
        if (!els.length) return;
        const i = els[0].index;
        const prop = labels[i];

        drilledProp = prop;
        drillLevel = 1;
        updateBack();
        setTimeframeVisible(false);
        setPresetVisible(true);
        setRangeVisible(true);
        titleEl.textContent = `${baseTitle} — ${prop}`;
        renderBreadcrumb(panelBody,[baseTitle,prop],(level)=>{ if(level===0) backToBase(); });
        styleCrumbs();

        // build series + default date range (last 3 months)
        const full = propertyWeeklySeries(MMR, prop);
        const rng = currentRange();
        // Filter by date range
        let filteredWeeks = full.labels;
        let filteredNet = full.net;
        if (rng && rng.from && rng.to) {
          const indices = full.labels.map((w, idx) => ({ w, idx }))
            .filter(x => x.w >= rng.from && x.w <= rng.to)
            .map(x => x.idx);
          filteredWeeks = indices.map(i => full.labels[i]);
          filteredNet = indices.map(i => full.net[i]);
        }
        const sliced = {
          labels: filteredWeeks,
          net: filteredNet
        };
        
        // Calculate all-time moving averages (30-day, 90-day)
        const maNet30 = calculateMovingAverage(full.net, full.labels, sliced.labels, 4);
        const maNet90 = calculateMovingAverage(full.net, full.labels, sliced.labels, 13);

        // Destroy old chart and create new line chart
        if (chart) chart.destroy();
        const ctx = createCanvas(panelBody);
        chart = new Chart(ctx, {
          type: "line",
          data: {
            labels: sliced.labels.map(l => typeof l === 'string' && l.match(/^\d{4}-\d{2}-\d{2}$/) ? formatDateForDisplay(l) : l),
            datasets: [
              { label:"Net Leases", data:sliced.net, borderColor:"#2f5d41", backgroundColor:"#2f5d41", tension:.25, pointRadius:3 },
              { label:"30-Day Moving Average (All-Time)", data:maNet30, borderColor:"#7e8a6b", backgroundColor:"#7e8a6b", borderDash:[3,3], tension:0, pointRadius:1, pointHoverRadius:3, borderWidth:1 },
              { label:"90-Day Moving Average (All-Time)", data:maNet90, borderColor:"#a6ad8a", backgroundColor:"#a6ad8a", borderDash:[4,4], tension:0, pointRadius:1.5, pointHoverRadius:3.5, borderWidth:1.2 }
            ]
          },
          options: {
            scales: { y: { beginAtZero:true } },
            plugins: {
              tooltip: {
                callbacks: {
                  title: (context) => `Week: ${context[0]?.label ?? ''}`,
                  label: (c) => `${c.dataset.label}: ${fmtInt(c.parsed.y)}`
                }
              }
            },
            onClick: (_, elements) => {
          const full = propertyWeeklySeries(MMR, drilledProp);
          const rng = currentRange();
          // Filter by date range
          let filteredWeeks = full.labels;
          if (rng && rng.from && rng.to) {
            filteredWeeks = full.labels.filter(w => w >= rng.from && w <= rng.to);
          }
          const detail = sortByBirth(MMR.filter(r => get(r,"Property")===drilledProp))
            .filter(r => {
              const wk = (get(r,"WeekStart")||"").toString().slice(0,10);
              return filteredWeeks.includes(wk);
            })
            .sort((a,b)=>(get(b,"WeekStart")||"").localeCompare((get(a,"WeekStart")||"")));
          const rowsTbl = detail.map(r=>{
            const visits = getVisits(r);
            const net = asNum(get(r,"NetLsd")) || 0;
            return {
              WeekStart: (get(r,"WeekStart")||"").toString().slice(0,10),
              Visits: visits,
              Canceled: getCanceled(r),
              Denied: asNum(get(r,"Denied"))||0,
              Net: net,
              Gross: net + (getCanceled(r)||0) + (asNum(get(r,"Denied"))||0),
              Closing: visits>0 ? net/visits : NaN
            };
          });
          const tot = {
            visits: rowsTbl.reduce((a,r)=>a+(r.Visits||0),0),
            canceled: rowsTbl.reduce((a,r)=>a+(r.Canceled||0),0),
            denied: rowsTbl.reduce((a,r)=>a+(r.Denied||0),0),
            net: rowsTbl.reduce((a,r)=>a+(r.Net||0),0)
          };
          openModal(`Net Leases — ${drilledProp}`, b=>{
            renderTable(b, [
              { label:"WeekStart",        value:r=>r.WeekStart },
              { label:"Visits",           value:r=>fmtInt(r.Visits), class:"num" },
              { label:"Canceled",         value:r=>fmtInt(r.Canceled), class:"num" },
              { label:"Denied",           value:r=>fmtInt(r.Denied), class:"num" },
              { label:"Net Leases",       value:r=>fmtInt(r.Net), class:"num" },
              { label:"Gross Leases",     value:r=>fmtInt(r.Gross), class:"num" },
              { label:"Closing Ratio",    value:r=>fmtPctSmart(r.Closing), class:"num" }
            ], rowsTbl, undefined, {
              "Visits": fmtInt(tot.visits),
              "Canceled": fmtInt(tot.canceled),
              "Denied": fmtInt(tot.denied),
              "Net Leases": fmtInt(tot.net),
              "Gross Leases": fmtInt(tot.net + tot.canceled + tot.denied),
              "Closing Ratio": fmtPctSmart((tot.visits>0? (tot.net/tot.visits):NaN))
            });
          }, rowsTbl);
            }
          }
        });

        // Hook up date range selectors for property drill
        const onRangeProperty = () => {
          if (drillLevel !== 1 || !drilledProp) return;
          const rng = currentRange();
          const full = propertyWeeklySeries(MMR, drilledProp);
          // Filter by date range
          let filteredWeeks = full.labels;
          let filteredNet = full.net;
          if (rng && rng.from && rng.to) {
            const indices = full.labels.map((w, idx) => ({ w, idx }))
              .filter(x => x.w >= rng.from && x.w <= rng.to)
              .map(x => x.idx);
            filteredWeeks = indices.map(i => full.labels[i]);
            filteredNet = indices.map(i => full.net[i]);
          }
          const maNet30 = calculateMovingAverage(full.net, full.labels, filteredWeeks, 4);
          const maNet90 = calculateMovingAverage(full.net, full.labels, filteredWeeks, 13);
          chart.data.labels = filteredWeeks.map(w => formatDateForDisplay(w));
          chart.data.datasets[0].data = filteredNet;
          if (chart.data.datasets.length > 1) chart.data.datasets[1].data = maNet30;
          if (chart.data.datasets.length > 2) chart.data.datasets[2].data = maNet90;
          chart.update();
        };
        fromSel.onchange = toSel.onchange = onRangeProperty;

        // clicking the line → weekly detail table (now includes Projected Net)
        chart.options.onClick = (_, elements) => {
          const full = propertyWeeklySeries(MMR, drilledProp);
          const rng = currentRange();
          // Filter by date range
          let filteredWeeks = full.labels;
          if (rng && rng.from && rng.to) {
            filteredWeeks = full.labels.filter(w => w >= rng.from && w <= rng.to);
          }
          const slicedForTable = { labels: filteredWeeks };
          const detail = sortByBirth(MMR.filter(r => get(r,"Property")===drilledProp))
            .filter(r => {
              const wk = (get(r,"WeekStart")||"").toString().slice(0,10);
              return slicedForTable.labels.includes(wk);
            })
            .sort((a,b)=>(get(b,"WeekStart")||"").localeCompare((get(a,"WeekStart")||"")));
          const rowsTbl = detail.map(r=>{
            const visits = getVisits(r);
            const net = asNum(get(r,"NetLsd")) || 0;
            //const proj = asNum(get(r,"ProjectedNetLeased"));
            return {
              WeekStart: (get(r,"WeekStart")||"").toString().slice(0,10),
              Visits: visits,
              Canceled: getCanceled(r),
              Denied: asNum(get(r,"Denied"))||0,
              Net: net,
              Gross: net + (getCanceled(r)||0) + (asNum(get(r,"Denied"))||0),
              //ProjectedNet: proj,
              Closing: visits>0 ? net/visits : NaN
            };
          });
          const tot = {
            visits: rowsTbl.reduce((a,r)=>a+(r.Visits||0),0),
            canceled: rowsTbl.reduce((a,r)=>a+(r.Canceled||0),0),
            denied: rowsTbl.reduce((a,r)=>a+(r.Denied||0),0),
            net: rowsTbl.reduce((a,r)=>a+(r.Net||0),0),
            proj: rowsTbl.reduce((a,r)=>a+(isFinite(r.ProjectedNet)?r.ProjectedNet:0),0)
          };
          openModal(`Net Leases — ${drilledProp}`, b=>{
            renderTable(b, [
              { label:"WeekStart",        value:r=>r.WeekStart },
              { label:"Visits",           value:r=>fmtInt(r.Visits), class:"num" },
              { label:"Canceled",         value:r=>fmtInt(r.Canceled), class:"num" },
              { label:"Denied",           value:r=>fmtInt(r.Denied), class:"num" },
              { label:"Net Leases",       value:r=>fmtInt(r.Net), class:"num" },
              { label:"Gross Leases",     value:r=>fmtInt(r.Gross), class:"num" },
              { label:"Projected Net",    value:r=>fmtInt(r.ProjectedNet), class:"num" }, // NEW column next to Net
              { label:"Closing Ratio",    value:r=>fmtPctSmart(r.Closing), class:"num" }
            ], rowsTbl, undefined, {
              "Visits": fmtInt(tot.visits),
              "Canceled": fmtInt(tot.canceled),
              "Denied": fmtInt(tot.denied),
              "Net Leases": fmtInt(tot.net),
              "Gross Leases": fmtInt(tot.net + tot.canceled + tot.denied),
              //"Projected Net": fmtInt(tot.proj),
              "Closing Ratio": fmtPctSmart((tot.visits>0? (tot.net/tot.visits):NaN))
            });
          });
        };
      };

      // TABLE VIEW (unchanged except for base)
      function renderTableView(){
        clearPanel();
        renderBreadcrumb(panelBody,[baseTitle,"Table"],()=>{});
        styleCrumbs(); updateBack(); setTimeframeVisible(false);

        const scroller=document.createElement("div");
        scroller.style.height="100%"; scroller.style.overflow="auto"; scroller.style.paddingRight="2px";
        panelBody.appendChild(scroller);

        const rowsTbl = rows.map(r=>{
          const visits = getVisits(r);
          const net = asNum(get(r,"NetLsd"))||0;
          return {
            Property: get(r,"Property"),
            Visits: visits,
            Canceled: getCanceled(r),
            Denied: asNum(get(r,"Denied"))||0,
            Net: net,
            Gross: net + (getCanceled(r)||0) + (asNum(get(r,"Denied"))||0),
            Closing: visits>0? net/visits : NaN
          };
        });

        const tot = {
          visits: rowsTbl.reduce((a,r)=>a+(r.Visits||0),0),
          canceled: rowsTbl.reduce((a,r)=>a+(r.Canceled||0),0),
          denied: rowsTbl.reduce((a,r)=>a+(r.Denied||0),0),
          net: rowsTbl.reduce((a,r)=>a+(r.Net||0),0)
        };

        // Add export button for table view
        const exportBtn = document.createElement('button');
        exportBtn.className = 'btn';
        exportBtn.textContent = 'Export CSV';
        exportBtn.style.marginBottom = '10px';
        exportBtn.onclick = () => {
          const currentWeek = (selectedWeek || "").toString().slice(0, 10);
          const exportData = rowsTbl.map(r => ({
            Property: r.Property,
            Week: currentWeek,
            "Visits": r.Visits,
            "Canceled": r.Canceled,
            "Denied": r.Denied,
            "Net Leases": r.Net,
            "Gross Leases": r.Gross,
            "Closing Ratio": r.Closing
          }));
          const filename = `Net_Leases_Table_${currentWeek}.csv`;
          exportToCSV(exportData, filename);
        };
        scroller.insertBefore(exportBtn, scroller.firstChild);

        renderTable(scroller, [
          { label:"Property", key:"Property" },
          { label:"Visits",   value:r=>fmtInt(r.Visits), class:"num" },
          { label:"Canceled", value:r=>fmtInt(r.Canceled), class:"num" },
          { label:"Denied",   value:r=>fmtInt(r.Denied), class:"num" },
          { label:"Net Leases", value:r=>fmtInt(r.Net), class:"num" },
          { label:"Gross Leases", value:r=>fmtInt(r.Gross), class:"num" },
          { label:"Closing Ratio", value:r=>fmtPctSmart(r.Closing), class:"num" }
        ], rowsTbl, (r)=>{
          // on row click open the same weekly table as chart drill (with Projected)
          const prop = r.Property;
          const detail = sortByBirth(MMR.filter(x=>get(x,"Property")===prop))
            .sort((a,b)=>(get(b,"WeekStart")||"").localeCompare((get(a,"WeekStart")||"")));
          const weekly = detail.map(x=>{
            const wk = (get(x,"WeekStart")||"").toString().slice(0,10);
            const visits = getVisits(x);
            return {
              WeekStart: wk,
              Visits: visits,
              Canceled: getCanceled(x),
              Denied: asNum(get(x,"Denied"))||0,
              Net: asNum(get(x,"NetLsd"))||0,
              Gross: (asNum(get(x,"NetLsd"))||0) + (getCanceled(x)||0) + (asNum(get(x,"Denied"))||0),
              //ProjectedNet: asNum(get(x,"ProjectedNetLeased")),
              Closing: visits>0 ? (asNum(get(x,"NetLsd"))||0)/visits : NaN
            };
          });
          const tot2 = {
            visits: weekly.reduce((a,c)=>a+(c.Visits||0),0),
            canceled: weekly.reduce((a,c)=>a+(c.Canceled||0),0),
            denied: weekly.reduce((a,c)=>a+(c.Denied||0),0),
            net: weekly.reduce((a,c)=>a+(c.Net||0),0),
            //proj: weekly.reduce((a,c)=>a+(isFinite(c.ProjectedNet)?c.ProjectedNet:0),0)
          };
          openModal(`Net Leases — ${prop}`, b=>{
            renderTable(b, [
              { label:"WeekStart",        value:x=>x.WeekStart },
              { label:"Visits",           value:x=>fmtInt(x.Visits), class:"num" },
              { label:"Canceled",         value:x=>fmtInt(x.Canceled), class:"num" },
              { label:"Denied",           value:x=>fmtInt(x.Denied), class:"num" },
              { label:"Net Leases",       value:x=>fmtInt(x.Net), class:"num" },
              { label:"Gross Leases",     value:x=>fmtInt(x.Gross), class:"num" },
              { label:"Projected Net",    value:x=>fmtInt(x.ProjectedNet), class:"num" },
              { label:"Closing Ratio",    value:x=>fmtPctSmart(x.Closing), class:"num" }
            ], weekly, undefined, {
              "Visits": fmtInt(tot2.visits),
              "Canceled": fmtInt(tot2.canceled),
              "Denied": fmtInt(tot2.denied),
              "Net Leases": fmtInt(tot2.net),
              "Gross Leases": fmtInt(tot2.net + tot2.canceled + tot2.denied),
              //"Projected Net": fmtInt(tot2.proj),
              "Closing Ratio": fmtPctSmart((tot2.visits>0? (tot2.net/tot2.visits):NaN))
            });
          });
        }, {
          "Visits": fmtInt(tot.visits),
          "Canceled": fmtInt(tot.canceled),
          "Denied": fmtInt(tot.denied),
          "Net Leases": fmtInt(tot.net),
          "Closing Ratio": fmtPctSmart((tot.visits>0? (tot.net/tot.visits):NaN))
        });
      }

      // BASE CHART
      function renderChart(){
        clearPanel();
        renderBreadcrumb(panelBody,[baseTitle],()=>{});
        styleCrumbs(); updateBack(); setTimeframeVisible(false);

        const ctx = (function createCanvas(container){
          const c=document.createElement("canvas");
          c.style.width="100%"; c.style.height="100%";
          container.innerHTML=""; container.appendChild(c);
          return c.getContext("2d");
        })(panelBody);

        const maxX_Net = (()=>{
          const safe = data.map(v => +v || 0);
          const mv = safe.length ? Math.max(...safe) : 0;
          return Math.max(10, mv);
        })();
        chart = new Chart(ctx, {
          type:"bar",
          data:{ labels, datasets:[{ label:"Net Leases", data, backgroundColor:"#7e8a6b", categoryPercentage: 0.55, barPercentage: 0.7 }]},
          options:{
            indexAxis:"y",
            scales:{ x:{ beginAtZero:true, min: 0, max: maxX_Net } },
            plugins:{ 
              legend:{ position:"bottom" }, 
              netCallout:{ show:true, text:calloutText },
              tooltip: {
                callbacks: {
                  title: (items) => `Property: ${items[0]?.label ?? ''}`,
                  label: (c) => `Net Leases: ${fmtInt(c.parsed.x)} — Move-ins minus move-outs`
                }
              }
            },
            layout: { padding: { left: 8, right: 16, top: 8, bottom: 8 } },
            onClick: baseOnClick
          },
          plugins:[netCalloutPlugin]
        });
      }

      // render initial view
      if (viewSel.value==="table"){ drillLevel=0; updateBack(); titleEl.textContent=baseTitle; renderTableView(); }
      else { renderChart(); }
      viewSel.onchange = ()=>{ backToBase(); };
    };
}




function t12Bars(rowsLatest, filter = "All") {
  let rows = sortByBirth(byActive(rowsLatest));
  if (filter !== "All") rows = byConst(rows, filter);

  // Helper function to calculate T-12 data for a given date range
  function calculateT12Data(dateRange = null) {
    let filteredRows = rows;
    
    // If date range is specified, filter by WeekStart
    if (dateRange && dateRange.from && dateRange.to) {
      filteredRows = rows.filter(r => {
        const week = (get(r, "WeekStart") || "").toString().slice(0, 10);
        return week >= dateRange.from && week <= dateRange.to;
      });
    }
    
    // Group by property and get the latest T-12 values for each property
    const byProperty = {};
    filteredRows.forEach(r => {
      const prop = get(r, "Property");
      if (!prop) return;
      const week = (get(r, "WeekStart") || "").toString().slice(0, 10);
      if (!byProperty[prop] || (week > (byProperty[prop].week || ""))) {
        byProperty[prop] = {
          week: week,
          ren: asNum(get(r, "T12LeasesRenewed")) || 0,
          exp: asNum(get(r, "T12LeasesExpired")) || 0
        };
      }
    });
    
    const labels = sortPropertyNamesByBirth(Object.keys(byProperty), rows);
    const ren = labels.map(prop => byProperty[prop].ren);
    const exp = labels.map(prop => byProperty[prop].exp);
    
    return { labels, ren, exp };
  }

  // Initial calculation (no date range filter)
  let initialData = calculateT12Data();
  let labels = initialData.labels;
  let ren = initialData.ren;
  let exp = initialData.exp;

  // --- Portfolio callout: Renewal Rate (ΣRen ÷ ΣExp) ---
  const sum = arr => arr.reduce((a, b) => a + (+b || 0), 0);
  let totalRen = sum(ren);
  let totalExp = sum(exp);
  let overallRate = totalExp ? (totalRen / totalExp) * 100 : NaN;
  let calloutText = `Renewal Rate: ${fmtPctSmart(overallRate)}`;
  let badge = null;

  function updateCallout() {
    totalRen = sum(ren);
    totalExp = sum(exp);
    overallRate = totalExp ? (totalRen / totalExp) * 100 : NaN;
    calloutText = `Renewal Rate: ${fmtPctSmart(overallRate)}`;
    if (badge) {
      badge.textContent = calloutText;
    }
  }

  return (panelBody) => {
    let chart = null;
    let viewMode = "bars"; // "bars" or "renewalRate"
    let renewalRateChart = null;
    let currentPropertyFilter = null; // Track which property is selected for renewal rate view

    // Callout badge (left of dropdown)
    const tools = panelBody.parentElement.querySelector(".inline-controls");
    
    // Date range selectors for bar chart filtering
    const allWeeks = distinct(MMR.map(r => (get(r, "WeekStart") || "").toString().slice(0, 10))).filter(Boolean).sort();
    
    // Bar chart date range selectors (separate from renewal rate view)
    const barFromSel = document.createElement("select");
    barFromSel.className = "select";
    barFromSel.setAttribute("data-role", "t12-bar-from");
    barFromSel.title = "From week";
    barFromSel.style.display = "";

    const barToSel = document.createElement("select");
    barToSel.className = "select";
    barToSel.setAttribute("data-role", "t12-bar-to");
    barToSel.title = "To week";
    barToSel.style.display = "";

    const barOpts = allWeeks.map(w => `<option value="${w}">${formatDateForDisplay(w)}</option>`).join("");
    barFromSel.innerHTML = barOpts;
    barToSel.innerHTML = barOpts;
    // Set default to all data (first week to last week)
    barFromSel.value = allWeeks[0] || "";
    barToSel.value = allWeeks[allWeeks.length - 1] || "";
    tools?.appendChild(barFromSel);
    tools?.appendChild(barToSel);

    function barCurrentRange() {
      const a = barFromSel.value, b = barToSel.value;
      if (!a || !b) return null;
      const from = a <= b ? a : b, to = b >= a ? b : a;
      return { from, to };
    }

    // Preset date range buttons for bar chart
    const barPresetWrap = document.createElement("div");
    barPresetWrap.setAttribute("data-role", "t12-bar-presets");
    barPresetWrap.style.display = "flex";
    barPresetWrap.style.gap = "6px";
    barPresetWrap.style.alignItems = "center";
    
    function setBarPresetRange(months) {
      if (!allWeeks.length) return;
      const endDate = new Date(allWeeks[allWeeks.length - 1]);
      const startDate = new Date(endDate);
      startDate.setMonth(startDate.getMonth() - months);
      const startStr = startDate.toISOString().slice(0, 10);
      // Find closest available weeks
      const closestStart = allWeeks.find(w => w >= startStr) || allWeeks[0];
      const closestEnd = allWeeks[allWeeks.length - 1];
      barFromSel.value = closestStart;
      barToSel.value = closestEnd;
      // Trigger change event
      barFromSel.dispatchEvent(new Event('change'));
      barToSel.dispatchEvent(new Event('change'));
    }
    
    ["1m", "3m", "6m", "12m"].forEach(label => {
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = label;
      btn.style.fontSize = "11px";
      btn.style.padding = "6px 10px";
      btn.onclick = () => {
        const months = { "1m": 1, "3m": 3, "6m": 6, "12m": 12 }[label];
        setBarPresetRange(months);
      };
      barPresetWrap.appendChild(btn);
    });
    
    const barCustomBtn = document.createElement("button");
    barCustomBtn.className = "btn";
    barCustomBtn.textContent = "Custom";
    barCustomBtn.style.fontSize = "11px";
    barCustomBtn.style.padding = "6px 10px";
    barCustomBtn.onclick = () => {
      barFromSel.style.display = "";
      barToSel.style.display = "";
    };
    barPresetWrap.appendChild(barCustomBtn);
    tools?.appendChild(barPresetWrap);
    
    // Date range selectors (hidden by default, shown for renewal rate view)
    const fromSel = document.createElement("select");
    fromSel.className = "select";
    fromSel.setAttribute("data-role", "rr-from");
    fromSel.title = "From week";
    fromSel.style.display = "none";

    const toSel = document.createElement("select");
    toSel.className = "select";
    toSel.setAttribute("data-role", "rr-to");
    toSel.title = "To week";
    toSel.style.display = "none";

    const opts = allWeeks.map(w => `<option value="${w}">${formatDateForDisplay(w)}</option>`).join("");
    fromSel.innerHTML = opts;
    toSel.innerHTML = opts;
    fromSel.value = allWeeks[Math.max(0, allWeeks.length - 8)];
    toSel.value = allWeeks[allWeeks.length - 1];
    tools?.appendChild(fromSel);
    tools?.appendChild(toSel);

    function setRangeVisible(v) {
      const disp = v ? "" : "none";
      fromSel.style.display = disp;
      toSel.style.display = disp;
      presetWrap.style.display = v ? "flex" : "none";
    }
    function currentRange() {
      const a = fromSel.value, b = toSel.value;
      if (!a || !b) return null;
      const from = a <= b ? a : b, to = b >= a ? b : a;
      return { from, to };
    }

    // Preset date range buttons
    const presetWrap = document.createElement("div");
    presetWrap.setAttribute("data-role", "rr-presets");
    presetWrap.style.display = "none";
    presetWrap.style.display = "flex";
    presetWrap.style.gap = "6px";
    presetWrap.style.alignItems = "center";
    
    function setPresetRange(months) {
      if (!allWeeks.length) return;
      const endDate = new Date(allWeeks[allWeeks.length - 1]);
      const startDate = new Date(endDate);
      startDate.setMonth(startDate.getMonth() - months);
      const startStr = startDate.toISOString().slice(0, 10);
      // Find closest available weeks
      const closestStart = allWeeks.find(w => w >= startStr) || allWeeks[0];
      const closestEnd = allWeeks[allWeeks.length - 1];
      fromSel.value = closestStart;
      toSel.value = closestEnd;
      // Trigger change event
      fromSel.dispatchEvent(new Event('change'));
      toSel.dispatchEvent(new Event('change'));
    }
    
    ["1m", "3m", "6m", "12m"].forEach(label => {
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = label;
      btn.style.fontSize = "11px";
      btn.style.padding = "6px 10px";
      btn.onclick = () => {
        const months = { "1m": 1, "3m": 3, "6m": 6, "12m": 12 }[label];
        setPresetRange(months);
      };
      presetWrap.appendChild(btn);
    });
    
    const customBtn = document.createElement("button");
    customBtn.className = "btn";
    customBtn.textContent = "Custom";
    customBtn.style.fontSize = "11px";
    customBtn.style.padding = "6px 10px";
    customBtn.onclick = () => {
      fromSel.style.display = "";
      toSel.style.display = "";
    };
    presetWrap.appendChild(customBtn);
    tools?.appendChild(presetWrap);

    // Back button (for renewal rate view)
    const backBtn = document.createElement("button");
    backBtn.className = "btn";
    backBtn.setAttribute("data-role", "rr-back");
    backBtn.textContent = "← Back";
    backBtn.style.fontWeight = "800";
    backBtn.style.display = "none";
    tools?.insertBefore(backBtn, tools.firstChild || null);
    
    function showRenewalRateGraph(propertyFilter = null) {
      viewMode = "renewalRate";
      currentPropertyFilter = propertyFilter;
      backBtn.style.display = "";
      setRangeVisible(true);
      
      // Hide bar chart date range selectors
      barFromSel.style.display = "none";
      barToSel.style.display = "none";
      barPresetWrap.style.display = "none";
      
      // Update title
      const titleEl = panelBody.parentElement.querySelector(".panel-title");
      const baseTitle = titleEl ? titleEl.textContent.split(" — ")[0] : "T-12 Renewed vs Expired (latest)";
      if (propertyFilter) {
        titleEl.textContent = `${baseTitle} — ${propertyFilter}`;
      } else {
        titleEl.textContent = `${baseTitle} — Renewal Rate Over Time`;
      }
      
      // Build renewal rate time series
      const renewalRates = [];
      const renewalLabels = [];
      
      const rng = currentRange();
      let filteredWeeks = allWeeks;
      if (rng && rng.from && rng.to) {
        filteredWeeks = allWeeks.filter(w => w >= rng.from && w <= rng.to);
      }
      
      filteredWeeks.forEach(week => {
        const weekRows = MMR.filter(r => (get(r, "WeekStart") || "").toString().slice(0, 10) === week);
        const activeWeekRows = byActive(weekRows);
        let filtered = activeWeekRows;
        if (filter !== "All") {
          filtered = byConst(activeWeekRows, filter);
        }
        if (currentPropertyFilter) {
          filtered = filtered.filter(r => get(r, "Property") === currentPropertyFilter);
        }
        
        if (filtered.length > 0) {
          const totalRen = sum(filtered.map(r => asNum(get(r, "T12LeasesRenewed")) || 0));
          const totalExp = sum(filtered.map(r => asNum(get(r, "T12LeasesExpired")) || 0));
          const rate = totalExp > 0 ? (totalRen / totalExp) * 100 : NaN;
          renewalRates.push(rate);
          renewalLabels.push(week);
        }
      });
      
      // Destroy old chart
      if (chart) chart.destroy();
      if (renewalRateChart) renewalRateChart.destroy();
      
      // Create new renewal rate chart
      const ctx = createCanvas(panelBody);
      renewalRateChart = new Chart(ctx, {
        type: "line",
        data: {
          labels: renewalLabels.map(w => formatDateForDisplay(w)),
          datasets: [{
            label: "Renewal Rate %",
            data: renewalRates,
            borderColor: "#2f5d41",
            backgroundColor: "#2f5d41",
            tension: 0.25,
            pointRadius: 3,
            fill: false
          }]
        },
        options: {
          scales: {
            y: {
              beginAtZero: false,
              min: 0,
              max: 100,
              ticks: {
                callback: function(value) {
                  return value + "%";
                }
              }
            }
          },
          plugins: {
            tooltip: {
              callbacks: {
                label: (c) => `Renewal Rate: ${fmtPctSmart(c.parsed.y)}`
              }
            },
            legend: {
              display: true,
              position: "bottom"
            }
          }
        }
      });
    }
    
    function showBarsChart() {
      viewMode = "bars";
      currentPropertyFilter = null;
      backBtn.style.display = "none";
      setRangeVisible(false);
      
      // Show bar chart date range selectors
      barFromSel.style.display = "";
      barToSel.style.display = "";
      barPresetWrap.style.display = "flex";
      
      // Reset title
      const titleEl = panelBody.parentElement.querySelector(".panel-title");
      if (titleEl) {
        titleEl.textContent = titleEl.textContent.split(" — ")[0];
      }
      
      // Destroy renewal rate chart
      if (renewalRateChart) {
        renewalRateChart.destroy();
        renewalRateChart = null;
      }
      
      // Get current date range and recalculate data
      const rng = barCurrentRange();
      const data = calculateT12Data(rng);
      labels = data.labels;
      ren = data.ren;
      exp = data.exp;
      updateCallout();
      
      // Recreate bars chart
      const ctx = createCanvas(panelBody);
      chart = new Chart(ctx, {
        type: "bar",
        data: {
          labels,
          datasets: [
            { label: "T-12 Renewed", data: ren, backgroundColor: "#a6ad8a", categoryPercentage: 0.55, barPercentage: 0.7 },
            { label: "T-12 Expired", data: exp, backgroundColor: "#bdc2ce", categoryPercentage: 0.55, barPercentage: 0.7 }
          ]
        },
        options: {
          indexAxis: "y",
          scales: { x: { beginAtZero: true } },
          layout: { padding: { left: 8, right: 16, top: 8, bottom: 8 } },
          plugins: { 
            legend: { position: "bottom" },
            tooltip: {
              backgroundColor: 'rgba(0, 0, 0, 0.8)',
              titleColor: '#fff',
              bodyColor: '#fff',
              borderColor: '#a6ad8a',
              borderWidth: 1,
              cornerRadius: 6,
              callbacks: {
                title: (context) => `Property: ${context[0].label}`,
                label: (c) => {
                  let description = "";
                  if (c.dataset.label.includes("Renewed")) {
                    description = " - Leases renewed in the past 12 months";
                  } else if (c.dataset.label.includes("Expired")) {
                    description = " - Leases that expired in the past 12 months";
                  }
                  return `${c.dataset.label}: ${c.parsed.x}${description}`;
                },
                afterBody: (context) => {
                  const index = context[0].dataIndex;
                  const rate = exp[index] ? (ren[index] / exp[index]) * 100 : NaN;
                  return [`Renewal Rate: ${fmtPctSmart(rate)}`];
                }
              }
            }
          }
        },
        onClick: (_, els) => {
          if (!els.length) return;
          const i = els[0].index;
          const prop = labels[i];
          
          // Show renewal rate graph for this property
          showRenewalRateGraph(prop);
        }
      });
    }
    
    backBtn.onclick = () => {
      showBarsChart();
    };
    
    // Hook up date range selectors for renewal rate view
    const onRangeChange = () => {
      if (viewMode === "renewalRate") {
        showRenewalRateGraph(currentPropertyFilter);
      }
    };
    fromSel.onchange = toSel.onchange = onRangeChange;
    
    // Hook up date range selectors for bar chart
    const onBarRangeChange = () => {
      if (viewMode === "bars" && chart) {
        const rng = barCurrentRange();
        const data = calculateT12Data(rng);
        labels = data.labels;
        ren = data.ren;
        exp = data.exp;
        updateCallout();
        
        chart.data.labels = labels;
        chart.data.datasets[0].data = ren;
        chart.data.datasets[1].data = exp;
        chart.update();
      }
    };
    barFromSel.onchange = barToSel.onchange = onBarRangeChange;
    
    if (tools) {
      const old = tools.querySelector(".callout-renewal");
      if (old) old.remove();

      badge = document.createElement("span");
      badge.className = "callout-renewal";
      badge.style.display = "inline-flex";
      badge.style.alignItems = "center";
      badge.style.gap = "6px";
      badge.style.padding = "6px 10px";
      badge.style.border = "1px solid #a6ad8a";
      badge.style.borderRadius = "10px";
      badge.style.background = "#f5f7f2";
      badge.style.color = "#2f5d41";
      badge.style.fontSize = "12px";
      badge.style.whiteSpace = "nowrap";
      badge.style.cursor = "pointer";
      badge.textContent = calloutText;
      badge.title = "Click to view renewal rate graph over time. Overall renewal rate across all properties. Calculated as total renewals divided by total expirations over the past 12 months.";
      badge.onclick = () => {
        showRenewalRateGraph();
      };
      tools.insertBefore(badge, tools.firstChild || null);
    }

    // Initial render - show bars chart
    showBarsChart();
  };
}


// currency rounding rules
// currency rounding rules
function rentValue(val, kind){ return kind==="psf" ? (isFinite(val)?Number(val):NaN) : Math.round(val); }

function rentMetrics(rowsLatest, kind = "total", filter = "All") {
  let rows = sortByBirth(byActive(rowsLatest));
  if (filter !== "All") rows = byConst(rows, filter);

  // Exclude properties with occupied rent <= 0
  rows = rows.filter(r => {
    const occVal = asNum(get(r, kind === "psf" ? "OccupiedRentPSF" : "OccupiedRent"));
    return isFinite(occVal) && occVal > 0;
  });

  const labels = rows.map(r => get(r, "Property"));
  const occ = rows.map(r => rentValue(asNum(get(r, kind === "psf" ? "OccupiedRentPSF" : "OccupiedRent")), kind));
  const bud = rows.map(r => rentValue(asNum(get(r, kind === "psf" ? "BudgetedRentPSF" : "BudgetedRent")), kind));
  const mir = rows.map(r => rentValue(asNum(get(r, kind === "psf" ? "MoveinRentPSF" : "MoveInRent")), kind));
  const miCount = rows.map(r => asNum(get(r, "MI")) || 0);

  // Mask Move-In values when MI == 0 for this week/property
  const mirMasked = mir.map((v, i) => (isFinite(v) && miCount[i] > 0) ? v : NaN);

  // --- helper for time series for one property (drill level 1) ---
  function seriesForProperty(prop) {
    const hist = sortByBirth(MMR.filter(r => get(r, "Property") === prop))
      .sort((a, b) => (get(a, "WeekStart") || "").localeCompare(get(b, "WeekStart") || ""));
    const weeks = hist.map(r => (get(r, "WeekStart") || "").toString().slice(0, 10));
    const occW = hist.map(r => rentValue(asNum(get(r, kind === "psf" ? "OccupiedRentPSF" : "OccupiedRent")), kind));
    const budW = hist.map(r => rentValue(asNum(get(r, kind === "psf" ? "BudgetedRentPSF" : "BudgetedRent")), kind));
    const miW  = hist.map(r => rentValue(asNum(get(r, kind === "psf" ? "MoveinRentPSF" : "MoveInRent")), kind));
    const miWCnt = hist.map(r => asNum(get(r, "MI")) || 0);
    const miWMasked = miW.map((v, i) => (isFinite(v) && miWCnt[i] > 0) ? v : NaN);  // hide when no MIs that week
    return { weeks, occW, budW, miW, miWMasked, hist };
  }

  // --- weighted averages for portfolio callouts ---
  const weight = r => asNum(get(r, "InServiceUnits")) || asNum(get(r, "Units")) || 0;
  function wAvg(key) {
    let num = 0, den = 0;
    rows.forEach(r => {
      const w = weight(r);
      const v = asNum(get(r, key));
      if (isFinite(v) && w > 0) { num += v * w; den += w; }
    });
    const val = den ? (num / den) : NaN;
    return rentValue(val, kind);
  }
  const wOcc = wAvg(kind === "psf" ? "OccupiedRentPSF" : "OccupiedRent");
  const wBud = wAvg(kind === "psf" ? "BudgetedRentPSF" : "BudgetedRent");
  const wMi  = wAvg(kind === "psf" ? "MoveinRentPSF" : "MoveInRent");
  const fmtMoney = (n) => kind === "psf" ? fmtUSD2(n) : fmtUSD0(n);

  // helpers for callouts
  const avgFinite = (arr) => {
    let s=0,c=0; arr.forEach(v=>{ const n=Number(v); if (isFinite(n)) { s+=n; c++; } });
    return c ? rentValue(s/c, kind) : NaN;
  };
  let occBadge, budBadge, miBadge;
  const setBadge = (el,label,val)=>{ el.textContent = `${label}: ${fmtMoney(val)}`; };
  const updateCalloutsPortfolio = () => {
    if (occBadge) setBadge(occBadge,"Avg Occupied", wOcc);
    if (budBadge) setBadge(budBadge,"Avg Budgeted", wBud);
    if (miBadge)  setBadge(miBadge, "Avg Move-In",  wMi);
  };
  const updateCalloutsProperty = (s) => {
    if (!s) return;
    const o = avgFinite(s.occW);
    const b = avgFinite(s.budW);
    const m = avgFinite(s.miWMasked); // ignore weeks with 0 MI
    if (occBadge) setBadge(occBadge,"Avg Occupied", o);
    if (budBadge) setBadge(budBadge,"Avg Budgeted", b);
    if (miBadge)  setBadge(miBadge, "Avg Move-In",  m);
  };

  // Y-axis rules (use masked MI so zero-MI weeks don’t push the scale)
  const allVals = [...occ, ...bud, ...mirMasked].filter(v => Number.isFinite(v));
  const yMin = (kind === "psf") ? 0 : 1000;
  const ySuggestedMax = allVals.length ? Math.max(...allVals) * 1.1 : (kind==="psf" ? 10 : 20000);

  // drill state
  let drillLevel = 0;     // 0 = portfolio bars, 1 = property line (next click opens table)
  let drilledProp = null;
  let timelineFilter = "1mo"; // default to 1 month

  // Timeline filter functions
  const allWeeks = distinct(MMR.map(r => get(r, "WeekStart")).filter(Boolean)).sort();
  const maxWeek = allWeeks[allWeeks.length - 1];

  function addWeeks(dateStr, delta) {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + (delta * 7));
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const weekStr = `${y}-${m}-${day}`;
    const idx = allWeeks.findIndex(w => w >= weekStr);
    return idx >= 0 ? allWeeks[idx] : allWeeks[0];
  }

  function addMonths(dateStr, delta) {
    const d = new Date(dateStr);
    d.setMonth(d.getMonth() + delta);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const firstOfMonth = `${y}-${m}-01`;
    const idx = allWeeks.findIndex(w => w >= firstOfMonth);
    return idx >= 0 ? allWeeks[idx] : allWeeks[0];
  }

  function getTimelineRange(filter) {
    const d = new Date(maxWeek);
    switch (filter) {
      case "1w": return { from: addWeeks(maxWeek, -1), to: maxWeek };
      case "1mo": return { from: addMonths(maxWeek, -1), to: maxWeek };
      case "3mo": return { from: addMonths(maxWeek, -3), to: maxWeek };
      case "6mo": return { from: addMonths(maxWeek, -6), to: maxWeek };
      case "12mo": return { from: addMonths(maxWeek, -12), to: maxWeek };
      case "all": return { from: allWeeks[0], to: maxWeek };
      default: return { from: addMonths(maxWeek, -1), to: maxWeek };
    }
  }

  function filterSeriesByTimeline(series, filter) {
    if (filter === "all") return series;
    const range = getTimelineRange(filter);
    const filteredIndices = [];
    series.weeks.forEach((week, index) => {
      if (week >= range.from && week <= range.to) {
        filteredIndices.push(index);
      }
    });
    
    return {
      weeks: filteredIndices.map(i => series.weeks[i]),
      occW: filteredIndices.map(i => series.occW[i]),
      budW: filteredIndices.map(i => series.budW[i]),
      miW: filteredIndices.map(i => series.miW[i]),
      miWMasked: filteredIndices.map(i => series.miWMasked[i]),
      hist: filteredIndices.map(i => series.hist[i])
    };
  }

  return (panelBody) => {
    const titleEl = panelBody.parentElement.querySelector(".panel-title");
    const baseTitle = titleEl.textContent;

    // ---- Callouts (left of dropdown, out of the way) + Back button ----
    const tools = panelBody.parentElement.querySelector(".inline-controls");
    if (tools) {
      tools.querySelectorAll(".callout-rentavg, [data-role='rent-back']").forEach(n => n.remove());

      const backBtn = document.createElement("button");
      backBtn.className = "btn";
      backBtn.setAttribute("data-role","rent-back");
      backBtn.textContent = "← Back";
      backBtn.style.fontWeight = "800";
      backBtn.style.display = "none";
      tools.insertBefore(backBtn, tools.firstChild || null);

      const makeBadge = (label, value) => {
        const span = document.createElement("span");
        span.className = "callout-rentavg";
        span.style.display = "inline-flex";
        span.style.alignItems = "center";
        span.style.gap = "6px";
        span.style.padding = "6px 10px";
        span.style.marginRight = "8px";
        span.style.border = "1px solid #cfd6c6";
        span.style.borderRadius = "10px";
        span.style.background = "#f7f9f6";
        span.style.color = "var(--ink)";
        span.style.fontSize = "12px";
        span.style.whiteSpace = "nowrap";
        span.style.cursor = "help";
        span.textContent = `${label}: ${fmtMoney(value)}`;
        
        // Add tooltip based on label
        if (label.includes("Occupied")) {
          span.title = "Average rent currently being paid by occupied units. This represents actual revenue per unit.";
        } else if (label.includes("Budgeted")) {
          span.title = "Average planned/target rent amount. This is the expected rent based on budget projections.";
        } else if (label.includes("Move-In")) {
          span.title = "Average rent for new move-ins during this period. Shows pricing for new leases.";
        }
        
        return span;
      };

      const first = tools.firstChild || null;
      occBadge = makeBadge("Avg Occupied", wOcc);
      budBadge = makeBadge("Avg Budgeted", wBud);
      miBadge  = makeBadge("Avg Move-In",  wMi);
      tools.insertBefore(miBadge, first);
      tools.insertBefore(budBadge, first);
      tools.insertBefore(occBadge, first);

      // Date range selectors (for property drill level 1)
      const fromSel = document.createElement("select");
      fromSel.className = "select";
      fromSel.setAttribute("data-role", "rent-from");
      fromSel.title = "From week";
      fromSel.style.display = "none";

      const toSel = document.createElement("select");
      toSel.className = "select";
      toSel.setAttribute("data-role", "rent-to");
      toSel.title = "To week";
      toSel.style.display = "none";

      const opts = allWeeks.map(w => `<option value="${w}">${formatDateForDisplay(w)}</option>`).join("");
      fromSel.innerHTML = opts;
      toSel.innerHTML = opts;
      // Set default to 1 month
      const endDate = new Date(allWeeks[allWeeks.length - 1]);
      const startDate = new Date(endDate);
      startDate.setMonth(startDate.getMonth() - 1);
      const startStr = startDate.toISOString().slice(0, 10);
      const closestStart = allWeeks.find(w => w >= startStr) || allWeeks[0];
      fromSel.value = closestStart;
      toSel.value = allWeeks[allWeeks.length - 1];
      tools.appendChild(fromSel);
      tools.appendChild(toSel);

      function setRangeVisible(v) {
        const disp = v ? "" : "none";
        fromSel.style.display = disp;
        toSel.style.display = disp;
        presetWrap.style.display = v ? "flex" : "none";
      }
      function currentRange() {
        const a = fromSel.value, b = toSel.value;
        if (!a || !b) return null;
        const from = a <= b ? a : b, to = b >= a ? b : a;
        return { from, to };
      }

      // Preset date range buttons
      const presetWrap = document.createElement("div");
      presetWrap.setAttribute("data-role", "rent-presets");
      presetWrap.style.display = "none";
      presetWrap.style.display = "flex";
      presetWrap.style.gap = "6px";
      presetWrap.style.alignItems = "center";
      
      function setPresetRange(months) {
        if (!allWeeks.length) return;
        const endDate = new Date(allWeeks[allWeeks.length - 1]);
        const startDate = new Date(endDate);
        startDate.setMonth(startDate.getMonth() - months);
        const startStr = startDate.toISOString().slice(0, 10);
        // Find closest available weeks
        const closestStart = allWeeks.find(w => w >= startStr) || allWeeks[0];
        const closestEnd = allWeeks[allWeeks.length - 1];
        fromSel.value = closestStart;
        toSel.value = closestEnd;
        // Trigger change event
        fromSel.dispatchEvent(new Event('change'));
        toSel.dispatchEvent(new Event('change'));
      }
      
      ["1m", "3m", "6m", "12m"].forEach(label => {
        const btn = document.createElement("button");
        btn.className = "btn";
        btn.textContent = label;
        btn.style.fontSize = "11px";
        btn.style.padding = "6px 10px";
        btn.onclick = () => {
          const months = { "1m": 1, "3m": 3, "6m": 6, "12m": 12 }[label];
          setPresetRange(months);
        };
        presetWrap.appendChild(btn);
      });
      
      const customBtn = document.createElement("button");
      customBtn.className = "btn";
      customBtn.textContent = "Custom";
      customBtn.style.fontSize = "11px";
      customBtn.style.padding = "6px 10px";
      customBtn.onclick = () => {
        fromSel.style.display = "";
        toSel.style.display = "";
      };
      presetWrap.appendChild(customBtn);
      tools.appendChild(presetWrap);

      // Update chart when date range changes
      const onRangeChange = () => {
        if (drillLevel === 1 && drilledProp) {
          const s = seriesForProperty(drilledProp);
          const rng = currentRange();
          
          // Filter by date range
          let filteredWeeks = s.weeks;
          let filteredOccW = s.occW;
          let filteredBudW = s.budW;
          let filteredMiWMasked = s.miWMasked;
          
          if (rng && rng.from && rng.to) {
            const indices = s.weeks.map((w, idx) => ({ w, idx }))
              .filter(x => x.w >= rng.from && x.w <= rng.to)
              .map(x => x.idx);
            filteredWeeks = indices.map(i => s.weeks[i]);
            filteredOccW = indices.map(i => s.occW[i]);
            filteredBudW = indices.map(i => s.budW[i]);
            filteredMiWMasked = indices.map(i => s.miWMasked[i]);
          }
          
          const seriesVals = [...filteredOccW, ...filteredBudW, ...filteredMiWMasked].filter(v => Number.isFinite(v));
          const seriesSuggestedMax = seriesVals.length ? Math.max(...seriesVals) * 1.1 : ySuggestedMax;

          chart.data.labels = filteredWeeks.map(w => formatDateForDisplay(w));
          chart.data.datasets = [
            { label: kind === "psf" ? "Occupied $/SF" : "Occupied Rent", data: filteredOccW, borderColor: "#2f5d41", backgroundColor: "#2f5d41", tension: .25, pointRadius: 3 },
            { label: kind === "psf" ? "Budgeted $/SF" : "Budgeted Rent", data: filteredBudW, borderColor: "#9aa796", backgroundColor: "#9aa796", borderDash: [6, 4], tension: .25, pointRadius: 3 },
            { label: kind === "psf" ? "Move-In $/SF" : "Move-In Rent", data: filteredMiWMasked, borderColor: "#333", backgroundColor: "#333", tension: .25, pointRadius: 2, spanGaps: false }
          ];
          chart.options.scales.y.min = yMin;
          chart.options.scales.y.suggestedMax = seriesSuggestedMax;
          chart.update();

          updateCalloutsProperty({ weeks: filteredWeeks, occW: filteredOccW, budW: filteredBudW, miWMasked: filteredMiWMasked });
        }
      };
      fromSel.onchange = toSel.onchange = onRangeChange;

      function styleCrumbs() {
        const bc = panelBody.parentElement.querySelector(".breadcrumb");
        if (bc) { bc.style.fontSize = "13px"; bc.style.fontWeight = "800"; bc.style.padding = "2px 0 6px"; }
      }
      function updateBack() { backBtn.style.display = (drillLevel > 0) ? "" : "none"; }

      // --- plugin: draw short black line at Move-In level per property (only when MI>0) ---
      const moveInTickPlugin = {
        id: "moveInTick",
        afterDatasetsDraw(chart) {
          if (chart.config.type !== "bar") return;
          const yScale = chart.scales.y;
          const metaOcc = chart.getDatasetMeta(0);
          const metaBud = chart.getDatasetMeta(1);
          const ctx = chart.ctx;

          mirMasked.forEach((v, i) => {
            if (!isFinite(v)) return; // masked out when MI == 0
            const y = yScale.getPixelForValue(v);
            const e0 = metaOcc.data[i], e1 = metaBud.data[i];
            if (!e0 || !e1 || e0.width == null || e1.width == null) return;
            const left  = Math.min(e0.x - e0.width/2, e1.x - e1.width/2);
            const right = Math.max(e0.x + e0.width/2, e1.x + e1.width/2);
            ctx.save();
            ctx.strokeStyle = "#333";
            ctx.lineWidth = 4; // thicker for visibility
            ctx.beginPath();
            ctx.moveTo(left, y);
            ctx.lineTo(right, y);
            ctx.stroke();
            ctx.restore();
          });
        }
      };

      // ---- Chart
      const ctx = createCanvas(panelBody);
      const chart = new Chart(ctx, {
        type: "bar",
        data: {
          labels,
          datasets: [
            { type: "bar",  label: kind === "psf" ? "Occupied $/SF" : "Occupied Rent", data: occ, backgroundColor: "#7e8a6b", categoryPercentage: 0.55, barPercentage: 0.7 },
            { type: "bar",  label: kind === "psf" ? "Budgeted $/SF" : "Budgeted Rent", data: bud, backgroundColor: "#bdc2ce", categoryPercentage: 0.55, barPercentage: 0.7 },
            // Move-In markers (hidden where MI==0 via NaN)
            {
              type: "scatter",
              label: kind === "psf" ? "Move-In $/SF" : "Move-In Rent",
              parsing: false,
              data: labels.map((x, i) => ({ x, y: mirMasked[i] })), // NaN points are skipped
              pointRadius: 7,
              pointHoverRadius: 9,
              pointHitRadius: 16,
              backgroundColor: "#333",
              borderWidth: 0,
              showLine: false,
              yAxisID: "y",
              xAxisID: "x"
            }
          ]
        },
        options: {
          maintainAspectRatio: false,
          responsive: true,
          interaction: { mode: "index", intersect: false },
          scales: {
            y: { min: yMin, suggestedMax: ySuggestedMax, ticks: { callback: kind === "psf" ? tickUSD2 : tickUSD0 } }
          },
          plugins: {
            legend: { 
              position: "bottom",
              labels: {
                generateLabels: function(chart) {
                  const original = Chart.defaults.plugins.legend.labels.generateLabels;
                  const labels = original.call(this, chart);
                  
                  // Customize legend labels to show dashed lines for budgeted data
                  labels.forEach(label => {
                    if (label.text.includes('Budgeted')) {
                      // Remove the box and show only a dashed line
                      label.fillStyle = 'transparent';
                      label.strokeStyle = label.strokeStyle;
                      label.lineDash = [6, 4]; // Same dash pattern as the actual line
                      label.lineWidth = 2;
                      label.usePointStyle = false; // Don't use point style
                    }
                  });
                  
                  return labels;
                }
              }
            },
            tooltip: {
              enabled: true,
              backgroundColor: 'rgba(0, 0, 0, 0.8)',
              titleColor: '#fff',
              bodyColor: '#fff',
              borderColor: '#a6ad8a',
              borderWidth: 1,
              cornerRadius: 6,
              displayColors: true,
              padding: 10,
              callbacks: {
                title: (context) => `Property: ${context[0]?.label ?? ''}`,
                label: (c) => {
                  const isPSF = (kind === "psf");
                  const fmt = isPSF ? tickUSD2 : tickUSD0;
                  const val = (c.dataset.type === "scatter") ? (c.raw?.y) : c.parsed.y;
                  if (c.dataset.label.includes("Occupied")) {
                    return `${c.dataset.label}: ${fmt(val)} — Current rent for occupied units`;
                  }
                  if (c.dataset.label.includes("Budgeted")) {
                    return `${c.dataset.label}: ${fmt(val)} — Planned/target rent amount`;
                  }
                  if (c.dataset.label.includes("Move-In")) {
                    return `${c.dataset.label}: ${fmt(val)} — Rent for new move-ins this period`;
                  }
                  return `${c.dataset.label}: ${fmt(val)}`;
                }
              }
            }
          },
          onClick: (_, els) => {
            // NEW: if already drilled, open modal regardless of whether a point was hit
            if (drillLevel === 1 && drilledProp) {
              let hist = sortByBirth(MMR.filter(r => get(r, "Property") === drilledProp))
                .sort((a, b) => (get(b, "WeekStart") || "").localeCompare((get(a, "WeekStart") || "")));
              
              // Filter by date range to match what's shown on the chart
              const rng = currentRange();
              if (rng && rng.from && rng.to) {
                hist = hist.filter(r => {
                  const wk = (get(r, "WeekStart") || "").toString().slice(0, 10);
                  return wk >= rng.from && wk <= rng.to;
                });
              }
              
              const rentData = hist.map(r => {
                const occV = asNum(get(r, kind === "psf" ? "OccupiedRentPSF" : "OccupiedRent"));
                const budV = asNum(get(r, kind === "psf" ? "BudgetedRentPSF" : "BudgetedRent"));
                const miV = asNum(get(r, kind === "psf" ? "MoveinRentPSF" : "MoveInRent"));
                return {
                  Property: drilledProp,
                  WeekStart: (get(r, "WeekStart") || "").toString().slice(0, 10),
                  "Occupied": occV,
                  "Budgeted": budV,
                  "Move-In": miV,
                  "Diff %": ((occV - budV) / (budV || 1)) * 100
                };
              });
              openModal(`Occupied vs Budgeted — ${drilledProp}`, b => {
                renderTable(b, [
                  { label: "WeekStart", value: r => (get(r, "WeekStart") || "").toString().slice(0, 10) },
                  {
                    label: kind === "psf" ? "Occupied $/SF" : "Occupied Rent",
                    value: r => kind === "psf" ? fmtUSD2(asNum(get(r, "OccupiedRentPSF"))) : fmtUSD0(asNum(get(r, "OccupiedRent"))),
                    class: "num"
                  },
                  {
                    label: kind === "psf" ? "Budgeted $/SF" : "Budgeted Rent",
                    value: r => kind === "psf" ? fmtUSD2(asNum(get(r, "BudgetedRentPSF"))) : fmtUSD0(asNum(get(r, "BudgetedRent"))),
                    class: "num"
                  },
                  {
                    label: kind === "psf" ? "Move-In $/SF" : "Move-In Rent",
                    value: r => kind === "psf" ? fmtUSD2(asNum(get(r, "MoveinRentPSF"))) : fmtUSD0(asNum(get(r, "MoveInRent"))),
                    class: "num"
                  },
                  {
                    label: "% Diff (Occ vs Bud)",
                    value: r => {
                      const occV = asNum(get(r, kind === "psf" ? "OccupiedRentPSF" : "OccupiedRent"));
                      const budV = asNum(get(r, kind === "psf" ? "BudgetedRentPSF" : "BudgetedRent"));
                      return fmtPctSmart(((occV - budV) / (budV || 1)) * 100); // fixed bUdV -> budV
                    },
                    class: "num"
                  }
                ], hist);
              }, rentData);
              return;
            }

            if (!els.length) return;

            if (drillLevel === 0) {
              // ---- Level 0 -> Level 1: property time series
              const i = els[0].index;
              drilledProp = labels[i];
              const s = seriesForProperty(drilledProp);
              
              // Apply default 1 month date range
              const rng = currentRange();
              let filteredS = s;
              if (rng && rng.from && rng.to) {
                const indices = s.weeks.map((w, idx) => ({ w, idx }))
                  .filter(x => x.w >= rng.from && x.w <= rng.to)
                  .map(x => x.idx);
                filteredS = {
                  weeks: indices.map(i => s.weeks[i]),
                  occW: indices.map(i => s.occW[i]),
                  budW: indices.map(i => s.budW[i]),
                  miW: indices.map(i => s.miW[i]),
                  miWMasked: indices.map(i => s.miWMasked[i]),
                  hist: indices.map(i => s.hist[i])
                };
              }

              const seriesVals = [...filteredS.occW, ...filteredS.budW, ...filteredS.miWMasked].filter(v => Number.isFinite(v));
              const seriesSuggestedMax = seriesVals.length ? Math.max(...seriesVals) * 1.1 : ySuggestedMax;

              drillLevel = 1; updateBack();
              titleEl.textContent = `${baseTitle} — ${drilledProp}`;
              renderBreadcrumb(panelBody, [baseTitle, drilledProp], (level)=>{ if (level===0) backToBase(); });
              styleCrumbs();

              // Show date range selectors
              setRangeVisible(true);

              chart.config.type = "line";
              chart.data.labels = filteredS.weeks.map(w => formatDateForDisplay(w));
              chart.data.datasets = [
                { label: kind === "psf" ? "Occupied $/SF" : "Occupied Rent", data: filteredS.occW, borderColor: "#2f5d41", backgroundColor: "#2f5d41", tension: .25, pointRadius: 3 },
                { label: kind === "psf" ? "Budgeted $/SF" : "Budgeted Rent", data: filteredS.budW, borderColor: "#9aa796", backgroundColor: "#9aa796", borderDash: [6, 4], tension: .25, pointRadius: 3 },
                // Move-In line with gaps (hidden on weeks where MI==0)
                { label: kind === "psf" ? "Move-In $/SF" : "Move-In Rent", data: filteredS.miWMasked, borderColor: "#333", backgroundColor: "#333", tension: .25, pointRadius: 2, spanGaps: false }
              ];
              chart.options.scales.y.min = yMin;
              chart.options.scales.y.suggestedMax = seriesSuggestedMax;
              
              // Update legend configuration for line chart
              chart.options.plugins.legend.labels = {
                generateLabels: function(chart) {
                  const original = Chart.defaults.plugins.legend.labels.generateLabels;
                  const labels = original.call(this, chart);
                  
                  // Customize legend labels to show dashed lines for budgeted data
                  labels.forEach(label => {
                    if (label.text.includes('Budgeted')) {
                      // Remove the box and show only a dashed line
                      label.fillStyle = 'transparent';
                      label.strokeStyle = label.strokeStyle;
                      label.lineDash = [6, 4]; // Same dash pattern as the actual line
                      label.lineWidth = 2;
                      label.usePointStyle = false; // Don't use point style
                    }
                  });
                  
                  return labels;
                }
              };
              
              chart.update();

              // NEW: update callouts to reflect the drilled property's series
              updateCalloutsProperty(filteredS);
              return;
            }
          }
        },
        plugins: [moveInTickPlugin]
      });

      function backToBase() {
        drilledProp = null; drillLevel = 0; updateBack();
        titleEl.textContent = baseTitle;
        renderBreadcrumb(panelBody, [baseTitle], ()=>{});
        styleCrumbs();

        // Hide date range selectors
        setRangeVisible(false);

        chart.config.type = "bar";
        chart.data.labels = labels;
        chart.data.datasets = [
          { type: "bar",  label: kind === "psf" ? "Occupied $/SF" : "Occupied Rent", data: occ, backgroundColor: "#7e8a6b" },
          { type: "bar",  label: kind === "psf" ? "Budgeted $/SF" : "Budgeted Rent", data: bud, backgroundColor: "#bdc2ce" },
          {
            type: "scatter",
            label: kind === "psf" ? "Move-In $/SF" : "Move-In Rent",
            parsing: false,
            data: labels.map((x, i) => ({ x, y: mirMasked[i] })), // still masked
            pointRadius: 7,
            pointHoverRadius: 9,
            pointHitRadius: 16,
            backgroundColor: "#333",
            borderWidth: 0,
            showLine: false,
            yAxisID: "y",
            xAxisID: "x"
          }
        ];
        chart.options.scales.y.min = yMin;
        chart.options.scales.y.suggestedMax = ySuggestedMax;
        chart.update();

        // NEW: restore portfolio-weighted callouts
        updateCalloutsPortfolio();
      }
      backBtn.onclick = backToBase;

      // Initial crumbs + callouts
      renderBreadcrumb(panelBody, [baseTitle], ()=>{});
      styleCrumbs();
      updateBack();
      updateCalloutsPortfolio();
    }
  };
}




function incomeVsBudget(rowsLatest, filter = "All") {
  let rows = sortByBirth(byActive(rowsLatest));
  if (filter !== "All") rows = byConst(rows, filter);

  const labels = rows.map(r => get(r, "Property"));
  const actual = rows.map(r => asNum(get(r, "CurrentMonthIncome")) || 0);
  const budget = rows.map(r => asNum(get(r, "BudgetedIncome")) || 0);

  // --- build property → monthly series from full MMR (use latest week in each month) ---
  function monthlySeriesForProperty(prop) {
    const hist = sortByBirth(MMR.filter(r => get(r, "Property") === prop));
    const byMonth = {};
    hist.forEach(r => {
      const wk = (get(r, "WeekStart") || "").toString().slice(0, 10);
      if (!wk) return;
      const month = wk.slice(0, 7); // YYYY-MM
      const a = asNum(get(r, "CurrentMonthIncome")) || 0;
      const b = asNum(get(r, "BudgetedIncome")) || 0;
      if (!byMonth[month] || wk > byMonth[month].wk) {
        byMonth[month] = { wk, a, b };
      }
    });
    const months = Object.keys(byMonth).sort();
    return {
      labels: months.map(m => {
        const d = new Date(m + "-01");
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        return `${monthNames[d.getMonth()]} ${d.getFullYear()}`;
      }),
      act: months.map(m => Math.round(byMonth[m].a)),
      bud: months.map(m => Math.round(byMonth[m].b)),
      rawLabels: months
    };
  }

  // --- drill state ---
  let drillLevel = 0;   // 0 = portfolio bars, 1 = property monthly line (click again -> table)
  let drilledProp = null;
  let timelineFilter = "6mo"; // default to 6 months

  return (panelBody) => {
    const titleEl = panelBody.parentElement.querySelector(".panel-title");
    const baseTitle = titleEl.textContent;
    const tools = panelBody.parentElement.querySelector(".inline-controls");

    // Back button + breadcrumbs helpers
    tools?.querySelectorAll("[data-role='inc-back'],[data-role='inc-timeframe']").forEach(n => n.remove());
    const backBtn = document.createElement("button");
    backBtn.className = "btn";
    backBtn.setAttribute("data-role", "inc-back");
    backBtn.textContent = "← Back";
    backBtn.style.fontWeight = "800";
    backBtn.style.display = "none";
    tools?.insertBefore(backBtn, tools.firstChild || null);

    // Timeline filter buttons (shown ONLY on property drill)
    const timeframeWrap = document.createElement("div");
    timeframeWrap.setAttribute("data-role", "inc-timeframe");
    timeframeWrap.style.display = "none";
    ["6mo","12mo","All"].forEach(lbl=>{
      const b=document.createElement("button");
      b.className = "btn";
      b.textContent = lbl;
      b.dataset.tf = lbl;
      timeframeWrap.appendChild(b);
    });
    tools?.appendChild(timeframeWrap);

    const setTimeframeVisible = (vis)=>{ timeframeWrap.style.display = vis ? "" : "none"; };

    function styleCrumbs() {
      const bc = panelBody.parentElement.querySelector(".breadcrumb");
      if (bc) { bc.style.fontSize = "13px"; bc.style.fontWeight = "800"; bc.style.padding = "2px 0 6px"; }
    }
    function updateBack() { backBtn.style.display = drillLevel > 0 ? "" : "none"; }
    
    // Helper to slice monthly series by timeframe
    function sliceByTimeframe(series, tfLabel) {
      if (tfLabel === "All") return series;
      const monthsCount = ({ "6mo": 6, "12mo": 12 })[tfLabel] ?? 6;
      const len = series.labels.length;
      const start = Math.max(0, len - monthsCount);
      const sliced = {
        labels: series.labels.slice(start),
        act: series.act.slice(start),
        bud: series.bud.slice(start)
      };
      // Format month labels (YYYY-MM to "Mon YYYY")
      sliced.labels = sliced.labels.map(m => {
        const d = new Date(m + "-01");
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        return `${monthNames[d.getMonth()]} ${d.getFullYear()}`;
      });
      return sliced;
    }

    const ctx = createCanvas(panelBody);

    const chart = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Actual (Month)",
            data: actual.map(Math.round),
            backgroundColor: "#7e8a6b",
            // tighter clusters — smaller gap between the two bars
            categoryPercentage: 0.45,
            barPercentage: 0.98
          },
          {
            label: "Budget",
            data: budget.map(Math.round),
            backgroundColor: "#bdc2ce",
            categoryPercentage: 0.45,
            barPercentage: 0.98
          }
        ]
      },
      options: {
        maintainAspectRatio: false,
        scales: {
          y: { beginAtZero: true, ticks: { callback: tickUSD0 } }
        },
        plugins: { 
          legend: { 
            position: "bottom",
            labels: {
              generateLabels: function(chart) {
                const original = Chart.defaults.plugins.legend.labels.generateLabels;
                const labels = original.call(this, chart);
                
                // Customize legend labels to show dashed lines for budgeted data
                labels.forEach(label => {
                  if (label.text.includes('Budget')) {
                    // Remove the box and show only a dashed line
                    label.fillStyle = 'transparent';
                    label.strokeStyle = label.strokeStyle;
                    label.lineDash = [6, 4]; // Same dash pattern as the actual line
                    label.lineWidth = 2;
                    label.usePointStyle = false; // Don't use point style
                  }
                });
                
                return labels;
              }
            }
          } 
        },
        onClick: (_, els) => {
          if (!els.length) return;

          // ---- Level 0 -> Level 1: show that property's month-over-month line ----
          if (drillLevel === 0) {
            const i = els[0].index;
            drilledProp = labels[i];
            const full = monthlySeriesForProperty(drilledProp);
            timelineFilter = "6mo"; // default to 6 months
            const s = sliceByTimeframe(full, timelineFilter);

            drillLevel = 1; updateBack(); setTimeframeVisible(true);
            titleEl.textContent = `${baseTitle} — ${drilledProp}`;
            renderBreadcrumb(panelBody, [baseTitle, drilledProp], (idx)=>{ if(idx===0) backToBase(); });
            styleCrumbs();

            chart.config.type = "line";
            chart.data.labels = s.labels.map(l => typeof l === 'string' && l.match(/^\d{4}-\d{2}-\d{2}$/) ? formatDateForDisplay(l) : l);
            chart.data.datasets = [
              { label: "Actual (Month)", data: s.act, borderColor: "#2f5d41", backgroundColor: "#2f5d41", tension: .25, pointRadius: 3 },
              { label: "Budget",         data: s.bud, borderColor: "#9aa796", backgroundColor: "#9aa796", borderDash: [6,4], tension: .25, pointRadius: 3 }
            ];
            chart.options.scales.y.ticks.callback = tickUSD0;
            
            // Update legend configuration for line chart
            chart.options.plugins.legend.labels = {
              generateLabels: function(chart) {
                const original = Chart.defaults.plugins.legend.labels.generateLabels;
                const labels = original.call(this, chart);
                
                // Customize legend labels to show dashed lines for budgeted data
                labels.forEach(label => {
                  if (label.text.includes('Budget')) {
                    // Remove the box and show only a dashed line
                    label.fillStyle = 'transparent';
                    label.strokeStyle = label.strokeStyle;
                    label.lineDash = [6, 4]; // Same dash pattern as the actual line
                    label.lineWidth = 2;
                    label.usePointStyle = false; // Don't use point style
                  }
                });
                
                return labels;
              }
            };
            
            // Hook up timeframe buttons
            Array.from(timeframeWrap.querySelectorAll("button")).forEach(btn=>{
              btn.classList.toggle("active", btn.dataset.tf===timelineFilter);
              btn.onclick = ()=>{
                timelineFilter = btn.dataset.tf;
                Array.from(timeframeWrap.querySelectorAll("button")).forEach(b=>b.classList.toggle("active", b===btn));
                const full = monthlySeriesForProperty(drilledProp);
                const sliced = sliceByTimeframe(full, timelineFilter);
                chart.data.labels = sliced.labels;
                chart.data.datasets[0].data = sliced.act;
                chart.data.datasets[1].data = sliced.bud;
                chart.update();
              };
            });
            
            chart.update();
            return;
          }

          // ---- Level 1 -> table modal for that property by month ----
          if (drillLevel === 1 && drilledProp) {
            const full = monthlySeriesForProperty(drilledProp);
            const s = sliceByTimeframe(full, timelineFilter); // Use filtered data
            const rowsTbl = s.labels.map((m, idx) => ({
              Month: m,
              Actual: s.act[idx],
              Budget: s.bud[idx],
              Pct: (s.bud[idx] ? ((s.act[idx] - s.bud[idx]) / s.bud[idx]) : NaN)
            }));
            const totActual = rowsTbl.reduce((a, r) => a + (r.Actual || 0), 0);
            const totBudget = rowsTbl.reduce((a, r) => a + (r.Budget || 0), 0);
            openModal(`Budgeted vs Actual Income — ${drilledProp}`, b => {
              renderTable(b, [
                { label: "Month",  key: "Month" },
                { label: "Actual (Month)",  value: r => tickUSD0(r.Actual), class: "num" },
                { label: "Budget",          value: r => tickUSD0(r.Budget), class: "num" },
                { label: "% Difference",    value: r => fmtPctSmart(r.Pct * 100), class: "num" }
              ], rowsTbl, undefined, {
                "Actual (Month)": tickUSD0(totActual),
                "Budget": tickUSD0(totBudget),
                "% Difference": fmtPctSmart(totBudget ? ((totActual - totBudget) / totBudget) * 100 : NaN)
              });
            }, rowsTbl);
          }
        }
      }
    });

    // initial crumbs
    renderBreadcrumb(panelBody, [baseTitle], ()=>{});
    styleCrumbs();
    updateBack();

    function backToBase() {
      drillLevel = 0; drilledProp = null; updateBack(); setTimeframeVisible(false);
      titleEl.textContent = baseTitle;
      renderBreadcrumb(panelBody, [baseTitle], ()=>{});
      styleCrumbs();

      chart.config.type = "bar";
      chart.data.labels = labels;
      chart.data.datasets = [
        {
          label: "Actual (Month)",
          data: actual.map(Math.round),
          backgroundColor: "#7e8a6b",
          categoryPercentage: 0.45,
          barPercentage: 0.98
        },
        {
          label: "Budget",
          data: budget.map(Math.round),
          backgroundColor: "#bdc2ce",
          categoryPercentage: 0.45,
          barPercentage: 0.98
        }
      ];
      chart.options.scales.y.ticks.callback = tickUSD0;
      chart.update();
    }
    backBtn.onclick = backToBase;
  };
}


  // ---------- Timelines (multi-level drill) ----------
  // Now 4 levels:
  // L0: Portfolio Actual vs Budgeted (with bucket selector)
  // L1: Actual (properties) for selected bucket
  // L2: Single property Actual vs Budgeted week-over-week
  // L3: Modal data table (existing)
  // Also: Y-axis scale fixed across all levels (min from all data, max = 100%)
 function timelineActualVsBudget(rowsAll, keyActual, keyBudget, title, options) {
  options = options || {};
  const state = { 
    level: 0, 
    selectedProps: [], 
    from: null, 
    to: null, 
    timelineFilter: "1mo",
    compareMode: false,
    showCompareButton: false,
    maxComparisons: 5,
    unitsMode: false
  };

  // ---------- helpers ----------
  const weekStr = r => (get(r, "WeekStart") || "").toString().slice(0, 10);
  const weight = r => asNum(get(r, "InServiceUnits")) || asNum(get(r, "Units")) || 0;

  // normalize percent to 0–1 (handles both 0–1 and 0–100 inputs)
  function toPct01(v) {
    if (!isFinite(v)) return NaN;
    return v > 1.5 ? v / 100 : v;
  }

  // for units mode: occupied/leased units = pct * weight
  function rowActualUnits(r) {
    const pct = toPct01(asNum(get(r, keyActual)));
    const w = weight(r);
    return (isFinite(pct) && isFinite(w) && w > 0) ? pct * w : NaN;
  }
  function rowBudgetUnits(r) {
    const pct = toPct01(asNum(get(r, keyBudget)));
    const w = weight(r);
    return (isFinite(pct) && isFinite(w) && w > 0) ? pct * w : NaN;
  }

  // weighted avg for a set of rows on a single snapshot
  function wAvg(rows, key) {
    let num = 0, den = 0;
    rows.forEach(r => {
      const v = asNum(get(r, key));
      const w = weight(r);
      if (isFinite(v) && isFinite(w) && w > 0) { num += v * w; den += w; }
    });
    return den ? (num / den) : NaN;
  }

  // sum of units (for units mode) for a set of rows
  function wSumUnits(rows, key) {
    let sum = 0;
    rows.forEach(r => {
      const pct = toPct01(asNum(get(r, key)));
      const w = weight(r);
      if (isFinite(pct) && isFinite(w) && w > 0) sum += pct * w;
    });
    return sum;
  }

  // min/max for consistent Y scale (depends on state.unitsMode)
  function calcGlobalScale() {
    if (state.unitsMode) {
      const vals = [];
      rowsAll.forEach(r => {
        const a = rowActualUnits(r), b = rowBudgetUnits(r);
        if (isFinite(a)) vals.push(a);
        if (isFinite(b)) vals.push(b);
      });
      if (!vals.length) return { min: 0, max: 1, pctMode: false, unitsMode: true };
      const maxVal = Math.max(...vals);
      const minVal = Math.min(...vals.filter(v => v >= 0));
      return { min: Math.min(0, minVal), max: Math.ceil(maxVal * 1.05) || 1, pctMode: false, unitsMode: true };
    }
    const vals = [];
    rowsAll.forEach(r => {
      const a = asNum(get(r, keyActual));
      const b = asNum(get(r, keyBudget));
      if (isFinite(a)) vals.push(a);
      if (isFinite(b)) vals.push(b);
    });
    if (!vals.length) return { min: 0, max: 1, pctMode: true, unitsMode: false };
    const maxVal = Math.max(...vals);
    const pctMode = maxVal <= 1.5;
    const minVal = Math.min(...vals);
    return { min: minVal, max: pctMode ? 1 : 100, pctMode, unitsMode: false };
  }
  function getScale() { return calcGlobalScale(); }

  // Scale from the actual plotted y-values (so units mode uses sums, not per-row values)
  function scaleFromPlottedValues(vals, unitsMode) {
    const finite = vals.filter(v => isFinite(v));
    if (!finite.length) return unitsMode ? { min: 0, max: 1, pctMode: false, unitsMode: true } : { min: 0, max: 1, pctMode: true, unitsMode: false };
    if (unitsMode) {
      const maxVal = Math.max(...finite);
      const minVal = Math.min(...finite.filter(v => v >= 0));
      return { min: Math.min(0, minVal), max: Math.ceil(maxVal * 1.05) || 1, pctMode: false, unitsMode: true };
    }
    const maxVal = Math.max(...finite);
    const minVal = Math.min(...finite);
    const pctMode = maxVal <= 1.5;
    return { min: minVal, max: pctMode ? 1 : 100, pctMode, unitsMode: false };
  }
  function yAxisTitle() {
    return state.unitsMode ? (title.includes("Occupancy") ? "Occupied units" : "Leased units") : (title.includes("Occupancy") ? "Occupancy %" : "Leased %");
  }

  // all available weeks (sorted)
  const allWeeks = distinct(rowsAll.map(weekStr)).filter(Boolean).sort();
  const maxWeek = allWeeks[allWeeks.length - 1];

  // timeline filter ranges
  function getTimelineRange(filter) {
    const d = new Date(maxWeek);
    switch (filter) {
      case "1w": return { from: addWeeks(maxWeek, -1), to: maxWeek };
      case "1mo": return { from: addMonths(maxWeek, -1), to: maxWeek };
      case "3mo": return { from: addMonths(maxWeek, -3), to: maxWeek };
      case "6mo": return { from: addMonths(maxWeek, -6), to: maxWeek };
      case "12mo": return { from: addMonths(maxWeek, -12), to: maxWeek };
      case "all": return { from: allWeeks[0], to: maxWeek };
      default: return { from: addMonths(maxWeek, -1), to: maxWeek };
    }
  }

  function addWeeks(dateStr, delta) {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + (delta * 7));
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const weekStr = `${y}-${m}-${day}`;
    // find closest available week
    const idx = allWeeks.findIndex(w => w >= weekStr);
    return idx >= 0 ? allWeeks[idx] : allWeeks[0];
  }

  // default range: past 6 months ending at latest week
  function addMonths(dateStr, delta) {
    const d = new Date(dateStr);
    d.setMonth(d.getMonth() + delta);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const firstOfMonth = `${y}-${m}-01`;
    // pick the first available week >= firstOfMonth
    const idx = allWeeks.findIndex(w => w >= firstOfMonth);
    return idx >= 0 ? allWeeks[idx] : allWeeks[0];
  }
  
  // Initialize range based on timeline filter
  if (!state.from || !state.to) {
    const range = getTimelineRange(state.timelineFilter);
    state.from = range.from;
    state.to = range.to;
  }

  // choose interval automatically per spec:
  // - if the selected range is within the current month -> weekly
  // - if within past 3 months -> weekly
  // - anything beyond -> monthly (use last available week per month)
  function pickInterval(from, to) {
    const dFrom = new Date(from), dTo = new Date(to);
    const sameMonth = dFrom.getFullYear() === dTo.getFullYear() && dFrom.getMonth() === dTo.getMonth();
    if (sameMonth) return "week";
    const monthsDiff = (dTo.getFullYear() - dFrom.getFullYear()) * 12 + (dTo.getMonth() - dFrom.getMonth()) + 1;
    return monthsDiff <= 3 ? "week" : "month";
  }

  // constraint weeks by range
  function weeksInRange(from, to) {
    return allWeeks.filter(w => w >= from && w <= to);
  }

  // last week string for a given month key (YYYY-MM) within a list of weeks
  function lastWeekOfMonth(weeks, monthKey) {
    const list = weeks.filter(w => w.startsWith(monthKey));
    return list.length ? list[list.length - 1] : null;
    }

  // portfolio series by interval (respects selected properties and range)
  function portfolioSeries(selectedProps, from, to) {
    const weeks = weeksInRange(from, to);
    const interval = pickInterval(from, to);
    const useUnits = state.unitsMode;

    // If no properties selected, use all properties
    const filteredRows = selectedProps.length > 0 ? 
      rowsAll.filter(r => selectedProps.includes(get(r, "Property"))) : 
      rowsAll;
      
      if (interval === "week") {
        const labels = weeks.map(w => formatDateForDisplay(w));
        const rowsByWeek = {};
        filteredRows.forEach(r => {
          const wk = weekStr(r);
          if (!wk || wk < from || wk > to) return;
          (rowsByWeek[wk] ||= []).push(r);
        });
        const a = weeks.map(w => useUnits ? wSumUnits(rowsByWeek[w] || [], keyActual) : wAvg(rowsByWeek[w] || [], keyActual));
        const b = weeks.map(w => useUnits ? wSumUnits(rowsByWeek[w] || [], keyBudget) : wAvg(rowsByWeek[w] || [], keyBudget));
        return { labels, a, b, interval, rawLabels: weeks };
    } else {
      const months = distinct(weeks.map(w => w.slice(0, 7))).sort();
      const labels = months;
      const a = [], b = [];
      months.forEach(m => {
        const lastW = lastWeekOfMonth(weeks, m);
        if (!lastW) { a.push(NaN); b.push(NaN); return; }
        let rows = filteredRows.filter(r => weekStr(r) === lastW);
        a.push(useUnits ? wSumUnits(rows, keyActual) : wAvg(rows, keyActual));
        b.push(useUnits ? wSumUnits(rows, keyBudget) : wAvg(rows, keyBudget));
      });
      return { labels, a, b, interval };
    }
  }

  // property series for individual properties (for stacked view)
  function propertySeries(selectedProps, from, to) {
    const weeks = weeksInRange(from, to);
    const interval = pickInterval(from, to);
    const props = selectedProps.length > 0
      ? sortPropertyNamesByBirth(selectedProps, rowsAll)
      : sortPropertyNamesByBirth(distinct(rowsAll.map(r => get(r, "Property"))).filter(Boolean), rowsAll);
    const useUnits = state.unitsMode;

    if (interval === "week") {
      const byWeekProp = {};
      rowsAll.forEach(r => {
        const wk = weekStr(r);
        if (!wk || wk < from || wk > to) return;
        const p = get(r, "Property");
        if (!props.includes(p)) return;
        (byWeekProp[p] ||= {})[wk] = useUnits
          ? { actual: rowActualUnits(r), budgeted: rowBudgetUnits(r) }
          : { actual: asNum(get(r, keyActual)), budgeted: asNum(get(r, keyBudget)) };
      });
      return {
        labels: weeks.map(w => formatDateForDisplay(w)),
        props,
        dataFor: (p) => weeks.map(w => byWeekProp[p]?.[w]?.actual ?? NaN),
        budgetedFor: (p) => weeks.map(w => byWeekProp[p]?.[w]?.budgeted ?? NaN),
        interval,
        rawLabels: weeks
      };
    } else {
      const months = distinct(weeks.map(w => w.slice(0, 7))).sort();
      const lastWeekPerMonth = months.map(m => lastWeekOfMonth(weeks, m));
      const byWProp = {};
      rowsAll.forEach(r => {
        const wk = weekStr(r);
        if (!wk || wk < from || wk > to) return;
        const p = get(r, "Property");
        if (!props.includes(p)) return;
        (byWProp[p] ||= {})[wk] = useUnits
          ? { actual: rowActualUnits(r), budgeted: rowBudgetUnits(r) }
          : { actual: asNum(get(r, keyActual)), budgeted: asNum(get(r, keyBudget)) };
      });
      const formattedMonths = months.map(m => {
        const d = new Date(m + "-01");
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        return `${monthNames[d.getMonth()]} ${d.getFullYear()}`;
      });
      return {
        labels: formattedMonths,
        props,
        dataFor: (p) => lastWeekPerMonth.map(w => (w && byWProp[p]?.[w] ? byWProp[p][w].actual : NaN)),
        budgetedFor: (p) => lastWeekPerMonth.map(w => (w && byWProp[p]?.[w] ? byWProp[p][w].budgeted : NaN)),
        interval,
        rawLabels: months
      };
    }
  }


  // ---------- renderer ----------
  function render(panelBody) {
    panelBody.innerHTML = "";

    // Breadcrumbs
    const trail = [title];
    renderBreadcrumb(panelBody, trail, (idx) => {
      state.level = idx;
      render(panelBody);
    });
    // style crumbs
    const bc = panelBody.parentElement.querySelector(".breadcrumb");
    if (bc) { bc.style.fontSize = "13px"; bc.style.fontWeight = "800"; bc.style.padding = "2px 0 6px"; }

    // Tools: property dropdown + timeline filter selectors
    const tools = panelBody.parentElement.querySelector(".inline-controls");
    // clear previous
    tools?.querySelectorAll("select[data-role='props'],select[data-role='compare-props'],select[data-role='timeline'],select[data-role='timeline-individual'],select[data-role='units-toggle'],div[data-role='checkbox-container'],div[data-role='compare-tags']").forEach(n => n.remove());

    // Get all available properties
    const allProps = sortPropertyNamesByBirth(distinct(rowsAll.map(r => get(r, "Property"))).filter(Boolean), rowsAll);
    
    // Property dropdown (single select)
    const selProps = document.createElement("select");
    selProps.className = "select";
    selProps.setAttribute("data-role", "props");
    selProps.innerHTML = `<option value="">All Properties</option>` + 
      allProps.map(p => `<option value="${p}">${p}</option>`).join("");
    
    // Set current value based on state
    if (state.selectedProps.length === 0) {
      selProps.value = ""; // All Properties
    } else if (state.selectedProps.length === 1) {
      selProps.value = state.selectedProps[0]; // Single property
    } else {
      selProps.value = ""; // Default to All Properties
    }
    
    tools?.appendChild(selProps);
    
    // Comparison property dropdown (initially hidden)
    const selCompareProps = document.createElement("select");
    selCompareProps.className = "select";
    selCompareProps.setAttribute("data-role", "compare-props");
    selCompareProps.style.display = "none";
    selCompareProps.innerHTML = `<option value="">Select property to compare...</option>` + 
      allProps.filter(p => !state.selectedProps.includes(p)).map(p => `<option value="${p}">${p}</option>`).join("");
    tools?.appendChild(selCompareProps);
    
    // Comparison tags container
    const compareTagsContainer = document.createElement("div");
    compareTagsContainer.setAttribute("data-role", "compare-tags");
    compareTagsContainer.style.display = "flex";
    compareTagsContainer.style.flexWrap = "wrap";
    compareTagsContainer.style.gap = "4px";
    compareTagsContainer.style.marginTop = "8px";
    tools?.appendChild(compareTagsContainer);
    
    // Function to update comparison tags
    function updateComparisonTags() {
      compareTagsContainer.innerHTML = "";
      
      state.selectedProps.forEach((prop, index) => {
        const tag = document.createElement("div");
        tag.style.display = "inline-flex";
        tag.style.alignItems = "center";
        tag.style.gap = "4px";
        tag.style.padding = "4px 8px";
        tag.style.backgroundColor = "#f0f0f0";
        tag.style.border = "1px solid #ccc";
        tag.style.borderRadius = "4px";
        tag.style.fontSize = "12px";
        
        const propName = document.createElement("span");
        propName.textContent = prop;
        
        tag.appendChild(propName);
        
        // Only show X button for properties after the first one
        if (index > 0) {
          const removeBtn = document.createElement("button");
          removeBtn.innerHTML = "×";
          removeBtn.style.background = "none";
          removeBtn.style.border = "none";
          removeBtn.style.cursor = "pointer";
          removeBtn.style.fontSize = "14px";
          removeBtn.style.color = "#666";
          removeBtn.style.padding = "0";
          removeBtn.style.marginLeft = "4px";
          removeBtn.title = "Remove this property from comparison";
          
          removeBtn.onclick = () => {
            state.selectedProps.splice(index, 1);
            updateComparisonTags();
            render(panelBody);
          };
          
          tag.appendChild(removeBtn);
        }
        
        compareTagsContainer.appendChild(tag);
      });
    }
    
    // Function to update comparison dropdown options
    function updateComparisonDropdown() {
      const availableProps = allProps.filter(p => !state.selectedProps.includes(p));
      selCompareProps.innerHTML = `<option value="">Select property to compare...</option>` + 
        availableProps.map(p => `<option value="${p}">${p}</option>`).join("");
      
      // Show/hide dropdown based on whether we can add more comparisons
      const canAddMore = state.selectedProps.length < state.maxComparisons && availableProps.length > 0;
      selCompareProps.style.display = state.showCompareButton && canAddMore ? "inline-block" : "none";
    }
    
    // Add event listener to main dropdown
    selProps.onchange = () => {
      const selectedProp = selProps.value;
      
      if (selectedProp === "") {
        // "All Properties" selected - show aggregated view
        state.selectedProps = [];
        state.compareMode = false;
        state.showCompareButton = false;
      } else {
        // Single property selected - show individual line
        state.selectedProps = [selectedProp];
        state.showCompareButton = true;
        state.compareMode = true; // Enable comparison mode immediately
      }
      
      updateComparisonTags();
      updateComparisonDropdown();
      render(panelBody);
    };
    
    // Add event listener to comparison dropdown
    selCompareProps.onchange = () => {
      const selectedProp = selCompareProps.value;
      
      if (selectedProp && state.selectedProps.length < state.maxComparisons) {
        // Add property for comparison
        state.selectedProps.push(selectedProp);
        selCompareProps.value = "";
        updateComparisonTags();
        updateComparisonDropdown();
        render(panelBody);
      }
    };
    
    // Initialize tags and dropdown
    updateComparisonTags();
    updateComparisonDropdown();

    // Timeline filter selector
    const selTimeline = document.createElement("select");
    selTimeline.className = "select";
    selTimeline.setAttribute("data-role", "timeline");
    selTimeline.innerHTML = `
      <option value="1w">1 Week</option>
      <option value="1mo" selected>1 Month</option>
      <option value="3mo">3 Months</option>
      <option value="6mo">6 Months</option>
      <option value="12mo">12 Months</option>
      <option value="all">All</option>
    `;
    selTimeline.value = state.timelineFilter;
    tools?.appendChild(selTimeline);

    function updateTimelineFilter() {
      const range = getTimelineRange(selTimeline.value);
      state.timelineFilter = selTimeline.value;
      state.from = range.from;
      state.to = range.to;
    }
    
    selTimeline.onchange = () => { updateTimelineFilter(); render(panelBody); };
    updateTimelineFilter();

    // Percent / Units toggle (occupancy chart only)
    if (options.allowUnitsToggle) {
      const selUnits = document.createElement("select");
      selUnits.className = "select";
      selUnits.setAttribute("data-role", "units-toggle");
      selUnits.title = "Show occupancy as percentage or as occupied units count";
      selUnits.innerHTML = `<option value="pct">%</option><option value="units">Units</option>`;
      selUnits.value = state.unitsMode ? "units" : "pct";
      tools?.appendChild(selUnits);
      selUnits.onchange = () => {
        state.unitsMode = selUnits.value === "units";
        const titleEl = panelBody.parentElement.querySelector(".panel-title");
        if (titleEl) titleEl.textContent = state.unitsMode ? title.replace(" %", "") + " (units) — Actual vs Budgeted" : title + " — Actual vs Budgeted";
        render(panelBody);
      };
    }

    // --------- levels ----------
    if (state.level === 0) {
      // Check if we should show individual property lines or aggregated view
      const showIndividualLines = state.selectedProps.length > 0; // Show individual lines for any selected properties
      
      if (showIndividualLines) {
        // Show individual property lines (stacked)
        const { labels, props, dataFor, budgetedFor, interval } = propertySeries(state.selectedProps, state.from, state.to);
        const ctx = createCanvas(panelBody);
        
        const datasets = [];
        const colors = [
          "#2f5d41", "#d32f2f", "#1976d2", "#7b1fa2", "#f57c00", // Green, Red, Blue, Purple, Orange
          "#388e3c", "#c62828", "#1565c0", "#6a1b9a", "#ef6c00"  // Darker variants
        ];
        
        props.forEach((p, idx) => {
          // Use distinct colors for each property
          const actualColor = colors[idx % colors.length];
          const budgetedColor = colors[idx % colors.length] + "80"; // Add transparency
          
          // Actual line
          datasets.push({
            label: `${p} (Actual)`,
            data: dataFor(p),
            borderColor: actualColor,
            backgroundColor: actualColor,
            tension: .25, 
            pointRadius: 2,
            borderWidth: 2
          });
          // Budgeted line (dashed)
          datasets.push({
            label: `${p} (Budgeted)`,
            data: budgetedFor(p),
            borderColor: actualColor,
            backgroundColor: actualColor,
            borderDash: [6, 4],
            tension: .25, 
            pointRadius: 2,
            borderWidth: 1
          });
        });
        
        // Update chart title based on comparison state
        let chartTitle;
        if (props.length === 1) {
          chartTitle = `${title} — ${props[0]}`;
        } else if (props.length === 2) {
          chartTitle = `${title} — ${props[0]} vs ${props[1]}`;
        } else if (props.length > 2) {
          chartTitle = `${title} — ${props.length} Properties Comparison`;
        } else {
          chartTitle = `${title} — Selected Properties`;
        }
        
        // Update the panel title
        const titleEl = panelBody.parentElement.querySelector(".panel-title");
        if (titleEl) {
          titleEl.textContent = chartTitle;
        }
        const allY = [];
        props.forEach(p => {
          dataFor(p).forEach(v => { if (isFinite(v)) allY.push(v); });
          budgetedFor(p).forEach(v => { if (isFinite(v)) allY.push(v); });
        });
        const scale = scaleFromPlottedValues(allY, state.unitsMode);
        const fmtY = scale.unitsMode ? fmtInt : (v => fmtPctSmart(v));
        new Chart(ctx, {
          type: "line",
          data: { labels, datasets },
          options: {
            scales: {
              y: {
                min: scale.min,
                max: scale.max,
                title: { display: true, text: yAxisTitle() },
                ticks: { callback: v => fmtY(v) }
              }
            },
            plugins: { 
              legend: { 
                position: "bottom",
                labels: {
                  generateLabels: function(chart) {
                    const original = Chart.defaults.plugins.legend.labels.generateLabels;
                    const labels = original.call(this, chart);
                    
                    // Customize legend labels to show dashed lines for budgeted data
                    labels.forEach(label => {
                      if (label.text.includes('(Budgeted)')) {
                        // Remove the box and show only a dashed line
                        label.fillStyle = 'transparent';
                        label.strokeStyle = label.strokeStyle;
                        label.lineDash = [6, 4]; // Same dash pattern as the actual line
                        label.lineWidth = 2;
                        label.usePointStyle = false; // Don't use point style
                      }
                    });
                    
                    return labels;
                  }
                }
              }, 
              tooltip: {
                callbacks: {
                  title: (context) => `${interval === "week" ? "Week" : "Month"}: ${context[0]?.label ?? ''}`,
                  label: (c) => {
                    const isActual = (c.dataset.label || '').toLowerCase().includes('actual');
                    const isBudget = (c.dataset.label || '').toLowerCase().includes('budget');
                    const desc = scale.unitsMode ? '' : (isActual ? 'Weighted actual percentage' : (isBudget ? 'Weighted budgeted percentage' : ''));
                    return `${c.dataset.label}: ${fmtY(c.parsed.y)}${desc ? ' — ' + desc : ''}`;
                  }
                }
              } 
            },
            onClick: () => {
              // Open data table for selected properties
              const rows = [];
              const colLabel = scale.unitsMode ? "Occupied units" : (title.includes("Occupancy") ? "Occupancy %" : "Leased %");
              labels.forEach((lab, i) => {
                const row = { Period: lab };
                props.forEach(p => {
                  row[`${p} (Actual)`] = dataFor(p)[i];
                  row[`${p} (Budgeted)`] = budgetedFor(p)[i];
                });
                rows.push(row);
              });
              
              // Create long format export data
              const exportData = [];
              labels.forEach((lab, i) => {
                props.forEach(p => {
                  const actualVal = dataFor(p)[i];
                  const budgetedVal = budgetedFor(p)[i];
                  
                  if (isFinite(actualVal)) {
                    exportData.push({
                      Property: p,
                      Period: lab,
                      "Actual or Budgeted": "Actual",
                      [colLabel]: actualVal
                    });
                  }
                  
                  if (isFinite(budgetedVal)) {
                    exportData.push({
                      Property: p,
                      Period: lab,
                      "Actual or Budgeted": "Budgeted",
                      [colLabel]: budgetedVal
                    });
                  }
                });
              });
              
              openModal(chartTitle, b => {
                const columns = [
                  { label: interval === "week" ? "WeekStart" : "Month", key: "Period" }
                ];
                props.forEach(p => {
                  columns.push({ label: `${p} (Actual)`, value: r => fmtY(r[`${p} (Actual)`]), class: "num" });
                  columns.push({ label: `${p} (Budgeted)`, value: r => fmtY(r[`${p} (Budgeted)`]), class: "num" });
                });
                
                renderTable(b, columns, rows);
              }, exportData);
            }
          }
        });
      } else {
        // Show aggregated portfolio view (when "All Properties" is selected)
        const { labels, a, b, interval } = portfolioSeries(state.selectedProps, state.from, state.to);
        const ctx = createCanvas(panelBody);
        const allY = [...(a || []), ...(b || [])].filter(v => isFinite(v));
        const scale = scaleFromPlottedValues(allY, state.unitsMode);
        const fmtY = scale.unitsMode ? fmtInt : (v => fmtPctSmart(v));
        new Chart(ctx, {
          type: "line",
          data: {
            labels,
            datasets: [
              { label: "Actual",   data: a, borderColor: "#2f5d41", backgroundColor: "#2f5d41", tension: .25, pointRadius: 3 },
              { label: "Budgeted", data: b, borderColor: "#9aa796", backgroundColor: "#9aa796", borderDash: [6, 4], tension: .25, pointRadius: 3 }
            ]
          },
          options: {
            scales: {
              y: {
                min: scale.min,
                max: scale.max,
                title: { display: true, text: yAxisTitle() },
                ticks: { callback: v => fmtY(v) }
              }
            },
            plugins: {
              legend: { 
                position: "bottom",
                labels: {
                  generateLabels: function(chart) {
                    const original = Chart.defaults.plugins.legend.labels.generateLabels;
                    const labels = original.call(this, chart);
                    
                    // Customize legend labels to show dashed lines for budgeted data
                    labels.forEach(label => {
                      if (label.text.includes('Budgeted')) {
                        // Remove the box and show only a dashed line
                        label.fillStyle = 'transparent';
                        label.strokeStyle = label.strokeStyle;
                        label.lineDash = [6, 4]; // Same dash pattern as the actual line
                        label.lineWidth = 2;
                        label.usePointStyle = false; // Don't use point style
                      }
                    });
                    
                    return labels;
                  }
                }
              },
              tooltip: {
                callbacks: {
                  title: (context) => `${interval === "week" ? "Week" : "Month"}: ${context[0]?.label ?? ''}`,
                  label: (c) => {
                    const isActual = (c.dataset.label || '').toLowerCase().includes('actual');
                    const isBudget = (c.dataset.label || '').toLowerCase().includes('budget');
                    const desc = scale.unitsMode ? '' : (isActual ? 'Weighted actual percentage' : (isBudget ? 'Weighted budgeted percentage' : ''));
                    return `${c.dataset.label}: ${fmtY(c.parsed.y)}${desc ? ' — ' + desc : ''}`;
                  }
                }
              }
            },
            onClick: () => {
              // Open data table directly
              // Recalculate the data to ensure we have the correct budgeted values
              const filteredRows = state.selectedProps.length > 0 ? 
                rowsAll.filter(r => state.selectedProps.includes(get(r, "Property"))) : 
                rowsAll;
              
              const rows = labels.map((lab, i) => {
                let actualVal = a[i];
                let budgetedVal = b[i];
                
                // If budgeted is NaN, try to recalculate it
                if (!isFinite(budgetedVal)) {
                  const weekData = filteredRows.filter(r => {
                    const wk = weekStr(r);
                    return interval === "week" ? wk === lab : wk.startsWith(lab.slice(0, 7));
                  });
                  budgetedVal = scale.unitsMode ? wSumUnits(weekData, keyBudget) : wAvg(weekData, keyBudget);
                }
                
                return {
                  Period: lab,
                  Actual: actualVal,
                  Budgeted: budgetedVal
                };
              });
              
              const colLabel = scale.unitsMode ? "Occupied units" : (title.includes("Occupancy") ? "Occupancy %" : "Leased %");
              const actualCol = scale.unitsMode ? "Actual (units)" : "Actual %";
              const budgetCol = scale.unitsMode ? "Budgeted (units)" : "Budgeted %";
              // Create long format export data for All Properties view
              const exportData = [];
              rows.forEach(row => {
                if (isFinite(row.Actual)) {
                  exportData.push({
                    Property: "All Properties",
                    Period: row.Period,
                    "Actual or Budgeted": "Actual",
                    [colLabel]: row.Actual
                  });
                }
                if (isFinite(row.Budgeted)) {
                  exportData.push({
                    Property: "All Properties",
                    Period: row.Period,
                    "Actual or Budgeted": "Budgeted",
                    [colLabel]: row.Budgeted
                  });
                }
              });
              
              openModal(`${title} — Timeline Data`, b => {
                const avgActual = rows.reduce((s, r) => s + (isFinite(r.Actual) ? r.Actual : 0), 0) / (rows.filter(r => isFinite(r.Actual)).length || 1);
                const avgBudgeted = rows.reduce((s, r) => s + (isFinite(r.Budgeted) ? r.Budgeted : 0), 0) / (rows.filter(r => isFinite(r.Budgeted)).length || 1);
                
                renderTable(b, [
                  { label: interval === "week" ? "WeekStart" : "Month", key: "Period" },
                  { label: actualCol, value: r => fmtY(r.Actual), class: "num" },
                  { label: budgetCol, value: r => fmtY(r.Budgeted), class: "num" }
                ], rows, undefined, scale.unitsMode ? {
                  [actualCol]: fmtY(avgActual),
                  [budgetCol]: fmtY(avgBudgeted)
                } : {
                  "Actual %": fmtPctSmart(avgActual),
                  "Budgeted %": fmtPctSmart(avgBudgeted)
                });
              }, exportData);
            }
          }
        });
      }

    }
  }

  return render;
}


function reviewsAvgChart(reviews){
  const byProp = {};
  reviews.forEach(r => {
    const p = get(r, "Property");
    const rat = asNum(get(r, "rating"));
    if (!p || !isFinite(rat)) return;
    (byProp[p] ||= []).push(rat);
  });

  const labels = Object.keys(byProp).sort((a, b) => {
    const avga = byProp[a].reduce((x, y) => x + y, 0) / byProp[a].length;
    const avgb = byProp[b].reduce((x, y) => x + y, 0) / byProp[b].length;
    return avgb - avga;
  });
  const avgs = labels.map(p => byProp[p].reduce((x, y) => x + y, 0) / byProp[p].length);

  return host => {
    const { wrap, body } = createPanel(host, "Google Reviews — Average Rating by Property");
    body.style.height = "360px";
    const ctx = createCanvas(body);

    new Chart(ctx, {
      type: "bar",
      data: { labels, datasets: [{ label: "Avg Rating", data: avgs, backgroundColor: "#7e8a6b" }] },
      options: {
        onClick: (_, els) => {
          if (!els.length) return;
          const prop = labels[els[0].index];
          openModal(`Google Reviews — ${prop}`, b => ratingSplitChart(reviews, prop)(b));
        },
        plugins: { legend: { display: false } }
      }
    });
  };
}

function ratingSplitChart(reviews, property){
  const rows = reviews.filter(r => get(r, "Property") === property);
  const buckets = [1, 2, 3, 4, 5];
  const counts = buckets.map(k => rows.filter(r => asNum(get(r, "rating")) === k).length);

  return host => {
    // Breadcrumbs (close modal if user clicks "Reviews")
    renderBreadcrumb(host, ["Reviews", property], idx => {
      if (idx === 0 && typeof closeModal === "function") closeModal();
    });

    // Back button (to exit modal back to property list)
    const backBar = document.createElement("div");
    backBar.style.display = "flex";
    backBar.style.marginBottom = "8px";
    const backBtn = document.createElement("button");
    backBtn.className = "btn";
    backBtn.textContent = "← Back";
    backBtn.style.fontWeight = "800";
    backBtn.onclick = () => { if (typeof closeModal === "function") closeModal(); };
    backBar.appendChild(backBtn);
    host.appendChild(backBar);

    const ctx = createCanvas(host);
    new Chart(ctx, {
      type: "pie",
      data: {
        labels: buckets.map(b => `${b}★`),
        datasets: [{ data: counts, backgroundColor: ["#e75d5d","#f6a86b","#7fb36a","#a6ad8a","#7e8a6b"] }]
      },
      options: {
        plugins: { legend: { position: "bottom" } },
        onClick: (_, els) => {
          if (!els.length) return;
          const rating = buckets[els[0].index];
          openModal(`Google Reviews — ${property} — ${rating}★`, b => categorySplitChart(reviews, property, rating)(b));
        }
      }
    });
  };
}

function categorySplitChart(reviews, property, rating){
  const rows = reviews.filter(r => get(r, "Property") === property && asNum(get(r, "rating")) === rating);
  const byCat = {};
  rows.forEach(r => {
    const c = (get(r, "category") || "uncategorized").toString();
    byCat[c] = (byCat[c] || 0) + 1;
  });
  const labels = Object.keys(byCat);
  const data = labels.map(k => byCat[k]);

  return host => {
    // Breadcrumbs with jump targets
    renderBreadcrumb(host, ["Reviews", property, `${rating}★`], idx => {
      if (idx === 0) { if (typeof closeModal === "function") closeModal(); return; }
      if (idx === 1 || idx === 2) {
        openModal(`Google Reviews — ${property}`, b => ratingSplitChart(reviews, property)(b));
      }
    });

    // Back button to pie
    const backBar = document.createElement("div");
    backBar.style.display = "flex";
    backBar.style.marginBottom = "8px";
    const backBtn = document.createElement("button");
    backBtn.className = "btn";
    backBtn.textContent = "← Back";
    backBtn.style.fontWeight = "800";
    backBtn.onclick = () => openModal(`Google Reviews — ${property}`, b => ratingSplitChart(reviews, property)(b));
    backBar.appendChild(backBtn);
    host.appendChild(backBar);

    const ctx = createCanvas(host);
    new Chart(ctx, {
      type: "bar",
      data: { labels, datasets: [{ label: "Count", data, backgroundColor: "#7e8a6b" }] },
      options: {
        plugins: { legend: { position: "bottom" } },
        onClick: (_, els) => {
          if (!els.length) return;
          const cat = labels[els[0].index];
          openModal(`Reviews — ${property} — ${rating}★ — ${cat}`, b => reviewsTable(reviews, property, rating, cat)(b));
        }
      }
    });
  };
}

function reviewsTable(reviews, property, rating, category){
  const rows = reviews.filter(r =>
    get(r, "Property") === property &&
    asNum(get(r, "rating")) === rating &&
    ((get(r, "category") || "").toString() === category)
  );

  return host => {
    // Breadcrumbs for table level with proper back jumps
    renderBreadcrumb(host, ["Reviews", property, `${rating}★`, category], idx => {
      if (idx === 0) { if (typeof closeModal === "function") closeModal(); return; }
      if (idx === 1 || idx === 2) {
        openModal(`Google Reviews — ${property}`, b => ratingSplitChart(reviews, property)(b));
        return;
      }
      if (idx === 3) {
        openModal(`Google Reviews — ${property} — ${rating}★`, b => categorySplitChart(reviews, property, rating)(b));
        return;
      }
    });

    // Back button to category (bucket) view
    const backBar = document.createElement("div");
    backBar.style.display = "flex";
    backBar.style.marginBottom = "8px";
    const backBtn = document.createElement("button");
    backBtn.className = "btn";
    backBtn.textContent = "← Back";
    backBtn.style.fontWeight = "800";
    backBtn.onclick = () => openModal(`Google Reviews — ${property} — ${rating}★`, b => categorySplitChart(reviews, property, rating)(b));
    backBar.appendChild(backBtn);
    host.appendChild(backBar);

    // Add export button
    const exportBtn = document.createElement('button');
    exportBtn.className = 'btn';
    exportBtn.textContent = 'Export CSV';
    exportBtn.style.marginLeft = '8px';
    exportBtn.onclick = () => {
      const exportData = rows.map(r => ({
        Property: get(r, "Property"),
        Category: get(r, "category"),
        Rating: asNum(get(r, "rating")),
        "Review Date": get(r, "reviewdate"),
        "Reviewer Name": get(r, "reviewername"),
        "Review Text": get(r, "ReviewText")
      }));
      const filename = `Reviews_${property}_${rating}star_${category}.csv`;
      exportToCSV(exportData, filename);
    };
    backBar.appendChild(exportBtn);

    renderTable(host, [
      { label: "Property", key: "Property" },
      { label: "Category", key: "category" },
      { label: "Rating", value: r => asNum(get(r, "rating")), class: "num" },
      { label: "Review Date", key: "reviewdate" },
      { label: "Reviewer Name", key: "reviewername" },
      {
        label: "Review Text (click row for full)",
        value: r => {
          const t = (get(r, "ReviewText") || "").toString();
          return t.length > 120 ? t.slice(0, 120) + "…" : t;
        }
      }
    ], rows, r => openModal("Review", b => {
      // Breadcrumbs for detail level with jumps all the way up
      renderBreadcrumb(b, ["Reviews", property, `${rating}★`, category, "Review"], idx => {
        if (idx === 0) { if (typeof closeModal === "function") closeModal(); return; }
        if (idx === 1 || idx === 2) {
          openModal(`Google Reviews — ${property}`, bb => ratingSplitChart(reviews, property)(bb));
          return;
        }
        if (idx === 3) {
          openModal(`Google Reviews — ${property} — ${rating}★`, bb => categorySplitChart(reviews, property, rating)(bb));
          return;
        }
        if (idx === 4) {
          openModal(`Reviews — ${property} — ${rating}★ — ${category}`, bb => reviewsTable(reviews, property, rating, category)(bb));
          return;
        }
      });

      // Back button to table
      const backBar2 = document.createElement("div");
      backBar2.style.display = "flex";
      backBar2.style.marginBottom = "8px";
      const backBtn2 = document.createElement("button");
      backBtn2.className = "btn";
      backBtn2.textContent = "← Back";
      backBtn2.style.fontWeight = "800";
      backBtn2.onclick = () => openModal(`Reviews — ${property} — ${rating}★ — ${category}`, bb => reviewsTable(reviews, property, rating, category)(bb));
      backBar2.appendChild(backBtn2);
      b.appendChild(backBar2);

      // Header with property, date, reviewer
      const head = document.createElement("div");
      head.style.marginBottom = "8px";

      const title = document.createElement("div");
      title.textContent = (get(r, "Property") || "").toString();
      title.style.fontWeight = "800";
      title.style.fontSize = "16px";
      head.appendChild(title);

      const sub = document.createElement("div");
      sub.className = "subtle";
      const dateStr = (get(r, "reviewdate") || "").toString();
      const reviewer = (get(r, "reviewername") || "").toString();
      sub.textContent = [dateStr, reviewer].filter(Boolean).join(" · ");
      head.appendChild(sub);

      b.appendChild(head);

      // Full review text
      const p = document.createElement("p");
      p.textContent = (get(r, "ReviewText") || "").toString();
      b.appendChild(p);
    }));
  };
}




  // Tabs
  document.querySelectorAll(".tab").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      const id = btn.dataset.tab;
      document.querySelectorAll(".tabpane").forEach(p=>p.classList.remove("active"));
      document.getElementById(`tab-${id}`).classList.add("active");
    });
  });

  // PropertyList API: fetch authoritative Status from the database
  const PROPERTY_LIST_API = "https://stoagroupdb-ddre.onrender.com/api/leasing/property-list";

  async function fetchPropertyListStatus() {
    try {
      const res = await fetch(PROPERTY_LIST_API, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const map = {};
      const canonical = [];
      (json.data || []).forEach(p => {
        const name = (p.Property || "").trim().toLowerCase();
        const status = (p.Status || "").trim();
        if (name) {
          map[name] = status;
          if (isLeaseUpOrStabilizedStatus(status)) {
            canonical.push({ Property: (p.Property || "").trim(), Status: status });
          }
        }
      });
      console.log(`[PropertyList] Loaded ${Object.keys(map).length} statuses, ${canonical.length} MMR-email properties`);
      return { statusMap: map, canonicalProperties: canonical, propertyListRows: json.data || [], fetchOk: true };
    } catch (e) {
      console.warn("[PropertyList] Could not fetch DB statuses, using Domo Status as-is:", e);
      return { statusMap: {}, canonicalProperties: [], propertyListRows: [], fetchOk: false };
    }
  }

  /**
   * Same property across Domo vs DB despite "The " prefix and punctuation (share one logical key).
   */
  function propEntityKey(s) {
    let k = (s || "").toString().trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    if (k.startsWith("the")) k = k.slice(3);
    return k;
  }

  function overlayDbStatus(rows, statusMap) {
    if (!statusMap || Object.keys(statusMap).length === 0) return rows;
    const entityToStatus = {};
    Object.keys(statusMap).forEach((k) => {
      const ek = propEntityKey(k);
      if (ek) entityToStatus[ek] = statusMap[k];
    });
    rows.forEach((r) => {
      const prop = (get(r, "Property") || "").toString().trim().toLowerCase();
      if (!prop) return;
      if (statusMap[prop]) r.Status = statusMap[prop];
      else {
        const ek = propEntityKey(prop);
        if (ek && entityToStatus[ek]) r.Status = entityToStatus[ek];
      }
    });
    return rows;
  }

  // MAIN
  let MMR=[], REV=[], weekOptions=[], selectedWeek=null;
  /** Lowercased property name -> Status from DB (same keys as email report). */
  let propertyStatusMap = {};
  /** Lease-Up / Stabilized rows from property-list (authoritative count). */
  let propertyCanonicalActive = [];
  /** Raw rows from property-list API (for stub rows when Domo has no match). */
  let propertyListRows = [];
  /** False when fetch to stoagroupDB failed (Domo iframe / network); overlay/augment need API data. */
  let propertyListFetchOk = false;

  async function init(){
    const [mmrRaw, revRaw, plResult] = await Promise.all([
      fetchAlias(ALIASES.MMR, FIELDS.MMR),
      fetchAlias(ALIASES.REV, FIELDS.REV).catch(()=>[]),
      fetchPropertyListStatus()
    ]);
    propertyStatusMap = plResult.statusMap || plResult || {};
    propertyCanonicalActive = plResult.canonicalProperties || [];
    propertyListRows = plResult.propertyListRows || [];
    propertyListFetchOk = plResult.fetchOk !== false;
    MMR = overlayDbStatus(mmrRaw, propertyStatusMap);
    REV = revRaw;

    // WeekStart select
    weekOptions = distinct(MMR.map(r=>(get(r,"WeekStart")||"").toString().slice(0,10))).filter(Boolean).sort().reverse();
    const sel=$("#weekstart-select"); sel.innerHTML = weekOptions.map(w=>`<option value="${w}">${formatDateForDisplay(w)}</option>`).join("");
    selectedWeek = weekOptions[0] || null;
    sel.value = selectedWeek;
    sel.addEventListener("change", ()=>{ selectedWeek = sel.value; render(); });

    render();
  }

  function filterBySelectedWeek(rows){
    if (!selectedWeek) return rows;
    return rows.filter(r => (get(r,"WeekStart")||"").toString().startsWith(selectedWeek));
  }

  /**
   * Same pipeline as monday morning email report `filterToMostRecentWeek`:
   * authoritative Status is already overlaid; keep Lease-Up / Stabilized;
   * one row per Property (latest ReportDate); sort by BirthOrder.
   * When `weekPrefix` is set, only rows for that WeekStart (dashboard week picker).
   */
  function filterMmrLikeEmailReport(allRows, weekPrefix) {
    if (!allRows || !allRows.length) return [];
    let rows = allRows.filter(r => isLeaseUpOrStabilizedStatus(get(r, "Status")));
    if (weekPrefix) {
      const pfx = weekPrefix.toString().slice(0, 10);
      rows = rows.filter(r => (get(r, "WeekStart") || "").toString().slice(0, 10) === pfx);
    }
    const propertyMap = {};
    // Prefer latest ReportDate per property; do not drop rows with missing ReportDate (fixes under-count when one property has no date on that week's row).
    rows.forEach(row => {
      const property = (get(row, "Property") || "").toString().trim();
      if (!property) return;
      const rd = get(row, "ReportDate");
      if (!rd) return;
      const dateValue = new Date(rd);
      if (isNaN(+dateValue)) return;
      if (!propertyMap[property] || dateValue > propertyMap[property].maxDate) {
        propertyMap[property] = { maxDate: dateValue, row: row };
      }
    });
    rows.forEach(row => {
      const property = (get(row, "Property") || "").toString().trim();
      if (!property || propertyMap[property]) return;
      propertyMap[property] = { maxDate: new Date(0), row: row };
    });
    let out = Object.values(propertyMap).map(o => o.row);
    if (out.length === 0) {
      const byProp = {};
      rows.forEach(row => {
        const property = (get(row, "Property") || "").toString().trim();
        if (!property) return;
        if (!byProp[property]) byProp[property] = row;
      });
      out = Object.values(byProp);
    }
    return sortByBirth(out);
  }

  function buildRowsForDisplay() {
    const week = selectedWeek ? selectedWeek.toString().slice(0, 10) : null;
    const primary = filterMmrLikeEmailReport(MMR, week);
    if (primary.length > 0) return primary;
    return sortByBirth(byActive(week ? filterBySelectedWeek(MMR) : MMR));
  }

  /**
   * If Domo has no row for a DB-active property in the selected week, the email-style
   * filter drops it and Active Properties under-counts vs occupancy. Pull the latest
   * overlaid MMR row for that property (any week) and align WeekStart to the picker.
   */
  function dedupeRowsByEntityKeyPreferActive(rows) {
    const byEk = new Map();
    rows.forEach((r) => {
      const ek = propEntityKey(get(r, "Property"));
      if (!ek) return;
      const prev = byEk.get(ek);
      if (!prev) {
        byEk.set(ek, r);
        return;
      }
      const aPrev = isLeaseUpOrStabilizedStatus(get(prev, "Status"));
      const aCur = isLeaseUpOrStabilizedStatus(get(r, "Status"));
      if (aCur && !aPrev) {
        byEk.set(ek, r);
        return;
      }
      if (!aCur && aPrev) return;
      const wP = new Date(get(prev, "WeekStart") || 0);
      const wC = new Date(get(r, "WeekStart") || 0);
      if (wC >= wP) byEk.set(ek, r);
    });
    return Array.from(byEk.values());
  }

  function augmentMmrLatestWithDbActiveProperties(mmrLatest) {
    if (!propertyCanonicalActive || !propertyCanonicalActive.length) return mmrLatest;
    /** Only skip when we already have an *active* row for this property (DB-backed status). */
    const presentActive = new Set(byActive(mmrLatest).map((r) => propEntityKey(get(r, "Property"))));
    const merged = mmrLatest.slice();
    const weekStr = selectedWeek ? selectedWeek.toString().slice(0, 10) : null;

    function pickLatestWeekRow(rows) {
      let pick = weekStr
        ? rows.find((r) => (get(r, "WeekStart") || "").toString().slice(0, 10) === weekStr)
        : null;
      if (!pick) {
        pick = rows.slice().sort((a, b) => {
          const wa = new Date(get(a, "WeekStart") || 0);
          const wb = new Date(get(b, "WeekStart") || 0);
          return wb - wa;
        })[0];
      }
      return pick;
    }

    propertyCanonicalActive.forEach(({ Property: displayName, Status: dbStatus }) => {
      const ek = propEntityKey(displayName);
      if (!ek || presentActive.has(ek)) return;

      const candidates = MMR.filter((r) => propEntityKey(get(r, "Property")) === ek);
      const activeCands = byActive(candidates);

      if (activeCands.length) {
        const pick = pickLatestWeekRow(activeCands);
        if (!pick) return;
        const clone = { ...pick };
        if (weekStr && (get(clone, "WeekStart") || "").toString().slice(0, 10) !== weekStr) {
          const ws = get(clone, "WeekStart");
          if (ws != null && `${ws}`.length >= 10) {
            clone.WeekStart = weekStr + `${ws}`.slice(10);
          } else {
            clone.WeekStart = weekStr;
          }
        }
        merged.push(clone);
        presentActive.add(ek);
        return;
      }

      if (candidates.length) {
        const pick = pickLatestWeekRow(candidates);
        if (!pick) return;
        const clone = { ...pick };
        clone.Status = dbStatus;
        if (weekStr && (get(clone, "WeekStart") || "").toString().slice(0, 10) !== weekStr) {
          const ws = get(clone, "WeekStart");
          if (ws != null && `${ws}`.length >= 10) {
            clone.WeekStart = weekStr + `${ws}`.slice(10);
          } else {
            clone.WeekStart = weekStr;
          }
        }
        merged.push(clone);
        presentActive.add(ek);
        return;
      }

      const raw = propertyListRows.find((p) => propEntityKey(p.Property) === ek);
      if (!raw) return;
      merged.push({
        Property: (raw.Property || "").toString().trim(),
        Status: dbStatus,
        Units: raw.Units,
        Region: raw.Region,
        City: raw.City,
        State: raw.State,
        FullAddress: raw["Full Address"] ?? raw.FullAddress,
        BirthOrder: raw["Birth Order"] ?? raw.BirthOrder,
        Latitude: raw["Latitude "] ?? raw.Latitude,
        Longitude: raw.Longitude,
        WeekStart: weekStr || (MMR[0] ? (get(MMR[0], "WeekStart") || "").toString().slice(0, 10) : ""),
      });
      presentActive.add(ek);
    });

    return sortByBirth(dedupeRowsByEntityKeyPreferActive(merged));
  }

  function previousWeekOf(selected){
    if (!selected) return null;
    const idx = weekOptions.indexOf(selected);
    return idx>=0 && idx<weekOptions.length-1 ? weekOptions[idx+1] : null;
  }

  // Find closest date MMR in previous month (approximately 4 weeks ago, same day of week)
  function findPreviousMonthMMR(selectedWeek, property, allMMR) {
    if (!selectedWeek) return null;
    const currentDate = new Date(selectedWeek);
    // Go back approximately 4 weeks (28 days) to get same week in previous month
    const prevMonthDate = new Date(currentDate);
    prevMonthDate.setDate(prevMonthDate.getDate() - 28);
    const prevMonthStr = prevMonthDate.toISOString().slice(0, 10);
    
    // Find all MMR entries for this property
    const propMMR = allMMR.filter(r => get(r, "Property") === property);
    if (!propMMR.length) return null;
    
    // Find the closest date to prevMonthStr (within 2 weeks before or after)
    const candidates = propMMR
      .map(r => ({ r, date: (get(r, "WeekStart") || "").toString().slice(0, 10) }))
      .filter(x => x.date)
      .map(x => ({
        ...x,
        diff: Math.abs((new Date(x.date) - new Date(prevMonthStr)) / (1000 * 60 * 60 * 24))
      }))
      .filter(x => x.diff <= 14) // within 2 weeks
      .sort((a, b) => a.diff - b.diff);
    
    return candidates.length > 0 ? candidates[0].r : null;
  }

function render(){
  const latestDate = MMR.map(r=>parseDateLike(get(r,"LatestDate"))).filter(Boolean).sort((a,b)=>b-a)[0];
  let sub = latestDate ? `Data as of ${latestDate.toLocaleDateString()} · WeekStart ${selectedWeek || "—"}` : `WeekStart ${selectedWeek || "—"}`;
  if (!propertyListFetchOk) {
    sub += " · Property list API unreachable (active count may be low until network allows stoagroupDB)";
  }
  $("#last-updated").textContent = sub;

  const mmrLatest = augmentMmrLatestWithDbActiveProperties(buildRowsForDisplay());
  const prevWeek = previousWeekOf(selectedWeek);
  const mmrPrev  = prevWeek ? MMR.filter(r=>(get(r,"WeekStart")||"").toString().startsWith(prevWeek)) : [];

  const active = byActive(mmrLatest);

  // ---- KPIs ----
  $("#kpi-grid").innerHTML = "";

  const countProps = new Set(active.map((r) => propEntityKey(get(r, "Property")))).size;
  const totalUnits = sum(active,"Units");

  // Delinquent with trend vs previous week
  const delinquent = sum(active,"Delinquent");
  const delinquentPrev = sum(byActive(mmrPrev),"Delinquent");
  const deltaDelq = delinquent - delinquentPrev;
  const trendIcon = deltaDelq>0 ? `▲ ${fmtInt(deltaDelq)}` : (deltaDelq<0 ? `▼ ${fmtInt(Math.abs(deltaDelq))}` : '—');
  const trendClass = deltaDelq>0 ? "down" : (deltaDelq<0 ? "up" : "");

  // Reviews avg
  let avgRating = "—";
  if (REV.length){
    const vals=REV.map(r=>asNum(get(r,"rating"))).filter(n=>isFinite(n));
    if (vals.length) avgRating = (vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(2);
  }

  // >>> CHANGED: KPIs should use ONLY active rows and Units weighting,
  // and UC must be Under Construction + (Lease-up/Stabilized)
  const rowsC  = byConst(active, "Completed");
  const rowsUC = byConst(active, "Under Construction");

  const wAvgUnitsKPI = (rows, key) => {
    let num = 0, den = 0;
    rows.forEach(r => {
      const w = asNum(get(r, "Units")) || 0;
      const v = asNum(get(r, key));
      if (isFinite(v) && w > 0) { num += v * w; den += w; }
    });
    return den ? (num / den) : NaN;
  };

  const occC  = wAvgUnitsKPI(rowsC,  "OccupancyPercent");
  const occU  = wAvgUnitsKPI(rowsUC, "OccupancyPercent");
  const lsdC  = wAvgUnitsKPI(rowsC,  "CurrentLeasedPercent");
  const lsdU  = wAvgUnitsKPI(rowsUC, "CurrentLeasedPercent");
  // <<< CHANGED

  // Active Properties
  addKPI({
    title:"Active Properties",
    main: fmtInt(countProps),
    foot: "Lease-up or stabilized",
    onClick:()=> activePropertiesModal(mmrLatest)
  });

  // Total Units
  addKPI({
    title:"Total Active Units",
    main: fmtInt(totalUnits),
    onClick:()=> totalUnitsModal(mmrLatest)
  });

  // Delinquent
  addKPI({
    title:`Delinquent Units (Month)`,
    main: fmtInt(delinquent),
    trend:{text:trendIcon, cls:trendClass},
    onClick:()=> {
      const rows=sortByBirth(byActive(mmrLatest).slice()).map(r=>{
        const prev = byActive(mmrPrev).find(x=>get(x,"Property")===get(r,"Property"));
        const prevMonth = findPreviousMonthMMR(selectedWeek, get(r, "Property"), MMR);
        return {cur:r, prev, prevMonth};
      });
      
      const currentWeek = (selectedWeek || "").toString().slice(0, 10);
      const prevWeek = previousWeekOf(selectedWeek);
      const exportData = rows.map(rp => ({
        Property: get(rp.cur, "Property"),
        "This Week": currentWeek || "Current Week",
        "Prev Week": prevWeek || "Previous Week",
        "Delinquent (This Week)": asNum(get(rp.cur, "Delinquent")),
        "Delinquent (Prev Week)": asNum(get(rp.prev, "Delinquent")),
        "Delinquent (Prev Month)": asNum(get(rp.prevMonth, "Delinquent")),
        "Change": (asNum(get(rp.cur, "Delinquent")) || 0) - (asNum(get(rp.prev, "Delinquent")) || 0),
        "Change vs Prev Month": (asNum(get(rp.cur, "Delinquent")) || 0) - (asNum(get(rp.prevMonth, "Delinquent")) || 0)
      }));
      
      openModal("Delinquent Units — Current vs Previous Week", body=>{
        renderTable(body,[
          {label:"Property", value:rp=>get(rp.cur,"Property")},
          {label:"Delinquent (This Week)", value:rp=>fmtInt(asNum(get(rp.cur,"Delinquent"))), class:"num"},
          {label:"Prev Week", value:rp=>fmtInt(asNum(get(rp.prev,"Delinquent"))), class:"num"},
          {label:"Prev Month (Continuous)", value:rp=>fmtInt(asNum(get(rp.prevMonth,"Delinquent"))), class:"num", title:"Same week number from previous month"},
          {label:"Δ", value:rp=>fmtInt((asNum(get(rp.cur,"Delinquent"))||0)-(asNum(get(rp.prev,"Delinquent"))||0)), class:"num"},
        ], rows);
      }, exportData);
    }
  });

  // Occupancy split
  addSplitKPI({
    title:"Occupancy %",
    aLabel:"Completed", aVal:fmtPctSmart(occC || NaN),
    bLabel:"Under Constr.", bVal:fmtPctSmart(occU || NaN),
    onClick:(filt)=> occLeasedModal(mmrLatest, filt)   // CHANGED: pass clicked bucket
  });

  // Leased split
  addSplitKPI({
    title:"Leased %",
    aLabel:"Completed", aVal:fmtPctSmart(lsdC || NaN),
    bLabel:"Under Constr.", bVal:fmtPctSmart(lsdU || NaN),
    onClick:(filt)=> occLeasedModal(mmrLatest, filt)   // CHANGED: pass clicked bucket
  });

  // Reviews KPI — jumps to tab
  addKPI({
    title:"Google Reviews",
    main: `${avgRating}★`,
    foot:"Portfolio average",
    onClick:()=>{
      // Simulate clicking the tab directly - this will trigger the normal tab handler with the same transition
      const reviewsTabBtn = document.querySelector('[data-tab="reviews"]');
      if (reviewsTabBtn) {
        reviewsTabBtn.click();
      }
    }
  });

  // ---- Tabs content ----
  // Leasing
  const leasing = $("#tab-leasing"); leasing.innerHTML="";
  const grid1=document.createElement("div"); grid1.className="grid-2"; leasing.appendChild(grid1);
  const p1=createPanel(grid1, "Move-Ins vs Move-Outs (latest)", true);
  const p2=createPanel(grid1, "Net Leases by Property (latest)", true);

  function renderLeasingPanels(){
    moveInsVsMoveOuts(mmrLatest, p1.wrap._constSelect.value)(p1.body);
    netLeasesBar(mmrLatest, p2.wrap._constSelect.value)(p2.body);
  }
  p1.wrap._constSelect.addEventListener("change", renderLeasingPanels);
  p2.wrap._constSelect.addEventListener("change", renderLeasingPanels);
  renderLeasingPanels();

  // T-12 & Rent
  const t12rent=$("#tab-t12rent"); t12rent.innerHTML="";
  const grid2=document.createElement("div"); grid2.className="grid-2"; t12rent.appendChild(grid2);
  const p3=createPanel(grid2, "T-12 Renewed vs Expired (latest)", true);
  const p4=createPanel(grid2, "Occupied vs Budgeted (latest)", true);
  const kindSelect=document.createElement("select"); kindSelect.className="select";
  kindSelect.title = "Choose between total dollar amounts or per-square-foot pricing. Total $ shows absolute rent values, $/SF shows rent per square foot.";
  kindSelect.innerHTML=`<option value="total">Total $</option><option value="psf">$ / SF</option>`;
  p4.wrap.querySelector(".inline-controls").appendChild(kindSelect);

  function renderT12Rent(){
    t12Bars(mmrLatest, p3.wrap._constSelect.value)(p3.body);
    rentMetrics(mmrLatest, kindSelect.value, p4.wrap._constSelect.value)(p4.body);
  }
  p3.wrap._constSelect.addEventListener("change", renderT12Rent);
  p4.wrap._constSelect.addEventListener("change", renderT12Rent);
  kindSelect.addEventListener("change", renderT12Rent);
  renderT12Rent();

  // Income
  const income=$("#tab-income"); income.innerHTML="";
  const p5=createPanel(income, "Budgeted vs Actual Income (latest)", true);
  function renderIncome(){ incomeVsBudget(mmrLatest, p5.wrap._constSelect.value)(p5.body); }
  p5.wrap._constSelect.addEventListener("change", renderIncome); renderIncome();

  // Timelines (multi-stage drills)
  const timelines=$("#tab-timelines"); timelines.innerHTML="";
  const grid3=document.createElement("div"); grid3.className="grid-2"; timelines.appendChild(grid3);
  const tOcc=createPanel(grid3, "Occupancy % — Actual vs Budgeted", false);
  const tLea=createPanel(grid3, "Leased % — Actual vs Budgeted", false);
  timelineActualVsBudget(sortByBirth(byActive(MMR)), "OccupancyPercent", "BudgetedOccupancyPercentageCurrentMonth", "Occupancy %", { allowUnitsToggle: true })(tOcc.body);
  timelineActualVsBudget(sortByBirth(byActive(MMR)), "CurrentLeasedPercent", "BudgetedLeasedPercentageCurrentMonth", "Leased %", { allowUnitsToggle: true })(tLea.body);

  // Reviews
  const reviews=$("#tab-reviews"); reviews.innerHTML="";
  if (REV.length) reviewsAvgChart(REV)(reviews);
}


  // KPI helpers
  function addKPI({title, main, foot, onClick, trend}){
    const el=document.createElement("div");
    el.className="kpi";
    el.style.cursor = onClick ? "pointer" : "default";
    
    // Add tooltip based on title
    let tooltip = "";
    if (title.includes("Active Properties")) {
      tooltip = "Number of properties that are either lease-up or stabilized (not in pre-construction)";
    } else if (title.includes("Total Active Units")) {
      tooltip = "Total number of units across all active properties";
    } else if (title.includes("Delinquent")) {
      tooltip = "Number of units with overdue rent payments for the current month";
    } else if (title.includes("Google Reviews")) {
      tooltip = "Average Google review rating across all properties in the portfolio";
    }
    
    if (tooltip) {
      el.title = tooltip;
    }
    
    el.innerHTML = `
      <div class="kpi-title">
        <div>${title}</div>
        <div class="kpi-trend ${trend?.cls||''}">${trend?trend.text:''}</div>
      </div>
      <div class="kpi-value">${main}</div>
      ${foot?`<div class="kpi-foot subtle">${foot}</div>`:""}`;
    if (onClick) el.addEventListener("click", onClick);
    $("#kpi-grid").appendChild(el);
  }
  function addSplitKPI({ title, aLabel, aVal, bLabel, bVal, onClick }) {
    // Normalize labels for construction filter
    const norm = (s) => {
      const t = (s || "").toString().toLowerCase();
      if (t.startsWith("under")) return "Under Construction";
      if (t.startsWith("compl")) return "Completed";
      return s || "All";
    };

    const el = document.createElement("div");
    el.className = "kpi";
    el.style.cursor = "pointer";
    
    // Add tooltip based on title
    let tooltip = "";
    if (title.includes("Occupancy")) {
      tooltip = "Percentage of units that are currently occupied. Completed = finished properties, Under Constr. = properties still being built";
    } else if (title.includes("Leased")) {
      tooltip = "Percentage of units that are leased (signed lease agreements). Completed = finished properties, Under Constr. = properties still being built";
    }
    
    if (tooltip) {
      el.title = tooltip;
    }
    
    el.innerHTML = `
      <div class="kpi-title"><div>${title}</div><div class="tag">Drill</div></div>
      <div class="kpi-split">
        <div class="sub" data-filter="${aLabel}">
          <div class="label">${aLabel}</div><div class="val">${aVal}</div>
        </div>
        <div class="sub" data-filter="${bLabel}">
          <div class="label">${bLabel}</div><div class="val">${bVal}</div>
        </div>
      </div>`;

    // Click on a half -> set a global hint for filter, then invoke provided handler
    el.querySelectorAll(".sub").forEach(sub => {
      sub.addEventListener("click", (e) => {
        e.stopPropagation();
        const filt = norm(sub.getAttribute("data-filter") || "All");
        window.__splitKPIFilter = filt;              // fallback so legacy onClick() still works
        if (typeof onClick === "function") onClick(filt); // extra arg is harmless if ignored
      });
    });

    // Click outside halves -> clear filter (show All)
    el.addEventListener("click", () => {
      window.__splitKPIFilter = "All";
      if (typeof onClick === "function") onClick("All");
    });

    document.querySelector("#kpi-grid").appendChild(el);
  }



  // Detail modals
  function activePropertiesModal(rowsLatest){
    const rows=sortByBirth(byActive(rowsLatest));
    
    const currentWeek = (selectedWeek || "").toString().slice(0, 10);
    const exportData = rows.map(r => ({
      Property: get(r, "Property"),
      Week: currentWeek || "Current Week",
      Region: get(r, "Region"),
      State: get(r, "State"),
      Status: get(r, "Status"),
      Units: asNum(get(r, "Units")),
      Address: get(r, "FullAddress")
    }));
    
    openModal("Active Properties (latest)", body=>{
      renderTable(body,[
        {label:"Property", key:"Property"},
        {label:"Region", key:"Region"},
        {label:"State", key:"State"},
        {label:"Status", key:"Status"},
        {label:"Units", value:r=>fmtInt(asNum(get(r,"Units"))), class:"num"},
        {label:"Address", key:"FullAddress"},
      ], rows, ()=> openModal("Active Properties — Map", b=> renderMap(b, rows)));
    }, exportData);
  }
  function totalUnitsModal(rowsLatest){
    const rows=sortByBirth(byActive(rowsLatest));
    
    const currentWeek = (selectedWeek || "").toString().slice(0, 10);
    const exportData = rows.map(r => ({
      Property: get(r, "Property"),
      Week: currentWeek || "Current Week",
      City: get(r, "City"),
      State: get(r, "State"),
      Construction: get(r, constKey(r)),
      Units: asNum(get(r, "Units"))
    }));
    
    openModal("Total Active Units — Detail (latest)", body=>{
      renderTable(body,[
        {label:"Property", key:"Property"},
        {label:"City", key:"City"},
        {label:"State", key:"State"},
        {label:"Construction", value:r=>get(r,constKey(r))},
        {label:"Units", value:r=>fmtInt(asNum(get(r,"Units"))), class:"num"},
      ], rows);
    }, exportData);
  }

function mmrDeltaUnitsVsBudget(r) {
  const units = asNum(get(r, "Units")) || 0;
  let occ = asNum(get(r, "OccupancyPercent"));
  let bOcc = asNum(get(r, "BudgetedOccupancyPercentageCurrentMonth"));
  if (!isFinite(occ)) occ = 0;
  if (!isFinite(bOcc)) bOcc = 0;
  const occDec = occ > -1 && occ < 1 && occ !== 0 ? occ : (occ === 0 ? 0 : occ / 100);
  const bDec = bOcc > -1 && bOcc < 1 && bOcc !== 0 ? bOcc : (bOcc === 0 ? 0 : bOcc / 100);
  const actualU = Math.round(units * occDec);
  const budgetU = Math.round(units * bDec);
  let d = actualU - budgetU;
  if (actualU === 0 || occ === 0) d = 0;
  return d;
}

function occLeasedModal(rowsLatest, filterLabel = "__USE_GLOBAL__") {
  // Respect split-KPI clicks; default to global hint if no explicit arg
  const chosen = (filterLabel === "__USE_GLOBAL__" ? (window.__splitKPIFilter || "All") : filterLabel);

  // Helper: exclude any row marked Sold in any relevant status field
  const isSoldRow = (r) => {
    const s1 = (get(r, "Status") || "").toString().toLowerCase();
    const s2 = (get(r, "ConstructionStatus") || "").toString().toLowerCase();
    const s3 = (get(r, "LatestConstructionStatus") || "").toString().toLowerCase();
    return s1.includes("sold") || s2.includes("sold") || s3.includes("sold");
  };

  // --- ensure we ONLY use the currently-selected WeekStart ---
  const wkSel = (selectedWeek && selectedWeek.toString().slice(0, 10)) || "";
  let rowsWeek = rowsLatest.filter(r => {
    const wk = (get(r, "WeekStart") || "").toString().slice(0, 10);
    return wkSel ? wk === wkSel : true;
  });

  // NEW: drop Sold rows from the modal table entirely
  rowsWeek = rowsWeek.filter(r => !isSoldRow(r));

  // Apply construction-status filter (Completed / Under Construction / All)
  let rows = (chosen && chosen !== "All") ? byConst(rowsWeek, chosen) : rowsWeek;

  // If user chose "Under Construction", additionally gate to Lease-Up or Stabilized
  if ((chosen || "").toLowerCase().includes("under")) {
    rows = rows.filter((r) => isLeaseUpOrStabilizedStatus(get(r, "Status")));
  }

  rows = sortByBirth(rows);

  // ---- Projected Occupancy (+4w, +8w) from dataset Week3/Week7 fields ----
  const normalizePct = (v) => {
    const n = asNum(v);
    if (!isFinite(n)) return NaN;
    return n > 1.5 ? n / 100 : n; // store as 0..1
  };
  const projByProp = {};
  rows.forEach(r => {
    const prop = get(r, "Property");
    const p4 = normalizePct(get(r, "Week3OccPercentage"));
    const p8 = normalizePct(get(r, "Week7OccPercentage"));
    projByProp[prop] = { p4, p8 };
  });

  // Weighted averages — strictly by Total Units (to match the boxes)
  const wAvgUnits = (key) => {
    let num = 0, den = 0;
    rows.forEach(r => {
      const w = asNum(get(r, "Units")) || 0;
      const v = asNum(get(r, key));
      if (isFinite(v) && w > 0) { num += v * w; den += w; }
    });
    return den > 0 ? (num / den) : NaN;
  };

  const wOcc  = wAvgUnits("OccupancyPercent");
  const wBOcc = wAvgUnits("BudgetedOccupancyPercentageCurrentMonth");
  const wLea  = wAvgUnits("CurrentLeasedPercent");
  const wBLea = wAvgUnits("BudgetedLeasedPercentageCurrentMonth");
  const sumDeltaUnits = rows.reduce((s, r) => s + mmrDeltaUnitsVsBudget(r), 0);

  const totals = {
    "Construction Status": "Total",
    "Property": "",
    "Current Occupancy %": fmtPctSmart(wOcc),
    "Budgeted Occupancy %": fmtPctSmart(wBOcc),
    "Δ (Units)": fmtInt(sumDeltaUnits),
    "Current Leased %": fmtPctSmart(wLea),
    "Budgeted Leased %": fmtPctSmart(wBLea)
  };

  const currentWeek = (selectedWeek || "").toString().slice(0, 10);
  const exportData = rows.map(r => ({
    "Construction Status": get(r, constKey(r)),
    "Property": get(r, "Property"),
    "Week": currentWeek || "Current Week",
    "Current Occupancy %": asNum(get(r, "OccupancyPercent")),
    "Budgeted Occupancy %": asNum(get(r, "BudgetedOccupancyPercentageCurrentMonth")),
    "Δ (Units)": mmrDeltaUnitsVsBudget(r),
    "Current Leased %": asNum(get(r, "CurrentLeasedPercent")),
    "Budgeted Leased %": asNum(get(r, "BudgetedLeasedPercentageCurrentMonth")),
    "+4w Projected Occupancy %": projByProp[get(r, "Property")] ? projByProp[get(r, "Property")].p4 : NaN,
    "+8w Projected Occupancy %": projByProp[get(r, "Property")] ? projByProp[get(r, "Property")].p8 : NaN
  }));

  openModal(`Occupancy & Leased — ${chosen || "All"} (latest)`, body => {
    renderBreadcrumb(body, [`Occupancy & Leased (latest)`, chosen || "All"], () => {});
    const tableHost = document.createElement("div");
    body.appendChild(tableHost);

    renderTable(tableHost, [
      { label: "Construction Status", value: r => get(r, constKey(r)) },
      { label: "Property",            key: "Property" },
      { label: "Current Occupancy %", value: r => fmtPctSmart(asNum(get(r, "OccupancyPercent"))),                        class: "num" },
      { label: "Budgeted Occupancy %",value: r => fmtPctSmart(asNum(get(r, "BudgetedOccupancyPercentageCurrentMonth"))), class: "num" },
      { label: "Δ (Units)", value: r => fmtInt(mmrDeltaUnitsVsBudget(r)), class: "num" },
      { label: "+4w Projected Occupancy %", value: r => fmtPctSmart(projByProp[get(r, "Property")] ? projByProp[get(r, "Property")].p4 : NaN), class: "num" },
      { label: "+8w Projected Occupancy %", value: r => fmtPctSmart(projByProp[get(r, "Property")] ? projByProp[get(r, "Property")].p8 : NaN), class: "num" },
      { label: "Current Leased %",    value: r => fmtPctSmart(asNum(get(r, "CurrentLeasedPercent"))),                    class: "num" },
      { label: "Budgeted Leased %",   value: r => fmtPctSmart(asNum(get(r, "BudgetedLeasedPercentageCurrentMonth"))),    class: "num" }
    ], rows, undefined, totals);

    // Make the Total row visually distinct (local-only styling)
    const table = body.querySelector(".table");
    const tfRow = table?.querySelector("tfoot tr");
    if (tfRow) {
      tfRow.style.background = "#f7f9f6";
      tfRow.style.borderTop = "2px solid #cfd6c6";
      tfRow.querySelectorAll("td").forEach(td => {
        td.style.fontWeight = "800";
        td.style.paddingTop = "12px";
        td.style.paddingBottom = "12px";
      });
    }
  }, exportData);
}




  init().catch(err=>{
    console.error(err);
    const msg = err?.message || 'Failed to load data.';
    document.querySelector(".page").insertAdjacentHTML("beforeend",
      '<div class="section" style="margin:1rem;padding:1rem;background:#f8d7da;border:1px solid #f5c6cb;border-radius:4px;"><strong>Error</strong><p style="margin:0.5rem 0 0;">' + String(msg).replace(/</g,'&lt;') + '</p></div>');
  });
})();
