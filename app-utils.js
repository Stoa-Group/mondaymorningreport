/* app-utils.js — helpers, formatters, DOM utilities, toast, confirm dialog */

// ---------- Value helpers ----------
function get(row, key) {
  if (!row) return undefined;
  if (key in row) return row[key];
  const norm = s => (s || "").toString().replace(/\s+/g, "").toLowerCase();
  const found = Object.keys(row).find(k => norm(k) === norm(key));
  return found ? row[found] : undefined;
}

const asNum = v => (v == null || v === "") ? NaN : +(`${v}`.toString().replace(/[$,%]/g, ""));
const fmtInt = n => isFinite(n) ? Math.round(n).toLocaleString() : "—";

function fmtPctSmart(n) {
  if (!isFinite(n)) return "—";
  const v = (Math.abs(n) <= 1 ? n * 100 : n);
  return `${v.toFixed(2)}%`;
}

const fmtUSD0 = n => isFinite(n) ? `$${Math.round(n).toLocaleString()}` : "—";
const fmtUSD2 = n => isFinite(n) ? `$${n.toFixed(2)}` : "—";
const tickUSD0 = v => "$" + Intl.NumberFormat().format(Math.round(v));
const tickUSD2 = v => "$" + Number(v).toFixed(2);

function parseDateLike(v) { const d = new Date(v); return isNaN(d) ? null : d; }
function distinct(vals) { return Array.from(new Set(vals)); }

/** Format date string for display (e.g. "Oct 20, 2025") */
function formatDateForDisplay(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** All-time moving average — calculates over allData then maps to visibleLabels only */
function calculateMovingAverage(allData, allLabels, visibleLabels, windowSize) {
  windowSize = windowSize || 11;
  const ma = [];
  for (let i = 0; i < allData.length; i++) {
    const start = Math.max(0, i - windowSize + 1);
    const slice = allData.slice(start, i + 1);
    const s = slice.reduce((a, v) => a + (isFinite(v) ? v : 0), 0);
    ma.push(slice.length > 0 ? s / slice.length : null);
  }
  return visibleLabels.map(label => {
    const idx = allLabels.indexOf(label);
    return idx >= 0 ? ma[idx] : null;
  });
}

// ---------- Row helpers (use globals MMR, byActive, etc.) ----------
/** Normalize Status string for comparison */
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
function byActive(rows) {
  return rows.filter(r => isLeaseUpOrStabilizedStatus(get(r, "Status")));
}
function constKey(r) {
  return get(r, "ConstructionStatus") !== undefined ? "ConstructionStatus" : "LatestConstructionStatus";
}
function byConst(rows, label) {
  if (label === "All") return rows;
  return rows.filter(r => (get(r, constKey(r)) || "").toString().toLowerCase().includes(label.toLowerCase()));
}
function sortByBirth(rows) {
  return rows.slice().sort((a, b) => (asNum(get(a, "BirthOrder")) || 0) - (asNum(get(b, "BirthOrder")) || 0));
}
/** Normalize property name to entity key (strips "The ", punctuation, lowercases) */
function propEntityKey(s) {
  let k = (s || "").toString().trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (k.startsWith("the")) k = k.slice(3);
  return k;
}

function rebuildBirthOrderIndex() {
  birthOrderByEntityKey = new Map();
  const setOrder = (ek, b) => {
    const n = asNum(b);
    if (!ek || !isFinite(n)) return;
    if (!birthOrderByEntityKey.has(ek)) birthOrderByEntityKey.set(ek, n);
  };
  (MMR || []).forEach(r => setOrder(propEntityKey(get(r, "Property")), get(r, "BirthOrder")));
  (propertyListRows || []).forEach(raw => {
    const bo = raw["Birth Order"] ?? raw.BirthOrder;
    setOrder(propEntityKey(raw.Property), bo);
  });
}

/** Sort property name strings by BirthOrder */
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
  Array.from(set).sort((a, b) => {
    const ka = propEntityKey(a), kb = propEntityKey(b);
    const ba = birthOrderByEntityKey.get(ka), bb = birthOrderByEntityKey.get(kb);
    if (ba != null && bb != null && ba !== bb) return ba - bb;
    if (ba != null && bb == null) return -1;
    if (ba == null && bb != null) return 1;
    return a.localeCompare(b);
  }).forEach(p => out.push(p));
  return out;
}

const sum = (rows, key) => rows.reduce((a, r) => a + (isFinite(asNum(get(r, key))) ? asNum(get(r, key)) : 0), 0);

function weightedAvg(rows, key) {
  let num = 0, den = 0;
  rows.forEach(r => {
    const w = asNum(get(r, "InServiceUnits")) || asNum(get(r, "Units")) || 0;
    const v = asNum(get(r, key));
    if (isFinite(v) && w > 0) { num += v * w; den += w; }
  });
  return den > 0 ? num / den : NaN;
}

// ---------- DOM helpers ----------
function $(sel) { return document.querySelector(sel); }

function createPanel(host, title, withConstSelector) {
  withConstSelector = withConstSelector || false;
  const wrap = document.createElement("div"); wrap.className = "panel";
  const head = document.createElement("div"); head.className = "panel-head";
  const ttl = document.createElement("div"); ttl.className = "panel-title"; ttl.textContent = title; head.appendChild(ttl);
  const tools = document.createElement("div"); tools.className = "inline-controls";
  if (withConstSelector) {
    const s = document.createElement("select"); s.className = "select";
    s.innerHTML = `<option value="All">All</option><option value="Completed">Completed</option><option value="Under Construction">Under Construction</option>`;
    tools.appendChild(s); head.appendChild(tools);
    wrap._constSelect = s;
  } else {
    head.appendChild(tools);
  }
  wrap.appendChild(head);
  const body = document.createElement("div"); body.className = "panel-body"; wrap.appendChild(body);
  host.appendChild(wrap);
  return { wrap, body, head, tools };
}

function createCanvas(container) {
  const c = document.createElement("canvas");
  c.style.width = "100%"; c.style.height = "100%";
  container.innerHTML = ""; container.appendChild(c);
  return c.getContext("2d");
}

function renderTable(host, columns, rows, onRowClick, totals, tableOptions) {
  tableOptions = tableOptions || {};
  const t = document.createElement("table"); t.className = "table";

  const thead = document.createElement("thead"), trh = document.createElement("tr");
  columns.forEach(c => { const th = document.createElement("th"); th.textContent = c.label; trh.appendChild(th); });
  thead.appendChild(trh); t.appendChild(thead);

  const tb = document.createElement("tbody");
  rows.forEach(r => {
    const tr = document.createElement("tr");
    const rowCls = typeof tableOptions.rowClass === "function" ? tableOptions.rowClass(r) : "";
    if (rowCls) tr.className = rowCls;
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

// ---------- Breadcrumbs ----------
function renderBreadcrumb(panelBody, trail, onClick) {
  let bc = panelBody.parentElement.querySelector(".breadcrumb");
  if (!bc) {
    bc = document.createElement("div");
    bc.className = "breadcrumb";
    bc.style.margin = "0";
    bc.style.padding = "0";
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

// ---------- Toast notification (replaces alert()) ----------
(function initToast() {
  var toastEl = null;
  var toastTimer = null;
  window.showToast = function(msg, type) {
    type = type || "info";
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.id = "app-toast";
      toastEl.style.cssText = [
        "position:fixed","bottom:24px","left:50%","transform:translateX(-50%)",
        "padding:10px 20px","border-radius:8px","font-size:14px","font-weight:600",
        "z-index:9999","pointer-events:none","transition:opacity 0.3s","max-width:480px",
        "text-align:center","box-shadow:0 4px 12px rgba(0,0,0,0.15)"
      ].join(";");
      document.body.appendChild(toastEl);
    }
    var bg = type === "error" ? "#c0392b" : (type === "success" ? "#2f5d41" : "#333");
    toastEl.style.background = bg;
    toastEl.style.color = "#fff";
    toastEl.style.opacity = "1";
    toastEl.textContent = msg;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function() {
      toastEl.style.opacity = "0";
    }, 3500);
  };
})();

// ---------- Custom confirm dialog (replaces confirm() — blocked in Domo iframes) ----------
window.showConfirm = function(message, onConfirm, onCancel) {
  var overlay = document.createElement("div");
  overlay.style.cssText = [
    "position:fixed","top:0","left:0","width:100%","height:100%",
    "background:rgba(0,0,0,0.45)","z-index:10000","display:flex",
    "align-items:center","justify-content:center"
  ].join(";");

  var box = document.createElement("div");
  box.style.cssText = [
    "background:#fff","border-radius:10px","padding:28px 32px","max-width:400px",
    "width:90%","box-shadow:0 8px 32px rgba(0,0,0,0.2)","text-align:center"
  ].join(";");

  var msgEl = document.createElement("p");
  msgEl.textContent = message;
  msgEl.style.cssText = "margin:0 0 20px;font-size:15px;line-height:1.5;color:#333;";

  var btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex;gap:12px;justify-content:center;";

  var confirmBtn = document.createElement("button");
  confirmBtn.textContent = "Confirm";
  confirmBtn.className = "btn";
  confirmBtn.style.cssText = "background:#2f5d41;color:#fff;font-weight:700;padding:9px 22px;";

  var cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  cancelBtn.className = "btn";
  cancelBtn.style.cssText = "padding:9px 22px;";

  function close() { document.body.removeChild(overlay); }

  confirmBtn.onclick = function() { close(); if (typeof onConfirm === "function") onConfirm(); };
  cancelBtn.onclick  = function() { close(); if (typeof onCancel  === "function") onCancel(); };
  overlay.addEventListener("click", function(e) { if (e.target === overlay) { close(); if (typeof onCancel === "function") onCancel(); } });

  btnRow.appendChild(confirmBtn);
  btnRow.appendChild(cancelBtn);
  box.appendChild(msgEl);
  box.appendChild(btnRow);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  confirmBtn.focus();
};

// ---------- CSV Export utility ----------
function exportToCSV(data, filename) {
  if (!data || data.length === 0) { showToast("No data to export", "error"); return; }
  const normRows = data.map(row => {
    const out = Object.assign({}, row);
    const keys = Object.keys(out);
    const findKey = name => keys.find(k => k.toLowerCase() === name.toLowerCase());
    const propKey = findKey("Property");
    if (!propKey) out.Property = "Portfolio";
    else if (propKey !== "Property") out.Property = out[propKey];

    const weekStartKey = keys.find(k => k.toLowerCase() === "weekstart");
    const weekKey      = keys.find(k => k.toLowerCase() === "week");
    const reviewDateKey = keys.find(k => k.toLowerCase() === "reviewdate");
    const monthKey     = keys.find(k => k.toLowerCase() === "month");
    const periodKey    = keys.find(k => k.toLowerCase() === "period");
    let dateVal = out[weekStartKey] || out[weekKey] || out[reviewDateKey] || out[monthKey] || out[periodKey];
    if (!dateVal && typeof selectedWeek !== "undefined" && selectedWeek) dateVal = selectedWeek;
    if (dateVal) {
      try {
        const d = new Date(dateVal);
        out.Date = isNaN(d) ? String(dateVal) : d.toISOString().slice(0, 10);
      } catch (_) { out.Date = String(dateVal); }
    } else if (out.Date == null) { out.Date = ""; }
    return out;
  });
  const allKeys = Array.from(normRows.reduce((s, r) => { Object.keys(r).forEach(k => s.add(k)); return s; }, new Set()));
  const otherKeys = allKeys.filter(k => k !== "Property" && k !== "Date");
  const headers = ["Property", "Date", ...otherKeys];
  const csvContent = [
    headers.map(h => `"${h}"`).join(","),
    ...normRows.map(row => headers.map(h => `"${String(row[h] ?? "").replace(/"/g, '""')}"`).join(","))
  ].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
