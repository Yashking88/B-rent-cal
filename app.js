/* eslint-disable no-undef */
(() => {
  "use strict";

  const TENANT_COUNT = 11;
  const ELECTRICITY_RATE_INR = 12;

  const LS = {
    calculationsHistory: "cRent.calculationsHistory.v1",
    activeCalcByMonth: "cRent.activeCalcByMonth.v1",
    paymentsByMonth: "cRent.paymentsByMonth.v1",
    lastMonthKey: "cRent.lastMonthKey.v1",
  };

  // ========== FIREBASE CONFIG ==========
  const firebaseConfig = {
  apiKey: "AIzaSyAyZjWNXAV4iXR2RLiLyCJ2xPiFi5ifJAo",
  authDomain: "c-rent-sync.firebaseapp.com",
  databaseURL: "https://c-rent-sync-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "c-rent-sync",
  storageBucket: "c-rent-sync.firebasestorage.app",
  messagingSenderId: "995172337203",
  appId: "1:995172337203:web:56e720db9216ff0de38546"
};

  let fb = {
    app: null,
    db: null,
    auth: null,
    user: null,
    isCloudEnabled: false,
  };

  // Initialize Firebase only after SDK is loaded
  function initFirebase() {
    if (typeof firebase === "undefined") {
      console.warn("Firebase SDK not loaded. Make sure Firebase scripts are in HTML.");
      return false;
    }
    
    try {
      // Check if already initialized
      if (firebase.apps.length > 0) {
        fb.app = firebase.apps[0];
      } else {
        fb.app = firebase.initializeApp(firebaseConfig);
      }
      
      // Initialize database and auth only if app is initialized
      try {
        fb.db = firebase.database(fb.app);
        console.log("Database initialized successfully");
      } catch (e) {
        console.warn("Database initialization failed:", e.message);
      }
      
      try {
        fb.auth = firebase.auth(fb.app);
        console.log("Auth initialized successfully");
      } catch (e) {
        console.warn("Auth initialization failed:", e.message);
      }
      
      console.log("Firebase initialized successfully");
      return true;
    } catch (e) {
      console.warn("Firebase init failed:", e.message);
      return false;
    }
  }

  // Wait for Firebase SDK to load before initializing
  async function waitForFirebase(maxAttempts = 20) {
    for (let i = 0; i < maxAttempts; i++) {
      if (typeof firebase !== "undefined") {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 100)); // Wait 100ms
    }
    console.warn("Firebase SDK did not load after", maxAttempts * 100, "ms");
    return false;
  }

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function safeParseJSON(raw, fallback) {
    try {
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  // ========== FIREBASE CLOUD FUNCTIONS ==========
  async function cloudLoad(key) {
    if (!fb.isCloudEnabled || !fb.user || !fb.db) return null;
    try {
      const ref = fb.db.ref(`users/${fb.user.uid}/${key}`);
      const snapshot = await ref.get();
      return snapshot.val();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`Cloud load failed for ${key}:`, e);
      return null;
    }
  }

  async function cloudSave(key, value) {
    if (!fb.isCloudEnabled || !fb.user || !fb.db) return false;
    try {
      const ref = fb.db.ref(`users/${fb.user.uid}/${key}`);
      await ref.set(value);
      updateSyncStatus("Synced", "emerald");
      return true;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`Cloud save failed for ${key}:`, e);
      updateSyncStatus("Offline", "slate");
      return false;
    }
  }

  function updateSyncStatus(text, color = "slate") {
    const statusEl = $("#syncStatusText");
    const statusDot = $("#syncStatus > .w-2");
    if (statusEl) statusEl.textContent = text;
    if (statusDot) {
      statusDot.className = `w-2 h-2 rounded-full ${
        color === "emerald" ? "bg-emerald-500" : color === "red" ? "bg-red-500" : "bg-slate-400"
      } animate-pulse`;
    }
  }

  function uid() {
    if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
    return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  function monthKeyFromDate(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${yyyy}-${mm}`;
  }

  function formatMonthKey(monthKey) {
    // monthKey: YYYY-MM
    const [y, m] = monthKey.split("-");
    const date = new Date(Number(y), Number(m) - 1, 1);
    return date.toLocaleString(undefined, { year: "numeric", month: "long" });
  }

  function fmtINR(amount) {
    const n = Number(amount || 0);
    // Keep it clean for dashboards; integer INR amounts
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(n);
  }

  function fmtDate(dateStr) {
    if (!dateStr) return '';
    // Convert YYYY-MM-DD to DD/MM/YYYY
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return dateStr;
  }

  function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function makeDefaultTenantInputs() {
    // Allows user to enter each tenant's components.
    return Array.from({ length: TENANT_COUNT }, () => ({
      baseRent: 0,
      previousElectricityReading: 0,
      previousElectricityDate: '',
      currentElectricityReading: 0,
      currentElectricityDate: '',
      notes: '',
    }));
  }

  function makeDefaultOccupiedFlags() {
    // Default: all occupied (common bill sharing makes UX more realistic).
    return Array.from({ length: TENANT_COUNT }, () => true);
  }

  function loadCalculationsHistory() {
    const data = safeParseJSON(localStorage.getItem(LS.calculationsHistory), { entries: [] });
    if (!data || typeof data !== "object") return { entries: [] };
    if (!Array.isArray(data.entries)) data.entries = [];
    return data;
  }

  function saveCalculationsHistory(history) {
    localStorage.setItem(LS.calculationsHistory, JSON.stringify(history));
    // Async cloud save
    if (fb.isCloudEnabled && fb.user) {
      cloudSave("calculationsHistory", history).catch(() => {});
    }
  }

  function loadActiveCalcByMonth() {
    const data = safeParseJSON(localStorage.getItem(LS.activeCalcByMonth), {});
    if (!data || typeof data !== "object") return {};
    return data;
  }

  function saveActiveCalcByMonth(map) {
    localStorage.setItem(LS.activeCalcByMonth, JSON.stringify(map));
    // Async cloud save
    if (fb.isCloudEnabled && fb.user) {
      cloudSave("activeCalcByMonth", map).catch(() => {});
    }
  }

  function loadPaymentsByMonth() {
    const data = safeParseJSON(localStorage.getItem(LS.paymentsByMonth), {});
    if (!data || typeof data !== "object") return {};
    return data;
  }

  function savePaymentsByMonth(map) {
    localStorage.setItem(LS.paymentsByMonth, JSON.stringify(map));
    // Async cloud save
    if (fb.isCloudEnabled && fb.user) {
      cloudSave("paymentsByMonth", map).catch(() => {});
    }
  }

  function defaultPaymentFlags() {
    return {
      roomRentPaid: false,
      electricityPaid: false,
      waterPaid: false,
    };
  }

  function computeBills({ tenantInputs, occupiedFlags, totalCommonBill }) {
    const occupiedCount = occupiedFlags.reduce((acc, v) => acc + (v ? 1 : 0), 0);
    const perOccupiedWaterShare = occupiedCount > 0 ? totalCommonBill / occupiedCount : 0;

    const bills = tenantInputs.map((t, idx) => {
      const rent = toNumber(t.baseRent);
      const previousReading = toNumber(t.previousElectricityReading);
      const currentReading = toNumber(t.currentElectricityReading);
      const electricityUnits = Math.max(0, currentReading - previousReading);
      const electricityAmount = electricityUnits * ELECTRICITY_RATE_INR;
      const sharedWaterAmount = occupiedFlags[idx] ? perOccupiedWaterShare : 0;
      const total = rent + electricityAmount + sharedWaterAmount;

      return {
        tenantId: idx,
        electricityRateInr: ELECTRICITY_RATE_INR,
        rentAmount: rent,
        previousElectricityReading: previousReading,
        previousElectricityDate: t.previousElectricityDate || '',
        currentElectricityReading: currentReading,
        currentElectricityDate: t.currentElectricityDate || '',
        electricityUnits,
        electricityAmount,
        sharedWaterAmount,
        notes: t.notes || '',
        total,
      };
    });

    return {
      occupiedCount,
      perOccupiedWaterShare,
      bills,
    };
  }

  function computeRemaining(bill, paymentFlags) {
    const p = paymentFlags || defaultPaymentFlags();
    const rentPaid = p.roomRentPaid ? bill.rentAmount : 0;
    const electricityPaid = p.electricityPaid ? bill.electricityAmount : 0;
    const waterPaid = p.waterPaid ? bill.sharedWaterAmount : 0;
    const paid = rentPaid + electricityPaid + waterPaid;
    const remaining = bill.total - paid;
    // Avoid negative due to floating-point quirks.
    return Math.max(0, remaining);
  }

  function isFullyPaid(bill, paymentFlags) {
    const remaining = computeRemaining(bill, paymentFlags);
    return remaining <= 0.00001;
  }

  function isPending(bill, paymentFlags) {
    const remaining = computeRemaining(bill, paymentFlags);
    return remaining >= bill.total - 0.00001 && bill.total > 0;
  }

  function isPartial(bill, paymentFlags) {
    const remaining = computeRemaining(bill, paymentFlags);
    return bill.total > 0 && remaining > 0.00001 && remaining < bill.total - 0.00001;
  }

  function ensurePaymentsForMonth(monthKey) {
    const all = loadPaymentsByMonth();
    if (!all[monthKey]) all[monthKey] = {};
    for (let i = 0; i < TENANT_COUNT; i++) {
      if (!all[monthKey][i]) all[monthKey][i] = defaultPaymentFlags();
    }
    savePaymentsByMonth(all);
    return all;
  }

  function getActiveCalculationEntry(monthKey) {
    const activeMap = loadActiveCalcByMonth();
    const activeId = activeMap[monthKey];
    if (!activeId) return null;
    const history = loadCalculationsHistory();
    return history.entries.find((e) => e.id === activeId) || null;
  }

  function getHistoryEntriesForMonth(monthKey) {
    const history = loadCalculationsHistory();
    const list = history.entries
      .filter((e) => e.monthKey === monthKey)
      .sort((a, b) => b.createdAt - a.createdAt);
    return list;
  }

  function setToast(text) {
    const el = $("#toast");
    el.textContent = text;
    el.classList.remove("hidden");
    window.clearTimeout(setToast._t);
    setToast._t = window.setTimeout(() => {
      el.classList.add("hidden");
    }, 1400);
  }

  function safeClipboardWrite(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    // Fallback
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "-9999px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand("copy");
      document.body.removeChild(ta);
      return Promise.resolve();
    } catch (e) {
      document.body.removeChild(ta);
      return Promise.reject(e);
    }
  }

  // ---------- App State ----------
  const state = {
    monthKey: "",
    draftTenantInputs: makeDefaultTenantInputs(),
    draftOccupiedFlags: makeDefaultOccupiedFlags(),
    draftTotalCommonBill: 0,
    computedBills: null,
    activeCalculation: null,
    dashboardTab: "all", // all | pending | partial
  };

  // ---------- Rendering: shared ----------
  function setNavActive(page) {
    const navCalculator = $("#navCalculator");
    const navDashboard = $("#navDashboard");
    const navReset = $("#navReset");
    const isCalculator = page === "calculator";
    const isDashboard = page === "dashboard";
    const isReset = page === "reset";

    if (isCalculator) {
      navCalculator.classList.add("bg-slate-900", "text-white", "shadow-soft");
      navCalculator.classList.remove("bg-white", "text-slate-800", "border", "border-slate-300");
      navCalculator.setAttribute("aria-pressed", "true");
      navDashboard.classList.remove("bg-slate-900", "text-white", "shadow-soft");
      navDashboard.classList.add("bg-white", "text-slate-800", "border", "border-slate-300");
      navDashboard.setAttribute("aria-pressed", "false");
      navReset.classList.remove("bg-slate-900", "text-white", "shadow-soft");
      navReset.classList.add("bg-white", "text-slate-800", "border", "border-slate-300");
      navReset.setAttribute("aria-pressed", "false");
      $("#page-calculator").classList.remove("hidden");
      $("#page-dashboard").classList.add("hidden");
      $("#page-reset").classList.add("hidden");
    } else if (isDashboard) {
      navDashboard.classList.add("bg-slate-900", "text-white", "shadow-soft");
      navDashboard.classList.remove("bg-white", "text-slate-800", "border", "border-slate-300");
      navDashboard.setAttribute("aria-pressed", "true");
      navCalculator.classList.remove("bg-slate-900", "text-white", "shadow-soft");
      navCalculator.classList.add("bg-white", "text-slate-800", "border", "border-slate-300");
      navCalculator.setAttribute("aria-pressed", "false");
      $("#page-dashboard").classList.remove("hidden");
      $("#page-calculator").classList.add("hidden");
      navReset.classList.remove("bg-slate-900", "text-white", "shadow-soft");
      navReset.classList.add("bg-white", "text-slate-800", "border", "border-slate-300");
      navReset.setAttribute("aria-pressed", "false");
      $("#page-reset").classList.add("hidden");
    } else if (isReset) {
      navReset.classList.add("bg-slate-900", "text-white", "shadow-soft");
      navReset.classList.remove("bg-white", "text-slate-800", "border", "border-slate-300");
      navReset.setAttribute("aria-pressed", "true");
      navCalculator.classList.remove("bg-slate-900", "text-white", "shadow-soft");
      navCalculator.classList.add("bg-white", "text-slate-800", "border", "border-slate-300");
      navCalculator.setAttribute("aria-pressed", "false");
      navDashboard.classList.remove("bg-slate-900", "text-white", "shadow-soft");
      navDashboard.classList.add("bg-white", "text-slate-800", "border", "border-slate-300");
      navDashboard.setAttribute("aria-pressed", "false");
      $("#page-reset").classList.remove("hidden");
      $("#page-dashboard").classList.add("hidden");
      $("#page-calculator").classList.add("hidden");
    }
  }

  function renderOccupiedCheckboxes() {
    const container = $("#occupiedCheckboxes");
    container.innerHTML = "";
    for (let i = 0; i < TENANT_COUNT; i++) {
      const idx = i;
      const checked = !!state.draftOccupiedFlags[idx];
      const label = `Room ${idx + 1}`;
      const wrapper = document.createElement("label");
      wrapper.className = "flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 cursor-pointer hover:bg-slate-50";

      const input = document.createElement("input");
      input.type = "checkbox";
      input.className = "accent-slate-900";
      input.checked = checked;
      input.addEventListener("change", () => {
        state.draftOccupiedFlags[idx] = input.checked;
        renderOccupiedCount();
        // Update calculator preview on occupancy changes.
        recomputeDraftBills();
      });

      const span = document.createElement("span");
      span.className = "text-sm text-slate-700";
      span.textContent = label;

      const dot = document.createElement("span");
      dot.className = `w-2.5 h-2.5 rounded-full ${checked ? "bg-emerald-500" : "bg-slate-400"}`;

      input.addEventListener("change", () => {
        dot.className = `w-2.5 h-2.5 rounded-full ${input.checked ? "bg-emerald-500" : "bg-slate-400"}`;
      });

      wrapper.appendChild(input);
      wrapper.appendChild(dot);
      wrapper.appendChild(span);
      container.appendChild(wrapper);
    }
    renderOccupiedCount();
  }

  function renderOccupiedCount() {
    const occupiedCount = state.draftOccupiedFlags.reduce((acc, v) => acc + (v ? 1 : 0), 0);
    $("#occupiedCount").textContent = String(occupiedCount);
  }

  function renderCalculatorHistory() {
    const list = getHistoryEntriesForMonth(state.monthKey).slice(0, 5);
    const container = $("#calcHistory");

    if (list.length === 0) {
      container.innerHTML = `<div class="text-sm text-slate-600">No previous calculations found for this month.</div>`;
      return;
    }

    const itemsHtml = list
      .map((e) => {
        const d = new Date(e.createdAt);
        const time = d.toLocaleString(undefined, {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        });
        return `
          <div class="flex items-center justify-between gap-3 w-full sm:w-auto p-3 rounded-xl border border-slate-200 bg-white">
            <div class="min-w-0">
              <div class="text-sm font-semibold text-slate-900">Calculated</div>
              <div class="text-xs text-slate-600 truncate">${time}</div>
            </div>
            <button
              class="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-900 text-white hover:bg-slate-800 transition"
              type="button"
              data-load-calc="${e.id}"
            >
              Load
            </button>
          </div>
        `;
      })
      .join("");

    container.innerHTML = `<div class="flex flex-col sm:flex-row gap-2 sm:items-center w-full">${itemsHtml}</div>`;

    $$("[data-load-calc]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-load-calc");
        const entry = loadCalculationsHistory().entries.find((x) => x.id === id);
        if (!entry) return;

        // Load into draft
        state.draftTotalCommonBill = entry.totalCommonBill || 0;
        state.draftOccupiedFlags = Array.isArray(entry.occupiedFlags)
          ? entry.occupiedFlags.slice(0, TENANT_COUNT)
          : makeDefaultOccupiedFlags();
        state.draftTenantInputs = Array.isArray(entry.tenantInputs) ? entry.tenantInputs : makeDefaultTenantInputs();

        // Update input elements
        $("#commonBillInput").value = String(state.draftTotalCommonBill);
        renderOccupiedCheckboxes();
        recomputeDraftBills();

        // Make this the active calculation for dashboard
        const activeMap = loadActiveCalcByMonth();
        activeMap[state.monthKey] = entry.id;
        saveActiveCalcByMonth(activeMap);
        state.activeCalculation = entry;
        setToast("Loaded previous calculation");
      });
    });
  }

  function renderCalculatorTenants() {
    const container = $("#calculator-tenants");
    container.innerHTML = "";
    const computed = state.computedBills?.bills || [];

    for (let i = 0; i < TENANT_COUNT; i++) {
      const tenant = state.draftTenantInputs[i];
      const bill = computed[i] || null;

      const card = document.createElement("div");
      card.className = "rounded-2xl border border-slate-200 bg-white p-4 hover:shadow-soft transition";

      const previousReading = toNumber(tenant.previousElectricityReading);
      const currentReading = toNumber(tenant.currentElectricityReading);
      const calculatedUnits = Math.max(0, currentReading - previousReading);

      card.innerHTML = `
        <div class="h-2 -mx-4 -mt-4 rounded-t-2xl bg-gradient-to-r from-slate-400 to-slate-600 opacity-30"></div>
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="text-sm font-semibold text-slate-900">Room ${i + 1}</div>
          </div>
          <div class="text-right">
            <div class="text-xs text-slate-500">Total</div>
            <div class="text-lg font-bold text-slate-900">${fmtINR(bill ? bill.total : 0)}</div>
          </div>
        </div>

        <div class="mt-4 grid grid-cols-1 gap-3">
          <div>
            <label class="text-xs font-medium text-slate-700" for="t-${i}-rent">Base Room Rent (INR)</label>
            <input
              id="t-${i}-rent"
              type="number"
              inputmode="numeric"
              min="0"
              step="1"
              class="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              value="${tenant.baseRent}"
            />
          </div>

          <div class="mt-3 p-3 rounded-lg bg-indigo-50 border border-indigo-200">
            <div class="text-xs font-semibold text-indigo-900 mb-3">Electricity Meter Readings</div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="text-xs font-medium text-slate-700" for="t-${i}-prev-elec">Previous Reading</label>
                <input
                  id="t-${i}-prev-elec"
                  type="number"
                  inputmode="decimal"
                  min="0"
                  step="0.1"
                  class="mt-1 w-full border border-indigo-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  value="${tenant.previousElectricityReading}"
                  placeholder="0"
                />
                <input
                  id="t-${i}-prev-elec-date"
                  type="date"
                  class="mt-1 w-full border border-indigo-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  value="${tenant.previousElectricityDate}"
                />
              </div>
              <div>
                <label class="text-xs font-medium text-slate-700" for="t-${i}-curr-elec">Current Reading</label>
                <input
                  id="t-${i}-curr-elec"
                  type="number"
                  inputmode="decimal"
                  min="0"
                  step="0.1"
                  class="mt-1 w-full border border-indigo-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  value="${tenant.currentElectricityReading}"
                  placeholder="0"
                />
                <input
                  id="t-${i}-curr-elec-date"
                  type="date"
                  class="mt-1 w-full border border-indigo-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  value="${tenant.currentElectricityDate}"
                />
              </div>
            </div>
            <div class="mt-2 text-xs text-indigo-700 font-semibold">
              Units Used: ${calculatedUnits.toFixed(1)} × ${ELECTRICITY_RATE_INR} INR = ${fmtINR(bill ? bill.electricityAmount : 0)}
            </div>
            ${tenant.previousElectricityDate ? `<div class="mt-1 text-xs text-indigo-600">Last Reading: ${fmtDate(tenant.previousElectricityDate)}</div>` : ''}
            ${tenant.currentElectricityDate ? `<div class="mt-1 text-xs text-indigo-600">Current Reading: ${fmtDate(tenant.currentElectricityDate)}</div>` : ''}
          </div>



          <div class="mt-2 p-3 rounded-lg border border-slate-200 bg-slate-50">
            <div class="text-xs font-medium text-slate-600 mb-2">Notes</div>
            <textarea
              id="t-${i}-notes"
              class="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              rows="3"
              placeholder="Record electricity readings with dates or any notes..."
            ></textarea>
          </div>
        </div>

        <div class="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div class="flex justify-between text-xs text-slate-600">
            <span>Room Rent</span>
            <span class="font-semibold text-slate-800">${fmtINR(bill ? bill.rentAmount : 0)}</span>
          </div>
          <div class="mt-1 flex justify-between text-xs text-slate-600">
            <span>Electricity (${ELECTRICITY_RATE_INR}/unit)</span>
            <span class="font-semibold text-slate-800">${fmtINR(bill ? bill.electricityAmount : 0)}</span>
          </div>
          <div class="mt-1 flex justify-between text-xs text-slate-600">
            <span>Water (Shared)</span>
            <span class="font-semibold text-slate-800">${fmtINR(bill ? bill.sharedWaterAmount : 0)}</span>
          </div>
          <div class="mt-2 pt-2 border-t border-slate-200 flex justify-between text-sm">
            <span class="font-semibold text-slate-800">Total Due</span>
            <span class="font-extrabold text-slate-900">${fmtINR(bill ? bill.total : 0)}</span>
          </div>
        </div>
      `;

      container.appendChild(card);

      // Input handlers
      const rentEl = $(`#t-${i}-rent`);
      const prevElecEl = $(`#t-${i}-prev-elec`);
      const prevElecDateEl = $(`#t-${i}-prev-elec-date`);
      const currElecEl = $(`#t-${i}-curr-elec`);
      const currElecDateEl = $(`#t-${i}-curr-elec-date`);

      const attach = (el, updater) => {
        el.addEventListener("input", () => {
          updater();
          queueRecompute();
        });
      };

      attach(rentEl, () => {
        state.draftTenantInputs[i].baseRent = toNumber(rentEl.value);
      });
      attach(prevElecEl, () => {
        state.draftTenantInputs[i].previousElectricityReading = toNumber(prevElecEl.value);
      });
      attach(prevElecDateEl, () => {
        state.draftTenantInputs[i].previousElectricityDate = prevElecDateEl.value;
      });
      attach(currElecEl, () => {
        state.draftTenantInputs[i].currentElectricityReading = toNumber(currElecEl.value);
      });
      attach(currElecDateEl, () => {
        state.draftTenantInputs[i].currentElectricityDate = currElecDateEl.value;
      });
    }
  }

  // ---------- Rendering: Dashboard ----------
  function renderDashboardMeta() {
    const container = $("#dashboardMeta");
    const calc = state.activeCalculation;
    if (!calc) {
      container.innerHTML = `
        <div>
          No bills saved for this month yet. Go to <span class="font-semibold">Calculator</span> to compute and save bills.
        </div>
      `;
      return;
    }

    const d = new Date(calc.createdAt);
    const created = d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    const occupiedCount = calc.occupiedFlags?.reduce((acc, v) => acc + (v ? 1 : 0), 0) || 0;

    container.innerHTML = `
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          Active calculation: <span class="font-semibold">${created}</span>
        </div>
        <div class="text-xs text-slate-600">
          Water Bill: <span class="font-semibold">${fmtINR(calc.totalCommonBill || 0)}</span> • Occupied Rooms: <span class="font-semibold">${occupiedCount}</span>
        </div>
      </div>
    `;
  }

  function renderDashboardTenants() {
    const container = $("#dashboard-tenants");
    container.innerHTML = "";
    const calc = state.activeCalculation;

    if (!calc || !Array.isArray(calc.bills)) {
      container.innerHTML = `
        <div class="col-span-full">
          <div class="p-5 rounded-2xl border border-slate-200 bg-slate-50 text-slate-700">
            <div class="font-semibold">Nothing to show yet</div>
            <div class="text-sm mt-1">Save bills from the Calculator for this month.</div>
          </div>
        </div>
      `;
      return;
    }

    const paymentsByMonth = loadPaymentsByMonth();
    const monthPayments = paymentsByMonth[state.monthKey] || {};
    const bills = calc.bills;

    const listWithStatus = bills
      .map((bill) => {
        const paymentFlags = monthPayments[bill.tenantId] || defaultPaymentFlags();
        const remaining = computeRemaining(bill, paymentFlags);
        const fullyPaid = isFullyPaid(bill, paymentFlags);
        const pending = isPending(bill, paymentFlags);
        const partial = isPartial(bill, paymentFlags);
        return {
          bill,
          paymentFlags,
          remaining,
          status: fullyPaid ? "paid" : pending ? "pending" : partial ? "partial" : "other",
        };
      })
      .filter((x) => {
        if (state.dashboardTab === "all") return true;
        if (state.dashboardTab === "pending") return x.status === "pending";
        // In "Partially Paid", allow marking components for both pending + already-partial tenants.
        if (state.dashboardTab === "partial") return x.status !== "paid";
        return true;
      });

    if (listWithStatus.length === 0) {
      container.innerHTML = `<div class="p-5 text-sm text-slate-600">No tenants match this filter.</div>`;
      return;
    }

    for (const item of listWithStatus) {
      const { bill, paymentFlags, remaining, status } = item;
      const tenantName = `Room ${bill.tenantId + 1}`;

      const tone =
        status === "paid"
          ? {
              border: "border-emerald-200",
              headerBg: "bg-emerald-50",
              headerText: "text-emerald-900",
              badge: "Paid",
              progressColor: "bg-emerald-500",
              remainingText: "text-emerald-800",
            }
          : status === "pending"
            ? {
              border: "border-rose-200",
              headerBg: "bg-rose-50",
              headerText: "text-rose-900",
              badge: "Pending",
              progressColor: "bg-rose-500",
              remainingText: "text-rose-800",
              }
            : {
              border: "border-amber-200",
              headerBg: "bg-amber-50",
              headerText: "text-amber-900",
              badge: "Partially Paid",
              progressColor: "bg-amber-500",
              remainingText: "text-amber-900",
              };

      const paidAmount = Math.max(0, bill.total - remaining);
      const paidPercent = bill.total > 0 ? Math.min(100, (paidAmount / bill.total) * 100) : 0;
      const shareText = [
        `Monthly Rent & Utilities - ${state.monthKey}`,
        `${tenantName}`,
        `Rent: ${Math.round(bill.rentAmount)}`,
        `Electricity: ${Math.round(bill.electricityAmount)}`,
        `Total: ${Math.round(bill.total)}`,
      ].join("\n");
      const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`;

      const card = document.createElement("div");
      card.className = `group rounded-2xl border ${tone.border} bg-white p-4 shadow-sm hover:shadow-soft transition`;

      card.innerHTML = `
        <div class="h-2 -mx-4 -mt-4 rounded-t-2xl ${tone.headerBg}"></div>
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <div class="text-sm font-semibold text-slate-900 truncate">${tenantName}</div>
              <span class="inline-flex items-center rounded-full px-3 py-1 text-xs border ${tone.border} ${tone.headerBg} ${tone.headerText}">
                ${tone.badge}
              </span>
            </div>
            <div class="mt-1 text-xs text-slate-600">
              Total Due: <span class="font-semibold text-slate-800">${fmtINR(bill.total)}</span>
            </div>
            <div class="mt-1 text-xs text-slate-600">
              Remaining: <span class="font-semibold ${tone.remainingText}">${fmtINR(remaining)}</span>
            </div>

            <div class="mt-2">
              <div class="flex items-center justify-between text-[11px] text-slate-500">
                <span>Paid</span>
                <span>${Math.round(paidPercent)}%</span>
              </div>
              <div class="mt-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
                <div class="h-2.5 ${tone.progressColor}" style="width:${paidPercent}%;"></div>
              </div>
              <div class="mt-1 text-[11px] text-slate-500">
                Paid Amount: <span class="font-semibold text-slate-700">${fmtINR(paidAmount)}</span>
              </div>
            </div>
          </div>
          <div class="text-right">
            <div class="text-xs text-slate-500">Total</div>
            <div class="text-lg font-bold text-slate-900">${fmtINR(bill.total)}</div>
          </div>
        </div>

        <div class="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div class="grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
            <div class="text-slate-600">Rent</div>
            <div class="text-slate-800 font-semibold text-right">${fmtINR(bill.rentAmount)}</div>
            <div class="text-slate-600">Electricity</div>
            <div class="text-slate-800 font-semibold text-right">${fmtINR(bill.electricityAmount)}</div>
            <div class="text-slate-600">Water (Shared)</div>
            <div class="text-slate-800 font-semibold text-right">${fmtINR(bill.sharedWaterAmount)}</div>
            <div class="text-slate-600">Total</div>
            <div class="text-slate-900 font-extrabold text-right">${fmtINR(bill.total)}</div>
          </div>
          <div class="mt-3 pt-3 border-t border-slate-300 space-y-1 text-xs">
            ${bill.previousElectricityDate ? `<div class="text-slate-600">Last Reading: <span class="font-semibold text-slate-800">${bill.previousElectricityReading}</span> on <span class="font-semibold">${fmtDate(bill.previousElectricityDate)}</span></div>` : ''}
            ${bill.currentElectricityDate ? `<div class="text-slate-600">Current Reading: <span class="font-semibold text-slate-800">${bill.currentElectricityReading}</span> on <span class="font-semibold">${fmtDate(bill.currentElectricityDate)}</span></div>` : ''}
          </div>
          ${bill.notes ? `<div class="mt-3 pt-3 border-t border-slate-300">
            <div class="text-xs font-semibold text-slate-700 mb-1">Notes</div>
            <div class="text-xs text-slate-600 whitespace-pre-wrap break-words">${bill.notes}</div>
          </div>` : ''}
        </div>

        <div class="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="shareBtn px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-900 text-white hover:bg-slate-800 transition"
              data-tenant="${bill.tenantId}"
            >
              Share
            </button>
            <a
              href="${whatsappUrl}"
              target="_blank"
              rel="noreferrer"
              class="px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-slate-300 text-slate-800 hover:bg-slate-50 transition"
            >
              WhatsApp
            </a>
          </div>

          <div>
            ${
              status !== "paid" && state.dashboardTab === "all"
                ? `<button
                    type="button"
                    class="markPaidBtn px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition"
                    data-tenant="${bill.tenantId}"
                  >
                    Mark Fully Paid
                  </button>`
                : ""
            }
          </div>
        </div>

        ${
          state.dashboardTab === "partial"
            ? `
          <div class="mt-4">
            <div class="text-sm font-semibold text-slate-900 mb-2">Partial Payment Components</div>
            <div class="grid grid-cols-1 gap-2">
              <label class="flex items-start gap-2 rounded-xl border px-3 py-2 cursor-pointer hover:bg-slate-50 w-full overflow-hidden break-words ${
                paymentFlags.roomRentPaid ? "bg-emerald-50 border-emerald-200" : "bg-white border-slate-200"
              }">
                <input type="checkbox" class="componentCb accent-emerald-600 mt-[2px]" data-kind="roomRentPaid" ${paymentFlags.roomRentPaid ? "checked" : ""} />
                <span class="text-xs sm:text-sm leading-snug ${paymentFlags.roomRentPaid ? "text-emerald-900" : "text-slate-700"}">Room Rent Paid</span>
              </label>
              <label class="flex items-start gap-2 rounded-xl border px-3 py-2 cursor-pointer hover:bg-slate-50 w-full overflow-hidden break-words ${
                paymentFlags.electricityPaid ? "bg-amber-50 border-amber-200" : "bg-white border-slate-200"
              }">
                <input type="checkbox" class="componentCb accent-amber-500 flex-shrink-0 mt-[2px]" data-kind="electricityPaid" ${paymentFlags.electricityPaid ? "checked" : ""} />
                <span class="text-xs sm:text-sm leading-snug ${paymentFlags.electricityPaid ? "text-amber-900" : "text-slate-700"}">Electricity Paid</span>
              </label>
              <label class="flex items-start gap-2 rounded-xl border px-3 py-2 cursor-pointer hover:bg-slate-50 w-full overflow-hidden break-words ${
                paymentFlags.waterPaid ? "bg-sky-50 border-sky-200" : "bg-white border-slate-200"
              }">
                <input type="checkbox" class="componentCb accent-sky-500 flex-shrink-0 mt-[2px]" data-kind="waterPaid" ${paymentFlags.waterPaid ? "checked" : ""} />
                <span class="text-xs sm:text-sm leading-snug ${paymentFlags.waterPaid ? "text-sky-900" : "text-slate-700"}">Water Paid</span>
              </label>
            </div>
          </div>
        `
            : ""
        }
      `;

      container.appendChild(card);

      // Share copy handler
      const shareBtn = card.querySelector(".shareBtn");
      shareBtn.addEventListener("click", async () => {
        try {
          await safeClipboardWrite(shareText);
          setToast("Share text copied");
        } catch {
          setToast("Copy failed. You can use WhatsApp instead.");
        }
      });

      // Mark Fully Paid handler
      const markPaidBtn = card.querySelector(".markPaidBtn");
      if (markPaidBtn) {
        markPaidBtn.addEventListener("click", () => {
          const tenantId = Number(markPaidBtn.getAttribute("data-tenant"));
          const payments = ensurePaymentsForMonth(state.monthKey);
          payments[state.monthKey][tenantId] = {
            roomRentPaid: true,
            electricityPaid: true,
            waterPaid: true,
          };
          savePaymentsByMonth(payments);
          // Smooth color transition: animate this card for 1s, then re-render.
          card.classList.add("paid-transition");
          setTimeout(() => {
            renderDashboardMeta();
            renderDashboardTenants();
          }, 500);
          setToast("Marked fully paid");
        });
      }

      // Partial component toggle handler
      const componentCbs = card.querySelectorAll(".componentCb");
      componentCbs.forEach((cb) => {
        cb.addEventListener("change", () => {
          const tenantId = bill.tenantId;
          const kind = cb.getAttribute("data-kind");
          const payments = ensurePaymentsForMonth(state.monthKey);
          const current = payments[state.monthKey][tenantId] || defaultPaymentFlags();
          current[kind] = cb.checked;
          payments[state.monthKey][tenantId] = current;
          savePaymentsByMonth(payments);
          renderDashboardTenants();
        });
      });
    }
  }

  // ---------- Reset payments ----------
  function renderResetMeta() {
    const container = $("#resetMeta");
    const calc = state.activeCalculation;
    if (!calc || !Array.isArray(calc.bills)) {
      container.textContent = `No saved bills for this month. Save bills from Calculator first.`;
      return;
    }

    const paymentsByMonth = loadPaymentsByMonth();
    const monthPayments = paymentsByMonth[state.monthKey] || {};
    const bills = calc.bills;

    let fullyPaid = 0;
    let pending = 0;
    let partial = 0;
    for (const bill of bills) {
      const paymentFlags = monthPayments[bill.tenantId] || defaultPaymentFlags();
      if (isFullyPaid(bill, paymentFlags)) fullyPaid += 1;
      else if (isPending(bill, paymentFlags)) pending += 1;
      else if (isPartial(bill, paymentFlags)) partial += 1;
    }

    container.innerHTML = `Month: <span class="font-semibold">${state.monthKey}</span> • Fully Paid: <span class="font-semibold text-emerald-700">${fullyPaid}</span> • Pending: <span class="font-semibold text-red-700">${pending}</span> • Partially Paid: <span class="font-semibold text-amber-800">${partial}</span>`;
  }

  function resetPaymentsForActiveMonth() {
    const map = loadPaymentsByMonth();
    map[state.monthKey] = {};
    savePaymentsByMonth(map);
  }

  function resetAllDataForActiveMonth() {
    // 1) Clear payment statuses for month
    const paymentsMap = loadPaymentsByMonth();
    if (paymentsMap && typeof paymentsMap === "object") delete paymentsMap[state.monthKey];
    savePaymentsByMonth(paymentsMap);

    // 2) Remove active calculation mapping for month
    const activeMap = loadActiveCalcByMonth();
    if (activeMap && typeof activeMap === "object") delete activeMap[state.monthKey];
    saveActiveCalcByMonth(activeMap);

    // 3) Remove calculation history entries for month
    const history = loadCalculationsHistory();
    history.entries = Array.isArray(history.entries) ? history.entries.filter((e) => e.monthKey !== state.monthKey) : [];
    saveCalculationsHistory(history);

    // 4) Reset in-memory state for current view
    state.activeCalculation = null;
    state.computedBills = null;
    state.draftTenantInputs = makeDefaultTenantInputs();
    state.draftOccupiedFlags = makeDefaultOccupiedFlags();
    state.draftTotalCommonBill = 0;
  }

  // ---------- Backup / Restore ----------
  function buildBackupObject() {
    return {
      version: 1,
      exportedAt: Date.now(),
      data: {
        calculationsHistory: loadCalculationsHistory(),
        activeCalcByMonth: loadActiveCalcByMonth(),
        paymentsByMonth: loadPaymentsByMonth(),
        lastMonthKey: localStorage.getItem(LS.lastMonthKey) || null,
      },
    };
  }

  function applyBackupObject(obj) {
    if (!obj || typeof obj !== "object" || !obj.data) throw new Error("Invalid backup file");
    const { calculationsHistory, activeCalcByMonth, paymentsByMonth, lastMonthKey } = obj.data;
    if (calculationsHistory) saveCalculationsHistory(calculationsHistory);
    if (activeCalcByMonth) saveActiveCalcByMonth(activeCalcByMonth);
    if (paymentsByMonth) savePaymentsByMonth(paymentsByMonth);
    if (lastMonthKey) localStorage.setItem(LS.lastMonthKey, lastMonthKey);
  }

  async function downloadBackupFile() {
    const backup = buildBackupObject();
    
    // Save to Firebase if logged in
    if (fb.isCloudEnabled && fb.user) {
      await saveBackupToCloud(backup);
    }
    
    // Also download locally
    const json = JSON.stringify(backup, null, 2);
    const blob = new Blob([json], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const now = new Date();
    const fname = `c-rent-backup-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate()
    ).padStart(2, "0")}.txt`;
    a.href = url;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    setToast("Backup saved locally and to cloud");
  }

  async function restoreFromFile(file) {
    const text = await file.text();
    const parsed = JSON.parse(text);
    applyBackupObject(parsed);
  }

  // ---------- Calculator logic ----------
  let recomputeTimer = null;
  function queueRecompute() {
    window.clearTimeout(recomputeTimer);
    recomputeTimer = window.setTimeout(() => {
      recomputeDraftBills();
    }, 180);
  }

  function recomputeDraftBills() {
    const bills = computeBills({
      tenantInputs: state.draftTenantInputs,
      occupiedFlags: state.draftOccupiedFlags,
      totalCommonBill: state.draftTotalCommonBill,
    });
    state.computedBills = bills;
    renderCalculatorTenants();
  }

  function hydrateDraftFromActiveCalculation(entry) {
    if (!entry) return;
    state.draftTotalCommonBill = toNumber(entry.totalCommonBill);
    state.draftOccupiedFlags = Array.isArray(entry.occupiedFlags)
      ? entry.occupiedFlags.slice(0, TENANT_COUNT).map((v) => !!v)
      : makeDefaultOccupiedFlags();
    state.draftTenantInputs = Array.isArray(entry.tenantInputs)
      ? entry.tenantInputs.slice(0, TENANT_COUNT)
      : makeDefaultTenantInputs();
  }

  function hydrateUIFromDraft() {
    $("#commonBillInput").value = String(state.draftTotalCommonBill);
    renderOccupiedCheckboxes();
    recomputeDraftBills();
    renderCalculatorHistory();
  }

  function resetDraftInputs() {
    state.draftTenantInputs = makeDefaultTenantInputs();
    state.draftOccupiedFlags = makeDefaultOccupiedFlags();
    state.draftTotalCommonBill = 0;
    hydrateUIFromDraft();
  }

  function readDraftInputsFromUI() {
    // Common bill
    state.draftTotalCommonBill = toNumber($("#commonBillInput").value);

    // Tenant fields
    for (let i = 0; i < TENANT_COUNT; i++) {
      const rentEl = $(`#t-${i}-rent`);
      const prevElecEl = $(`#t-${i}-prev-elec`);
      const prevElecDateEl = $(`#t-${i}-prev-elec-date`);
      const currElecEl = $(`#t-${i}-curr-elec`);
      const currElecDateEl = $(`#t-${i}-curr-elec-date`);
      const notesEl = $(`#t-${i}-notes`);
      if (rentEl) state.draftTenantInputs[i].baseRent = toNumber(rentEl.value);
      if (prevElecEl) state.draftTenantInputs[i].previousElectricityReading = toNumber(prevElecEl.value);
      if (prevElecDateEl) state.draftTenantInputs[i].previousElectricityDate = prevElecDateEl.value;
      if (currElecEl) state.draftTenantInputs[i].currentElectricityReading = toNumber(currElecEl.value);
      if (currElecDateEl) state.draftTenantInputs[i].currentElectricityDate = currElecDateEl.value;
      if (notesEl) state.draftTenantInputs[i].notes = notesEl.value;
    }
  }

  function saveDraftToHistoryAndActivate() {
    // Make sure state is current.
    readDraftInputsFromUI();
    recomputeDraftBills();

    const entry = {
      id: uid(),
      monthKey: state.monthKey,
      createdAt: Date.now(),
      totalCommonBill: state.draftTotalCommonBill,
      occupiedFlags: state.draftOccupiedFlags.slice(0, TENANT_COUNT),
      tenantInputs: state.draftTenantInputs.map((t) => ({
        baseRent: toNumber(t.baseRent),
        previousElectricityReading: toNumber(t.previousElectricityReading),
        previousElectricityDate: t.previousElectricityDate || '',
        currentElectricityReading: toNumber(t.currentElectricityReading),
        currentElectricityDate: t.currentElectricityDate || '',
        notes: t.notes || '',
      })),
      bills: state.computedBills.bills,
    };

    const history = loadCalculationsHistory();
    history.entries.push(entry);
    // Trim to keep storage reasonable.
    history.entries = history.entries.sort((a, b) => b.createdAt - a.createdAt).slice(0, 50);
    saveCalculationsHistory(history);

    const activeMap = loadActiveCalcByMonth();
    activeMap[state.monthKey] = entry.id;
    saveActiveCalcByMonth(activeMap);
    state.activeCalculation = entry;

    ensurePaymentsForMonth(state.monthKey);
  }

  // ---------- Wiring ----------
  function renderActivePage() {
    // Calculator always uses draft + computedBills.
    if (state.activeCalculation) {
      // Dashboard uses active calculation
      renderDashboardMeta();
      renderDashboardTenants();
    }
  }

  function setTab(tab) {
    state.dashboardTab = tab;
    $("#tabAll").className =
      tab === "all"
        ? "px-4 py-2 rounded-lg text-sm font-medium bg-slate-900 text-white hover:bg-slate-800 transition"
        : "px-4 py-2 rounded-lg text-sm font-medium bg-white border border-slate-300 text-slate-800 hover:bg-slate-50 transition";
    $("#tabPending").className =
      tab === "pending"
        ? "px-4 py-2 rounded-lg text-sm font-medium bg-slate-900 text-white hover:bg-slate-800 transition"
        : "px-4 py-2 rounded-lg text-sm font-medium bg-white border border-slate-300 text-slate-800 hover:bg-slate-50 transition";
    $("#tabPartial").className =
      tab === "partial"
        ? "px-4 py-2 rounded-lg text-sm font-medium bg-slate-900 text-white hover:bg-slate-800 transition"
        : "px-4 py-2 rounded-lg text-sm font-medium bg-white border border-slate-300 text-slate-800 hover:bg-slate-50 transition";

    renderDashboardTenants();
  }

  // ========== AUTH FUNCTIONS ==========
  // Show signup modal
  function showSignupModal() {
    $("#signupModal").classList.remove("hidden");
    $("#signinModal").classList.add("hidden");
    $("#signupEmail").value = "";
    $("#signupPassword").value = "";
    $("#signupError").classList.add("hidden");
  }

  // Show signin modal
  function showSigninModal() {
    $("#signinModal").classList.remove("hidden");
    $("#signupModal").classList.add("hidden");
    $("#signinEmail").value = "";
    $("#signinPassword").value = "";
    $("#signinError").classList.add("hidden");
  }

  async function handleSignup(email, password) {
    if (!fb.auth) {
      console.error("Firebase auth not initialized");
      return false;
    }

    const signupContent = $("#signupContent");
    const signupLoading = $("#signupLoading");
    const signupError = $("#signupError");

    if (password.length < 6) {
      signupError.textContent = "Password must be at least 6 characters";
      signupError.classList.remove("hidden");
      return false;
    }

    try {
      signupContent.classList.add("hidden");
      signupLoading.classList.remove("hidden");
      signupError.classList.add("hidden");

      // Create user account
      const userCred = await fb.auth.createUserWithEmailAndPassword(email, password);
      console.log("Signup successful:", email);
      
      // Save basic user info to Firebase
      await fb.db.ref(`users/${userCred.user.uid}/profile`).set({
        email: email,
        createdAt: Date.now(),
      });

      setToast("Account created! Please sign in now.");
      // Switch to signin modal
      setTimeout(() => {
        showSigninModal();
      }, 1000);

      return true;
    } catch (e) {
      console.error("Signup error:", e);
      let errorMsg = "Signup failed";
      if (e.code === "auth/email-already-in-use") {
        errorMsg = "Email already in use";
      } else if (e.code === "auth/invalid-email") {
        errorMsg = "Invalid email address";
      } else if (e.code === "auth/weak-password") {
        errorMsg = "Password is too weak";
      }
      signupError.textContent = errorMsg;
      signupError.classList.remove("hidden");
      return false;
    } finally {
      signupLoading.classList.add("hidden");
      signupContent.classList.remove("hidden");
    }
  }

  async function handleSignin(email, password) {
    if (!fb.auth) {
      console.error("Firebase auth not initialized");
      return false;
    }

    const signinContent = $("#signinContent");
    const signinLoading = $("#signinLoading");
    const signinError = $("#signinError");

    try {
      signinContent.classList.add("hidden");
      signinLoading.classList.remove("hidden");
      signinError.classList.add("hidden");

      const userCred = await fb.auth.signInWithEmailAndPassword(email, password);
      console.log("Signin successful:", email);
      
      fb.user = userCred.user;
      fb.isCloudEnabled = true;
      updateSyncStatus("Synced", "emerald");
      
      // Load cloud data
      await syncFromCloud();
      
      $("#signinModal").classList.add("hidden");
      $("#signupModal").classList.add("hidden");
      $("#syncStatus").classList.remove("hidden");
      
      // Update user email in menu
      const userEmailEl = $("#userEmail");
      if (userEmailEl) userEmailEl.textContent = email;

      return true;
    } catch (e) {
      console.error("Signin error:", e);
      let errorMsg = "Sign in failed";
      if (e.code === "auth/user-not-found" || e.code === "auth/invalid-credential") {
        errorMsg = "Invalid email or password";
      } else if (e.code === "auth/invalid-email") {
        errorMsg = "Invalid email address";
      }
      signinError.textContent = errorMsg;
      signinError.classList.remove("hidden");
      return false;
    } finally {
      signinLoading.classList.add("hidden");
      signinContent.classList.remove("hidden");
    }
  }

  async function handleGuestContinue() {
    fb.user = null;
    fb.isCloudEnabled = false;
    $("#signinModal").classList.add("hidden");
    $("#signupModal").classList.add("hidden");
    $("#syncStatus").classList.add("hidden");
    setToast("Using local storage (guest mode)");
  }

  async function cloudLogout() {
    if (!fb.auth) return;
    try {
      await fb.auth.signOut();
      fb.user = null;
      fb.isCloudEnabled = false;
      updateSyncStatus("Offline", "slate");
      showSigninModal();
    } catch (e) {
      console.error("Logout error:", e);
    }
  }

  async function saveBackupToCloud(backupData) {
    if (!fb.isCloudEnabled || !fb.user || !fb.db) {
      console.warn("Cloud backup not available");
      return false;
    }
    try {
      const timestamp = Date.now();
      const ref = fb.db.ref(`users/${fb.user.uid}/backups/${timestamp}`);
      await ref.set(backupData);
      updateSyncStatus("Backup saved", "emerald");
      return true;
    } catch (e) {
      console.error("Cloud backup save failed:", e);
      updateSyncStatus("Backup failed", "red");
      return false;
    }
  }

  async function downloadBackupFromCloud(timestamp) {
    if (!fb.isCloudEnabled || !fb.user || !fb.db) {
      console.warn("Cloud backup not available");
      return null;
    }
    try {
      const snapshot = await fb.db.ref(`users/${fb.user.uid}/backups/${timestamp}`).get();
      return snapshot.val();
    } catch (e) {
      console.error("Cloud backup load failed:", e);
      return null;
    }
  }

  async function setupAuth() {
    if (!fb.auth) {
      console.warn("Firebase auth not available");
      showSignupModal();
      return;
    }

    return new Promise((resolve) => {
      fb.auth.onAuthStateChanged(async (user) => {
        if (user) {
          fb.user = user;
          fb.isCloudEnabled = true;
          updateSyncStatus("Synced", "emerald");
          $("#signinModal").classList.add("hidden");
          $("#signupModal").classList.add("hidden");
          $("#syncStatus").classList.remove("hidden");
          
          // Load cloud data into localStorage
          await syncFromCloud();
          
          // Show user email in menu
          const userEmailEl = $("#userEmail");
          if (userEmailEl) userEmailEl.textContent = user.email || "Cloud User";
          
          console.log("User authenticated:", user.email);
          resolve(true);
        } else {
          fb.user = null;
          fb.isCloudEnabled = false;
          updateSyncStatus("Offline", "slate");
          showSignupModal();
          console.log("No user logged in, showing signup modal");
          resolve(false);
        }
      });
    });
  }

  async function syncToCloud() {
    if (!fb.isCloudEnabled || !fb.user) return;
    try {
      const history = loadCalculationsHistory();
      const active = loadActiveCalcByMonth();
      const payments = loadPaymentsByMonth();
      
      await Promise.all([
        cloudSave("calculationsHistory", history),
        cloudSave("activeCalcByMonth", active),
        cloudSave("paymentsByMonth", payments),
      ]);
    } catch (e) {
      console.error("Sync to cloud failed:", e);
    }
  }

  async function syncFromCloud() {
    if (!fb.isCloudEnabled || !fb.user) return;
    try {
      const cloudHistory = await cloudLoad("calculationsHistory");
      const cloudActive = await cloudLoad("activeCalcByMonth");
      const cloudPayments = await cloudLoad("paymentsByMonth");
      
      if (cloudHistory) {
        localStorage.setItem(LS.calculationsHistory, JSON.stringify(cloudHistory));
      }
      if (cloudActive) {
        localStorage.setItem(LS.activeCalcByMonth, JSON.stringify(cloudActive));
      }
      if (cloudPayments) {
        localStorage.setItem(LS.paymentsByMonth, JSON.stringify(cloudPayments));
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Sync from cloud failed:", e);
    }
  }

  function initEvents() {
    // ========== AUTH EVENTS ==========
    // Signup modal events
    const signupBtn = $("#signupBtn");
    const signupEmail = $("#signupEmail");
    const signupPassword = $("#signupPassword");
    const signupToSigninBtn = $("#signupToSigninBtn");

    if (signupBtn) {
      signupBtn.addEventListener("click", async () => {
        const email = signupEmail.value.trim();
        const password = signupPassword.value.trim();
        if (!email || !password) {
          $("#signupError").textContent = "Please enter email and password";
          $("#signupError").classList.remove("hidden");
          return;
        }
        await handleSignup(email, password);
      });
    }

    if (signupToSigninBtn) {
      signupToSigninBtn.addEventListener("click", () => {
        showSigninModal();
      });
    }

    //Signin modal events
    const signinBtn = $("#signinBtn");
    const signinEmail = $("#signinEmail");
    const signinPassword = $("#signinPassword");
    const signinGuestBtn = $("#signinGuestBtn");
    const signinToSignupBtn = $("#signinToSignupBtn");

    if (signinBtn) {
      signinBtn.addEventListener("click", async () => {
        const email = signinEmail.value.trim();
        const password = signinPassword.value.trim();
        if (!email || !password) {
          $("#signinError").textContent = "Please enter email and password";
          $("#signinError").classList.remove("hidden");
          return;
        }
        await handleSignin(email, password);
      });
    }

    if (signinGuestBtn) {
      signinGuestBtn.addEventListener("click", () => {
        handleGuestContinue();
      });
    }

    if (signinToSignupBtn) {
      signinToSignupBtn.addEventListener("click", () => {
        showSignupModal();
      });
    }

    const userMenuBtn = $("#userMenuBtn");
    const userMenu = $("#userMenu");
    const logoutBtn = $("#logoutBtn");

    if (userMenuBtn) {
      userMenuBtn.addEventListener("click", () => {
        const isHidden = userMenu.classList.contains("hidden");
        userMenu.classList.toggle("hidden");
        userMenuBtn.setAttribute("aria-expanded", isHidden ? "true" : "false");
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener("click", async () => {
        await cloudLogout();
        userMenu.classList.add("hidden");
      });
    }

    // Close menu when clicking outside
    document.addEventListener("click", (e) => {
      if (!userMenuBtn.contains(e.target) && !userMenu.contains(e.target)) {
        userMenu.classList.add("hidden");
        userMenuBtn.setAttribute("aria-expanded", "false");
      }
    });

    $("#navCalculator").addEventListener("click", () => {
      setNavActive("calculator");
    });
    $("#navDashboard").addEventListener("click", () => {
      setNavActive("dashboard");
      renderDashboardMeta();
      renderDashboardTenants();
    });
    $("#navReset").addEventListener("click", () => {
      setNavActive("reset");
      renderResetMeta();
    });

    $("#recalcBtn").addEventListener("click", () => {
      readDraftInputsFromUI();
      recomputeDraftBills();
      setToast("Bills calculated");
    });

    $("#calcResetBtn").addEventListener("click", () => {
      resetDraftInputs();
      setToast("Inputs reset");
    });

    $("#saveBillsBtn").addEventListener("click", () => {
      try {
        saveDraftToHistoryAndActivate();
        setNavActive("dashboard");
        state.dashboardTab = "all";
        setTab("all");
        renderDashboardMeta();
        renderDashboardTenants();
        setToast("Bills saved");
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(e);
        alert("Could not save bills. Please check inputs and try again.");
      }
    });

    $("#resetPaymentsBtn").addEventListener("click", () => {
      const calc = state.activeCalculation;
      if (!calc || !Array.isArray(calc.bills)) {
        setToast("Save bills first, then you can reset payments.");
        return;
      }

      const ok = window.confirm(
        `Reset all payment status for ${state.monthKey}? This will clear the paid/pending/partial component checkboxes, but keep the bills saved.`
      );
      if (!ok) return;

      resetPaymentsForActiveMonth();
      renderResetMeta();
      renderDashboardMeta();
      renderDashboardTenants();
      setToast("Payment statuses reset");
    });

    $("#resetAllBtn").addEventListener("click", () => {
      const ok = window.confirm(
        `Reset EVERYTHING for ${state.monthKey}? This will delete saved bills + all payment statuses for the month.`
      );
      if (!ok) return;

      resetAllDataForActiveMonth();
      // Refresh UI
      hydrateUIFromDraft();
      renderResetMeta();
      renderDashboardMeta();
      renderDashboardTenants();
      setToast("Month data reset");
    });

    // Backup / restore
    const downloadBackupBtn = $("#downloadBackupBtn");
    const restoreBackupBtn = $("#restoreBackupBtn");
    const restoreFileInput = $("#restoreFileInput");

    if (downloadBackupBtn) {
      downloadBackupBtn.addEventListener("click", () => {
        try {
          downloadBackupFile();
          setToast("Backup downloaded");
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error(e);
          alert("Could not create backup file.");
        }
      });
    }

    if (restoreBackupBtn && restoreFileInput) {
      restoreBackupBtn.addEventListener("click", () => {
        restoreFileInput.value = "";
        restoreFileInput.click();
      });

      restoreFileInput.addEventListener("change", async () => {
        const file = restoreFileInput.files?.[0];
        if (!file) return;
        try {
          await restoreFromFile(file);
          // Reload in-memory state from restored storage
          const savedMonth = localStorage.getItem(LS.lastMonthKey);
          const today = monthKeyFromDate(new Date());
          state.monthKey = savedMonth || today;
          $("#monthSelect").value = state.monthKey;

          const active = getActiveCalculationEntry(state.monthKey);
          state.activeCalculation = active;
          if (active) hydrateDraftFromActiveCalculation(active);
          else {
            state.draftTenantInputs = makeDefaultTenantInputs();
            state.draftOccupiedFlags = makeDefaultOccupiedFlags();
            state.draftTotalCommonBill = 0;
          }

          hydrateUIFromDraft();
          renderCalculatorTenants();
          renderDashboardMeta();
          renderDashboardTenants();
          renderResetMeta();
          setToast("Backup restored");
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error(e);
          alert("Invalid or corrupted backup file.");
        }
      });
    }

    $("#tabAll").addEventListener("click", () => setTab("all"));
    $("#tabPending").addEventListener("click", () => setTab("pending"));
    $("#tabPartial").addEventListener("click", () => setTab("partial"));

    $("#monthSelect").addEventListener("change", () => {
      const mk = $("#monthSelect").value;
      if (!mk) return;
      state.monthKey = mk;
      localStorage.setItem(LS.lastMonthKey, mk);
      // Hydrate for selected month.
      const active = getActiveCalculationEntry(mk);
      state.activeCalculation = active;
      state.dashboardTab = "all";
      setNavActive("calculator");

      // Load draft from active calc if it exists; else default.
      if (active) hydrateDraftFromActiveCalculation(active);
      else {
        state.draftTenantInputs = makeDefaultTenantInputs();
        state.draftOccupiedFlags = makeDefaultOccupiedFlags();
        state.draftTotalCommonBill = 0;
      }
      hydrateUIFromDraft();

      // Also update dashboard (if user is there).
      renderDashboardMeta();
      renderDashboardTenants();
    });

    // Logo maximize/minimize modal
    // (Removed - using simplified text-based logo)
  }

  function init() {
    initEvents();
  }

  async function initApp() {
    // Wait for Firebase SDK to load first
    await waitForFirebase();
    
    // Initialize Firebase
    const firebaseReady = initFirebase();
    if (!firebaseReady) {
      console.warn("Firebase not available, using local storage only");
    }
    
    // Setup Firebase auth (if Firebase is ready)
    if (firebaseReady) {
      await setupAuth();
    }

    const savedMonth = localStorage.getItem(LS.lastMonthKey);
    const today = monthKeyFromDate(new Date());
    state.monthKey = savedMonth || today;
    $("#monthSelect").value = state.monthKey;

    const active = getActiveCalculationEntry(state.monthKey);
    state.activeCalculation = active;

    // Default draft:
    if (active) hydrateDraftFromActiveCalculation(active);
    else {
      state.draftTenantInputs = makeDefaultTenantInputs();
      state.draftOccupiedFlags = makeDefaultOccupiedFlags();
      state.draftTotalCommonBill = 0;
    }

    // Initial UI
    hydrateUIFromDraft();
    renderDashboardMeta();
    renderDashboardTenants();
    renderResetMeta();

    // Handle PWA shortcuts and URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const pageParam = urlParams.get('page');
    
    // Start on specified page or default to calculator
    if (pageParam === 'dashboard') {
      setNavActive("dashboard");
      renderDashboardMeta();
      renderDashboardTenants();
    } else if (pageParam === 'reset') {
      setNavActive("reset");
      renderResetMeta();
    } else {
      setNavActive("calculator");
    }
  }

  init();
  initApp().catch((e) => {
    // eslint-disable-next-line no-console
    console.error("App init error:", e);
  });

  // Register service worker for PWA support
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {
        // Service worker registration failed, continue without it
      });
    });
  }
})();

