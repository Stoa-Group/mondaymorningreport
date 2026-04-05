/* app-init.js — init() function and bootstrap */

// Initialize modal elements after DOM is ready
_initModal();

async function init() {
  const [mmrRaw, revRaw, plResult, hubMaps] = await Promise.all([
    fetchAlias(ALIASES.MMR, FIELDS.MMR),
    fetchAlias(ALIASES.REV, FIELDS.REV).catch(function() { return []; }),
    fetchPropertyListStatus(),
    fetchLeasingHubDeltas()
  ]);
  leasingHubDeltaMaps = hubMaps;
  propertyStatusMap = plResult.statusMap || plResult || {};
  propertyCanonicalActive = plResult.canonicalProperties || [];
  propertyListRows = plResult.propertyListRows || [];
  propertyListFetchOk = plResult.fetchOk !== false;
  MMR = overlayDbStatus(mmrRaw, propertyStatusMap);
  rebuildBirthOrderIndex();
  REV = revRaw;

  // WeekStart select
  weekOptions = distinct(MMR.map(function(r) { return (get(r, "WeekStart") || "").toString().slice(0, 10); })).filter(Boolean).sort().reverse();
  var sel = document.querySelector("#weekstart-select");
  sel.innerHTML = weekOptions.map(function(w) { return "<option value='" + w + "'>" + formatDateForDisplay(w) + "</option>"; }).join("");
  selectedWeek = weekOptions[0] || null;
  sel.value = selectedWeek;
  sel.addEventListener("change", function() { selectedWeek = sel.value; render(); });

  render();
}

init().catch(function(err) {
  console.error(err);
  var msg = (err && err.message) || "Failed to load data.";
  document.querySelector(".page").insertAdjacentHTML("beforeend",
    '<div class="section" style="margin:1rem;padding:1rem;background:#f8d7da;border:1px solid #f5c6cb;border-radius:4px;"><strong>Error</strong><p style="margin:0.5rem 0 0;">' + String(msg).replace(/</g, "&lt;") + "</p></div>");
});
