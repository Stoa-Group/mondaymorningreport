/* app-render-2.js — t12Bars, rentMetrics, incomeVsBudget chart functions */

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

// incomeVsBudget
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
            const rowsTbl = s.labels.map((m, idx) => {
              const act = s.act[idx];
              const bud = s.bud[idx];
              const zeroAct = (act || 0) === 0;
              const pct = zeroAct ? NaN : (bud ? (act - bud) / bud : NaN);
              return { Month: m, Actual: act, Budget: bud, Pct: pct, _zeroAct: zeroAct };
            });
            const totActual = rowsTbl.reduce((a, r) => a + (r.Actual || 0), 0);
            const totBudget = rowsTbl.reduce((a, r) => a + (r.Budget || 0), 0);
            const totPctWeighted = totBudget > 0 ? ((totActual - totBudget) / totBudget) * 100 : NaN;
            openModal(`Budgeted vs Actual Income — ${drilledProp}`, b => {
              renderTable(b, [
                { label: "Month",  key: "Month" },
                { label: "Actual (Month)",  value: r => r._zeroAct ? "N/A" : tickUSD0(r.Actual), class: "num" },
                { label: "Budget",          value: r => tickUSD0(r.Budget), class: "num" },
                { label: "% Difference",    value: r => r._zeroAct || !isFinite(r.Pct) ? "N/A" : fmtPctSmart(r.Pct * 100), class: "num" }
              ], rowsTbl, undefined, {
                "Actual (Month)": tickUSD0(totActual),
                "Budget": tickUSD0(totBudget),
                "% Difference": isFinite(totPctWeighted) ? fmtPctSmart(totPctWeighted) : "N/A"
              }, {
                rowClass: r => r._zeroAct ? "income-row-na" : ""
              });
            }, rowsTbl.map(r => ({
              Month: r.Month,
              Actual: r._zeroAct ? "N/A" : r.Actual,
              Budget: r.Budget,
              Pct: r._zeroAct || !isFinite(r.Pct) ? "N/A" : r.Pct
            })));
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
