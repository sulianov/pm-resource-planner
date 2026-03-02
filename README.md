# SPRINTPLAN Resource Engine

A React-based sprint planning tool for calculating development and test delivery timelines based on team velocity and epic data.

## What it does

- Takes a **team roster** with individual daily SP velocity
- Takes a list of **epics** with story points and analysis due dates
- Calculates per-epic:
  - **Solo Dev Due Date** — how long one average dev would take with no contention
  - **Planned Dev Due Date** — realistic date accounting for team parallelism and sprint capacity
  - **Test Due Date** — 4 weeks after planned dev completion
- Excludes Canadian federal bank holidays and weekends from all calculations
- Supports mixed date input formats (YYYY-MM-DD, M/D/YYYY, D-Mon, etc.)

## Views

| Tab | Description |
|-----|-------------|
| Epic Input | Paste or edit epics, see calculated dates inline |
| Demand Table | Sprint-by-sprint dev demand vs capacity |
| Utilisation Chart | Visual bar chart of team utilisation per sprint |
| Epic Breakdown | Collapsible per-sprint epic allocation detail |
| Gantt | Timeline view of epic scheduling across sprints |

## Stack

- React 19
- Vite 8
- Vitest (unit tests)
- No external UI libraries

## Getting started
```bash
npm install
npm run dev
```

## Running tests
```bash
npm test
```

## Input format

**Team velocity** — paste TSV from Excel:
```
Name    Role    Location    Velocity
Alice   Dev     Canada      0.475
Bob     Dev     Canada      0.226
```

**Epics** — paste TSV from Excel (Name · SP · Analysis Due):
```
BMO-1234    12    3/27/2026
BMO-5678    5     2026-04-15
```

## Notes

- Holidays covered: 2025–2027 Canadian federal bank holidays
- Planning logic uses greedy parallel packing — epics are sorted by analysis due date, then allocated across the team dev-day pool sprint by sprint
- Adding new epics with earlier analysis dates may shift existing planned dates
