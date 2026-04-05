/* app-render-3.js — timelineActualVsBudget, reviews chart functions */

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

  const labels = sortPropertyNamesByBirth(Object.keys(byProp), MMR);
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
