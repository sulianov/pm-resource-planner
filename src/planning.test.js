import { describe, it, expect } from "vitest";
import {
  isBizDay,
  bizDaysBetween,
  addBizDaysFrom,
  nextBizDay,
  fmtDate,
  calcSoloBuildDate,
  runPlan,
  parseDate,
} from "./planning.js";

// ── Helpers ──────────────────────────────────────────────────────────────────
const d = (s) => new Date(s + "T00:00:00");
const fmt = (s) => fmtDate(d(s));

// Base config reused across runPlan tests
const BASE = {
  perDevVelocityPerDay: 6,   // 6 SP per dev per day
  totalDevs: 4,
  sprintStartDate: d("2026-03-02"), // Monday
  numSprints: 6,
  startSprintNum: 1,
};

function makeEpic(name, sp, analysisDue) {
  return { id: name, name, sp, analysisDue: analysisDue ? d(analysisDue) : null };
}

// ── isBizDay ─────────────────────────────────────────────────────────────────
describe("isBizDay", () => {
  it("returns true for a normal weekday", () => {
    expect(isBizDay(d("2026-03-04"))).toBe(true); // Wednesday
  });

  it("returns false for Saturday", () => {
    expect(isBizDay(d("2026-03-07"))).toBe(false);
  });

  it("returns false for Sunday", () => {
    expect(isBizDay(d("2026-03-08"))).toBe(false);
  });

  it("returns false for CA holiday (Good Friday 2026)", () => {
    expect(isBizDay(d("2026-04-03"))).toBe(false);
  });

  it("returns false for CA holiday (Canada Day 2026)", () => {
    expect(isBizDay(d("2026-07-01"))).toBe(false);
  });

  it("returns true for day after a holiday", () => {
    expect(isBizDay(d("2026-07-02"))).toBe(true); // Thursday after Canada Day
  });
});

// ── bizDaysBetween ────────────────────────────────────────────────────────────
describe("bizDaysBetween", () => {
  it("counts 5 biz days in a normal week Mon–Fri", () => {
    // Mon 2026-03-02 to Sat 2026-03-07
    expect(bizDaysBetween(d("2026-03-02"), d("2026-03-07"))).toBe(5);
  });

  it("counts 0 for same day", () => {
    expect(bizDaysBetween(d("2026-03-04"), d("2026-03-04"))).toBe(0);
  });

  it("counts 0 for weekend-only range", () => {
    expect(bizDaysBetween(d("2026-03-07"), d("2026-03-09"))).toBe(0);
  });

  it("excludes CA holiday in range", () => {
    // Mon Mar 30 – Tue Apr 7 (exclusive): Mon/Tue/Wed/Thu = 4 days, Good Friday Apr 3 excluded, weekend excluded, Mon Apr 6 = 5 biz days
    expect(bizDaysBetween(d("2026-03-30"), d("2026-04-07"))).toBe(5);
  });

  it("counts 10 biz days in a standard 2-week sprint", () => {
    expect(bizDaysBetween(d("2026-03-02"), d("2026-03-16"))).toBe(10);
  });
});

// ── addBizDaysFrom ────────────────────────────────────────────────────────────
describe("addBizDaysFrom", () => {
  it("adds 1 biz day from a Monday → Tuesday", () => {
    expect(fmtDate(addBizDaysFrom(d("2026-03-02"), 1))).toBe("2026-03-03");
  });

  it("adds 1 biz day from Friday → Monday (skips weekend)", () => {
    expect(fmtDate(addBizDaysFrom(d("2026-03-06"), 1))).toBe("2026-03-09");
  });

  it("adds 5 biz days from Monday → Monday of next week", () => {
    expect(fmtDate(addBizDaysFrom(d("2026-03-02"), 5))).toBe("2026-03-09");
  });

  it("crosses weekend correctly", () => {
    // 6 biz days from Mon 2026-03-02 → Tuesday 2026-03-10
    expect(fmtDate(addBizDaysFrom(d("2026-03-02"), 6))).toBe("2026-03-10");
  });

  it("skips over a CA holiday", () => {
    // Canada Day 2026-07-01 is Wednesday. 3 biz days from Mon 2026-06-29:
    // Tue(1) Wed=holiday skip Thu(2) Fri(3) → lands Fri 2026-07-03
    expect(fmtDate(addBizDaysFrom(d("2026-06-29"), 3))).toBe("2026-07-03");
  });
});

// ── nextBizDay ────────────────────────────────────────────────────────────────
describe("nextBizDay", () => {
  it("from Friday → Monday", () => {
    expect(fmtDate(nextBizDay(d("2026-03-06")))).toBe("2026-03-09");
  });

  it("from Thursday before a holiday Friday → Monday", () => {
    // Good Friday 2026-04-03, so next biz day after Thu 2026-04-02 → Mon 2026-04-06
    expect(fmtDate(nextBizDay(d("2026-04-02")))).toBe("2026-04-06");
  });
});

// ── calcSoloBuildDate ─────────────────────────────────────────────────────────
describe("calcSoloBuildDate", () => {
  it("returns null if no SP", () => {
    expect(calcSoloBuildDate({ sp: 0, analysisDue: "2026-03-02" }, 6)).toBeNull();
  });

  it("returns null if no analysis due date", () => {
    expect(calcSoloBuildDate({ sp: 30, analysisDue: "" }, 6)).toBeNull();
  });

  it("calculates correct date for 30 SP at 6 SP/day = 5 biz days", () => {
    // 5 biz days forward from 2026-03-02 (Mon): Tue Wed Thu Fri Mon → 2026-03-09
    const result = calcSoloBuildDate({ sp: 30, analysisDue: "2026-03-02" }, 6);
    expect(fmtDate(result)).toBe("2026-03-09");
  });

  it("skips holidays in solo date calculation", () => {
    // 5 biz days from Mon 2026-06-29: Tue(1) Wed=holiday Thu(2) Fri(3) Mon(4) Tue(5) → 2026-07-07
    const result = calcSoloBuildDate({ sp: 30, analysisDue: "2026-06-29" }, 6);
    expect(fmtDate(result)).toBe("2026-07-07");
  });
});

// ── runPlan ───────────────────────────────────────────────────────────────────
describe("runPlan", () => {

  it("schedules a single small epic within the first sprint", () => {
    // 6 SP / 6 vel = 1 dev-day. With 4 devs and 10 biz days, fits easily.
    const { assignedEpics } = runPlan({
      ...BASE,
      epics: [makeEpic("Alpha", 6, "2026-03-02")],
    });
    expect(assignedEpics[0].segments.length).toBe(1);
    expect(assignedEpics[0].segments[0].sprintIdx).toBe(0);
    expect(assignedEpics[0].warning).toBeNull();
  });

  it("build complete date is within the sprint, not snapped to sprint end", () => {
    // 12 SP / 6 vel = 2 dev-days for 1 dev.
    // 2 biz days forward from sprint start 2026-03-02 → Wed 2026-03-04
    const { assignedEpics } = runPlan({
      ...BASE,
      totalDevs: 1,
      epics: [makeEpic("Beta", 12, "2026-03-02")],
    });
    const bc = fmtDate(assignedEpics[0].buildComplete);
    expect(bc).toBe("2026-03-04");
  });

  it("epic with analysis due mid-sprint only uses remaining biz days of that sprint", () => {
    // Sprint 1: 2026-03-02 → 2026-03-16 (10 biz days)
    // Analysis due 2026-03-09 (Monday of week 2) → 5 biz days remaining in sprint
    // 60 SP / 6 vel = 10 dev-days needed. 1 dev × 5 remaining days = only 5 dev-days in S1
    // Should spill into S2
    const { assignedEpics } = runPlan({
      ...BASE,
      totalDevs: 1,
      epics: [makeEpic("Gamma", 60, "2026-03-09")],
    });
    expect(assignedEpics[0].segments.length).toBeGreaterThan(1);
  });

  it("epic with no analysis due date starts from sprint 0", () => {
    const { assignedEpics } = runPlan({
      ...BASE,
      epics: [makeEpic("Delta", 12, null)],
    });
    expect(assignedEpics[0].segments[0].sprintIdx).toBe(0);
  });

  it("large epic that can't fit flags overflow warning", () => {
    // 10000 SP with 6 sprints of 4 devs × 10 biz days × 6 vel = 2400 SP max
    const { assignedEpics } = runPlan({
      ...BASE,
      epics: [makeEpic("Huge", 10000, "2026-03-02")],
    });
    expect(assignedEpics[0].warning).toBeTruthy();
  });

  it("earlier analysis due date gets priority over later one", () => {
    const epics = [
      makeEpic("Late", 60, "2026-04-01"),
      makeEpic("Early", 60, "2026-03-02"),
    ];
    const { assignedEpics } = runPlan({ ...BASE, epics });
    // Early should appear first in assigned output
    expect(assignedEpics[0].name).toBe("Early");
  });

  it("adding a new earlier epic can push a later epic to a later sprint", () => {
    const sprintStart = d("2026-03-02");

    // Start: 1 dev, 1 epic filling Sprint 1 completely
    // 60 SP / 6 vel = 10 dev-days = exactly Sprint 1 capacity (1 dev × 10 biz days)
    const before = runPlan({
      ...BASE,
      totalDevs: 1,
      epics: [makeEpic("Existing", 60, "2026-03-02")],
    });
    const beforeSprint = before.assignedEpics[0].segments[0].sprintIdx;

    // Add a new epic with same due date and equal SP — competes for same sprint
    const after = runPlan({
      ...BASE,
      totalDevs: 1,
      epics: [
        makeEpic("Existing", 60, "2026-03-02"),
        makeEpic("NewComer", 60, "2026-03-02"),
      ],
    });
    // One of them must spill to Sprint 2
    const sprintIndices = after.assignedEpics.flatMap(e => e.segments.map(s => s.sprintIdx));
    expect(Math.max(...sprintIndices)).toBeGreaterThan(beforeSprint);
  });

  it("two epics with same due date: larger SP gets scheduled first", () => {
    const epics = [
      makeEpic("Small", 12, "2026-03-02"),
      makeEpic("Large", 60, "2026-03-02"),
    ];
    const { assignedEpics } = runPlan({ ...BASE, epics });
    expect(assignedEpics[0].name).toBe("Large");
  });

  it("sprint utilisation never exceeds totalDevs pool", () => {
    const epics = [
      makeEpic("E1", 60, "2026-03-02"),
      makeEpic("E2", 60, "2026-03-02"),
      makeEpic("E3", 60, "2026-03-02"),
    ];
    const { sprintStats } = runPlan({ ...BASE, epics });
    sprintStats.forEach(s => {
      expect(s.devsNeeded).toBeLessThanOrEqual(BASE.totalDevs);
    });
  });

  it("zero velocity returns no scheduled epics", () => {
    const { assignedEpics } = runPlan({
      ...BASE,
      perDevVelocityPerDay: 0,
      epics: [makeEpic("Zero", 30, "2026-03-02")],
    });
    // With 0 velocity remaining never reaches 0, all segments empty or overflow
    expect(assignedEpics[0].warning).toBeTruthy();
  });
});
