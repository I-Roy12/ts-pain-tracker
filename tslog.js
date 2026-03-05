(() => {
  const TSLOG_VERSION = "tslog-0.1";
  const TSLOG_TZ = "Asia/Tokyo";
  const STORAGE = {
    userId: "ts:user_id",
    logs: "ts:logs",
    legacyRecords: "ts_pain_records"
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function createUUID() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    const t = Date.now().toString(16);
    const r = Math.random().toString(16).slice(2, 10);
    return `fallback-${t}-${r}`;
  }

  function getTokyoNow() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: TSLOG_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).formatToParts(new Date());
    const map = {};
    parts.forEach((p) => {
      if (p.type !== "literal") map[p.type] = p.value;
    });
    return {
      date: `${map.year}-${map.month}-${map.day}`,
      time: `${map.hour}:${map.minute}`
    };
  }

  function compactDate(date) {
    return (date || "").replace(/-/g, "");
  }

  function isDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value || "");
  }

  function isTime(value) {
    return /^\d{2}:\d{2}$/.test(value || "");
  }

  function clampInt(value, min, max, fallback = 0) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.round(n)));
  }

  function clampNullable(value, min, max) {
    if (value == null || value === "") return null;
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.max(min, Math.min(max, Math.round(n)));
  }

  function defaultInputs() {
    return {
      pli: 0,
      cgi: 0,
      tpi: 0,
      bp_self: null,
      bp_ownership: null,
      bp_mismatch: null,
      sleep_hours: null,
      sleep_quality: null,
      fatigue: null,
      stress: null,
      steps: null,
      notes: ""
    };
  }

  function getUserId() {
    let id = localStorage.getItem(STORAGE.userId);
    if (id) return id;
    id = `local-${createUUID()}`;
    localStorage.setItem(STORAGE.userId, id);
    return id;
  }

  function deriveAlert(inputs) {
    const cgi = clampInt(inputs.cgi, 0, 10, 0);
    const tpi = clampInt(inputs.tpi, 0, 10, 0);
    const mismatch = clampNullable(inputs.bp_mismatch, 0, 10);

    const riskFlags = [];
    if (cgi >= 4) riskFlags.push("cgi_high");
    if (tpi >= 4) riskFlags.push("tpi_high");
    if (mismatch != null && mismatch >= 6) riskFlags.push("bp_mismatch_high");

    let alertLevel = 0;
    if (cgi >= 4 || tpi >= 4) alertLevel = 1;
    if (cgi >= 6 && tpi >= 6) alertLevel = 2;
    if (cgi >= 7 && tpi >= 7 && mismatch != null && mismatch >= 6) alertLevel = 3;

    return { alert_level: alertLevel, risk_flags: riskFlags };
  }

  function normalizeLog(log, fallbackUserId) {
    const now = getTokyoNow();
    const safeInputs = {
      ...defaultInputs(),
      ...(log?.entry?.inputs || {})
    };
    safeInputs.pli = clampInt(safeInputs.pli, 0, 10, 0);
    safeInputs.cgi = clampInt(safeInputs.cgi, 0, 10, 0);
    safeInputs.tpi = clampInt(safeInputs.tpi, 0, 10, 0);
    safeInputs.bp_mismatch = clampNullable(safeInputs.bp_mismatch, 0, 10);
    safeInputs.notes = String(safeInputs.notes || "").slice(0, 300);

    return {
      schema_version: TSLOG_VERSION,
      user: {
        user_id: log?.user?.user_id || fallbackUserId,
        tz: TSLOG_TZ
      },
      entry: {
        id: log?.entry?.id || createUUID(),
        date: isDate(log?.entry?.date) ? log.entry.date : now.date,
        time: isTime(log?.entry?.time) ? log.entry.time : now.time,
        inputs: safeInputs,
        derived: deriveAlert(safeInputs)
      }
    };
  }

  function compareDesc(a, b) {
    const ad = `${a.entry.date} ${a.entry.time}`;
    const bd = `${b.entry.date} ${b.entry.time}`;
    return ad < bd ? 1 : (ad > bd ? -1 : 0);
  }

  function convertLegacyRecord(rec, userId) {
    const now = getTokyoNow();
    const date = isDate(rec?.date) ? rec.date : now.date;
    const time = isTime(rec?.time) ? rec.time : now.time;

    const shoulder = clampNullable(rec?.shoulder, 0, 10);
    const neck = clampNullable(rec?.neck, 0, 10);
    const throat = clampNullable(rec?.throat, 0, 10);
    const lowerBack = clampNullable(rec?.lowerBack, 0, 10);
    const painValues = [shoulder, neck, throat, lowerBack].filter((v) => v != null);

    const pli = painValues.length ? Math.round(painValues.reduce((a, b) => a + b, 0) / painValues.length) : 0;
    const cgi = clampInt(rec?.stress, 0, 10, 0);
    const tpi = throat == null ? pli : throat;

    const legacyNotes = [];
    if (typeof rec?.note === "string" && rec.note.trim()) legacyNotes.push(rec.note.trim());
    if (typeof rec?.interventionNote === "string" && rec.interventionNote.trim()) legacyNotes.push(rec.interventionNote.trim());
    if (!legacyNotes.length) {
      const summary = JSON.stringify(rec || {}).slice(0, 140);
      legacyNotes.push(`旧データ変換: ${summary}`);
    }

    const inputs = {
      ...defaultInputs(),
      pli,
      cgi,
      tpi,
      notes: legacyNotes.join(" / ").slice(0, 300)
    };

    return {
      schema_version: TSLOG_VERSION,
      user: { user_id: userId, tz: TSLOG_TZ },
      entry: {
        id: rec?.id || createUUID(),
        date,
        time,
        inputs,
        derived: deriveAlert(inputs)
      }
    };
  }

  function migrateLegacyRecords(userId) {
    let legacy = [];
    try {
      const raw = localStorage.getItem(STORAGE.legacyRecords);
      if (raw) legacy = JSON.parse(raw);
    } catch {
      legacy = [];
    }
    if (!Array.isArray(legacy) || !legacy.length) return [];

    const daily = new Map();
    legacy.forEach((rec) => {
      try {
        const converted = convertLegacyRecord(rec, userId);
        const key = converted.entry.date;
        const prev = daily.get(key);
        if (!prev || prev.entry.time <= converted.entry.time) {
          daily.set(key, converted);
        }
      } catch {
        const fallback = convertLegacyRecord({ note: `旧データ変換失敗: ${JSON.stringify(rec).slice(0, 120)}` }, userId);
        daily.set(fallback.entry.date, fallback);
      }
    });

    return [...daily.values()].sort(compareDesc);
  }

  function loadLogs() {
    const userId = getUserId();
    let logs = [];

    try {
      const raw = localStorage.getItem(STORAGE.logs);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          logs = parsed.map((item) => normalizeLog(item, userId));
        }
      }
    } catch {
      logs = [];
    }

    if (!logs.length) {
      logs = migrateLegacyRecords(userId);
      if (logs.length) {
        localStorage.setItem(STORAGE.logs, JSON.stringify(logs));
      }
    }

    logs.sort(compareDesc);
    return logs;
  }

  function saveAll(logs) {
    localStorage.setItem(STORAGE.logs, JSON.stringify(logs));
  }

  function saveLog(payload) {
    const userId = getUserId();
    const now = getTokyoNow();
    const logs = loadLogs();
    const idx = logs.findIndex((item) => item.entry.date === now.date);
    const prev = idx >= 0 ? logs[idx] : null;

    const inputs = {
      ...defaultInputs(),
      ...(prev?.entry?.inputs || {})
    };
    inputs.pli = clampInt(payload?.pli, 0, 10, 0);
    inputs.cgi = clampInt(payload?.cgi, 0, 10, 0);
    inputs.tpi = clampInt(payload?.tpi, 0, 10, 0);
    inputs.notes = String(payload?.notes || "").slice(0, 300);

    const entry = {
      id: prev?.entry?.id || createUUID(),
      date: now.date,
      time: now.time,
      inputs,
      derived: deriveAlert(inputs)
    };

    const log = {
      schema_version: TSLOG_VERSION,
      user: { user_id: userId, tz: TSLOG_TZ },
      entry
    };

    if (idx >= 0) {
      logs[idx] = log;
    } else {
      logs.push(log);
    }

    logs.sort(compareDesc);
    saveAll(logs);
    return log;
  }

  function downloadText(filename, text, mimeType) {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportJSON() {
    const now = getTokyoNow();
    const logs = loadLogs();
    const payload = {
      schema_version: TSLOG_VERSION,
      exported_at: new Date().toISOString(),
      user: { user_id: getUserId(), tz: TSLOG_TZ },
      logs
    };
    downloadText(
      `tslogs-export-${compactDate(now.date)}.json`,
      JSON.stringify(payload, null, 2),
      "application/json"
    );
  }

  function alertClass(level) {
    return `alert-level-${Math.max(0, Math.min(3, Number(level) || 0))}`;
  }

  function renderResult(log) {
    const target = byId("tslogResult");
    if (!target) return;
    if (!log) {
      target.textContent = "未保存";
      return;
    }
    const level = log.entry.derived.alert_level;
    const flags = log.entry.derived.risk_flags || [];
    target.innerHTML = `
      <span class="alert-pill ${alertClass(level)}">alert_level: ${level}</span>
      <span>risk_flags: ${flags.length ? flags.join(", ") : "なし"}</span>
    `;
  }

  function renderDetail(log) {
    const target = byId("tslogDetail");
    if (!target) return;
    target.textContent = log ? JSON.stringify(log, null, 2) : "{}";
  }

  function setRangeValue(inputId, valueId, value) {
    const input = byId(inputId);
    const label = byId(valueId);
    if (!input || !label) return;
    input.value = String(value);
    label.textContent = String(value);
  }

  function bindSlider(inputId, valueId) {
    const input = byId(inputId);
    const label = byId(valueId);
    if (!input || !label) return;
    input.addEventListener("input", () => {
      label.textContent = input.value;
    });
  }

  function renderToday() {
    const now = getTokyoNow();
    const logs = loadLogs();
    const today = logs.find((log) => log.entry.date === now.date) || null;

    const todayLabel = byId("tslogTodayLabel");
    if (todayLabel) todayLabel.textContent = `今日: ${now.date} (${TSLOG_TZ})`;
    const userLabel = byId("tslogUserLabel");
    if (userLabel) userLabel.textContent = `user_id: ${getUserId()}`;

    setRangeValue("tslogPli", "tslogPliValue", today?.entry?.inputs?.pli ?? 0);
    setRangeValue("tslogCgi", "tslogCgiValue", today?.entry?.inputs?.cgi ?? 0);
    setRangeValue("tslogTpi", "tslogTpiValue", today?.entry?.inputs?.tpi ?? 0);

    const notes = byId("tslogNotes");
    if (notes) notes.value = today?.entry?.inputs?.notes || "";

    renderResult(today);
    if (today) renderDetail(today);
  }

  function renderHistory() {
    const logs = loadLogs();
    const wrap = byId("tslogHistoryList");
    if (!wrap) return;

    if (!logs.length) {
      wrap.innerHTML = `<div class="muted">履歴がまだありません。</div>`;
      return;
    }

    wrap.innerHTML = logs.map((log) => {
      const level = log.entry.derived.alert_level;
      const flags = log.entry.derived.risk_flags || [];
      return `
        <button type="button" class="record-row" data-log-id="${log.entry.id}">
          <div class="row-head">
            <strong>${log.entry.date} ${log.entry.time}</strong>
            <span class="alert-pill ${alertClass(level)}">L${level}</span>
          </div>
          <div class="subtle">${flags.length ? flags.join(", ") : "risk_flags: なし"}</div>
        </button>
      `;
    }).join("");

    wrap.querySelectorAll("[data-log-id]").forEach((row) => {
      row.addEventListener("click", () => {
        const id = row.getAttribute("data-log-id");
        const picked = loadLogs().find((log) => log.entry.id === id) || null;
        renderDetail(picked);
      });
    });
  }

  function initTSLog() {
    if (!byId("tslogSaveBtn")) return;

    bindSlider("tslogPli", "tslogPliValue");
    bindSlider("tslogCgi", "tslogCgiValue");
    bindSlider("tslogTpi", "tslogTpiValue");

    const saveBtn = byId("tslogSaveBtn");
    if (saveBtn) {
      saveBtn.addEventListener("click", () => {
        const log = saveLog({
          pli: Number(byId("tslogPli")?.value || 0),
          cgi: Number(byId("tslogCgi")?.value || 0),
          tpi: Number(byId("tslogTpi")?.value || 0),
          notes: byId("tslogNotes")?.value || ""
        });
        renderResult(log);
        renderHistory();
        renderDetail(log);
      });
    }

    const exportBtn = byId("tslogExportBtn");
    if (exportBtn) {
      exportBtn.addEventListener("click", exportJSON);
    }

    renderToday();
    renderHistory();
    if (!loadLogs().length) renderDetail(null);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initTSLog);
  } else {
    initTSLog();
  }
})();
