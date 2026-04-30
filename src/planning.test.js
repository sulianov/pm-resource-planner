import { describe, it, expect } from "vitest";
import {
  isBizDay,
  bizDaysBetween,
  addBizDaysFrom,
  nextBizDay,
  parseDate,
  fmtDate,
  calcSoloBuildDate,
  calcStoryDates,
  calcFullFocusDate,
  runPlan,
} from "./planning.js";

// ── Helpers ───────────────────────────────────────────────────────────────────
const d  = (s) => new Date(s + "T00:00:00");

/** Base runPlan config reused across tests. */
const BASE = {
  perDevVelocityPerDay: 6,
  totalDevs: 4,
  sprintStartDate: d("2026-03-02"),
  numSprints: 6,
  startSprintNum: 1,
};

function makeEpic(name, sp, analysisDue) {
  return { id: name, name, sp, analysisDue: analysisDue ? d(analysisDue) : null };
}

// ════════════════════════════════════════════════════════════════════════════
// isBizDay
// ════════════════════════════════════════════════════════════════════════════
describe("isBizDay", () => {
  it("returns true for a normal weekday (Wednesday)", () => {
    expect(isBizDay(d("2026-03-04"))).toBe(true);
  });
  it("returns false for Saturday", () => {
    expect(isBizDay(d("2026-03-07"))).toBe(false);
  });
  it("returns false for Sunday", () => {
    expect(isBizDay(d("2026-03-08"))).toBe(false);
  });
  it("returns false for Good Friday 2026 (CA holiday)", () => {
    expect(isBizDay(d("2026-04-03"))).toBe(false);
  });
  it("returns false for Canada Day 2026 (CA holiday)", () => {
    expect(isBizDay(d("2026-07-01"))).toBe(false);
  });
  it("returns true the day after a CA holiday", () => {
    expect(isBizDay(d("2026-07-02"))).toBe(true);
  });
  it("returns false for Boxing Day 2026 (CA observed holiday)", () => {
    expect(isBizDay(d("2026-12-28"))).toBe(false);
  });
  it("returns false for New Year 2027 (CA holiday)", () => {
    expect(isBizDay(d("2027-01-01"))).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// bizDaysBetween
// ════════════════════════════════════════════════════════════════════════════
describe("bizDaysBetween", () => {
  it("counts 5 biz days Mon–Sat (exclusive end)", () => {
    expect(bizDaysBetween(d("2026-03-02"), d("2026-03-07"))).toBe(5);
  });
  it("counts 0 for the same day", () => {
    expect(bizDaysBetween(d("2026-03-04"), d("2026-03-04"))).toBe(0);
  });
  it("counts 0 for a weekend-only range", () => {
    expect(bizDaysBetween(d("2026-03-07"), d("2026-03-09"))).toBe(0);
  });
  it("excludes CA holiday within a range", () => {
    // Mar 30 Mon – Apr 7 Tue: Mon Tue Wed Thu(4) GoodFriday=skip Mon Apr6(5)
    expect(bizDaysBetween(d("2026-03-30"), d("2026-04-07"))).toBe(5);
  });
  it("counts 10 biz days in a standard 2-week sprint", () => {
    expect(bizDaysBetween(d("2026-03-02"), d("2026-03-16"))).toBe(10);
  });
  it("counts correctly across a month boundary with a holiday (Canada Day)", () => {
    // Jun 29(1) 30(2) Jul 1=holiday Jul 2(3) 3(4) → 4 before Mon Jul 6
    expect(bizDaysBetween(d("2026-06-29"), d("2026-07-06"))).toBe(4);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// addBizDaysFrom
// ════════════════════════════════════════════════════════════════════════════
describe("addBizDaysFrom", () => {
  it("adds 1 biz day from Monday → Tuesday", () => {
    expect(fmtDate(addBizDaysFrom(d("2026-03-02"), 1))).toBe("2026-03-03");
  });
  it("adds 1 biz day from Friday → Monday (skips weekend)", () => {
    expect(fmtDate(addBizDaysFrom(d("2026-03-06"), 1))).toBe("2026-03-09");
  });
  it("adds 5 biz days from Monday → next Monday", () => {
    expect(fmtDate(addBizDaysFrom(d("2026-03-02"), 5))).toBe("2026-03-09");
  });
  it("adds 6 biz days crossing a weekend", () => {
    expect(fmtDate(addBizDaysFrom(d("2026-03-02"), 6))).toBe("2026-03-10");
  });
  it("skips a CA holiday mid-count (Canada Day)", () => {
    // 3 biz from Mon Jun 29: Tue 30(1) Wed=holiday Thu 2(2) Fri 3(3)
    expect(fmtDate(addBizDaysFrom(d("2026-06-29"), 3))).toBe("2026-07-03");
  });
  it("adds 20 biz days = 4 calendar weeks (no holidays in range)", () => {
    expect(fmtDate(addBizDaysFrom(d("2026-03-02"), 20))).toBe("2026-03-30");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// nextBizDay
// ════════════════════════════════════════════════════════════════════════════
describe("nextBizDay", () => {
  it("from Friday → Monday", () => {
    expect(fmtDate(nextBizDay(d("2026-03-06")))).toBe("2026-03-09");
  });
  it("from Thursday before holiday Friday → Monday", () => {
    expect(fmtDate(nextBizDay(d("2026-04-02")))).toBe("2026-04-06");
  });
  it("from a mid-week day → next day", () => {
    expect(fmtDate(nextBizDay(d("2026-03-04")))).toBe("2026-03-05");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// parseDate
// ════════════════════════════════════════════════════════════════════════════
describe("parseDate", () => {
  it("parses YYYY-MM-DD (ISO format)", () => {
    expect(fmtDate(parseDate("2026-05-15"))).toBe("2026-05-15");
  });
  it("parses M/D/YYYY (US slash format)", () => {
    expect(fmtDate(parseDate("3/27/2026"))).toBe("2026-03-27");
  });
  it("parses MM/DD/YYYY (zero-padded US format)", () => {
    expect(fmtDate(parseDate("12/01/2026"))).toBe("2026-12-01");
  });
  it("parses D-M-YYYY (day-month-year hyphens)", () => {
    expect(fmtDate(parseDate("27-2-2026"))).toBe("2026-02-27");
  });
  it("returns null for null input", () => {
    expect(parseDate(null)).toBeNull();
  });
  it("returns null for empty string", () => {
    expect(parseDate("")).toBeNull();
  });
  it("returns null for an invalid date string", () => {
    expect(parseDate("not-a-date")).toBeNull();
  });
  it("round-trips through fmtDate without drift", () => {
    expect(fmtDate(parseDate("2026-11-30"))).toBe("2026-11-30");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// fmtDate
// ════════════════════════════════════════════════════════════════════════════
describe("fmtDate", () => {
  it("formats a Date to YYYY-MM-DD", () => {
    expect(fmtDate(d("2026-07-04"))).toBe("2026-07-04");
  });
  it("zero-pads single-digit month and day", () => {
    expect(fmtDate(d("2026-01-05"))).toBe("2026-01-05");
  });
  it("returns dash for null", () => {
    expect(fmtDate(null)).toBe("—");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// calcSoloBuildDate
// ════════════════════════════════════════════════════════════════════════════
describe("calcSoloBuildDate", () => {
  it("returns null when SP is 0", () => {
    expect(calcSoloBuildDate({ sp: 0, analysisDue: "2026-03-02" }, 6)).toBeNull();
  });
  it("returns null when analysisDue is empty", () => {
    expect(calcSoloBuildDate({ sp: 30, analysisDue: "" }, 6)).toBeNull();
  });
  it("returns null when velocity is 0", () => {
    expect(calcSoloBuildDate({ sp: 30, analysisDue: "2026-03-02" }, 0)).toBeNull();
  });
  it("calculates correctly: 30 SP / 6 vel = 5 biz days from Mon → Mon", () => {
    expect(fmtDate(calcSoloBuildDate({ sp: 30, analysisDue: "2026-03-02" }, 6))).toBe("2026-03-09");
  });
  it("skips CA holidays in the count", () => {
    // 5 biz from Mon Jun 29: Tue(1) Wed=holiday Thu(2) Fri(3) Mon(4) Tue(5) → Jul 7
    expect(fmtDate(calcSoloBuildDate({ sp: 30, analysisDue: "2026-06-29" }, 6))).toBe("2026-07-07");
  });
  it("uses Math.ceil so fractional dev-days round up", () => {
    // 7 SP / 6 vel = 1.17 → ceil(2) biz days from Mon → Wed
    expect(fmtDate(calcSoloBuildDate({ sp: 7, analysisDue: "2026-03-02" }, 6))).toBe("2026-03-04");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// calcStoryDates
// ════════════════════════════════════════════════════════════════════════════
describe("calcStoryDates", () => {
  const start = d("2026-03-02");

  it("returns null dates when analysisDue is null", () => {
    const { devDue, testDue } = calcStoryDates({ analysisDue: null, sp: "5" }, 1);
    expect(devDue).toBeNull();
    expect(testDue).toBeNull();
  });
  it("returns null dates when SP is 0", () => {
    const { devDue } = calcStoryDates({ analysisDue: start, sp: "0" }, 1);
    expect(devDue).toBeNull();
  });
  it("returns null dates when velocity is 0", () => {
    const { devDue } = calcStoryDates({ analysisDue: start, sp: "5" }, 0);
    expect(devDue).toBeNull();
  });
  it("devDue = analysisDue + ceil(SP/vel) biz days", () => {
    // 6 SP / 6 vel = 1 biz day: Mon → Tue
    const { devDue } = calcStoryDates({ analysisDue: start, sp: "6" }, 6);
    expect(fmtDate(devDue)).toBe("2026-03-03");
  });
  it("testDue = devDue + 20 biz days", () => {
    const { devDue, testDue } = calcStoryDates({ analysisDue: start, sp: "6" }, 6);
    expect(fmtDate(testDue)).toBe(fmtDate(addBizDaysFrom(devDue, 20)));
  });
  it("overrideSP replaces story.sp", () => {
    // overrideSP=12: 12/6=2 biz days Mon → Wed
    const { devDue } = calcStoryDates({ analysisDue: start, sp: "6" }, 6, 12);
    expect(fmtDate(devDue)).toBe("2026-03-04");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// calcFullFocusDate
// ════════════════════════════════════════════════════════════════════════════
describe("calcFullFocusDate", () => {
  it("returns null when SP is 0", () => {
    expect(calcFullFocusDate({ sp: "0", analysisDue: "2026-03-02" }, 1, 4)).toBeNull();
  });
  it("returns null when analysisDue is empty", () => {
    expect(calcFullFocusDate({ sp: "10", analysisDue: "" }, 1, 4)).toBeNull();
  });
  it("returns null when teamSize is 0", () => {
    expect(calcFullFocusDate({ sp: "10", analysisDue: "2026-03-02" }, 1, 0)).toBeNull();
  });
  it("returns null when velocity is 0", () => {
    expect(calcFullFocusDate({ sp: "10", analysisDue: "2026-03-02" }, 0, 4)).toBeNull();
  });
  it("accepts analysisDue as a Date object", () => {
    const result = calcFullFocusDate({ sp: "6", analysisDue: d("2026-03-02") }, 6, 1);
    expect(fmtDate(result)).toBe("2026-03-03");
  });
  it("accepts analysisDue as a YYYY-MM-DD string", () => {
    const result = calcFullFocusDate({ sp: "6", analysisDue: "2026-03-02" }, 6, 1);
    expect(fmtDate(result)).toBe("2026-03-03");
  });
  it("larger teamSize produces an earlier date", () => {
    // 24 SP / (6 * 1) = 4 biz from Mon → Fri Mar 6
    const solo = calcFullFocusDate({ sp: "24", analysisDue: "2026-03-02" }, 6, 1);
    // 24 SP / (6 * 4) = 1 biz from Mon → Tue Mar 3
    const team = calcFullFocusDate({ sp: "24", analysisDue: "2026-03-02" }, 6, 4);
    expect(fmtDate(solo)).toBe("2026-03-06");
    expect(fmtDate(team)).toBe("2026-03-03");
  });
  it("uses Math.ceil for fractional biz days", () => {
    // 7 SP / (6 * 4) = 0.29 → ceil(1) biz day Mon → Tue
    const result = calcFullFocusDate({ sp: "7", analysisDue: "2026-03-02" }, 6, 4);
    expect(fmtDate(result)).toBe("2026-03-03");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// runPlan
// ════════════════════════════════════════════════════════════════════════════
describe("runPlan", () => {
  it("schedules a small epic in sprint 0 with no warning", () => {
    const { assignedEpics } = runPlan({
      ...BASE,
      epics: [makeEpic("Alpha", 6, "2026-03-02")],
    });
    expect(assignedEpics[0].segments[0].sprintIdx).toBe(0);
    expect(assignedEpics[0].warning).toBeNull();
  });

  it("buildComplete is precise, not snapped to sprint end", () => {
    // 12 SP / 6 vel = 2 dev-days → Wed Mar 4
    const { assignedEpics } = runPlan({
      ...BASE, totalDevs: 1,
      epics: [makeEpic("Beta", 12, "2026-03-02")],
    });
    expect(fmtDate(assignedEpics[0].buildComplete)).toBe("2026-03-04");
  });

  it("mid-sprint analysisDue only uses remaining biz days of that sprint", () => {
    // analysisDue Mar 9: 5 remaining biz days in sprint 1; 60/6=10 dev-days needed → spills
    const { assignedEpics } = runPlan({
      ...BASE, totalDevs: 1,
      epics: [makeEpic("Gamma", 60, "2026-03-09")],
    });
    expect(assignedEpics[0].segments.length).toBeGreaterThan(1);
  });

  it("null analysisDue starts from sprint 0", () => {
    const { assignedEpics } = runPlan({
      ...BASE,
      epics: [makeEpic("Delta", 12, null)],
    });
    expect(assignedEpics[0].segments[0].sprintIdx).toBe(0);
  });

  it("epic with SP too large for all sprints gets overflow warning", () => {
    const { assignedEpics } = runPlan({
      ...BASE,
      epics: [makeEpic("Huge", 100000, "2026-03-02")],
    });
    expect(assignedEpics[0].warning).toBeTruthy();
  });

  it("analysisDue beyond all sprints produces overflow with zero segments", () => {
    const { assignedEpics } = runPlan({
      ...BASE,
      epics: [makeEpic("Future", 10, "2027-06-01")],
    });
    expect(assignedEpics[0].warning).toBeTruthy();
    expect(assignedEpics[0].segments.length).toBe(0);
  });

  it("sorts by analysisDue ascending (earlier gets priority)", () => {
    const epics = [makeEpic("Late", 60, "2026-04-01"), makeEpic("Early", 60, "2026-03-02")];
    const { assignedEpics } = runPlan({ ...BASE, epics });
    expect(assignedEpics[0].name).toBe("Early");
  });

  it("same analysisDue: larger SP gets priority", () => {
    const epics = [makeEpic("Small", 12, "2026-03-02"), makeEpic("Large", 60, "2026-03-02")];
    const { assignedEpics } = runPlan({ ...BASE, epics });
    expect(assignedEpics[0].name).toBe("Large");
  });

  it("adding a competing epic displaces the first to a later sprint", () => {
    const before = runPlan({ ...BASE, totalDevs: 1, epics: [makeEpic("E", 60, "2026-03-02")] });
    const maxBefore = Math.max(...before.assignedEpics.flatMap(e => e.segments.map(s => s.sprintIdx)));
    const after = runPlan({
      ...BASE, totalDevs: 1,
      epics: [makeEpic("E", 60, "2026-03-02"), makeEpic("N", 60, "2026-03-02")],
    });
    const maxAfter = Math.max(...after.assignedEpics.flatMap(e => e.segments.map(s => s.sprintIdx)));
    expect(maxAfter).toBeGreaterThan(maxBefore);
  });

  it("sprint utilisation never exceeds totalDevs", () => {
    const epics = [makeEpic("E1", 60, "2026-03-02"), makeEpic("E2", 60, "2026-03-02"), makeEpic("E3", 60, "2026-03-02")];
    const { sprintStats } = runPlan({ ...BASE, epics });
    sprintStats.forEach(s => expect(s.devsNeeded).toBeLessThanOrEqual(BASE.totalDevs));
  });

  it("devsNeeded never exceeds totalDevs when an epic has a mid-sprint analysisDue", () => {
    // "Full" uses 20 dev-days over 10 days → devs=2
    // "Mid" has analysisDue 2026-03-09 (effectiveBizDays=5): 20 dev-days over 5 days → devs=4
    // Old formula: 2+4=6 > totalDevs=4 (bug). New formula: round(40/10)=4 ≤ 4.
    const epics = [
      makeEpic("Full", 120, "2026-03-02"),
      makeEpic("Mid",  120, "2026-03-09"),
    ];
    const { sprintStats } = runPlan({ ...BASE, epics });
    sprintStats.forEach(s => expect(s.devsNeeded).toBeLessThanOrEqual(BASE.totalDevs));
  });

  it("zero velocity results in overflow (guard against division by ~0)", () => {
    const { assignedEpics } = runPlan({
      ...BASE, perDevVelocityPerDay: 0,
      epics: [makeEpic("Zero", 30, "2026-03-02")],
    });
    expect(assignedEpics[0].warning).toBeTruthy();
  });

  it("fully packed sprint reports 100% utilisation", () => {
    // 1 dev, 60 SP / 6 vel = 10 dev-days = exactly sprint 1 capacity
    const { sprintStats } = runPlan({
      ...BASE, totalDevs: 1,
      epics: [makeEpic("Full", 60, "2026-03-02")],
    });
    expect(sprintStats[0].utilPct).toBe(100);
  });

  it("empty epic list produces zero-utilisation sprints", () => {
    const { sprintStats, assignedEpics } = runPlan({ ...BASE, epics: [] });
    expect(assignedEpics.length).toBe(0);
    sprintStats.forEach(s => expect(s.utilPct).toBe(0));
  });
});

// ════════════════════════════════════════════════════════════════════════════
// parseDate + fmtDate round-trip
// ════════════════════════════════════════════════════════════════════════════
describe("parseDate + fmtDate round-trip", () => {
  it.each([
    // [description,          input,          expected ISO]
    ["YYYY-MM-DD (ISO)",      "2026-05-15",   "2026-05-15"],
    ["M/D/YYYY (US slash)",   "3/27/2026",    "2026-03-27"],
    ["D-M-YYYY (DMY hyphens)","27-2-2026",    "2026-02-27"],
    ["D-Mon (day-abbrev)",    "13-Mar",        `${new Date().getFullYear()}-03-13`],
  ])("%s: fmtDate(parseDate('%s')) === '%s'", (_desc, input, expected) => {
    expect(fmtDate(parseDate(input))).toBe(expected);
  });

  it("non-ISO input '3/27/2026' normalises consistently for Epic Input and Sprint Demand display", () => {
    // Simulates the Epic Input value prop:
    //   parseDate(ep.analysisDue) ? fmtDate(parseDate(ep.analysisDue)) : (ep.analysisDue ?? "")
    // and the Sprint Demand cell:
    //   e.analysisDue ? fmtDate(e.analysisDue) : "—"
    // Both should produce the same canonical YYYY-MM-DD string.
    const raw = "3/27/2026";
    const parsed = parseDate(raw);

    // Epic Input display (value prop normalisation)
    const epicInputDisplay = parsed ? fmtDate(parsed) : (raw ?? "");

    // Sprint Demand display (analysisDue is stored as the raw string in activeEpics)
    const sprintDemandDisplay = raw ? fmtDate(parseDate(raw)) : "—";

    expect(epicInputDisplay).toBe("2026-03-27");
    expect(sprintDemandDisplay).toBe("2026-03-27");
    expect(epicInputDisplay).toBe(sprintDemandDisplay);
  });
});
