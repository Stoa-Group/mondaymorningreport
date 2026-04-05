/* app-state.js — constants, aliases, field lists, shared state variables */

// Chart.js theme defaults (must run before any chart is created)
Chart.defaults.color = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();
Chart.defaults.borderColor = "#e3e8e2";
Chart.defaults.font.family =
  "Gotham, 'Interstate', system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
Chart.defaults.plugins.legend.labels.boxWidth = 12;
Chart.defaults.elements.bar.borderRadius = 8;
Chart.defaults.datasets.bar.maxBarThickness = 36;
Chart.defaults.responsive = true;
Chart.defaults.maintainAspectRatio = false;
Chart.defaults.elements.point.radius = 4;
Chart.defaults.elements.point.hoverRadius = 6;

// ---------- Dataset aliases + field lists ----------
const ALIASES = { MMR: "MMRData", REV: "googlereviews" };

const FIELDS = {
  MMR: [
    "Property","Region","City","State","Status","ConstructionStatus","LatestConstructionStatus",
    "Units","TotalUnits","InServiceUnits",
    "OccupancyPercent","CurrentLeasedPercent",
    "OccUnits",
    "BudgetedOccupancyCurrentMonth",
    "BudgetedOccupancyPercentageCurrentMonth","BudgetedLeasedPercentageCurrentMonth",
    "MI","MO","NetLsd","Applied","Denied","ReturnVisitCount","1stVisit",
    "T12LeasesExpired","T12LeasesRenewed",
    "CurrentMonthIncome","BudgetedIncome",
    "OccupiedRent","BudgetedRent","MoveInRent",
    "OccupiedRentPSF","BudgetedRentPSF","MoveinRentPSF",
    "Delinquent","Latitude","Longitude","FullAddress",
    "Week3OccPercentage","Week7OccPercentage",
    "LatestDate","WeekStart","BirthOrder"
  ],
  REV: ["Property","rating","category","ReviewText","reviewdate","reviewername","BirthOrder"],
};

// ---------- External API endpoints ----------
const PROPERTY_LIST_API  = "https://stoagroupdb-ddre.onrender.com/api/leasing/property-list";
const LEASING_SUMMARY_API = "https://stoagroupdb-ddre.onrender.com/api/leasing/dashboard/summary";

// ---------- Mutable shared state (written in app-data / app-init) ----------
var MMR = [];
var REV = [];
var weekOptions = [];
var selectedWeek = null;

/** Lowercased property name -> Status from DB */
var propertyStatusMap = {};
/** Lease-Up / Stabilized rows from property-list (authoritative count) */
var propertyCanonicalActive = [];
/** Raw rows from property-list API */
var propertyListRows = [];
/** False when fetch to stoagroupDB failed */
var propertyListFetchOk = false;
/** deltaToBudget maps from LeasingHub API */
var leasingHubDeltaMaps = null;
/** BirthOrder lookup by entity key */
var birthOrderByEntityKey = new Map();
