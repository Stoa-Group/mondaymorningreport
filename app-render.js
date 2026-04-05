/* app-render.js — chart/render functions: modal helpers, map, moveInsVsMoveOuts, netLeasesBar, t12Bars */

// ---------- Modal ----------
var _modal, _modalTitle, _modalBody;

function _initModal() {
  _modal      = document.getElementById("modal");
  _modalTitle = document.getElementById("modal-title");
  _modalBody  = document.getElementById("modal-body");
  document.getElementById("modal-close").addEventListener("click", closeModal);
  _modal.addEventListener("click", function(e) { if (e.target === _modal) closeModal(); });
}

function openModal(title, renderFn, exportData) {
  if (!_modal) _initModal();
  _modalTitle.textContent = title;
  _modalBody.innerHTML = "";

  if (exportData) {
    var modalHead = _modal.querySelector(".modal-head");
    // Remove any old export button
    var oldBtn = modalHead.querySelector("button:not(#modal-close)");
    if (oldBtn) oldBtn.remove();
    var exportBtn = document.createElement("button");
    exportBtn.className = "btn";
    exportBtn.textContent = "Export CSV";
    exportBtn.style.marginRight = "10px";
    exportBtn.onclick = function() {
      var filename = title.replace(/[^a-zA-Z0-9\s]/g, "").replace(/\s+/g, "_") + ".csv";
      exportToCSV(exportData, filename);
    };
    modalHead.insertBefore(exportBtn, _modal.querySelector("#modal-close"));
  }

  renderFn(_modalBody);
  _modal.setAttribute("aria-hidden", "false");
}

function closeModal() {
  if (!_modal) return;
  var exportBtn = _modal.querySelector(".modal-head button:not(#modal-close)");
  if (exportBtn) exportBtn.remove();
  _modal.setAttribute("aria-hidden", "true");
}

// ---------- Map ----------
function renderMap(host, rows) {
  var div = document.createElement("div");
  div.id = "map";
  div.style.height = "520px";
  host.appendChild(div);
  var map = L.map(div).setView([30.4, -90.9], 6);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(map);
  rows.forEach(function(r) {
    var lat = asNum(get(r, "Latitude")), lon = asNum(get(r, "Longitude"));
    if (!isFinite(lat) || !isFinite(lon)) return;
    var units = asNum(get(r, "Units"));
    L.circleMarker([lat, lon], {
      radius: Math.max(6, Math.min(18, Math.sqrt(units || 0) / 2)),
      weight: 1, color: "#7e8a6b", fillColor: "#7e8a6b", fillOpacity: 0.75
    }).addTo(map).bindPopup("<b>" + get(r, "Property") + "</b><br/>" + (get(r, "FullAddress") || "") + "<br/>Units: " + fmtInt(units));
  });
}

// ---------- Weekly series helper (shared by charts) ----------
function propertyWeeklySeries(rowsAll, prop) {
  var numOrNull = function(v) { var n = asNum(v); return Number.isFinite(n) ? n : null; };
  var rows = sortByBirth(rowsAll.filter(function(r) { return get(r, "Property") === prop; }));
  var byWeek = {};
  rows.forEach(function(r) {
    var wk = (get(r, "WeekStart") || "").toString().slice(0, 10);
    if (!wk) return;
    if (!byWeek[wk]) byWeek[wk] = { MI: 0, MO: 0, NetLsd: 0, Occ: null, Lea: null, BOcc: null, BLea: null, Proj: null };
    byWeek[wk].MI     = asNum(get(r, "MI")) || 0;
    byWeek[wk].MO     = asNum(get(r, "MO")) || 0;
    byWeek[wk].NetLsd = asNum(get(r, "NetLsd")) || 0;
    byWeek[wk].Occ    = numOrNull(get(r, "OccupancyPercent"));
    byWeek[wk].Lea    = numOrNull(get(r, "CurrentLeasedPercent"));
    byWeek[wk].BOcc   = numOrNull(get(r, "BudgetedOccupancyPercentageCurrentMonth"));
    byWeek[wk].BLea   = numOrNull(get(r, "BudgetedLeasedPercentageCurrentMonth"));
  });
  var weeks = Object.keys(byWeek).sort();
  return {
    labels: weeks,
    mi:    weeks.map(function(w) { return byWeek[w].MI; }),
    mo:    weeks.map(function(w) { return byWeek[w].MO; }),
    net:   weeks.map(function(w) { return byWeek[w].NetLsd; }),
    occ:   weeks.map(function(w) { return byWeek[w].Occ; }),
    lea:   weeks.map(function(w) { return byWeek[w].Lea; }),
    bocc:  weeks.map(function(w) { return byWeek[w].BOcc; }),
    blea:  weeks.map(function(w) { return byWeek[w].BLea; }),
    proj:  weeks.map(function(w) { return byWeek[w].Proj; })
  };
}

// ---------- Net callout Chart.js plugin (shared) ----------
var netCalloutPlugin = {
  id: "netCallout",
  afterDatasetsDraw: function(chart) {
    var opts = (chart.options && chart.options.plugins && chart.options.plugins.netCallout) || {};
    if (!opts.show) { chart.$_netCalloutBounds = null; return; }
    var ctx = chart.ctx, chartArea = chart.chartArea;
    var padX = 10, boxH = 26, r = 8, txt = opts.text || "";
    ctx.save();
    ctx.font = Chart.helpers.toFont(Chart.defaults.font).string;
    var boxW = ctx.measureText(txt).width + padX * 2;
    var x = chartArea.right - boxW - 6, y = chartArea.top + 6;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + boxW, y, x + boxW, y + boxH, r);
    ctx.arcTo(x + boxW, y + boxH, x, y + boxH, r);
    ctx.arcTo(x, y + boxH, x, y, r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
    ctx.fillStyle = "#f5f7f2"; ctx.strokeStyle = "#a6ad8a"; ctx.lineWidth = 1;
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#2f5d41"; ctx.textBaseline = "middle";
    ctx.fillText(txt, x + padX, y + boxH / 2);
    ctx.restore();
    chart.$_netCalloutBounds = { x: x, y: y, w: boxW, h: boxH };
  }
};

// ---------- moveInsVsMoveOuts ----------
function moveInsVsMoveOuts(rowsLatest, filter) {
  filter = filter || "All";
  var rows = sortByBirth(byActive(rowsLatest));
  if (filter !== "All") rows = byConst(rows, filter);
  var labels = rows.map(function(r) { return get(r, "Property"); });
  var mi = rows.map(function(r) { return asNum(get(r, "MI")) || 0; });
  var mo = rows.map(function(r) { return asNum(get(r, "MO")) || 0; });

  var allWeeks = distinct(MMR.map(function(r) { return (get(r, "WeekStart") || "").toString().slice(0, 10); })).filter(Boolean).sort();

  function activeRowsForWeek(week) {
    var arr = byActive(MMR).filter(function(r) { return (get(r, "WeekStart") || "").toString().startsWith(week); });
    if (filter !== "All") arr = byConst(arr, filter);
    return arr;
  }
  function activeUnitsForWeek(week) {
    return activeRowsForWeek(week).reduce(function(a, r) {
      var u = asNum(get(r, "InServiceUnits")) || asNum(get(r, "Units")) || 0;
      return a + (isFinite(u) ? u : 0);
    }, 0);
  }

  var sumArr = function(arr) { return arr.reduce(function(a, b) { return a + (+b || 0); }, 0); };
  var netValue = sumArr(mi) - sumArr(mo);
  var netText = "Net Move-Ins: " + (netValue >= 0 ? "+" : "") + fmtInt(netValue);

  function portfolioWeeklyNetSeries(weeksRange) {
    var all = sortByBirth(byActive(MMR));
    if (filter !== "All") all = byConst(all, filter);
    var byWeek = {};
    all.forEach(function(r) {
      var wk = (get(r, "WeekStart") || "").toString().slice(0, 10);
      if (!wk) return;
      var MI = asNum(get(r, "MI")) || 0;
      var MO = asNum(get(r, "MO")) || 0;
      var units = asNum(get(r, "InServiceUnits")) || asNum(get(r, "Units")) || 0;
      if (!byWeek[wk]) byWeek[wk] = { mi: 0, mo: 0, units: 0 };
      byWeek[wk].mi += MI; byWeek[wk].mo += MO; byWeek[wk].units += units;
    });
    var weeks = Object.keys(byWeek).sort();
    if (weeksRange && weeksRange.from && weeksRange.to)
      weeks = weeks.filter(function(w) { return w >= weeksRange.from && w <= weeksRange.to; });
    return {
      weeks: weeks,
      mi:    weeks.map(function(w) { return byWeek[w].mi; }),
      mo:    weeks.map(function(w) { return byWeek[w].mo; }),
      net:   weeks.map(function(w) { return byWeek[w].mi - byWeek[w].mo; }),
      units: weeks.map(function(w) { return byWeek[w].units; }),
      table: weeks.map(function(w) { return { WeekStart: w, MI: byWeek[w].mi, MO: byWeek[w].mo, Net: byWeek[w].mi - byWeek[w].mo, Units: byWeek[w].units }; })
    };
  }

  var drillLevel = 0, drilledProp = null, portfolioSeries = null, chart = null;

  return function(panelBody) {
    var titleEl = panelBody.parentElement.querySelector(".panel-title");
    var baseTitle = titleEl.textContent;
    var tools = panelBody.parentElement.querySelector(".inline-controls");

    tools && tools.querySelectorAll("[data-role='mi-view'],[data-role='mi-from'],[data-role='mi-to'],[data-role='mi-back'],[data-role='mi-presets']").forEach(function(n) { n.remove(); });

    var backBtn = document.createElement("button");
    backBtn.className = "btn"; backBtn.setAttribute("data-role", "mi-back");
    backBtn.textContent = "\u2190 Back"; backBtn.style.fontWeight = "800"; backBtn.style.display = "none";
    tools && tools.insertBefore(backBtn, tools.firstChild || null);

    var viewSel = document.createElement("select");
    viewSel.className = "select"; viewSel.setAttribute("data-role", "mi-view");
    viewSel.innerHTML = "<option value='chart'>Chart</option><option value='table'>Table</option>";
    tools && tools.appendChild(viewSel);

    var fromSel = document.createElement("select");
    fromSel.className = "select"; fromSel.setAttribute("data-role", "mi-from");
    fromSel.title = "From week"; fromSel.style.display = "none";
    var toSel = document.createElement("select");
    toSel.className = "select"; toSel.setAttribute("data-role", "mi-to");
    toSel.title = "To week"; toSel.style.display = "none";
    var opts = allWeeks.map(function(w) { return "<option value='" + w + "'>" + formatDateForDisplay(w) + "</option>"; }).join("");
    fromSel.innerHTML = opts; toSel.innerHTML = opts;
    fromSel.value = allWeeks[Math.max(0, allWeeks.length - 8)];
    toSel.value = allWeeks[allWeeks.length - 1];
    tools && tools.appendChild(fromSel); tools && tools.appendChild(toSel);

    var presetWrap = document.createElement("div");
    presetWrap.setAttribute("data-role", "mi-presets");
    presetWrap.style.display = "flex"; presetWrap.style.gap = "6px"; presetWrap.style.alignItems = "center";
    function setPresetRange(months) {
      if (!allWeeks.length) return;
      var endDate = new Date(allWeeks[allWeeks.length - 1]);
      var startDate = new Date(endDate);
      startDate.setMonth(startDate.getMonth() - months);
      var startStr = startDate.toISOString().slice(0, 10);
      fromSel.value = allWeeks.find(function(w) { return w >= startStr; }) || allWeeks[0];
      toSel.value = allWeeks[allWeeks.length - 1];
      fromSel.dispatchEvent(new Event("change"));
      toSel.dispatchEvent(new Event("change"));
    }
    ["1m","3m","6m","12m"].forEach(function(label) {
      var btn = document.createElement("button"); btn.className = "btn"; btn.textContent = label;
      btn.style.fontSize = "11px"; btn.style.padding = "6px 10px";
      btn.onclick = function() { setPresetRange({ "1m":1,"3m":3,"6m":6,"12m":12 }[label]); };
      presetWrap.appendChild(btn);
    });
    tools && tools.appendChild(presetWrap);

    function setRangeVisible(v) {
      fromSel.style.display = v ? "" : "none";
      toSel.style.display = v ? "" : "none";
      presetWrap.style.display = v ? "flex" : "none";
    }
    function currentRange() {
      var a = fromSel.value, b = toSel.value;
      if (!a || !b) return null;
      return { from: a <= b ? a : b, to: b >= a ? b : a };
    }
    function clearPanel() { panelBody.innerHTML = ""; chart = null; }
    function styleCrumbs() {
      var bc = panelBody.parentElement.querySelector(".breadcrumb");
      if (bc) { bc.style.fontSize = "13px"; bc.style.fontWeight = "800"; bc.style.padding = "2px 0 6px"; }
    }
    function updateBackBtn() {
      backBtn.style.display = (viewSel.value === "chart" && drillLevel > 0) ? "" : "none";
    }
    function backToBase() {
      drilledProp = null; drillLevel = 0;
      titleEl.textContent = baseTitle; setRangeVisible(false); renderChart();
    }
    backBtn.onclick = backToBase;

    function renderTableView() {
      clearPanel(); setRangeVisible(false);
      renderBreadcrumb(panelBody, [baseTitle, "Table"], function() {});
      styleCrumbs(); updateBackBtn();
      var scroller = document.createElement("div");
      scroller.style.height = "100%"; scroller.style.overflow = "auto"; scroller.style.paddingRight = "2px";
      panelBody.appendChild(scroller);
      var week = (selectedWeek || "").toString().slice(0, 10);
      var activeWeekRows = sortByBirth(byActive(rowsLatest));
      var rowsTbl = activeWeekRows.map(function(r) {
        var MIv = asNum(get(r, "MI")) || 0, MOv = asNum(get(r, "MO")) || 0;
        return { Property: get(r, "Property"), MI: MIv, MO: MOv, Net: MIv - MOv, UnitsProp: asNum(get(r, "InServiceUnits")) || asNum(get(r, "Units")) || 0 };
      });
      var portfolioUnits = activeUnitsForWeek(week);
      var totals = {
        "Move-Ins": fmtInt(rowsTbl.reduce(function(a,x){return a+x.MI;},0)),
        "Move-Outs": fmtInt(rowsTbl.reduce(function(a,x){return a+x.MO;},0)),
        "Net": fmtInt(rowsTbl.reduce(function(a,x){return a+x.Net;},0)),
        "% Gain/Loss": fmtPctSmart(portfolioUnits > 0 ? rowsTbl.reduce(function(a,x){return a+x.Net;},0) / portfolioUnits : NaN)
      };
      var exportBtn = document.createElement("button");
      exportBtn.className = "btn"; exportBtn.textContent = "Export CSV"; exportBtn.style.marginBottom = "10px";
      exportBtn.onclick = function() {
        exportToCSV(rowsTbl.map(function(r) { return { Property: r.Property, Week: week, "Move-Ins": r.MI, "Move-Outs": r.MO, Net: r.Net, "% Gain/Loss": r.UnitsProp > 0 ? r.Net / r.UnitsProp : NaN }; }), "Move-Ins_vs_Move-Outs_Table_" + week + ".csv");
      };
      scroller.insertBefore(exportBtn, scroller.firstChild);
      renderTable(scroller, [
        { label: "Property", key: "Property" },
        { label: "Move-Ins",  value: function(r) { return fmtInt(r.MI); }, class: "num" },
        { label: "Move-Outs", value: function(r) { return fmtInt(r.MO); }, class: "num" },
        { label: "Net",        value: function(r) { return fmtInt(r.Net); }, class: "num" },
        { label: "% Gain/Loss", value: function(r) { return fmtPctSmart(r.UnitsProp > 0 ? r.Net / r.UnitsProp : NaN); }, class: "num" }
      ], rowsTbl, function(r) {
        var prop = r.Property;
        var hist = sortByBirth(MMR.filter(function(x) { return get(x, "Property") === prop; }))
          .sort(function(a, b) { return (get(b, "WeekStart") || "").localeCompare(get(a, "WeekStart") || ""); });
        var rowsM = hist.map(function(x) {
          var wk = (get(x, "WeekStart") || "").toString().slice(0, 10);
          var MIv = asNum(get(x, "MI")) || 0, MOv = asNum(get(x, "MO")) || 0;
          var den = asNum(get(x, "InServiceUnits")) || asNum(get(x, "Units")) || 0;
          return { Property: prop, WeekStart: wk, MI: MIv, MO: MOv, Net: MIv - MOv, Den: den };
        });
        openModal("Move-Ins vs Move-Outs \u2014 " + prop + " \u2014 Weekly", function(b) {
          var tMI = rowsM.reduce(function(a,x){return a+x.MI;},0);
          var tMO = rowsM.reduce(function(a,x){return a+x.MO;},0);
          var tNet = rowsM.reduce(function(a,x){return a+x.Net;},0);
          var unitsRef = NaN;
          for (var xi=0;xi<rowsM.length;xi++){if(isFinite(rowsM[xi].Den)&&rowsM[xi].Den>0){unitsRef=rowsM[xi].Den;break;}}
          renderTable(b, [
            { label: "WeekStart", value: function(x) { return x.WeekStart; } },
            { label: "Move-Ins",  value: function(x) { return fmtInt(x.MI); }, class: "num" },
            { label: "Move-Outs", value: function(x) { return fmtInt(x.MO); }, class: "num" },
            { label: "Net",        value: function(x) { return fmtInt(x.Net); }, class: "num" },
            { label: "% Gain/Loss", value: function(x) { return fmtPctSmart(x.Den > 0 ? x.Net / x.Den : NaN); }, class: "num" }
          ], rowsM, undefined, { "Move-Ins": fmtInt(tMI), "Move-Outs": fmtInt(tMO), "Net": fmtInt(tNet), "% Gain/Loss": fmtPctSmart(isFinite(unitsRef) && unitsRef > 0 ? tNet / unitsRef : NaN) });
        }, rowsM);
      }, totals);
    }

    function renderChart() {
      clearPanel(); setRangeVisible(false);
      renderBreadcrumb(panelBody, [baseTitle], function() {}); styleCrumbs(); updateBackBtn();
      var ctx = createCanvas(panelBody);
      var safe = mi.concat(mo).map(function(v) { return +v || 0; });
      var maxX = Math.max(10, safe.length ? Math.max.apply(null, safe) : 0);
      chart = new Chart(ctx, {
        type: "bar",
        data: { labels: labels, datasets: [
          { label: "Move-Ins",  data: mi, backgroundColor: "#a6ad8a", categoryPercentage: 0.55, barPercentage: 0.7 },
          { label: "Move-Outs", data: mo, backgroundColor: "#bdc2ce", categoryPercentage: 0.55, barPercentage: 0.7 }
        ]},
        options: {
          indexAxis: "y",
          plugins: {
            legend: { position: "bottom" },
            netCallout: { show: true, text: netText },
            tooltip: { callbacks: {
              title: function(items) { return "Property: " + (items[0] && items[0].label || ""); },
              label: function(c) {
                var lbl = c.dataset.label || "";
                var desc = lbl.includes("Move-Ins") ? "Leases started this week" : "Leases ended this week";
                return lbl + ": " + fmtInt(c.parsed.x) + " \u2014 " + desc;
              }
            }}
          },
          layout: { padding: { left: 8, right: 16, top: 8, bottom: 8 } },
          scales: { x: { beginAtZero: true, min: 0, max: maxX } },
          onClick: function(evt, els) {
            var b = chart.$_netCalloutBounds;
            if (b) {
              var pos = Chart.helpers.getRelativePosition(evt, chart);
              if (pos.x >= b.x && pos.x <= b.x + b.w && pos.y >= b.y && pos.y <= b.y + b.h) {
                drillLevel = 2; drilledProp = null;
                titleEl.textContent = baseTitle + " \u2014 Portfolio Net";
                setRangeVisible(true);
                var rng = currentRange();
                portfolioSeries = portfolioWeeklyNetSeries(rng);
                var allTimeSeries = portfolioWeeklyNetSeries(null);
                var maNet30 = calculateMovingAverage(allTimeSeries.net, allTimeSeries.weeks, portfolioSeries.weeks, 4);
                var maNet90 = calculateMovingAverage(allTimeSeries.net, allTimeSeries.weeks, portfolioSeries.weeks, 13);
                if (chart) chart.destroy();
                var ctx2 = createCanvas(panelBody);
                chart = new Chart(ctx2, {
                  type: "line",
                  data: { labels: portfolioSeries.weeks.map(formatDateForDisplay), datasets: [
                    { label: "Net Move-Ins", data: portfolioSeries.net, borderColor: "#2f5d41", backgroundColor: "#2f5d41", tension: 0.25, pointRadius: 3 },
                    { label: "30-Day Moving Average (All-Time)", data: maNet30, borderColor: "#7e8a6b", backgroundColor: "#7e8a6b", borderDash: [3,3], tension: 0, pointRadius: 1, pointHoverRadius: 3, borderWidth: 1 },
                    { label: "90-Day Moving Average (All-Time)", data: maNet90, borderColor: "#a6ad8a", backgroundColor: "#a6ad8a", borderDash: [4,4], tension: 0, pointRadius: 1.5, pointHoverRadius: 3.5, borderWidth: 1.2 }
                  ]},
                  options: {
                    scales: { y: { beginAtZero: true } },
                    plugins: { tooltip: { callbacks: {
                      title: function(ctx) { return "Week: " + (ctx[0] && ctx[0].label || ""); },
                      label: function(c) { return c.dataset.label + ": " + fmtInt(c.parsed.y); }
                    }}},
                    onClick: function() {
                      var pf = portfolioWeeklyNetSeries(currentRange());
                      var tots = { "Move-Ins": fmtInt(pf.mi.reduce(function(a,v){return a+v;},0)), "Move-Outs": fmtInt(pf.mo.reduce(function(a,v){return a+v;},0)), "Net": fmtInt(pf.net.reduce(function(a,v){return a+v;},0)) };
                      openModal("Portfolio Net Move-Ins \u2014 Weekly", function(b) {
                        renderTable(b, [
                          { label:"WeekStart", value:function(r){return r.WeekStart;} },
                          { label:"Move-Ins",  value:function(r){return fmtInt(r.MI);}, class:"num" },
                          { label:"Move-Outs", value:function(r){return fmtInt(r.MO);}, class:"num" },
                          { label:"Net",       value:function(r){return fmtInt(r.Net);}, class:"num" }
                        ], pf.table, undefined, tots);
                      }, pf.table);
                    }
                  }
                });
                fromSel.onchange = toSel.onchange = function() {
                  if (drillLevel !== 2) return;
                  var rng2 = currentRange();
                  portfolioSeries = portfolioWeeklyNetSeries(rng2);
                  var ats = portfolioWeeklyNetSeries(null);
                  chart.data.labels = portfolioSeries.weeks.map(formatDateForDisplay);
                  chart.data.datasets[0].data = portfolioSeries.net;
                  if (chart.data.datasets.length > 1) chart.data.datasets[1].data = calculateMovingAverage(ats.net, ats.weeks, portfolioSeries.weeks, 4);
                  if (chart.data.datasets.length > 2) chart.data.datasets[2].data = calculateMovingAverage(ats.net, ats.weeks, portfolioSeries.weeks, 13);
                  chart.update();
                };
                renderBreadcrumb(panelBody, [baseTitle, "Portfolio Net"], function(level) { if (level === 0) backToBase(); });
                styleCrumbs(); updateBackBtn();
                return;
              }
            }

            if (!els.length) return;
            var i = els[0].index;
            var prop = labels[i];
            drilledProp = prop; drillLevel = 1;
            titleEl.textContent = baseTitle + " \u2014 " + prop;
            setRangeVisible(true);
            var series = propertyWeeklySeries(MMR, prop);
            function slicePropSeries(sr) {
              var rng2 = currentRange();
              var indices = sr.labels.map(function(w, idx) { return { w: w, idx: idx }; })
                .filter(function(x) { return !rng2 || (x.w >= rng2.from && x.w <= rng2.to); })
                .map(function(x) { return x.idx; });
              return { labels: indices.map(function(i2){return sr.labels[i2];}), mi: indices.map(function(i2){return sr.mi[i2];}), mo: indices.map(function(i2){return sr.mo[i2];}), allI: indices };
            }
            var s = slicePropSeries({ labels: series.labels, mi: series.mi, mo: series.mo });
            var maMI30 = calculateMovingAverage(series.mi, series.labels, s.labels, 4);
            var maMO30 = calculateMovingAverage(series.mo, series.labels, s.labels, 4);
            var maMI90 = calculateMovingAverage(series.mi, series.labels, s.labels, 13);
            var maMO90 = calculateMovingAverage(series.mo, series.labels, s.labels, 13);
            if (chart) chart.destroy();
            var ctxP = createCanvas(panelBody);
            chart = new Chart(ctxP, {
              type: "line",
              data: {
                labels: s.labels.map(function(l) { return l.match && l.match(/^\d{4}-\d{2}-\d{2}$/) ? formatDateForDisplay(l) : l; }),
                datasets: [
                  { label:"Move-Ins",  data:s.mi, borderColor:"#2f5d41", backgroundColor:"#2f5d41", tension:.25, pointRadius:3 },
                  { label:"Move-Outs", data:s.mo, borderColor:"#9aa796", backgroundColor:"#9aa796", tension:.25, pointRadius:3 },
                  { label:"30-Day MA Move-Ins",  data:maMI30, borderColor:"#7e8a6b", backgroundColor:"#7e8a6b", borderDash:[3,3], tension:0, pointRadius:1, borderWidth:1 },
                  { label:"30-Day MA Move-Outs", data:maMO30, borderColor:"#a6ad8a", backgroundColor:"#a6ad8a", borderDash:[3,3], tension:0, pointRadius:1, borderWidth:1 },
                  { label:"90-Day MA Move-Ins",  data:maMI90, borderColor:"#5a6b4a", backgroundColor:"#5a6b4a", borderDash:[4,4], tension:0, pointRadius:1.5, borderWidth:1.2 },
                  { label:"90-Day MA Move-Outs", data:maMO90, borderColor:"#8a9578", backgroundColor:"#8a9578", borderDash:[4,4], tension:0, pointRadius:1.5, borderWidth:1.2 }
                ]
              },
              options: {
                scales: { y: { beginAtZero: true } },
                plugins: { tooltip: { callbacks: {
                  title: function(ctx) { return "Week: " + (ctx[0] && ctx[0].label || ""); },
                  label: function(c) { return c.dataset.label + ": " + fmtInt(c.parsed.y); }
                }}},
                onClick: function() {
                  var rng2 = currentRange();
                  var hist = sortByBirth(MMR.filter(function(r2) { return get(r2,"Property") === drilledProp; }))
                    .filter(function(r2) { if (!rng2) return true; var wk=(get(r2,"WeekStart")||"").toString().slice(0,10); return wk>=rng2.from&&wk<=rng2.to; })
                    .sort(function(a2,b2){return (get(b2,"WeekStart")||"").localeCompare(get(a2,"WeekStart")||"");});
                  var rowsM = hist.map(function(r2){
                    var wk=(get(r2,"WeekStart")||"").toString().slice(0,10);
                    var MIv=asNum(get(r2,"MI"))||0,MOv=asNum(get(r2,"MO"))||0,den=asNum(get(r2,"InServiceUnits"))||asNum(get(r2,"Units"))||0;
                    return {Property:drilledProp,WeekStart:wk,MI:MIv,MO:MOv,Net:MIv-MOv,Den:den};
                  });
                  openModal("Move-Ins vs Move-Outs \u2014 " + drilledProp, function(b) {
                    var tMI=rowsM.reduce(function(a,x){return a+x.MI;},0);
                    var tMO=rowsM.reduce(function(a,x){return a+x.MO;},0);
                    var tNet=rowsM.reduce(function(a,x){return a+x.Net;},0);
                    var unitsRef=NaN;for(var xi=0;xi<rowsM.length;xi++){if(isFinite(rowsM[xi].Den)&&rowsM[xi].Den>0){unitsRef=rowsM[xi].Den;break;}}
                    renderTable(b,[
                      {label:"WeekStart",value:function(x){return x.WeekStart;}},
                      {label:"Move-Ins",value:function(x){return fmtInt(x.MI);},class:"num"},
                      {label:"Move-Outs",value:function(x){return fmtInt(x.MO);},class:"num"},
                      {label:"Net",value:function(x){return fmtInt(x.Net);},class:"num"},
                      {label:"% Gain/Loss",value:function(x){return fmtPctSmart(x.Den>0?x.Net/x.Den:NaN);},class:"num"}
                    ],rowsM,undefined,{"Move-Ins":fmtInt(tMI),"Move-Outs":fmtInt(tMO),"Net":fmtInt(tNet),"% Gain/Loss":fmtPctSmart(isFinite(unitsRef)&&unitsRef>0?tNet/unitsRef:NaN)});
                  }, rowsM);
                }
              }
            });
            renderBreadcrumb(panelBody, [baseTitle, prop], function(level) { if (level === 0) backToBase(); });
            styleCrumbs(); updateBackBtn();
            fromSel.onchange = toSel.onchange = function() {
              var full = propertyWeeklySeries(MMR, prop);
              var sliced = slicePropSeries({ labels: full.labels, mi: full.mi, mo: full.mo });
              chart.data.labels = sliced.labels;
              chart.data.datasets[0].data = sliced.mi;
              chart.data.datasets[1].data = sliced.mo;
              chart.data.datasets[2].data = calculateMovingAverage(full.mi, full.labels, sliced.labels, 11);
              chart.data.datasets[3].data = calculateMovingAverage(full.mo, full.labels, sliced.labels, 11);
              chart.update();
            };
          }
        },
        plugins: [netCalloutPlugin]
      });
    }

    function renderView() {
      if (viewSel.value === "table") renderTableView(); else renderChart();
    }
    viewSel.onchange = function() { drillLevel = 0; drilledProp = null; titleEl.textContent = baseTitle; renderView(); };
    renderView();
  };
}

// ---------- netLeasesBar ----------
function netLeasesBar(rowsLatest, filter) {
  filter = filter || "All";
  var getVisits   = function(r) { return (asNum(get(r,"ReturnVisitCount"))||0) + (asNum(get(r,"1stVisit"))||0); };
  var getCanceled = function(r) {
    var keys=["Canceled","Cancelled","Cancel","Cancellations"], t=0;
    keys.forEach(function(k){var v=asNum(get(r,k));if(isFinite(v))t+=v;});
    return t;
  };
  var rows = sortByBirth(byActive(rowsLatest));
  if (filter !== "All") rows = byConst(rows, filter);
  var labels = rows.map(function(r){return get(r,"Property");});
  var data   = rows.map(function(r){return asNum(get(r,"NetLsd"))||0;});
  var sumArr = function(arr){return arr.reduce(function(a,b){return a+(+b||0);},0);};
  var totalNet = sumArr(data);
  var calloutText = "Total Net Leases: " + (totalNet>=0?"+":"") + fmtInt(totalNet);
  var allWeeks = distinct(MMR.map(function(r){return (get(r,"WeekStart")||"").toString().slice(0,10);})).filter(Boolean).sort();

  function portfolioWeekly(weeksRange) {
    var all = sortByBirth(byActive(MMR));
    if (filter !== "All") all = byConst(all, filter);
    var byWeek = {};
    all.forEach(function(r){
      var wk=(get(r,"WeekStart")||"").toString().slice(0,10); if(!wk) return;
      if(!byWeek[wk]) byWeek[wk]={net:0,visits:0,canceled:0,denied:0};
      byWeek[wk].net      += asNum(get(r,"NetLsd"))||0;
      byWeek[wk].visits   += getVisits(r);
      byWeek[wk].canceled += getCanceled(r);
      byWeek[wk].denied   += asNum(get(r,"Denied"))||0;
    });
    var weeks = Object.keys(byWeek).sort();
    if (weeksRange&&weeksRange.from&&weeksRange.to) weeks=weeks.filter(function(w){return w>=weeksRange.from&&w<=weeksRange.to;});
    return {
      weeks: weeks,
      net: weeks.map(function(w){return byWeek[w].net;}),
      rows: weeks.map(function(w){return {WeekStart:w,Visits:byWeek[w].visits,Canceled:byWeek[w].canceled,Denied:byWeek[w].denied,Net:byWeek[w].net,Closing:byWeek[w].visits>0?byWeek[w].net/byWeek[w].visits:NaN};})
    };
  }

  var drillLevel=0, drilledProp=null, chart=null;

  return function(panelBody) {
    var titleEl=panelBody.parentElement.querySelector(".panel-title");
    var baseTitle=titleEl.textContent;
    var tools=panelBody.parentElement.querySelector(".inline-controls");
    tools&&tools.querySelectorAll("[data-role='nl-back'],[data-role='nl-view'],[data-role='nl-timeframe'],[data-role='nl-from'],[data-role='nl-to'],[data-role='nl-presets']").forEach(function(n){n.remove();});

    var backBtn=document.createElement("button"); backBtn.className="btn"; backBtn.textContent="\u2190 Back";
    backBtn.setAttribute("data-role","nl-back"); backBtn.style.fontWeight="800"; backBtn.style.display="none";
    tools&&tools.insertBefore(backBtn,tools.firstChild||null);

    var viewSel=document.createElement("select"); viewSel.className="select"; viewSel.setAttribute("data-role","nl-view");
    viewSel.innerHTML="<option value='chart'>Chart</option><option value='table'>Table</option>";
    tools&&tools.appendChild(viewSel);

    var fromSel=document.createElement("select"); fromSel.className="select"; fromSel.setAttribute("data-role","nl-from"); fromSel.style.display="none";
    var toSel=document.createElement("select"); toSel.className="select"; toSel.setAttribute("data-role","nl-to"); toSel.style.display="none";
    var opts=allWeeks.map(function(w){return "<option value='"+w+"'>"+formatDateForDisplay(w)+"</option>";}).join("");
    fromSel.innerHTML=opts; toSel.innerHTML=opts;
    fromSel.value=allWeeks[Math.max(0,allWeeks.length-8)]; toSel.value=allWeeks[allWeeks.length-1];
    tools&&tools.appendChild(fromSel); tools&&tools.appendChild(toSel);

    var presetWrap=document.createElement("div"); presetWrap.setAttribute("data-role","nl-presets");
    presetWrap.style.display="flex"; presetWrap.style.gap="6px"; presetWrap.style.alignItems="center";
    function setPresetRange(months) {
      if (!allWeeks.length) return;
      var e=new Date(allWeeks[allWeeks.length-1]); var s=new Date(e); s.setMonth(s.getMonth()-months);
      fromSel.value=allWeeks.find(function(w){return w>=s.toISOString().slice(0,10);})||allWeeks[0];
      toSel.value=allWeeks[allWeeks.length-1];
      fromSel.dispatchEvent(new Event("change")); toSel.dispatchEvent(new Event("change"));
    }
    ["1m","3m","6m","12m"].forEach(function(lbl){
      var b=document.createElement("button"); b.className="btn"; b.textContent=lbl; b.style.fontSize="11px"; b.style.padding="6px 10px";
      b.onclick=function(){setPresetRange({"1m":1,"3m":3,"6m":6,"12m":12}[lbl]);}; presetWrap.appendChild(b);
    });
    tools&&tools.appendChild(presetWrap);

    function setRangeVisible(v){fromSel.style.display=v?"":"none";toSel.style.display=v?"":"none";}
    function currentRange(){var a=fromSel.value,b=toSel.value;if(!a||!b)return null;return{from:a<=b?a:b,to:b>=a?b:a};}
    function clearPanel(){panelBody.innerHTML="";chart=null;}
    function styleCrumbs(){var bc=panelBody.parentElement.querySelector(".breadcrumb");if(bc){bc.style.fontSize="13px";bc.style.fontWeight="800";bc.style.padding="2px 0 6px";}}
    function updateBack(){backBtn.style.display=(viewSel.value==="chart"&&drillLevel>0)?"":"none";}

    function backToBase(){
      drilledProp=null; drillLevel=0; updateBack(); setRangeVisible(false);
      titleEl.textContent=baseTitle;
      renderBreadcrumb(panelBody,[baseTitle],function(){});
      styleCrumbs();
      if(viewSel.value==="table")renderTableView(); else renderChart();
    }
    backBtn.onclick=backToBase;

    var baseOnClick=function(evt,els){
      var b=chart.$_netCalloutBounds;
      if(b){
        var pos=Chart.helpers.getRelativePosition(evt,chart);
        if(pos.x>=b.x&&pos.x<=b.x+b.w&&pos.y>=b.y&&pos.y<=b.y+b.h){
          drillLevel=2; updateBack(); setRangeVisible(true);
          titleEl.textContent=baseTitle+" \u2014 Portfolio Net";
          var rng=currentRange(); var portfolioSeries2=portfolioWeekly(rng); var allTimeSeries=portfolioWeekly(null);
          var maNet30=calculateMovingAverage(allTimeSeries.net,allTimeSeries.weeks,portfolioSeries2.weeks,4);
          var maNet90=calculateMovingAverage(allTimeSeries.net,allTimeSeries.weeks,portfolioSeries2.weeks,13);
          if(chart)chart.destroy();
          var ctx2=createCanvas(panelBody);
          chart=new Chart(ctx2,{type:"line",data:{labels:portfolioSeries2.weeks.map(formatDateForDisplay),datasets:[
            {label:"Net Leases",data:portfolioSeries2.net,borderColor:"#2f5d41",backgroundColor:"#2f5d41",tension:.25,pointRadius:3},
            {label:"30-Day MA",data:maNet30,borderColor:"#7e8a6b",backgroundColor:"#7e8a6b",borderDash:[3,3],tension:0,pointRadius:1,borderWidth:1},
            {label:"90-Day MA",data:maNet90,borderColor:"#a6ad8a",backgroundColor:"#a6ad8a",borderDash:[4,4],tension:0,pointRadius:1.5,borderWidth:1.2}
          ]},options:{scales:{y:{beginAtZero:true}},plugins:{tooltip:{callbacks:{title:function(c){return "Week: "+(c[0]&&c[0].label||"");},label:function(c){return c.dataset.label+": "+fmtInt(c.parsed.y);}}}},onClick:function(){
            var rng2=currentRange(); var pf2=portfolioWeekly(rng2);
            var tot={visits:pf2.rows.reduce(function(a,r){return a+(r.Visits||0);},0),canceled:pf2.rows.reduce(function(a,r){return a+(r.Canceled||0);},0),denied:pf2.rows.reduce(function(a,r){return a+(r.Denied||0);},0),net:pf2.rows.reduce(function(a,r){return a+(r.Net||0);},0)};
            openModal("Portfolio Net Leases \u2014 Weekly",function(b){renderTable(b,[{label:"WeekStart",value:function(r){return r.WeekStart;}},{label:"Visits",value:function(r){return fmtInt(r.Visits);},class:"num"},{label:"Canceled",value:function(r){return fmtInt(r.Canceled);},class:"num"},{label:"Denied",value:function(r){return fmtInt(r.Denied);},class:"num"},{label:"Net Leases",value:function(r){return fmtInt(r.Net);},class:"num"},{label:"Closing Ratio",value:function(r){return fmtPctSmart(r.Closing);},class:"num"}],pf2.rows,undefined,{"Visits":fmtInt(tot.visits),"Canceled":fmtInt(tot.canceled),"Denied":fmtInt(tot.denied),"Net Leases":fmtInt(tot.net),"Closing Ratio":fmtPctSmart(tot.visits>0?tot.net/tot.visits:NaN)});},pf2.rows);
          }}});
          renderBreadcrumb(panelBody,[baseTitle,"Portfolio Net"],function(level){if(level===0)backToBase();});
          styleCrumbs();
          fromSel.onchange=toSel.onchange=function(){
            if(drillLevel!==2)return;
            var rng2=currentRange(); var pfC=portfolioWeekly(rng2); var ats=portfolioWeekly(null);
            chart.data.labels=pfC.weeks.map(formatDateForDisplay); chart.data.datasets[0].data=pfC.net;
            if(chart.data.datasets.length>1)chart.data.datasets[1].data=calculateMovingAverage(ats.net,ats.weeks,pfC.weeks,4);
            if(chart.data.datasets.length>2)chart.data.datasets[2].data=calculateMovingAverage(ats.net,ats.weeks,pfC.weeks,13);
            chart.update();
          };
          return;
        }
      }
      if(!els.length)return;
      var idx=els[0].index, prop=labels[idx];
      drilledProp=prop; drillLevel=1; updateBack(); setRangeVisible(true);
      titleEl.textContent=baseTitle+" \u2014 "+prop;
      renderBreadcrumb(panelBody,[baseTitle,prop],function(level){if(level===0)backToBase();});
      styleCrumbs();
      var full=propertyWeeklySeries(MMR,prop);
      var rng=currentRange();
      var filteredWeeks=full.labels, filteredNet=full.net;
      if(rng&&rng.from&&rng.to){
        var indices=full.labels.map(function(w,i){return{w:w,i:i};}).filter(function(x){return x.w>=rng.from&&x.w<=rng.to;}).map(function(x){return x.i;});
        filteredWeeks=indices.map(function(i){return full.labels[i];});
        filteredNet=indices.map(function(i){return full.net[i];});
      }
      var maNet30P=calculateMovingAverage(full.net,full.labels,filteredWeeks,4);
      var maNet90P=calculateMovingAverage(full.net,full.labels,filteredWeeks,13);
      if(chart)chart.destroy();
      var ctxP=createCanvas(panelBody);
      chart=new Chart(ctxP,{type:"line",data:{labels:filteredWeeks.map(function(l){return l.match&&l.match(/^\d{4}-\d{2}-\d{2}$/)?formatDateForDisplay(l):l;}),datasets:[
        {label:"Net Leases",data:filteredNet,borderColor:"#2f5d41",backgroundColor:"#2f5d41",tension:.25,pointRadius:3},
        {label:"30-Day MA",data:maNet30P,borderColor:"#7e8a6b",backgroundColor:"#7e8a6b",borderDash:[3,3],tension:0,pointRadius:1,borderWidth:1},
        {label:"90-Day MA",data:maNet90P,borderColor:"#a6ad8a",backgroundColor:"#a6ad8a",borderDash:[4,4],tension:0,pointRadius:1.5,borderWidth:1.2}
      ]},options:{scales:{y:{beginAtZero:true}},plugins:{tooltip:{callbacks:{title:function(c){return"Week: "+(c[0]&&c[0].label||"");},label:function(c){return c.dataset.label+": "+fmtInt(c.parsed.y);}}}},onClick:function(){
        var full2=propertyWeeklySeries(MMR,drilledProp); var rng2=currentRange();
        var fw=full2.labels; if(rng2&&rng2.from&&rng2.to)fw=full2.labels.filter(function(w){return w>=rng2.from&&w<=rng2.to;});
        var detail=sortByBirth(MMR.filter(function(r){return get(r,"Property")===drilledProp;})).filter(function(r){var wk=(get(r,"WeekStart")||"").toString().slice(0,10);return fw.includes(wk);}).sort(function(a,b){return(get(b,"WeekStart")||"").localeCompare(get(a,"WeekStart")||"");});
        var rowsTbl=detail.map(function(r){var visits=getVisits(r),net=asNum(get(r,"NetLsd"))||0;return{WeekStart:(get(r,"WeekStart")||"").toString().slice(0,10),Visits:visits,Canceled:getCanceled(r),Denied:asNum(get(r,"Denied"))||0,Net:net,Gross:net+(getCanceled(r)||0)+(asNum(get(r,"Denied"))||0),Closing:visits>0?net/visits:NaN};});
        var tot={visits:rowsTbl.reduce(function(a,r){return a+(r.Visits||0);},0),canceled:rowsTbl.reduce(function(a,r){return a+(r.Canceled||0);},0),denied:rowsTbl.reduce(function(a,r){return a+(r.Denied||0);},0),net:rowsTbl.reduce(function(a,r){return a+(r.Net||0);},0)};
        openModal("Net Leases \u2014 "+drilledProp,function(b){renderTable(b,[{label:"WeekStart",value:function(r){return r.WeekStart;}},{label:"Visits",value:function(r){return fmtInt(r.Visits);},class:"num"},{label:"Canceled",value:function(r){return fmtInt(r.Canceled);},class:"num"},{label:"Denied",value:function(r){return fmtInt(r.Denied);},class:"num"},{label:"Net Leases",value:function(r){return fmtInt(r.Net);},class:"num"},{label:"Gross Leases",value:function(r){return fmtInt(r.Gross);},class:"num"},{label:"Closing Ratio",value:function(r){return fmtPctSmart(r.Closing);},class:"num"}],rowsTbl,undefined,{"Visits":fmtInt(tot.visits),"Canceled":fmtInt(tot.canceled),"Denied":fmtInt(tot.denied),"Net Leases":fmtInt(tot.net),"Gross Leases":fmtInt(tot.net+tot.canceled+tot.denied),"Closing Ratio":fmtPctSmart(tot.visits>0?tot.net/tot.visits:NaN)});},rowsTbl);
      }}});
      fromSel.onchange=toSel.onchange=function(){
        if(drillLevel!==1||!drilledProp)return;
        var full2=propertyWeeklySeries(MMR,drilledProp); var rng2=currentRange();
        var fw=full2.labels,fn=full2.net;
        if(rng2&&rng2.from&&rng2.to){var idx2=full2.labels.map(function(w,i){return{w:w,i:i};}).filter(function(x){return x.w>=rng2.from&&x.w<=rng2.to;}).map(function(x){return x.i;});fw=idx2.map(function(i){return full2.labels[i];});fn=idx2.map(function(i){return full2.net[i];});}
        chart.data.labels=fw.map(formatDateForDisplay); chart.data.datasets[0].data=fn;
        if(chart.data.datasets.length>1)chart.data.datasets[1].data=calculateMovingAverage(full2.net,full2.labels,fw,4);
        if(chart.data.datasets.length>2)chart.data.datasets[2].data=calculateMovingAverage(full2.net,full2.labels,fw,13);
        chart.update();
      };
    };

    function renderTableView(){
      clearPanel();
      renderBreadcrumb(panelBody,[baseTitle,"Table"],function(){}); styleCrumbs(); updateBack();
      var scroller=document.createElement("div"); scroller.style.height="100%"; scroller.style.overflow="auto"; scroller.style.paddingRight="2px"; panelBody.appendChild(scroller);
      var rowsTbl=rows.map(function(r){var visits=getVisits(r),net=asNum(get(r,"NetLsd"))||0;return{Property:get(r,"Property"),Visits:visits,Canceled:getCanceled(r),Denied:asNum(get(r,"Denied"))||0,Net:net,Gross:net+(getCanceled(r)||0)+(asNum(get(r,"Denied"))||0),Closing:visits>0?net/visits:NaN};});
      var tot={visits:rowsTbl.reduce(function(a,r){return a+(r.Visits||0);},0),canceled:rowsTbl.reduce(function(a,r){return a+(r.Canceled||0);},0),denied:rowsTbl.reduce(function(a,r){return a+(r.Denied||0);},0),net:rowsTbl.reduce(function(a,r){return a+(r.Net||0);},0)};
      var exportBtn=document.createElement("button"); exportBtn.className="btn"; exportBtn.textContent="Export CSV"; exportBtn.style.marginBottom="10px";
      exportBtn.onclick=function(){var cw=(selectedWeek||"").toString().slice(0,10);exportToCSV(rowsTbl.map(function(r){return{Property:r.Property,Week:cw,"Visits":r.Visits,"Canceled":r.Canceled,"Denied":r.Denied,"Net Leases":r.Net,"Gross Leases":r.Gross,"Closing Ratio":r.Closing};}), "Net_Leases_Table_"+cw+".csv");};
      scroller.insertBefore(exportBtn,scroller.firstChild);
      renderTable(scroller,[{label:"Property",key:"Property"},{label:"Visits",value:function(r){return fmtInt(r.Visits);},class:"num"},{label:"Canceled",value:function(r){return fmtInt(r.Canceled);},class:"num"},{label:"Denied",value:function(r){return fmtInt(r.Denied);},class:"num"},{label:"Net Leases",value:function(r){return fmtInt(r.Net);},class:"num"},{label:"Gross Leases",value:function(r){return fmtInt(r.Gross);},class:"num"},{label:"Closing Ratio",value:function(r){return fmtPctSmart(r.Closing);},class:"num"}],rowsTbl,function(r){
        var prop=r.Property;
        var detail=sortByBirth(MMR.filter(function(x){return get(x,"Property")===prop;})).sort(function(a,b){return(get(b,"WeekStart")||"").localeCompare(get(a,"WeekStart")||"");});
        var weekly=detail.map(function(x){var wk=(get(x,"WeekStart")||"").toString().slice(0,10),visits=getVisits(x),net=asNum(get(x,"NetLsd"))||0;return{WeekStart:wk,Visits:visits,Canceled:getCanceled(x),Denied:asNum(get(x,"Denied"))||0,Net:net,Gross:net+(getCanceled(x)||0)+(asNum(get(x,"Denied"))||0),Closing:visits>0?net/visits:NaN};});
        var tot2={visits:weekly.reduce(function(a,c){return a+(c.Visits||0);},0),canceled:weekly.reduce(function(a,c){return a+(c.Canceled||0);},0),denied:weekly.reduce(function(a,c){return a+(c.Denied||0);},0),net:weekly.reduce(function(a,c){return a+(c.Net||0);},0)};
        openModal("Net Leases \u2014 "+prop,function(b){renderTable(b,[{label:"WeekStart",value:function(x){return x.WeekStart;}},{label:"Visits",value:function(x){return fmtInt(x.Visits);},class:"num"},{label:"Canceled",value:function(x){return fmtInt(x.Canceled);},class:"num"},{label:"Denied",value:function(x){return fmtInt(x.Denied);},class:"num"},{label:"Net Leases",value:function(x){return fmtInt(x.Net);},class:"num"},{label:"Gross Leases",value:function(x){return fmtInt(x.Gross);},class:"num"},{label:"Closing Ratio",value:function(x){return fmtPctSmart(x.Closing);},class:"num"}],weekly,undefined,{"Visits":fmtInt(tot2.visits),"Canceled":fmtInt(tot2.canceled),"Denied":fmtInt(tot2.denied),"Net Leases":fmtInt(tot2.net),"Gross Leases":fmtInt(tot2.net+tot2.canceled+tot2.denied),"Closing Ratio":fmtPctSmart(tot2.visits>0?tot2.net/tot2.visits:NaN)});});
      },{
        "Visits":fmtInt(tot.visits),"Canceled":fmtInt(tot.canceled),"Denied":fmtInt(tot.denied),"Net Leases":fmtInt(tot.net),"Closing Ratio":fmtPctSmart(tot.visits>0?tot.net/tot.visits:NaN)
      });
    }

    function renderChart(){
      clearPanel();
      renderBreadcrumb(panelBody,[baseTitle],function(){}); styleCrumbs(); updateBack();
      var ctx=createCanvas(panelBody);
      var safe=data.map(function(v){return +v||0;});
      var maxX=Math.max(10,safe.length?Math.max.apply(null,safe):0);
      chart=new Chart(ctx,{type:"bar",data:{labels:labels,datasets:[{label:"Net Leases",data:data,backgroundColor:"#7e8a6b",categoryPercentage:0.55,barPercentage:0.7}]},options:{indexAxis:"y",scales:{x:{beginAtZero:true,min:0,max:maxX}},plugins:{legend:{position:"bottom"},netCallout:{show:true,text:calloutText},tooltip:{callbacks:{title:function(items){return"Property: "+(items[0]&&items[0].label||"");},label:function(c){return"Net Leases: "+fmtInt(c.parsed.x)+" \u2014 Move-ins minus move-outs";}}}},layout:{padding:{left:8,right:16,top:8,bottom:8}},onClick:baseOnClick},plugins:[netCalloutPlugin]});
    }

    if(viewSel.value==="table"){drillLevel=0;updateBack();titleEl.textContent=baseTitle;renderTableView();}
    else renderChart();
    viewSel.onchange=function(){backToBase();};
  };
}
