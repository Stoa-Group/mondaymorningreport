/* app-data.js — data fetching, Domo SDK integration, API calls */

// ---------- Domo dataset fetch ----------
async function fetchAlias(alias, fields) {
  const qs = new URLSearchParams();
  if (fields && fields.length) qs.set("fields", fields.join(","));
  qs.set("limit", "50000");
  return domo.get(`/data/v2/${encodeURIComponent(alias)}?${qs.toString()}`);
}

// ---------- Property-list status overlay ----------
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

function overlayDbStatus(rows, statusMap) {
  if (!statusMap || Object.keys(statusMap).length === 0) return rows;
  const entityToStatus = {};
  Object.keys(statusMap).forEach(k => {
    const ek = propEntityKey(k);
    if (ek) entityToStatus[ek] = statusMap[k];
  });
  rows.forEach(r => {
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

// ---------- Leasing Hub delta-to-budget ----------
async function fetchLeasingHubDeltas() {
  try {
    const res = await fetch(LEASING_SUMMARY_API, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const byLower = {}, byEntity = {};
    const bp = json.kpis && json.kpis.byProperty;
    if (bp && typeof bp === "object") {
      Object.keys(bp).forEach(k => {
        const entry = bp[k];
        const d = entry && entry.deltaToBudget;
        if (d != null && typeof d === "number" && isFinite(d)) {
          const lk = (k || "").trim().toLowerCase();
          if (lk) byLower[lk] = d;
          const ekey = propEntityKey(k);
          if (ekey && byEntity[ekey] === undefined) byEntity[ekey] = d;
        }
      });
    }
    console.log(`[LeasingHub] deltaToBudget for ${Object.keys(byLower).length} properties`);
    return { byLower, byEntity };
  } catch (e) {
    console.warn("[LeasingHub] Could not fetch dashboard summary:", e);
    return null;
  }
}

function getDeltaFromLeasingHub(propertyName) {
  if (!leasingHubDeltaMaps) return null;
  const lower = (propertyName || "").trim().toLowerCase();
  if (leasingHubDeltaMaps.byLower && leasingHubDeltaMaps.byLower[lower] != null) {
    return leasingHubDeltaMaps.byLower[lower];
  }
  const ek = propEntityKey(propertyName);
  if (ek && leasingHubDeltaMaps.byEntity && leasingHubDeltaMaps.byEntity[ek] != null) {
    return leasingHubDeltaMaps.byEntity[ek];
  }
  return null;
}

// ---------- Row filtering / data-pipeline helpers ----------
function filterBySelectedWeek(rows) {
  if (!selectedWeek) return rows;
  return rows.filter(r => (get(r, "WeekStart") || "").toString().startsWith(selectedWeek));
}

/**
 * Same pipeline as monday morning email report filterToMostRecentWeek:
 * overlay Status already applied; keep Lease-Up / Stabilized;
 * one row per Property (latest ReportDate); sort by BirthOrder.
 */
function filterMmrLikeEmailReport(allRows, weekPrefix) {
  if (!allRows || !allRows.length) return [];
  let rows = allRows.filter(r => isLeaseUpOrStabilizedStatus(get(r, "Status")));
  if (weekPrefix) {
    const pfx = weekPrefix.toString().slice(0, 10);
    rows = rows.filter(r => (get(r, "WeekStart") || "").toString().slice(0, 10) === pfx);
  }
  const propertyMap = {};
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

function dedupeRowsByEntityKeyPreferActive(rows) {
  const byEk = new Map();
  rows.forEach(r => {
    const ek = propEntityKey(get(r, "Property"));
    if (!ek) return;
    const prev = byEk.get(ek);
    if (!prev) { byEk.set(ek, r); return; }
    const aPrev = isLeaseUpOrStabilizedStatus(get(prev, "Status"));
    const aCur  = isLeaseUpOrStabilizedStatus(get(r, "Status"));
    if (aCur && !aPrev) { byEk.set(ek, r); return; }
    if (!aCur && aPrev) return;
    const wP = new Date(get(prev, "WeekStart") || 0);
    const wC = new Date(get(r, "WeekStart") || 0);
    if (wC >= wP) byEk.set(ek, r);
  });
  return Array.from(byEk.values());
}

function augmentMmrLatestWithDbActiveProperties(mmrLatest) {
  if (!propertyCanonicalActive || !propertyCanonicalActive.length) return mmrLatest;
  const presentActive = new Set(byActive(mmrLatest).map(r => propEntityKey(get(r, "Property"))));
  const merged = mmrLatest.slice();
  const weekStr = selectedWeek ? selectedWeek.toString().slice(0, 10) : null;

  function pickLatestWeekRow(rows) {
    let pick = weekStr
      ? rows.find(r => (get(r, "WeekStart") || "").toString().slice(0, 10) === weekStr)
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

  propertyCanonicalActive.forEach(function(item) {
    var displayName = item.Property;
    var dbStatus = item.Status;
    const ek = propEntityKey(displayName);
    if (!ek || presentActive.has(ek)) return;
    const candidates = MMR.filter(r => propEntityKey(get(r, "Property")) === ek);
    const activeCands = byActive(candidates);
    if (activeCands.length) {
      const pick = pickLatestWeekRow(activeCands);
      if (!pick) return;
      const clone = Object.assign({}, pick);
      if (weekStr && (get(clone, "WeekStart") || "").toString().slice(0, 10) !== weekStr) {
        const ws = get(clone, "WeekStart");
        clone.WeekStart = ws != null && `${ws}`.length >= 10 ? weekStr + `${ws}`.slice(10) : weekStr;
      }
      merged.push(clone);
      presentActive.add(ek);
      return;
    }
    if (candidates.length) {
      const pick = pickLatestWeekRow(candidates);
      if (!pick) return;
      const clone = Object.assign({}, pick);
      clone.Status = dbStatus;
      if (weekStr && (get(clone, "WeekStart") || "").toString().slice(0, 10) !== weekStr) {
        const ws = get(clone, "WeekStart");
        clone.WeekStart = ws != null && `${ws}`.length >= 10 ? weekStr + `${ws}`.slice(10) : weekStr;
      }
      merged.push(clone);
      presentActive.add(ek);
      return;
    }
    const raw = propertyListRows.find(p => propEntityKey(p.Property) === ek);
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

function previousWeekOf(selected) {
  if (!selected) return null;
  const idx = weekOptions.indexOf(selected);
  return idx >= 0 && idx < weekOptions.length - 1 ? weekOptions[idx + 1] : null;
}

/** Find closest MMR row approximately one month before selectedWeek for same property */
function findPreviousMonthMMR(selectedWeek, property, allMMR) {
  if (!selectedWeek) return null;
  const currentDate = new Date(selectedWeek);
  const prevMonthDate = new Date(currentDate);
  prevMonthDate.setDate(prevMonthDate.getDate() - 28);
  const prevMonthStr = prevMonthDate.toISOString().slice(0, 10);
  const propMMR = allMMR.filter(r => get(r, "Property") === property);
  if (!propMMR.length) return null;
  const candidates = propMMR
    .map(r => ({ r, date: (get(r, "WeekStart") || "").toString().slice(0, 10) }))
    .filter(x => x.date)
    .map(x => ({ r: x.r, diff: Math.abs((new Date(x.date) - new Date(prevMonthStr)) / (1000 * 60 * 60 * 24)) }))
    .filter(x => x.diff <= 14)
    .sort((a, b) => a.diff - b.diff);
  return candidates.length > 0 ? candidates[0].r : null;
}

/**
 * Δ units vs month-end budget:
 * Primary source: stoagroupDB (DailyPropertyMetrics projected).
 * Fallback: Domo OccUnits − BudgetedOccupancyCurrentMonth.
 * Further fallback: % × units calculation.
 */
function mmrDeltaUnitsVsBudget(r) {
  const hub = getDeltaFromLeasingHub(get(r, "Property"));
  if (hub != null && typeof hub === "number" && isFinite(hub)) return hub;
  const occUnitsRaw = get(r, "OccUnits");
  const budgetUnitsRaw = get(r, "BudgetedOccupancyCurrentMonth");
  const ou = asNum(occUnitsRaw), bu = asNum(budgetUnitsRaw);
  if (occUnitsRaw != null && occUnitsRaw !== "" && isFinite(ou) &&
      budgetUnitsRaw != null && budgetUnitsRaw !== "" && isFinite(bu)) {
    return Math.round(ou) - Math.round(bu);
  }
  const units = asNum(get(r, "TotalUnits")) || asNum(get(r, "Units")) || asNum(get(r, "InServiceUnits")) || 0;
  let occ = asNum(get(r, "OccupancyPercent"));
  let bOcc = asNum(get(r, "BudgetedOccupancyPercentageCurrentMonth"));
  if (!isFinite(occ)) occ = 0;
  if (!isFinite(bOcc)) bOcc = 0;
  const occDec = occ > -1 && occ < 1 && occ !== 0 ? occ : (occ === 0 ? 0 : occ / 100);
  const bDec   = bOcc > -1 && bOcc < 1 && bOcc !== 0 ? bOcc : (bOcc === 0 ? 0 : bOcc / 100);
  const actualU  = Math.round(units * occDec);
  const budgetU  = (budgetUnitsRaw != null && budgetUnitsRaw !== "" && isFinite(bu))
    ? Math.round(bu)
    : Math.round(units * bDec);
  let d = actualU - budgetU;
  if (actualU === 0 || occ === 0) d = 0;
  return d;
}
