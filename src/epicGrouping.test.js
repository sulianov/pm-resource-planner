import { describe, it, expect } from "vitest";
import {
  normalizeStory,
  groupStoriesByEpic,
  F_EPIC_LINK,
  F_SP,
  F_ANALYSIS_DUE,
  F_DEV_DUE,
  F_TEST_DUE,
} from "./epicGrouping.js";
import { fmtDate } from "./planning.js";

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeIssue(key, fields = {}) {
  return { key, fields };
}

function storyFields({
  summary    = "Test story",
  status     = "In Progress",
  sp         = 3,
  analysisDue = null,
  devDue     = null,
  testDue    = null,
  epicKey    = "PROJ-100",
} = {}) {
  return {
    summary,
    status: { name: status },
    [F_SP]:           sp,
    [F_ANALYSIS_DUE]: analysisDue,
    [F_DEV_DUE]:      devDue,
    [F_TEST_DUE]:     testDue,
    [F_EPIC_LINK]:    epicKey,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// normalizeStory
// ════════════════════════════════════════════════════════════════════════════
describe("normalizeStory", () => {
  it("extracts key and summary", () => {
    const story = normalizeStory(makeIssue("PROJ-1", storyFields({ summary: "My story" })));
    expect(story.key).toBe("PROJ-1");
    expect(story.summary).toBe("My story");
  });

  it("extracts numeric SP", () => {
    const story = normalizeStory(makeIssue("PROJ-1", storyFields({ sp: 5 })));
    expect(story.sp).toBe(5);
  });

  it("converts string SP to number", () => {
    const story = normalizeStory(makeIssue("PROJ-1", storyFields({ sp: "2.5" })));
    expect(story.sp).toBe(2.5);
  });

  it("defaults SP to 0 when missing or non-numeric", () => {
    const story = normalizeStory(makeIssue("PROJ-1", storyFields({ sp: null })));
    expect(story.sp).toBe(0);
  });

  it("parses analysisDue into a Date object", () => {
    const story = normalizeStory(makeIssue("PROJ-1", storyFields({ analysisDue: "2026-05-15" })));
    expect(story.analysisDue).toBeInstanceOf(Date);
    expect(fmtDate(story.analysisDue)).toBe("2026-05-15");
  });

  it("sets analysisDue to null when not provided", () => {
    const story = normalizeStory(makeIssue("PROJ-1", storyFields({ analysisDue: null })));
    expect(story.analysisDue).toBeNull();
  });

  it("passes through currentDevDue and currentTestDue as raw strings", () => {
    const story = normalizeStory(makeIssue("PROJ-1", storyFields({ devDue: "2026-06-01", testDue: "2026-07-01" })));
    expect(story.currentDevDue).toBe("2026-06-01");
    expect(story.currentTestDue).toBe("2026-07-01");
  });

  it("extracts epicKey", () => {
    const story = normalizeStory(makeIssue("PROJ-1", storyFields({ epicKey: "PROJ-999" })));
    expect(story.epicKey).toBe("PROJ-999");
  });

  it("sets epicKey to null when missing", () => {
    const fields = storyFields();
    delete fields[F_EPIC_LINK];
    const story = normalizeStory(makeIssue("PROJ-1", fields));
    expect(story.epicKey).toBeNull();
  });

  it("extracts status name", () => {
    const story = normalizeStory(makeIssue("PROJ-1", storyFields({ status: "Done" })));
    expect(story.status).toBe("Done");
  });

  it("handles completely empty fields gracefully", () => {
    const story = normalizeStory({ key: "PROJ-X", fields: {} });
    expect(story.key).toBe("PROJ-X");
    expect(story.sp).toBe(0);
    expect(story.summary).toBe("");
    expect(story.epicKey).toBeNull();
    expect(story.analysisDue).toBeNull();
  });

  it("handles missing fields property", () => {
    const story = normalizeStory({ key: "PROJ-Y" });
    expect(story.sp).toBe(0);
    expect(story.epicKey).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// groupStoriesByEpic
// ════════════════════════════════════════════════════════════════════════════
describe("groupStoriesByEpic", () => {
  it("returns empty arrays for empty input", () => {
    const { epics, orphanStories } = groupStoriesByEpic([]);
    expect(epics).toHaveLength(0);
    expect(orphanStories).toHaveLength(0);
  });

  it("groups stories by epic key", () => {
    const issues = [
      makeIssue("PROJ-1", storyFields({ epicKey: "PROJ-100", sp: 2 })),
      makeIssue("PROJ-2", storyFields({ epicKey: "PROJ-100", sp: 3 })),
      makeIssue("PROJ-3", storyFields({ epicKey: "PROJ-200", sp: 1 })),
    ];
    const { epics, storyMap } = groupStoriesByEpic(issues);
    expect(epics).toHaveLength(2);
    expect(storyMap["PROJ-100"]).toHaveLength(2);
    expect(storyMap["PROJ-200"]).toHaveLength(1);
  });

  it("separates orphan stories (no epic link)", () => {
    const issues = [
      makeIssue("PROJ-1", storyFields({ epicKey: "PROJ-100" })),
      makeIssue("PROJ-2", { ...storyFields(), [F_EPIC_LINK]: null }),
    ];
    const { epics, orphanStories } = groupStoriesByEpic(issues);
    expect(epics).toHaveLength(1);
    expect(orphanStories).toHaveLength(1);
    expect(orphanStories[0].key).toBe("PROJ-2");
  });

  it("sums story SPs when no epicSpMap provided", () => {
    const issues = [
      makeIssue("PROJ-1", storyFields({ epicKey: "PROJ-100", sp: 2 })),
      makeIssue("PROJ-2", storyFields({ epicKey: "PROJ-100", sp: 3 })),
    ];
    const { epics } = groupStoriesByEpic(issues);
    expect(parseFloat(epics[0].sp)).toBe(5);
  });

  it("always uses story sum regardless of epic estimate", () => {
    const issues = [
      makeIssue("PROJ-1", storyFields({ epicKey: "PROJ-100", sp: 2 })),
      makeIssue("PROJ-2", storyFields({ epicKey: "PROJ-100", sp: 3 })),
    ];
    const { epics } = groupStoriesByEpic(issues, { "PROJ-100": 20 });
    expect(parseFloat(epics[0].sp)).toBe(5); // always story sum
  });

  it("uses story sum when story sum exceeds epic estimate", () => {
    const issues = [
      makeIssue("PROJ-1", storyFields({ epicKey: "PROJ-100", sp: 8 })),
      makeIssue("PROJ-2", storyFields({ epicKey: "PROJ-100", sp: 7 })),
    ];
    const { epics } = groupStoriesByEpic(issues, { "PROJ-100": 10 });
    expect(parseFloat(epics[0].sp)).toBe(15); // story sum wins
  });

  it("ignores epicSpMap value of 0.24 (Jira default SP) and falls back to story sum", () => {
    const issues = [
      makeIssue("PROJ-1", storyFields({ epicKey: "PROJ-100", sp: 2 })),
      makeIssue("PROJ-2", storyFields({ epicKey: "PROJ-100", sp: 3 })),
    ];
    const { epics } = groupStoriesByEpic(issues, { "PROJ-100": 0.24 });
    expect(parseFloat(epics[0].sp)).toBe(5); // falls back to sum
  });

  it("ignores epicSpMap value of 0 and falls back to story sum", () => {
    const issues = [
      makeIssue("PROJ-1", storyFields({ epicKey: "PROJ-100", sp: 4 })),
    ];
    const { epics } = groupStoriesByEpic(issues, { "PROJ-100": 0 });
    expect(parseFloat(epics[0].sp)).toBe(4);
  });

  // ── Fix Version scope ───────────────────────────────────────────────────────
  it("uses story sum when scopeFixVersion is set and epic fix version differs", () => {
    // Epic PROJ-100 is tagged R1, stories are R1.1 — epic estimate is too broad
    const issues = [
      makeIssue("PROJ-1", storyFields({ epicKey: "PROJ-100", sp: 3 })),
      makeIssue("PROJ-2", storyFields({ epicKey: "PROJ-100", sp: 2 })),
    ];
    const epicSpMap = { "PROJ-100": 50 };
    const epicFixVersionMap = { "PROJ-100": ["R1"] };
    const { epics } = groupStoriesByEpic(issues, epicSpMap, epicFixVersionMap, "R1.1");
    expect(parseFloat(epics[0].sp)).toBe(5); // story sum — epic is R1, scope is R1.1
  });

  it("uses epic estimate when scopeFixVersion matches epic fix version", () => {
    const issues = [
      makeIssue("PROJ-1", storyFields({ epicKey: "PROJ-100", sp: 3 })),
    ];
    const epicSpMap = { "PROJ-100": 20 };
    const epicFixVersionMap = { "PROJ-100": ["R1.1"] };
    const { epics } = groupStoriesByEpic(issues, epicSpMap, epicFixVersionMap, "R1.1");
    expect(parseFloat(epics[0].sp)).toBe(3); // always story sum
  });

  it("uses story sum when story sum exceeds epic estimate even if scope matches", () => {
    const issues = [
      makeIssue("PROJ-1", storyFields({ epicKey: "PROJ-100", sp: 15 })),
      makeIssue("PROJ-2", storyFields({ epicKey: "PROJ-100", sp: 10 })),
    ];
    const epicSpMap = { "PROJ-100": 20 };
    const epicFixVersionMap = { "PROJ-100": ["R1.1"] };
    const { epics } = groupStoriesByEpic(issues, epicSpMap, epicFixVersionMap, "R1.1");
    expect(parseFloat(epics[0].sp)).toBe(25); // story sum wins even though scope matches
  });

  it("ignores scope rule when scopeFixVersion is empty", () => {
    const issues = [
      makeIssue("PROJ-1", storyFields({ epicKey: "PROJ-100", sp: 3 })),
    ];
    const epicSpMap = { "PROJ-100": 20 };
    const epicFixVersionMap = { "PROJ-100": ["R1"] };
    const { epics } = groupStoriesByEpic(issues, epicSpMap, epicFixVersionMap, "");
    expect(parseFloat(epics[0].sp)).toBe(3); // always story sum
  });

  it("scope check is case-insensitive", () => {
    const issues = [makeIssue("PROJ-1", storyFields({ epicKey: "PROJ-100", sp: 3 }))];
    const epicSpMap = { "PROJ-100": 20 };
    const epicFixVersionMap = { "PROJ-100": ["R1.1"] };
    const { epics } = groupStoriesByEpic(issues, epicSpMap, epicFixVersionMap, "r1.1");
    expect(parseFloat(epics[0].sp)).toBe(3); // always story sum
  });

  it("sets epic analysisDue to the latest story analysisDue", () => {
    const issues = [
      makeIssue("PROJ-1", storyFields({ epicKey: "PROJ-100", analysisDue: "2026-05-01" })),
      makeIssue("PROJ-2", storyFields({ epicKey: "PROJ-100", analysisDue: "2026-06-15" })),
      makeIssue("PROJ-3", storyFields({ epicKey: "PROJ-100", analysisDue: "2026-04-10" })),
    ];
    const { epics } = groupStoriesByEpic(issues);
    expect(epics[0].analysisDue).toBe("2026-06-15");
  });

  it("sets epic analysisDue to empty string when no story has one", () => {
    const issues = [
      makeIssue("PROJ-1", storyFields({ epicKey: "PROJ-100", analysisDue: null })),
    ];
    const { epics } = groupStoriesByEpic(issues);
    expect(epics[0].analysisDue).toBe("");
  });

  it("sets epic name and id from the epicKey", () => {
    const issues = [makeIssue("PROJ-1", storyFields({ epicKey: "PROJ-100" }))];
    const { epics } = groupStoriesByEpic(issues);
    expect(epics[0].name).toBe("PROJ-100");
    expect(epics[0].epicKey).toBe("PROJ-100");
    expect(epics[0].id).toBe("PROJ-100__import");
  });

  it("marks epics as source: jira", () => {
    const issues = [makeIssue("PROJ-1", storyFields({ epicKey: "PROJ-100" }))];
    const { epics } = groupStoriesByEpic(issues);
    expect(epics[0].source).toBe("jira");
  });

  it("storyMap contains Story objects, not raw issues", () => {
    const issues = [makeIssue("PROJ-1", storyFields({ epicKey: "PROJ-100", sp: 5 }))];
    const { storyMap } = groupStoriesByEpic(issues);
    // Story objects have .sp as a number (normalized), not a raw field value
    expect(typeof storyMap["PROJ-100"][0].sp).toBe("number");
    expect(storyMap["PROJ-100"][0].sp).toBe(5);
  });

  it("handles multiple epics with different SP maps", () => {
    const issues = [
      makeIssue("PROJ-1", storyFields({ epicKey: "PROJ-A", sp: 2 })),
      makeIssue("PROJ-2", storyFields({ epicKey: "PROJ-B", sp: 3 })),
    ];
    const epicSpMap = { "PROJ-A": 10, "PROJ-B": 0.24 };
    const { epics } = groupStoriesByEpic(issues, epicSpMap);
    const a = epics.find(e => e.epicKey === "PROJ-A");
    const b = epics.find(e => e.epicKey === "PROJ-B");
    expect(parseFloat(a.sp)).toBe(2); // always story sum
    expect(parseFloat(b.sp)).toBe(3); // always story sum
  });
});
