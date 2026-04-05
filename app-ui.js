/* app-ui.js — tab wiring, render(), KPI builders, detail modal functions */

// ---------- Tab wiring ----------
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

/**
 * Δ units vs month-end budget: primary source is stoagroupDB (DailyPropertyMetrics) — today’s occupancy,
 * then scheduled move-ins/move-outs through the last day of the month, compared to month-end budgeted occupancy units.
 * Falls back to Domo Occ Units − Budgeted Occupancy (Current Month), then % × units.
 */
function mmrDeltaUnitsVsBudget(r) {
  const hub = getDeltaFromLeasingHub(get(r, "Property"));
  if (hub != null && typeof hub === "number" && isFinite(hub)) return hub;

  const occUnitsRaw = get(r, "OccUnits");
  const budgetUnitsRaw = get(r, "BudgetedOccupancyCurrentMonth");
  const ou = asNum(occUnitsRaw);
  const bu = asNum(budgetUnitsRaw);
  if (occUnitsRaw != null && occUnitsRaw !== "" && isFinite(ou) && budgetUnitsRaw != null && budgetUnitsRaw !== "" && isFinite(bu)) {
    return Math.round(ou) - Math.round(bu);
  }
  const units = asNum(get(r, "TotalUnits")) || asNum(get(r, "Units")) || asNum(get(r, "InServiceUnits")) || 0;
  let occ = asNum(get(r, "OccupancyPercent"));
  let bOcc = asNum(get(r, "BudgetedOccupancyPercentageCurrentMonth"));
  if (!isFinite(occ)) occ = 0;
  if (!isFinite(bOcc)) bOcc = 0;
  const occDec = occ > -1 && occ < 1 && occ !== 0 ? occ : (occ === 0 ? 0 : occ / 100);
  const bDec = bOcc > -1 && bOcc < 1 && bOcc !== 0 ? bOcc : (bOcc === 0 ? 0 : bOcc / 100);
  const actualU = Math.round(units * occDec);
  let budgetU;
  if (budgetUnitsRaw != null && budgetUnitsRaw !== "" && isFinite(bu)) {
    budgetU = Math.round(bu);
  } else {
    budgetU = Math.round(units * bDec);
  }
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
      const w = asNum(get(r, "TotalUnits")) || asNum(get(r, "Units")) || 0;
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
