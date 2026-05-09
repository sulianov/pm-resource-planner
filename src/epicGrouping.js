import { parseDate, fmtDate } from "./planning.js";

// ── Jira field IDs ────────────────────────────────────────────────────────────
export const F_EPIC_LINK    = "customfield_";
export const F_SP           = "customfield_";
export const F_ANALYSIS_DUE = "customfield_";
export const F_DEV_DUE      = "customfield_";
export const F_TEST_DUE     = "customfield_";
export const F_PRODUCT      = "customfield_";
export const F_POD          = "customfield_";

export const STORY_FIELDS = [
  "summary", "status", "issuetype",
  F_EPIC_LINK, F_SP, F_ANALYSIS_DUE, F_DEV_DUE, F_TEST_DUE, F_PRODUCT, F_POD,
];

// ── Story normaliser ──────────────────────────────────────────────────────────
export function normalizeStory(issue) {
  const f = issue.fields ?? {};
  const analysisDueRaw = f[F_ANALYSIS_DUE] ?? null;
  return {
    key:            issue.key,
    summary:        f.summary ?? "",
    sp:             parseFloat(f[F_SP]) || 0,
    analysisDue:    analysisDueRaw ? parseDate(analysisDueRaw) : null,  // Date | null
    currentDevDue:  f[F_DEV_DUE]  ?? null,                              // "YYYY-MM-DD" | null
    currentTestDue: f[F_TEST_DUE] ?? null,
    epicKey:        f[F_EPIC_LINK] ?? null,
    status:         f.status?.name ?? "",
    product:        f[F_PRODUCT]?.value ?? f[F_PRODUCT] ?? "",
    pod:            f[F_POD]?.value   ?? f[F_POD]   ?? "",
  };
}

/**
 * Group raw Jira issues by epic (customfield_).
 *
 * epicSpMap (optional): { epicKey: number } — SP from the actual Jira epic issue.
 *   When provided, epic SP = max(epicSp, storySum) so a larger story sum overrides
 *   the estimate, but the estimate is preserved when stories are a subset.
 *
 * epicFixVersionMap (optional): { epicKey: string[] } — fix version names on the epic.
 * scopeFixVersion (optional): string — e.g. "R1.1". When set, if the epic's fix
 *   versions do NOT include this scope (meaning the epic spans more work than this
 *   planning horizon), the epic SP estimate is ignored and only the fetched story sum
 *   is used. This prevents an R1 epic estimate from inflating an R1.1 plan.
 *
 * Returns:
 *   epics         – EpicRow[] compatible with epicRows state
 *   storyMap      – { epicKey: Story[] }
 *   orphanStories – stories with no epic link
 *
 * Epic analysisDue = latest story analysisDue within the epic.
 */
export function groupStoriesByEpic(rawIssues, epicSpMap = {}, epicFixVersionMap = {}, scopeFixVersion = "") {
  const byEpic = new Map();       // epicKey → Story[]
  const orphanStories = [];

  for (const issue of rawIssues) {
    const story = normalizeStory(issue);
    if (!story.epicKey) {
      orphanStories.push(story);
      continue;
    }
    if (!byEpic.has(story.epicKey)) byEpic.set(story.epicKey, []);
    byEpic.get(story.epicKey).push(story);
  }

  const epics = Array.from(byEpic.entries()).map(([epicKey, stories]) => {
    // analysisDue = latest story analysis due date
    let latestAnalysisDue = null;
    for (const s of stories) {
      if (s.analysisDue && (!latestAnalysisDue || s.analysisDue > latestAnalysisDue)) {
        latestAnalysisDue = s.analysisDue;
      }
    }
    const storySum = stories.reduce((sum, s) => sum + s.sp, 0);

    // Always use story sum — epic-level SP estimate is ignored.
    const totalSP = storySum;

    // Aggregate unique non-empty POD values from stories
    const pod = [...new Set(stories.map(s => s.pod).filter(Boolean))].join(", ");

    const fixVersion = (epicFixVersionMap[epicKey] || []).join(", ");

    return {
      id:          `${epicKey}__import`,
      epicKey,
      name:        epicKey,
      sp:          String(totalSP),
      analysisDue: latestAnalysisDue ? fmtDate(latestAnalysisDue) : "",
      pod,
      fixVersion,
      stories,
      source:      "jira",
    };
  });

  const storyMap = Object.fromEntries(byEpic); // plain object for React state
  return { epics, storyMap, orphanStories };
}
