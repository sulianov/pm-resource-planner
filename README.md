# sprint-planner

A React + Vite sprint planning tool for scheduling epics across sprints, reverse-planning headcount requirements, tracking scope burndown, and writing calculated due dates back to Jira.

## Features

### Planning engine
- **Sprint-centric greedy packing** — outer loop iterates sprints, inner loop iterates epics sorted by analysis due date. Freed capacity from the per-epic concurrency cap is immediately absorbed by the next epic in the queue.
- **Per-epic concurrency cap** (`Max Devs / epic`) — global default (sidebar) overridable per epic in the Epic Input tab. Prevents unrealistic swarming.
- **Per-sprint staffing overrides** — each sprint's headcount is individually editable in the Sprint Demand tab.
- **Reverse planning** — set a target date instead of a sprint count. The app computes how many sprints fit and shows a *Min Req* curve (minimum devs needed per sprint from an uncapped plan) alongside your *Staffed* headcount so you can see the gap at a glance.
- Excludes Canadian federal bank holidays and weekends from all business-day calculations (2025–2027).
- Supports mixed date input formats: `YYYY-MM-DD`, `M/D/YYYY`, `D-Mon`, etc.

### Jira integration
- **Import** epics and stories from Jira via a local proxy (`proxy.py`) — pulls SP, analysis/dev/test due dates, Fix Version, POD, and story breakdown.
- **Write-back** — push calculated Dev Due and Test Due dates back to Jira stories individually or in bulk.
- Always uses story sum SP (ignores epic-level SP estimate).

### Epic Input tab
| Column | Description |
|--------|-------------|
| SP | Story points (summed from Jira stories on import) |
| Max Devs ⓘ | Per-epic concurrency cap override |
| Analysis Due | Date analysis is complete — epics are not scheduled before this |
| Fix Version | Jira fix version (display only) |
| Full Focus | Theoretical best-case date if the whole team swarms this epic |
| Solo Dev Due Date | Date if one average dev worked it alone |
| Planned Dev Due Date | Realistic date from the team plan |
| Test Due Date | Planned Dev Due + configurable test window (default 6 wks) |
| Devs | Peak devs allocated in any single sprint |
| Sprint(s) | Sprints this epic is scheduled across |
| POD | Jira POD field |

Epics are sorted by analysis due date (oldest first, blanks last). Paste TSV from Excel or edit inline.

### Sprint Demand tab
| Column | Description |
|--------|-------------|
| Min Req ⓘ | Minimum devs needed to avoid slippage (from uncapped plan) |
| Staffed ⓘ | Your planned headcount — edit inline per sprint |
| Gap | Staffed − Min Req (red = understaffed, green = surplus) |

Editing *Staffed* immediately reruns the plan — Planned Dev Due dates and sprint assignments update reactively across all tabs.

### Burndown tab
Visualises cumulative scope burn across sprints relative to the target date.

| Element | Description |
|---------|-------------|
| Planned burndown | Solid line showing SP remaining after each sprint based on the team plan |
| Ideal line | Dashed reference line for perfectly linear burn from total SP → 0 |
| Target velocity line | Optional amber line — enter a uniform SP/sprint target to see where that pace lands |
| Overflow marker | Vertical dashed line at the target date boundary; overflow sprints shown in red |
| Schedule variance | Per-sprint table column: how many SP ahead or behind the ideal pace |

Stats strip shows total scope, average SP/sprint, remaining SP at end-of-plan, and overflow sprint count.

### Other tabs
| Tab | Description |
|-----|-------------|
| Jira Import | Import epics/stories from Jira, configure proxy URL and auth |
| Write-back | Review and push calculated dates back to Jira |
| Utilisation Chart | Visual bar chart of team utilisation per sprint |
| Gantt | Timeline view of epic scheduling across sprints |

### Sidebar — Sprint Config
- **Start sprint #** — label offset for sprint numbering
- **Sprint days** — sprint length in calendar days (default 14)
- **Sprint 1 start** — calendar date of the first sprint
- **Target date** — planning horizon; sprint count is auto-computed as `⌈(target − start) / sprintDays⌉`
- **Team size** and **velocity** inputs
- **Max devs / epic** — global concurrency cap
- **Test window** — business weeks allocated for testing after build complete (default 6)

### Session persistence
All inputs are automatically saved to `localStorage` (`sp_session_v1`) on a 400 ms debounce and restored on page refresh. This covers epics, team roster, sprint config, Jira settings, staffing overrides, story map, and all planning mode flags. The bearer token is intentionally excluded. A **Reset to defaults** button (double-confirm) in the sidebar clears the saved session and reloads to the built-in sample data.

## Stack

- React 19
- Vite 8
- Vitest (unit tests, 118 passing)
- No external UI libraries

## Getting started

```bash
npm install
npm run dev
```

Jira import requires the local proxy:

```bash
pip install flask flask-cors requests
python proxy.py
```

## Running tests

```bash
npm test
```

## Epic input format (paste from Excel)

Columns: **Epic Name / ID · SP · Analysis Due**

```
BMO-1234    12    3/27/2026
BMO-5678    5     2026-04-15
```

Additional columns (Max Devs, Fix Version) can be included or left blank.

## Team velocity format (paste from Excel)

```
Name      Role    Location    Velocity
Alice     Dev     Canada      0.475
Bob       Dev     Canada      0.226
```

## Notes

- Holidays covered: 2025–2027 Canadian federal bank holidays
- Epic SP always derived from story sum (epic estimate ignored)
- Jira field IDs: Epic Link `customfield_10002`, SP `customfield_10006`, Analysis Due `customfield_10304`, Dev Due `customfield_10305`, Test Due `customfield_10306`, Product `customfield_10123`, POD `customfield_12904`
