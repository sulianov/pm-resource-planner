import { useState, useMemo } from "react";
import {
  parseDate, fmtDate, calcSoloBuildDate, runPlan, addBizDaysFrom
} from "./planning.js";

// ── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg: "#0a0e14",
  surface: "#111720",
  surface2: "#1a2232",
  border: "#1e2d42",
  accent: "#00d9b8",
  accent2: "#ff5f3d",
  amber: "#f59e0b",
  text: "#dce8f5",
  muted: "#5a7a99",
  mutedLight: "#8aa5bf",
};

function parseTSV(raw) {
  return raw.trim().split("\n")
    .filter(l => l.trim())
    .map(l => l.split(/\t/).map(c => c.trim().replace(/^"|"$/g, "")));
}

// ── Shared UI ─────────────────────────────────────────────────────────────────
function inputStyle(extra = {}) {
  return {
    background: C.bg, color: C.text, border: `1px solid ${C.border}`,
    borderRadius: 5, padding: "5px 9px", fontSize: 12, outline: "none",
    fontFamily: "inherit", ...extra,
  };
}

function TabBar({ tabs, active, onChange }) {
  return (
    <div style={{ display: "flex", borderBottom: `1px solid ${C.border}` }}>
      {tabs.map(t => (
        <button key={t} onClick={() => onChange(t)} style={{
          background: "none", border: "none", cursor: "pointer",
          padding: "11px 18px", fontSize: 11, fontFamily: "inherit",
          letterSpacing: "0.09em", textTransform: "uppercase",
          color: active === t ? C.accent : C.muted,
          borderBottom: active === t ? `2px solid ${C.accent}` : "2px solid transparent",
        }}>{t}</button>
      ))}
    </div>
  );
}

function Tag({ children, color = C.accent }) {
  return (
    <span style={{
      background: color + "20", color, border: `1px solid ${color}40`,
      borderRadius: 4, padding: "1px 7px", fontSize: 10, letterSpacing: "0.05em", fontWeight: 600,
    }}>{children}</span>
  );
}

function UtilBar({ v, max }) {
  const pct = max > 0 ? Math.min(100, Math.round((v / max) * 100)) : 0;
  const col = pct > 100 ? C.accent2 : pct > 85 ? C.amber : C.accent;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ width: 70, height: 5, background: C.border, borderRadius: 3 }}>
        <div style={{ width: `${pct}%`, height: "100%", background: col, borderRadius: 3 }} />
      </div>
      <span style={{ color: C.mutedLight, fontSize: 11 }}>{pct}%</span>
    </div>
  );
}

// ── Epic Input Tab ────────────────────────────────────────────────────────────
const mkEpic = () => ({ id: Math.random(), name: "", sp: "", analysisDue: "" });

function EpicInputTab({ epics, onChange, assignedEpics, perDevVelocityPerDay }) {
  const [confirmClear, setConfirmClear] = useState(false);
  const [copied, setCopied] = useState(false);

  const sortedEpics = useMemo(() =>
    [...epics].sort((a, b) => (parseFloat(a.sp) || 0) - (parseFloat(b.sp) || 0))
  , [epics]);

  const buildMap = useMemo(() => {
    const m = {};
    assignedEpics.forEach(e => { m[e.id] = e; });
    return m;
  }, [assignedEpics]);

  function update(id, field, val) {
    onChange(epics.map(e => e.id === id ? { ...e, [field]: val } : e));
  }
  function addRow() { onChange([...epics, mkEpic()]); }
  function removeRow(id) { onChange(epics.filter(e => e.id !== id)); }

  function handleClear() {
    if (confirmClear) { onChange([]); setConfirmClear(false); }
    else { setConfirmClear(true); setTimeout(() => setConfirmClear(false), 3000); }
  }

  function handlePaste(rawEvt) {
    const text = rawEvt.clipboardData?.getData("text");
    if (!text) return;
    const rows = parseTSV(text);
    const isHeader = isNaN(parseFloat(rows[0]?.[1]));
    const dataRows = isHeader ? rows.slice(1) : rows;
    const newEpics = dataRows.filter(r => r[0]?.trim()).map(r => ({
      id: Math.random(), name: r[0] || "", sp: r[1] || "", analysisDue: r[2] || "",
    }));
    if (newEpics.length > 0) {
      rawEvt.preventDefault();
      onChange([...epics.filter(e => e.name || e.sp), ...newEpics]);
    }
  }

  function handleCopyCSV() {
    const header = ["Epic Name / ID","SP","Analysis Due","Solo Dev Due Date","Planned Dev Due Date","Test Due Date","Sprints","Status"];
    const rows = sortedEpics.map(ep => {
      const calc = buildMap[ep.id];
      const solo = calcSoloBuildDate(ep, perDevVelocityPerDay);
      return [
        ep.name,
        ep.sp,
        ep.analysisDue,
        solo ? fmtDate(solo) : "",
        calc?.buildComplete ? fmtDate(calc.buildComplete) : "",
        calc?.buildComplete ? fmtDate(addBizDaysFrom(calc.buildComplete, 20)) : "",
        calc?.segments?.length ?? "",
        calc?.warning ? "Overflow" : calc?.buildComplete ? "Scheduled" : "Pending",
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(",");
    });
    const csv = [header.join(","), ...rows].join("\n");
    navigator.clipboard.writeText(csv).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

    const today = new Date().toLocaleDateString("en-CA");

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ color: C.muted, fontSize: 11, letterSpacing: "0.08em" }}>
          Paste from Excel (Name · SP · Analysis Due) or edit inline. Build Complete is <span style={{ color: C.accent }}>calculated automatically</span>.
          <span style={{ marginLeft: 16, color: C.mutedLight }}>Today: <span style={{ color: C.amber, fontWeight: 600 }}>{today}</span></span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={handleCopyCSV} style={{
            background: copied ? C.accent + "22" : "transparent",
            border: `1px solid ${copied ? C.accent : C.border}`,
            color: copied ? C.accent : C.muted,
            borderRadius: 6, padding: "6px 14px", fontSize: 11, letterSpacing: "0.08em",
            cursor: "pointer", fontFamily: "inherit", textTransform: "uppercase",
            transition: "all 0.2s",
          }}>{copied ? "✓ Copied!" : "Copy CSV"}</button>
          <button onClick={handleClear} style={{
            background: confirmClear ? C.accent2 + "22" : "transparent",
            border: `1px solid ${confirmClear ? C.accent2 : C.border}`,
            color: confirmClear ? C.accent2 : C.muted,
            borderRadius: 6, padding: "6px 14px", fontSize: 11, letterSpacing: "0.08em",
            cursor: "pointer", fontFamily: "inherit", textTransform: "uppercase",
            transition: "all 0.2s",
          }}>{confirmClear ? "⚠ Confirm Clear" : "Clear All"}</button>
          <button onClick={addRow} style={{
            background: C.accent + "18", border: `1px solid ${C.accent}44`, color: C.accent,
            borderRadius: 6, padding: "6px 14px", fontSize: 11, letterSpacing: "0.08em",
            cursor: "pointer", fontFamily: "inherit", textTransform: "uppercase",
          }}>+ Add Row</button>
        </div>
      </div>

      <div style={{ overflowX: "auto" }} onPaste={handlePaste}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              {["#","Epic Name / ID","SP","Analysis Due","Solo Dev Due Date ⓘ","Planned Dev Due Date ↗","Test Due Date","Sprints","Status",""].map(h => (
                <th key={h} title={h === "Solo Dev Due Date ⓘ" ? "Projection for 1 dev, no contention — reference only" : undefined}
                  style={{ padding: "8px 12px", textAlign: "left", color: h === "Solo Dev Due Date ⓘ" ? C.mutedLight : C.muted, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 500, whiteSpace: "nowrap", cursor: h === "Solo Dev Due Date ⓘ" ? "help" : "default" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedEpics.map((ep, i) => {
              const calc = buildMap[ep.id];
              const solo = calcSoloBuildDate(ep, perDevVelocityPerDay);
              return (
                <tr key={ep.id} style={{ borderBottom: `1px solid ${C.border}18`, background: i % 2 === 0 ? "transparent" : C.surface + "55" }}>
                  <td style={{ padding: "6px 12px", color: C.muted, fontSize: 11 }}>{i + 1}</td>
                  <td style={{ padding: "4px 8px" }}>
                    <input value={ep.name} onChange={e => update(ep.id, "name", e.target.value)}
                      placeholder="Epic name or Jira ID"
                      style={inputStyle({ width: 230 })} />
                  </td>
                  <td style={{ padding: "4px 8px" }}>
                    <input value={ep.sp} onChange={e => update(ep.id, "sp", e.target.value)}
                      type="number" min={0} placeholder="SP"
                      style={inputStyle({ width: 64 })} />
                  </td>
                  <td style={{ padding: "4px 8px" }}>
                    <input value={ep.analysisDue} onChange={e => update(ep.id, "analysisDue", e.target.value)}
                      placeholder="YYYY-MM-DD"
                      style={inputStyle({ width: 130 })} />
                  </td>
                  <td style={{ padding: "8px 12px", color: C.mutedLight, fontSize: 12, whiteSpace: "nowrap", fontStyle: "italic" }}>
                    {solo ? fmtDate(solo) : "—"}
                  </td>
                  <td style={{ padding: "8px 12px", color: calc?.warning ? C.accent2 : C.accent, fontWeight: 700, fontSize: 13, whiteSpace: "nowrap" }}>
                    {calc?.buildComplete ? fmtDate(calc.buildComplete) : "—"}
                  </td>
                  <td style={{ padding: "8px 12px", color: C.amber, fontWeight: 700, fontSize: 13, whiteSpace: "nowrap" }}>
                    {calc?.buildComplete ? fmtDate(addBizDaysFrom(calc.buildComplete, 20)) : "—"}
                  </td>
                  <td style={{ padding: "8px 12px", color: C.mutedLight, fontSize: 12 }}>
                    {calc?.segments?.length > 0 ? `${calc.segments.length}` : "—"}
                  </td>
                  <td style={{ padding: "8px 12px" }}>
                    {calc?.warning
                      ? <Tag color={C.accent2}>⚠ Overflow</Tag>
                      : calc?.buildComplete
                        ? <Tag color={C.accent}>✓ Scheduled</Tag>
                        : <Tag color={C.muted}>Pending</Tag>}
                  </td>
                  <td style={{ padding: "4px 8px" }}>
                    <button onClick={() => removeRow(ep.id)} style={{
                      background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 16, padding: "2px 6px",
                    }}>×</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {epics.length === 0 && (
          <div style={{ color: C.muted, textAlign: "center", padding: "48px 0", fontSize: 13 }}>
            No epics yet — add a row or paste from Excel.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Demand Table ──────────────────────────────────────────────────────────────
function DemandTable({ sprintStats, teamSize }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${C.border}` }}>
            {["Sprint","Start","End","Biz Days","Devs Needed","Devs Free","Utilisation","Active Epics"].map(h => (
              <th key={h} style={{ padding: "9px 14px", textAlign: "left", color: C.muted, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 500, whiteSpace: "nowrap" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sprintStats.map((s, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${C.border}22`, background: i % 2 === 0 ? "transparent" : C.surface + "55" }}>
              <td style={{ padding: "9px 14px", color: C.text, fontWeight: 600, whiteSpace: "nowrap" }}>{s.label}</td>
              <td style={{ padding: "9px 14px", color: C.muted, whiteSpace: "nowrap" }}>{fmtDate(s.start)}</td>
              <td style={{ padding: "9px 14px", color: C.muted, whiteSpace: "nowrap" }}>{fmtDate(s.end)}</td>
              <td style={{ padding: "9px 14px", color: C.mutedLight }}>{s.bizDays}</td>
              <td style={{ padding: "9px 14px", color: s.devsNeeded > teamSize ? C.accent2 : C.accent, fontWeight: 700, fontSize: 15 }}>{s.devsNeeded}</td>
              <td style={{ padding: "9px 14px", color: s.devsFree < 0 ? C.accent2 : C.text }}>{s.devsFree}</td>
              <td style={{ padding: "9px 14px" }}><UtilBar v={s.devsNeeded} max={teamSize} /></td>
              <td style={{ padding: "9px 14px", color: C.mutedLight, fontSize: 11, maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {s.activeEpics.map(e => e.name).join(", ") || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Utilisation Chart ─────────────────────────────────────────────────────────
function UtilChart({ sprintStats, teamSize }) {
  if (!sprintStats.length) return null;
  const maxVal = Math.max(teamSize, ...sprintStats.map(s => s.devsNeeded), 1) * 1.15;
  const H = 200, W = 30, GAP = 6, PAD_L = 40, PAD_B = 60;
  const totalW = sprintStats.length * (W + GAP) + PAD_L + 20;

  return (
    <div style={{ overflowX: "auto" }}>
      <svg width={totalW} height={H + PAD_B + 20} style={{ display: "block", fontFamily: "inherit" }}>
        {[0, 0.25, 0.5, 0.75, 1].map(p => {
          const y = H - p * H + 10;
          return (
            <g key={p}>
              <line x1={PAD_L} y1={y} x2={totalW - 10} y2={y} stroke={C.border} strokeWidth={0.8} />
              <text x={PAD_L - 6} y={y + 4} textAnchor="end" fill={C.muted} fontSize={9}>{Math.round(maxVal * p)}</text>
            </g>
          );
        })}
        {(() => {
          const y = H - (teamSize / maxVal) * H + 10;
          return <>
            <line x1={PAD_L} y1={y} x2={totalW - 10} y2={y} stroke={C.accent2} strokeWidth={1.5} strokeDasharray="5 3" opacity={0.8} />
            <text x={PAD_L + 6} y={y - 4} fill={C.accent2} fontSize={9}>Capacity ({teamSize})</text>
          </>;
        })()}
        {sprintStats.map((s, i) => {
          const barH = Math.max((s.devsNeeded / maxVal) * H, 1);
          const x = PAD_L + i * (W + GAP);
          const y = H - barH + 10;
          const col = s.devsNeeded > teamSize ? C.accent2 : s.utilPct > 85 ? C.amber : C.accent;
          return (
            <g key={i}>
              <rect x={x} y={y} width={W} height={barH} fill={col} opacity={0.82} rx={3} />
              {s.devsNeeded > 0 && <text x={x + W / 2} y={y - 4} textAnchor="middle" fill={C.text} fontSize={9}>{s.devsNeeded}</text>}
              <text x={x + W / 2} y={H + 24} textAnchor="middle" fill={C.muted} fontSize={8}
                transform={`rotate(-50 ${x + W / 2} ${H + 24})`}>{s.label.replace("Sprint ", "S")}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── Gantt ─────────────────────────────────────────────────────────────────────
function GanttView({ assignedEpics, sprints }) {
  const colors = [C.accent,"#7c3aed","#ec4899",C.amber,C.accent2,"#06b6d4","#84cc16","#f97316","#a78bfa","#34d399"];
  if (!sprints.length || !assignedEpics.length) return <div style={{ color: C.muted, padding: "48px 0", textAlign: "center" }}>No data.</div>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ padding: "6px 12px", textAlign: "left", color: C.muted, minWidth: 220, position: "sticky", left: 0, background: C.surface, zIndex: 2 }}>Epic</th>
            <th style={{ padding: "6px 10px", color: C.muted, minWidth: 50, textAlign: "center" }}>SP</th>
            <th style={{ padding: "6px 10px", color: C.muted, minWidth: 110, textAlign: "left", whiteSpace: "nowrap" }}>Build Complete</th>
            {sprints.map((s, i) => (
              <th key={i} style={{ padding: "4px 2px", color: C.muted, minWidth: 38, textAlign: "center" }}>
                <div style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", height: 66, fontSize: 9 }}>{s.label}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {assignedEpics.map((ep, ri) => {
            const color = colors[ri % colors.length];
            const segMap = {};
            (ep.segments || []).forEach(seg => { segMap[seg.sprintIdx] = seg; });
            return (
              <tr key={ep.id} style={{ borderBottom: `1px solid ${C.border}22` }}>
                <td style={{ padding: "6px 12px", color: C.text, position: "sticky", left: 0, background: C.surface, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={ep.name}>{ep.name || `Epic ${ri + 1}`}</td>
                <td style={{ padding: "6px 10px", color: C.muted, textAlign: "center" }}>{ep.sp}</td>
                <td style={{ padding: "6px 10px", color: ep.warning ? C.accent2 : C.accent, fontWeight: 600, fontSize: 11, whiteSpace: "nowrap" }}>{fmtDate(ep.buildComplete)}</td>
                {sprints.map((_, si) => {
                  const seg = segMap[si];
                  return (
                    <td key={si} style={{ padding: "3px 2px", textAlign: "center" }}>
                      {seg ? (
                        <div title={`${seg.devs} dev(s) · ${seg.devDays.toFixed(1)} dev-days`} style={{
                          background: color, borderRadius: 3, height: 22, minWidth: 34,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 9, color: "#000", fontWeight: 700,
                        }}>{seg.devs}d</div>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Epic Breakdown ────────────────────────────────────────────────────────────
function EpicBreakdown({ sprintStats, teamSize }) {
  const [open, setOpen] = useState(null);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {sprintStats.map((s, i) => (
        <div key={i}>
          <button onClick={() => setOpen(open === i ? null : i)} style={{
            width: "100%", background: open === i ? C.surface2 : C.surface,
            border: `1px solid ${C.border}`, borderRadius: 6, padding: "10px 16px",
            color: C.text, cursor: "pointer", display: "flex", justifyContent: "space-between",
            alignItems: "center", fontFamily: "inherit", fontSize: 13,
          }}>
            <span style={{ fontWeight: 600 }}>{s.label}</span>
            <span style={{ display: "flex", gap: 16, alignItems: "center" }}>
              <span style={{ color: s.devsNeeded > teamSize ? C.accent2 : C.accent, fontWeight: 700 }}>{s.devsNeeded} devs</span>
              <span style={{ color: C.muted, fontSize: 11 }}>{s.activeEpics.length} epic{s.activeEpics.length !== 1 ? "s" : ""}</span>
              <UtilBar v={s.devsNeeded} max={teamSize} />
              <span style={{ color: C.accent }}>{open === i ? "▲" : "▼"}</span>
            </span>
          </button>
          {open === i && (
            <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderTop: "none", borderRadius: "0 0 6px 6px", padding: "12px 16px" }}>
              {s.activeEpics.length === 0
                ? <span style={{ color: C.muted, fontSize: 12 }}>No epics active this sprint.</span>
                : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr>{["Epic","Total SP","Devs this sprint","Dev-days"].map(h => (
                        <th key={h} style={{ textAlign: "left", color: C.muted, padding: "4px 10px", fontWeight: 500, fontSize: 10, letterSpacing: "0.08em" }}>{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody>
                      {s.activeEpics.map((e, ei) => (
                        <tr key={ei} style={{ borderTop: `1px solid ${C.border}22` }}>
                          <td style={{ padding: "7px 10px", color: C.text }}>{e.name}</td>
                          <td style={{ padding: "7px 10px", color: C.muted }}>{e.sp}</td>
                          <td style={{ padding: "7px 10px", color: C.accent, fontWeight: 700 }}>{e.devs}</td>
                          <td style={{ padding: "7px 10px", color: C.mutedLight }}>{e.devDays.toFixed(1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Sample data ───────────────────────────────────────────────────────────────
const SAMPLE_EPICS = [
  { id: 1, name: "BMO-69546 Payment Gateway", sp: "40", analysisDue: "2026-02-01" },
  { id: 2, name: "BMO-6498 KYC Onboarding", sp: "60", analysisDue: "2026-02-10" },
  { id: 3, name: "BMO-71234 Trade Blotter UI", sp: "25", analysisDue: "2026-03-01" },
  { id: 4, name: "BMO-80011 Margin Calculator", sp: "80", analysisDue: "2026-03-15" },
  { id: 5, name: "BMO-55321 Settlement Report", sp: "35", analysisDue: "2026-04-01" },
  { id: 6, name: "BMO-90123 Order Mgmt v2", sp: "90", analysisDue: "2026-04-20" },
  { id: 7, name: "BMO-44567 Risk Dashboard", sp: "50", analysisDue: "2026-05-01" },
];

const SAMPLE_TEAM = `Name\tRole\tTeam\tDaily Velocity
Alice Chen\tSenior Dev\tTrading\t8
Bob Kumar\tDev\tTrading\t6
Carol Smith\tSenior Dev\tC&S\t8
Dave Jones\tDev\tC&S\t6
Eve Martinez\tTech Lead\tTrading\t7
Frank Lee\tDev\tC&S\t6
Grace Park\tDev\tTrading\t6
Hannah White\tSenior Dev\tC&S\t8
Ian Brown\tDev\tTrading\t6
James Wilson\tDev\tC&S\t6`;

// ── Root ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [epicRows, setEpicRows] = useState(SAMPLE_EPICS);
  const [teamRaw, setTeamRaw] = useState(SAMPLE_TEAM);
  const [velCol, setVelCol] = useState(3);
  const [numSprints, setNumSprints] = useState(21);
  const [sprintStart, setSprintStart] = useState("2026-02-16");
  const [startSprintNum, setStartSprintNum] = useState(90);
  const [activeTab, setActiveTab] = useState("Epic Input");

  const { perDevVelocityPerDay, teamSize } = useMemo(() => {
    const rows = parseTSV(teamRaw);
    const vals = rows.slice(1).map(r => parseFloat(r[velCol])).filter(v => !isNaN(v) && v > 0);
    const size = vals.length || 1;
    return { perDevVelocityPerDay: vals.reduce((a, b) => a + b, 0) / size, teamSize: size };
  }, [teamRaw, velCol]);

  const parsedEpics = useMemo(() => epicRows.map(e => ({
    id: e.id, name: e.name, sp: parseFloat(e.sp) || 0, analysisDue: parseDate(e.analysisDue),
  })), [epicRows]);

  const { sprintStats, assignedEpics, sprints } = useMemo(() => runPlan({
    epics: parsedEpics, perDevVelocityPerDay, totalDevs: teamSize,
    sprintStartDate: parseDate(sprintStart) || new Date("2026-02-16"),
    numSprints, startSprintNum,
  }), [parsedEpics, perDevVelocityPerDay, teamSize, sprintStart, numSprints, startSprintNum]);

  const totalSP = parsedEpics.reduce((a, e) => a + e.sp, 0);
  const scheduled = assignedEpics.filter(e => e.buildComplete).length;
  const warnings = assignedEpics.filter(e => e.warning).length;

  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.text, fontFamily: "'DM Mono','Fira Code',monospace", fontSize: 14 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@700;800&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: ${C.bg}; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; }
        input:focus { border-color: ${C.accent}88 !important; }
        textarea { color-scheme: dark; }
        input[type=date] { color-scheme: dark; }
        input[type=number]::-webkit-inner-spin-button { opacity: 0.3; }
      `}</style>

      {/* Header */}
      <div style={{ borderBottom: `1px solid ${C.border}`, padding: "15px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", background: C.surface }}>
        <div>
          <div style={{ fontFamily: "Syne,sans-serif", fontSize: 17, fontWeight: 800, letterSpacing: "-0.04em" }}>
            <span style={{ color: C.accent }}>SPRINT</span><span style={{ color: C.text }}>PLAN</span>
            <span style={{ color: C.muted, fontSize: 10, fontWeight: 400, letterSpacing: "0.14em", marginLeft: 10 }}>RESOURCE ENGINE</span>
          </div>
          <div style={{ color: C.muted, fontSize: 10, marginTop: 2 }}>Mon–Fri · CA bank holidays excluded · greedy parallel packing</div>
        </div>
        <div style={{ display: "flex", gap: 24 }}>
          {[["Epics", epicRows.filter(e=>e.name||e.sp).length, C.text],["Scheduled",scheduled,C.accent],["Warnings",warnings,warnings>0?C.accent2:C.muted],["Total SP",totalSP.toFixed(2),C.amber],["Team",`${teamSize}d`,C.mutedLight]].map(([l,v,col])=>(
            <div key={l} style={{ textAlign: "right" }}>
              <div style={{ color: C.muted, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase" }}>{l}</div>
              <div style={{ color: col, fontFamily: "Syne,sans-serif", fontSize: 17, fontWeight: 700 }}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", minHeight: "calc(100vh - 68px)" }}>
        {/* Sidebar */}
        <div style={{ width: 272, borderRight: `1px solid ${C.border}`, padding: "18px 16px", flexShrink: 0, background: C.surface, display: "flex", flexDirection: "column", gap: 14, overflowY: "auto" }}>
          <div style={{ color: C.muted, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase" }}>● Sprint Config</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {[["Start sprint #",startSprintNum,setStartSprintNum,1,999],["# sprints",numSprints,setNumSprints,1,60]].map(([lbl,val,setter,min,max])=>(
              <div key={lbl}>
                <label style={{ color: C.muted, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase" }}>{lbl}</label>
                <input type="number" min={min} max={max} value={val} onChange={e=>setter(Number(e.target.value))}
                  style={inputStyle({ width: "100%", marginTop: 3 })} />
              </div>
            ))}
            <div style={{ gridColumn: "1/3" }}>
              <label style={{ color: C.muted, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase" }}>Sprint 1 start</label>
              <input type="date" value={sprintStart} onChange={e=>setSprintStart(e.target.value)}
                style={inputStyle({ width: "100%", marginTop: 3 })} />
            </div>
          </div>

          <div style={{ height: 1, background: C.border }} />
          <div style={{ color: C.muted, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase" }}>● Team Velocity</div>
          <div>
            <label style={{ color: C.muted, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase" }}>Velocity column (0-based)</label>
            <input type="number" min={0} value={velCol} onChange={e=>setVelCol(Number(e.target.value))}
              style={inputStyle({ width: 60, marginTop: 3 })} />
          </div>
          <textarea value={teamRaw} onChange={e=>setTeamRaw(e.target.value)}
            placeholder={"Name\tRole\tVelocity\nAlice\t...\t0.5"}
            spellCheck={false}
            style={{ ...inputStyle({ width: "100%", height: 160, resize: "vertical", lineHeight: 1.5 }) }} />
          <div style={{ color: C.muted, fontSize: 11 }}>
            → <span style={{ color: C.accent, fontWeight: 600 }}>{teamSize} devs</span> · <span style={{ color: C.accent, fontWeight: 600 }}>{perDevVelocityPerDay.toFixed(4)} SP/dev/day</span>
          </div>

          <div style={{ height: 1, background: C.border }} />
          <div style={{ padding: "10px 12px", background: C.surface2, borderRadius: 7, fontSize: 10, color: C.muted, lineHeight: 1.9 }}>
            <div style={{ color: C.mutedLight, marginBottom: 4 }}>LOGIC</div>
            Dev-days needed = SP ÷ avg daily vel<br/>
            Team size derived from pasted roster<br/>
            Epics start after analysis due date<br/>
            Mid-sprint start uses remaining biz days only<br/>
            Build complete = actual day work finishes<br/>
            Parallel packing up to team size
          </div>
        </div>

        {/* Main */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <TabBar
            tabs={["Epic Input","Demand Table","Utilisation Chart","Epic Breakdown","Gantt"]}
            active={activeTab}
            onChange={setActiveTab}
          />
          <div style={{ flex: 1, padding: "20px 24px", overflowY: "auto", overflowX: "auto" }}>
            {activeTab === "Epic Input" && <EpicInputTab epics={epicRows} onChange={setEpicRows} assignedEpics={assignedEpics} perDevVelocityPerDay={perDevVelocityPerDay} />}
            {activeTab === "Demand Table" && <DemandTable sprintStats={sprintStats} teamSize={teamSize} />}
            {activeTab === "Utilisation Chart" && <UtilChart sprintStats={sprintStats} teamSize={teamSize} />}
            {activeTab === "Epic Breakdown" && <EpicBreakdown sprintStats={sprintStats} teamSize={teamSize} />}
            {activeTab === "Gantt" && <GanttView assignedEpics={assignedEpics} sprints={sprints} />}
          </div>
        </div>
      </div>
    </div>
  );
}
