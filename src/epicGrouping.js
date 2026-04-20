import { parseDate, fmtDate } from "./planning.js";

// ── Jira field IDs ────────────────────────────────────────────────────────────
export const F_EPIC_LINK    = "customfield_10002";
export const F_SP           = "customfield_10006";
export const F_ANALYSIS_DUE = "customfield_10304";
export const F_DEV_DUE      = "customfield_10305";
export const F_TEST_DUE     = "customfield_10306";

export const STORY_FIELDS = [
  "summary", "status", "issuetype",
  F_EPIC_LINK, F_SP, F_ANALYSIS_DUE, F_DEV_DUE, F_TEST_DUE,
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
  };
}

/**
 * Group raw Jira issues by epic (customfield_10002).
 *
 * epicSpMap (optional): { epicKey: number } — SP from the actual Jira epic issue.
 *   When provided, epic SP = epicSpMap[epicKey] if present and > 0,
 *   otherwise falls back to sum of story SPs.
 *
 * Returns:
 *   epics         – EpicRow[] compatible with epicRows state
 *   storyMap      – { epicKey: Story[] }
 *   orphanStories – stories with no epic link
 *
 * Epic analysisDue = latest story analysisDue within the epic.
 */
export function groupStoriesByEpic(rawIssues, epicSpMap = {}) {
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
    const JIRA_DEFAULT_SP = 0.24;
    const epicSp = epicSpMap[epicKey];
    const epicSpIsUsable = epicSp != null && epicSp > 0 && epicSp !== JIRA_DEFAULT_SP;
    const totalSP = epicSpIsUsable ? epicSp : stories.reduce((sum, s) => sum + s.sp, 0);
    return {
      id:          `${epicKey}__import`,
      epicKey,
      name:        epicKey,
      sp:          String(totalSP),
      analysisDue: latestAnalysisDue ? fmtDate(latestAnalysisDue) : "",
      stories,
      source:      "jira",
    };
  });

  const storyMap = Object.fromEntries(byEpic); // plain object for React state
  return { epics, storyMap, orphanStories };
}
