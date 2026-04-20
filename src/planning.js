// ── Canadian Federal Bank Holidays (2025–2027) ───────────────────────────────
export const CA_HOLIDAYS = new Set([
  "2025-01-01","2025-02-17","2025-04-18","2025-05-19","2025-07-01",
  "2025-08-04","2025-09-01","2025-10-13","2025-11-11","2025-12-25","2025-12-26",
  "2026-01-01","2026-02-16","2026-04-03","2026-05-18","2026-07-01",
  "2026-08-03","2026-09-07","2026-10-12","2026-11-11","2026-12-25","2026-12-28",
  "2027-01-01","2027-02-15","2027-03-26","2027-05-24","2027-07-01",
  "2027-08-02","2027-09-06","2027-10-11","2027-11-11","2027-12-27","2027-12-28",
]);

export function isBizDay(d) {
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return false;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return !CA_HOLIDAYS.has(`${yyyy}-${mm}-${dd}`);
}

export function bizDaysBetween(a, b) {
  let count = 0;
  let d = new Date(a);
  while (d < b) {
    if (isBizDay(d)) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

export function nextBizDay(d) {
  let r = new Date(d);
  r.setDate(r.getDate() + 1);
  while (!isBizDay(r)) r.setDate(r.getDate() + 1);
  return r;
}

export function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function addBizDaysFrom(start, n) {
  let d = new Date(start);
  let count = 0;
  while (count < n) {
    d.setDate(d.getDate() + 1);
    if (isBizDay(d)) count++;
  }
  return d;
}

export function parseDate(s) {
  if (!s || !String(s).trim()) return null;
  const raw = String(s).trim();

  // 1. YYYY-MM-DD
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(raw)) {
    const d = new Date(raw + "T00:00:00");
    return isNaN(d) ? null : d;
  }

  // 2. M/D/YYYY or MM/DD/YYYY (e.g. 3/27/2026)
  const mdy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    const d = new Date(+mdy[3], +mdy[1] - 1, +mdy[2]);
    return isNaN(d) ? null : d;
  }

  // 3. D-M-YYYY (e.g. 27-2-2026)
  const dmy = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dmy) {
    const d = new Date(+dmy[3], +dmy[2] - 1, +dmy[1]);
    return isNaN(d) ? null : d;
  }

  // 4. D-Mon (e.g. 13-Mar, 30-Apr) — assume current year
  const dmon = raw.match(/^(\d{1,2})-([A-Za-z]{3})$/);
  if (dmon) {
    const d = new Date(`${dmon[2]} ${dmon[1]} ${new Date().getFullYear()}`);
    return isNaN(d) ? null : d;
  }

  // 5. Fallback — normalise to local midnight
  const fallback = new Date(raw);
  if (!isNaN(fallback)) {
    return new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate());
  }

  return null;
}

export function fmtDate(d) {
  if (!d) return "—";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function calcSoloBuildDate(ep, perDevVelocityPerDay) {
  const sp = parseFloat(ep.sp);
  const start = parseDate(ep.analysisDue);
  if (!sp || !start || perDevVelocityPerDay <= 0) return null;
  const devDaysNeeded = Math.ceil(sp / perDevVelocityPerDay);
  return addBizDaysFrom(start, devDaysNeeded);
}

export function runPlan({ epics, perDevVelocityPerDay, totalDevs, sprintStartDate, numSprints, startSprintNum }) {
  const sprints = [];
  let cur = new Date(sprintStartDate);
  for (let i = 0; i < numSprints; i++) {
    const end = addDays(cur, 14);
    const bizDays = bizDaysBetween(cur, end);
    sprints.push({ idx: i, label: `Sprint ${startSprintNum + i}`, start: new Date(cur), end, bizDays });
    cur = end;
  }

  const sorted = [...epics]
    .filter(e => e.sp > 0)
    .sort((a, b) => {
      const da = a.analysisDue ? a.analysisDue.getTime() : Infinity;
      const db = b.analysisDue ? b.analysisDue.getTime() : Infinity;
      return da !== db ? da - db : b.sp - a.sp;
    });

  const sprintCapRemaining = sprints.map(s => totalDevs * s.bizDays);

  const assigned = sorted.map(epic => {
    const foundIdx = epic.analysisDue
      ? sprints.findIndex(s => s.end > epic.analysisDue)
      : 0;
    // -1 means analysisDue is beyond all sprints → start past the end so the
    // while loop never runs and the epic gets the overflow warning.
    const firstIdx = foundIdx === -1 ? sprints.length : Math.max(0, foundIdx);

    let remaining = epic.sp / Math.max(perDevVelocityPerDay, 0.01);
    let s = firstIdx;
    const segments = [];

    while (remaining > 0.001 && s < sprints.length) {
      const sprint = sprints[s];

      let effectiveBizDays = sprint.bizDays;
      if (epic.analysisDue && epic.analysisDue > sprint.start && epic.analysisDue < sprint.end) {
        effectiveBizDays = bizDaysBetween(epic.analysisDue, sprint.end);
      }

      const effectiveCap = sprintCapRemaining[s] > 0
        ? Math.min(sprintCapRemaining[s], totalDevs * effectiveBizDays)
        : 0;

      if (effectiveCap > 0.001) {
        const use = Math.min(effectiveCap, remaining);
        const devs = Math.max(1, Math.round(use / effectiveBizDays));
        segments.push({ sprintIdx: s, devDays: use, devs, effectiveBizDays });
        sprintCapRemaining[s] -= use;
        remaining -= use;
      }
      s++;
    }

    let buildComplete = null;
    if (segments.length > 0) {
      const lastSeg = segments[segments.length - 1];
      const lastSprint = sprints[lastSeg.sprintIdx];
      const bizDaysOccupied = Math.ceil(lastSeg.devDays / Math.max(lastSeg.devs, 1));
      const effectiveStart =
        epic.analysisDue && epic.analysisDue > lastSprint.start && epic.analysisDue < lastSprint.end
          ? epic.analysisDue
          : lastSprint.start;
      buildComplete = addBizDaysFrom(effectiveStart, bizDaysOccupied);
    }

    return {
      ...epic,
      segments,
      buildComplete,
      warning: remaining > 0.001 ? "Extends beyond sprint range" : null,
    };
  });

  const sprintStats = sprints.map((sp, i) => {
    const activeEpics = assigned.flatMap(e =>
      (e.segments || []).filter(seg => seg.sprintIdx === i)
        .map(seg => ({ name: e.name, sp: e.sp, devs: seg.devs, devDays: seg.devDays }))
    );
    const devsNeeded = activeEpics.reduce((sum, e) => sum + e.devs, 0);
    return {
      ...sp,
      devsNeeded,
      devsFree: totalDevs - devsNeeded,
      utilPct: totalDevs > 0 ? Math.round((devsNeeded / totalDevs) * 100) : 0,
      activeEpics,
    };
  });

  return { sprintStats, assignedEpics: assigned, sprints };
}
