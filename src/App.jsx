import { useState, useMemo, useRef, Fragment, useEffect } from "react";
import {
  parseDate, fmtDate, calcSoloBuildDate, runPlan, addBizDaysFrom,
  calcStoryDates, calcFullFocusDate, bizDaysBetween,
} from "./planning.js";
import { fetchStoriesPaginated, fetchIssuesByKeys, updateIssue } from "./jiraService.js";
import { groupStoriesByEpic, STORY_FIELDS, F_SP, F_DEV_DUE, F_TEST_DUE } from "./epicGrouping.js";

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

function labelStyle() {
  return { display: "block", color: C.muted, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 3 };
}

function btnStyle(col, disabled = false) {
  return {
    background: col + "18", border: `1px solid ${col}44`, color: disabled ? C.muted : col,
    borderRadius: 6, padding: "7px 16px", fontSize: 11, letterSpacing: "0.08em",
    cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit", textTransform: "uppercase",
    opacity: disabled ? 0.6 : 1, transition: "all 0.15s",
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

function Tag({ children, color = C.accent, title }) {
  return (
    <span title={title} style={{
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
const mkEpic = () => ({ id: Math.random(), name: "", sp: "", analysisDue: "", maxDevs: "" });

function deriveRisks(epic, assignedEpic, extendedEpic, targetDateStr) {
  const reasons = [];
  const target = parseDate(targetDateStr);
  const sp = parseFloat(epic.sp) || 0;
  if (!(sp > 0))
    reasons.push({ code: "NO_SP", label: "Not estimated (0 SP)", sev: "error" });
  if (!epic.analysisDue)
    reasons.push({ code: "NO_ANALYSIS_DATE", label: "Missing analysis due date", sev: "warn" });
  else if (target && epic.analysisDue > target)
    reasons.push({ code: "ANALYSIS_AFTER_TARGET", label: `Analysis due ${fmtDate(epic.analysisDue)} — after target`, sev: "error" });
  if (sp > 0 && assignedEpic?.warning)
    reasons.push({ code: "CAPACITY_GAP", label: assignedEpic.warning, sev: "warn" });
  if (extendedEpic?.buildComplete && target && extendedEpic.buildComplete > target) {
    const days = Math.round((extendedEpic.buildComplete.getTime() - target.getTime()) / 86400000);
    reasons.push({ code: "LATE_BUILD", label: `Projected build ${fmtDate(extendedEpic.buildComplete)} — ${days}d late`, sev: "warn" });
  }
  return reasons;
}

function EpicInputTab({ epics, onChange, assignedEpics, extendedBuildMap, sprints, extendedSprints, perDevVelocityPerDay, teamSize, devDueMode, maxDevsPerEpic, targetDate, testWeeks = 6 }) {
  const [confirmClear, setConfirmClear] = useState(false);
  const [copied, setCopied] = useState(false);

  const sortedEpics = useMemo(() =>
    [...epics].sort((a, b) => {
      const da = a.analysisDue ? new Date(a.analysisDue).getTime() : Infinity;
      const db = b.analysisDue ? new Date(b.analysisDue).getTime() : Infinity;
      return da - db;
    })
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
    const modeLabel = devDueMode === "solo" ? "Solo" : "Planned";
    const header = ["Epic Name / ID","SP","Max Devs","Analysis Due","Fix Version","Full Focus Dev Due","Full Focus Test Due","Solo Dev Due Date","Planned Dev Due Date",`Test Due Date (${modeLabel})`,"Peak Devs","Sprint(s)","POD","Status"];
    const allSprints = extendedSprints || sprints;
    const rows = sortedEpics.map(ep => {
      const calc    = buildMap[ep.id];
      const extCalc = extendedBuildMap?.[ep.id];
      const solo    = calcSoloBuildDate(ep, perDevVelocityPerDay);
      const ff      = calcFullFocusDate(ep, perDevVelocityPerDay, teamSize);
      const effectiveSegs  = (calc?.warning && extCalc?.segments?.length > 0) ? extCalc.segments : (calc?.segments?.length > 0 ? calc.segments : extCalc?.segments);
      const effectiveBuild = (calc?.warning ? null : calc?.buildComplete) ?? extCalc?.buildComplete;
      const testDue     = effectiveBuild ? fmtDate(addBizDaysFrom(effectiveBuild, testWeeks * 5)) : "";
      const peakDevs    = effectiveSegs?.length > 0 ? Math.max(...effectiveSegs.map(s => s.devs)) : "";
      const sprintLabels = effectiveSegs?.length > 0
        ? effectiveSegs.map(s => (allSprints[s.sprintIdx]?.label ?? `S${s.sprintIdx}`).replace("Sprint ", "S")).join(", ")
        : "";
      return [
        ep.name,
        ep.sp,
        ep.maxDevs || "",
        ep.analysisDue,
        ep.fixVersion || "",
        ff ? fmtDate(ff) : "",
        ff ? fmtDate(addBizDaysFrom(ff, testWeeks * 5)) : "",
        solo ? fmtDate(solo) : "",
        effectiveBuild ? fmtDate(effectiveBuild) : "",
        testDue,
        peakDevs,
        sprintLabels,
        (assignedEpics.find(a => a.id === ep.id) ?? {}).pod || "",
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
              {["#","Epic Name / ID","SP","Max Devs ⓘ","Analysis Due","Fix Version","Full Focus ⓘ","Solo Dev Due Date ⓘ","Planned Dev Due Date ↗",`Test Due Date (via ${devDueMode === "solo" ? "Solo ★" : "Planned ★"})`  ,"Devs ⓘ","Sprint(s)","POD","Status","Risks",""].map(h => {
                const isSolo = h === "Solo Dev Due Date ⓘ";
                const isFF   = h === "Full Focus ⓘ";
                const isMaxDevs = h === "Max Devs ⓘ";
                const isTestDue = h.startsWith("Test Due");
                const isDevs = h === "Devs ⓘ";
                const isActive = (devDueMode === "solo" && isSolo) || (devDueMode === "planned" && h === "Planned Dev Due Date ↗");
                return (
                  <th key={h}
                    title={
                      isFF      ? `All ${teamSize} dev${teamSize !== 1 ? "s" : ""} swarm this epic immediately after analysis — theoretical lower bound, ignores contention` :
                      isSolo    ? "Projection for 1 dev, no contention" :
                      isMaxDevs ? `Max devs that can work this epic in parallel (overrides the global default of ${maxDevsPerEpic})` :
                      isTestDue ? `Derived from ${devDueMode === "solo" ? "Solo" : "Planned"} Dev Due Date` :
                      isDevs    ? "Peak devs allocated to this epic in any single sprint" : undefined
                    }
                    style={{ padding: "8px 12px", textAlign: "left",
                      color: isFF ? "#a78bfa" : isActive ? C.accent : isSolo ? C.mutedLight : C.muted,
                      fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: isActive ? 700 : 500,
                      whiteSpace: "nowrap", cursor: isFF || isSolo || isMaxDevs || isTestDue || isDevs ? "help" : "default" }}>{h}</th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedEpics.map((ep, i) => {
              const calc = buildMap[ep.id];
              const solo = calcSoloBuildDate(ep, perDevVelocityPerDay);
              const ff   = calcFullFocusDate(ep, perDevVelocityPerDay, teamSize);
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
                    <input value={ep.maxDevs ?? ""} onChange={e => update(ep.id, "maxDevs", e.target.value)}
                      type="number" min={1} placeholder={maxDevsPerEpic}
                      style={inputStyle({ width: 56 })} />
                  </td>
                  <td style={{ padding: "4px 8px" }}>
                    <input value={parseDate(ep.analysisDue) ? fmtDate(parseDate(ep.analysisDue)) : (ep.analysisDue ?? "")} onChange={e => update(ep.id, "analysisDue", e.target.value)}
                      placeholder="YYYY-MM-DD"
                      style={inputStyle({ width: 130 })} />
                  </td>
                  <td style={{ padding: "8px 12px", color: C.mutedLight, fontSize: 11, whiteSpace: "nowrap" }}>
                    {ep.fixVersion || "—"}
                  </td>
                  <td style={{ padding: "8px 12px", color: "#a78bfa", fontSize: 12, whiteSpace: "nowrap", fontWeight: 500 }}>
                    {ff ? fmtDate(ff) : "—"}
                  </td>
                  <td style={{ padding: "8px 12px", color: devDueMode === "solo" ? C.accent : C.mutedLight, fontSize: 12, whiteSpace: "nowrap", fontStyle: devDueMode === "solo" ? "normal" : "italic", fontWeight: devDueMode === "solo" ? 700 : 400 }}>
                    {solo ? fmtDate(solo) : "—"}
                  </td>
                  <td style={{ padding: "8px 12px", color: devDueMode === "planned" ? (calc?.warning ? C.accent2 : C.accent) : C.mutedLight, fontWeight: devDueMode === "planned" ? 700 : 400, fontSize: 13, whiteSpace: "nowrap" }}>
                    {(() => {
                      const isOverflow = !!calc?.warning;
                      const extBd = extendedBuildMap?.[ep.id]?.buildComplete;
                      if (!isOverflow && calc?.buildComplete) return fmtDate(calc.buildComplete);
                      if (extBd) return <span style={{ color: C.accent2 }} title="Projected build date — beyond target date">↗ {fmtDate(extBd)}</span>;
                      return "—";
                    })()}
                  </td>
                  <td style={{ padding: "8px 12px", color: C.amber, fontWeight: 700, fontSize: 13, whiteSpace: "nowrap" }}>
                    {(() => {
                      const isOverflow = !!calc?.warning;
                      const bd = (isOverflow ? null : calc?.buildComplete) ?? extendedBuildMap?.[ep.id]?.buildComplete;
                      const isExt = isOverflow || (!calc?.buildComplete && !!bd);
                      return bd
                        ? <span style={isExt ? { color: C.accent2 } : {}} title={isExt ? "Derived from projected overflow build date" : undefined}>{fmtDate(addBizDaysFrom(bd, testWeeks * 5))}{isExt ? " ↗" : ""}</span>
                        : "—";
                    })()}
                  </td>
                  <td style={{ padding: "8px 12px", color: C.mutedLight, fontSize: 12 }}>
                    {(() => {
                      const segs = calc?.segments?.length > 0 ? calc.segments : extendedBuildMap?.[ep.id]?.segments;
                      if (!segs?.length) return "—";
                      const peak = Math.max(...segs.map(s => s.devs));
                      const isExt = !calc?.segments?.length;
                      return <span style={isExt ? { color: C.accent2 } : {}}>{peak}</span>;
                    })()}
                  </td>
                  <td style={{ padding: "8px 12px", color: C.mutedLight, fontSize: 11, whiteSpace: "nowrap" }}>
                    {(() => {
                      const isOverflow = !!calc?.warning;
                      const segs = (isOverflow && extendedBuildMap?.[ep.id]?.segments?.length > 0)
                        ? extendedBuildMap[ep.id].segments
                        : (calc?.segments?.length > 0 ? calc.segments : extendedBuildMap?.[ep.id]?.segments);
                      const allSprints = extendedSprints || sprints;
                      if (!segs?.length) return "—";
                      const isExt = isOverflow || !calc?.segments?.length;
                      const labels = segs.map(s => (allSprints[s.sprintIdx]?.label ?? `S${s.sprintIdx}`).replace("Sprint ", "S")).join(", ");
                      return <span style={isExt ? { color: C.accent2 } : {}}>{labels}</span>;
                    })()}
                  </td>
              <td style={{ padding: "8px 12px", color: C.mutedLight, fontSize: 11, whiteSpace: "nowrap" }}>
                {ep.pod || "—"}
              </td>
                  <td style={{ padding: "8px 12px" }}>
                    {calc?.warning
                      ? <Tag color={C.accent2} title={calc.warning}>⚠ Overflow</Tag>
                      : calc?.buildComplete
                        ? <Tag color={devDueMode === "solo" ? C.amber : C.accent}>{devDueMode === "solo" ? "✓ Solo" : "✓ Scheduled"}</Tag>
                        : <Tag color={C.muted}>Pending</Tag>}
                  </td>
                  <td style={{ padding: "8px 12px" }}>
                    {(() => {
                      const risks = deriveRisks(ep, calc, extendedBuildMap?.[ep.id], targetDate);
                      if (!risks.length) return <span style={{ color: C.muted, fontSize: 10 }}>—</span>;
                      const hasError = risks.some(r => r.sev === "error");
                      const col = hasError ? C.accent2 : C.amber;
                      const tip = risks.map(r => `${r.sev === "error" ? "✕" : "⚠"} ${r.label}`).join("\n");
                      return <span title={tip} style={{ color: col, fontSize: 11, cursor: "help", fontWeight: 700 }}>● {risks.length}</span>;
                    })()}
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

// ── Sprint Demand (combined Demand Table + Epic Breakdown) ────────────────────
function SprintDemandTab({ sprintStats, uncappedStats, teamSize, staffingOverrides, onStaffingChange, onEpicClick, perDevVelocityPerDay, overflowSprintStats = [], targetDate, numSprints = 0 }) {
  const [openSet, setOpenSet] = useState(new Set());
  const [copied, setCopied] = useState(false);

  function toggle(key) {
    setOpenSet(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }
  function expandAll() {
    setOpenSet(new Set([...sprintStats.map((_, i) => i), ...overflowSprintStats.map((_, i) => `o${i}`)]));
  }
  function collapseAll() { setOpenSet(new Set()); }

  // Epic names that spill into overflow sprints (for ↗ late badge in main table)
  const overflowEpicNames = useMemo(
    () => new Set(overflowSprintStats.flatMap(s => s.activeEpics.map(e => e.name))),
    [overflowSprintStats]);
  // Overflow summary: unique epics + total SP
  const overflowEpicMap = useMemo(() => {
    const m = {};
    overflowSprintStats.forEach(s => s.activeEpics.forEach(e => { m[e.name] = e.sp; }));
    return m;
  }, [overflowSprintStats]);
  const overflowEpicCount = Object.keys(overflowEpicMap).length;
  const overflowTotalSP   = Object.values(overflowEpicMap).reduce((a, b) => a + (b || 0), 0);

  function copyCSV() {
    const headers = ["Sprint","Start","End","Biz Days","SP","Min Req","Staffed","Slack","Epic","Epic SP","Analysis Due","Devs (this sprint)","Dev-days (this sprint)"];
    const rows = [];
    sprintStats.forEach((s, i) => {
      const sprintSP = Math.round(s.activeEpics.reduce((sum, e) => sum + e.devDays, 0) * (perDevVelocityPerDay || 0));
      const minReq  = uncappedStats?.[i]?.devsNeeded ?? 0;
      const staffed = staffingOverrides[i] ?? teamSize;
      const gap     = staffed - (s.devsNeeded ?? 0);
      if (s.activeEpics.length === 0) {
        rows.push([s.label, fmtDate(s.start), fmtDate(s.end), s.bizDays, sprintSP, minReq, staffed, gap, "", "", "", "", ""]);
      } else {
        s.activeEpics.forEach((e, ei) => {
          rows.push([
            ei === 0 ? s.label : "",
            ei === 0 ? fmtDate(s.start) : "",
            ei === 0 ? fmtDate(s.end) : "",
            ei === 0 ? s.bizDays : "",
            ei === 0 ? sprintSP : "",
            ei === 0 ? minReq : "",
            ei === 0 ? staffed : "",
            ei === 0 ? gap : "",
            e.name, e.sp, e.analysisDue ? fmtDate(e.analysisDue) : "", e.devs.toFixed(1), e.devDays.toFixed(1),
          ]);
        });
      }
    });
    if (overflowSprintStats.length > 0) {
      rows.push([`--- BEYOND TARGET${targetDate ? ` (${targetDate})` : ""} ---`, "", "", "", "", "", "", "", "", "", "", "", ""]);
      overflowSprintStats.forEach((s, oi) => {
        const sprintSP    = Math.round(s.activeEpics.reduce((sum, e) => sum + e.devDays, 0) * (perDevVelocityPerDay || 0));
        const overflowIdx = s.idx;
        const oMinReq     = s.devsNeeded ?? 0;
        const oStaffed    = staffingOverrides[overflowIdx] ?? teamSize;
        const oGap        = oStaffed - oMinReq;
        if (s.activeEpics.length === 0) {
          rows.push([s.label, fmtDate(s.start), fmtDate(s.end), s.bizDays, sprintSP, oMinReq, oStaffed, oGap, "", "", "", "", ""]);
        } else {
          s.activeEpics.forEach((e, ei) => {
            rows.push([
              ei === 0 ? s.label : "",
              ei === 0 ? fmtDate(s.start) : "",
              ei === 0 ? fmtDate(s.end) : "",
              ei === 0 ? s.bizDays : "",
              ei === 0 ? sprintSP : "",
              ei === 0 ? oMinReq : "",
              ei === 0 ? oStaffed : "",
              ei === 0 ? oGap : "",
              e.name, e.sp, e.analysisDue ? fmtDate(e.analysisDue) : "", e.devs.toFixed(1), e.devDays.toFixed(1),
            ]);
          });
        }
      });
    }
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    navigator.clipboard.writeText(csv).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const allOpen = openSet.size === sprintStats.length + overflowSprintStats.length;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
        <button onClick={allOpen ? collapseAll : expandAll} style={{ background: "transparent", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 6, padding: "5px 12px", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
          {allOpen ? "Collapse All" : "Expand All"}
        </button>
        <button onClick={copyCSV} style={{
          background: copied ? C.accent + "22" : "transparent",
          border: `1px solid ${copied ? C.accent : C.border}`,
          color: copied ? C.accent : C.muted,
          borderRadius: 6, padding: "5px 12px", fontSize: 11, cursor: "pointer", fontFamily: "inherit",
          transition: "all 0.2s",
        }}>
          {copied ? "✓ Copied!" : "Copy CSV"}
        </button>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${C.border}` }}>
            {["Sprint","Start","End","Biz Days","SP ⓘ","Min Req ⓘ","Staffed ⓘ","Slack ⓘ",""].map((h, i) => (
              <th key={i} title={
                h === "SP ⓘ" ? "Story points of work in progress this sprint (sum of dev-days × velocity)" :
                h === "Min Req ⓘ" ? `Minimum devs needed to avoid slippage (uncapped plan). Beyond the target date${targetDate ? ` (${targetDate})` : ""} these are the devs needed to complete overflow work.` :
                h === "Staffed ⓘ" ? "Your planned headcount per sprint — edit inline. Applies to both in-target and overflow sprints." :
                h === "Slack ⓘ" ? `Positive = idle dev capacity this sprint. Zero with red SP = team fully packed but demand exceeds headcount — those SPs slip to overflow. Negative = active shortfall.` : undefined
              } style={{ padding: "9px 14px", textAlign: i === 8 ? "center" : "left", color: C.muted, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 500, whiteSpace: "nowrap", cursor: h.endsWith("ⓘ") ? "help" : "default" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sprintStats.map((s, i) => {
            const isOpen = openSet.has(i);
            const sprintSP = Math.round(s.activeEpics.reduce((sum, e) => sum + e.devDays, 0) * (perDevVelocityPerDay || 0));
            return (
              <Fragment key={i}>
                <tr
                  onClick={() => toggle(i)}
                  style={{ borderBottom: `1px solid ${C.border}22`, background: i % 2 === 0 ? "transparent" : C.surface + "55", cursor: "pointer" }}
                >
                  <td style={{ padding: "9px 14px", color: C.text, fontWeight: 600, whiteSpace: "nowrap" }}>{s.label}</td>
                  <td style={{ padding: "9px 14px", color: C.muted, whiteSpace: "nowrap" }}>{fmtDate(s.start)}</td>
                  <td style={{ padding: "9px 14px", color: C.muted, whiteSpace: "nowrap" }}>{fmtDate(s.end)}</td>
                  <td style={{ padding: "9px 14px", color: C.mutedLight }}>{s.bizDays}</td>
                  <td style={{ padding: "9px 14px", color: C.mutedLight, fontWeight: 600 }} title={`${sprintSP} SP in progress this sprint`}>{sprintSP > 0 ? sprintSP : "—"}</td>
                  {(() => {
                    const minReq  = uncappedStats?.[i]?.devsNeeded ?? 0;
                    const staffed = staffingOverrides[i] ?? teamSize;
                    const gap     = staffed - (s.devsNeeded ?? 0);
                    return <>
                      <td style={{ padding: "9px 14px", color: staffed < minReq ? C.accent2 : C.accent, fontWeight: 700, fontSize: 15 }}>{minReq}</td>
                      <td style={{ padding: "4px 8px" }} onClick={e => e.stopPropagation()}>
                        <input type="number" min={0} value={staffed}
                          onChange={e => onStaffingChange(i, Math.max(0, Number(e.target.value)))}
                          style={{ background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, padding: "3px 7px", fontSize: 13, width: 56, fontFamily: "inherit", outline: "none" }} />
                      </td>
                      <td style={{ padding: "9px 14px", color: gap < 0 ? C.accent2 : gap === 0 ? C.mutedLight : C.accent, fontWeight: 700 }}>
                        {(() => {
                          const spPerDev = (perDevVelocityPerDay || 0) * (s.bizDays || 0);
                          const spGap = Math.round(gap * spPerDev);
                          const demandShortfall = minReq - staffed;
                          const demandShortfallSP = demandShortfall > 0 ? Math.round(demandShortfall * spPerDev) : 0;
                          const gapStr = gap > 0 ? `+${gap}` : String(gap);
                          const spStr  = spGap > 0 ? `+${spGap}` : String(spGap);
                          const titleStr = `${gapStr} devs · ${spStr} SP equivalent${demandShortfallSP > 0 ? ` · −${demandShortfallSP} SP undeliverable (need ${demandShortfall} more devs)` : ''}`;
                          return <span title={titleStr}>{gapStr}{spGap !== 0 && <span style={{ color: spGap < 0 ? C.accent2 : C.mutedLight, fontWeight: spGap < 0 ? 700 : 400, fontSize: 10, marginLeft: 4 }}>({spStr} SP)</span>}{gap === 0 && demandShortfallSP > 0 && <span style={{ color: C.accent2, fontWeight: 700, fontSize: 10, marginLeft: 4 }}>(−{demandShortfallSP} SP)</span>}</span>;
                        })()}
                      </td>
                    </>;
                  })()}
                  <td style={{ padding: "9px 14px", textAlign: "center", color: C.accent, fontSize: 11 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 5, justifyContent: "center" }}>
                      <span style={{ color: C.muted, fontSize: 10 }}>{s.activeEpics.length} epic{s.activeEpics.length !== 1 ? "s" : ""}</span>
                      {isOpen ? "▲" : "▼"}
                    </span>
                  </td>
                </tr>
                {isOpen && (
                  <tr style={{ background: C.bg }}>
                    <td colSpan={9} style={{ padding: "0 0 6px 36px", borderBottom: `1px solid ${C.border}44` }}>
                      {s.activeEpics.length === 0
                        ? <span style={{ color: C.muted, fontSize: 12, display: "block", padding: "10px 0" }}>No epics active this sprint.</span>
                        : (
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginTop: 4 }}>
                            <thead>
                              <tr>{["Epic","Total SP","Analysis Due","Devs this sprint","Dev-days"].map(h => (
                                <th key={h} style={{ textAlign: "left", color: C.muted, padding: "4px 10px", fontWeight: 500, fontSize: 10, letterSpacing: "0.08em" }}>{h}</th>
                              ))}</tr>
                            </thead>
                            <tbody>
                              {s.activeEpics.map((e, ei) => {
                                const isLate = overflowEpicNames.has(e.name);
                                return (
                                  <tr key={ei} style={{ borderTop: `1px solid ${C.border}22`, background: isLate ? C.accent2 + "0d" : undefined }}>
                                    <td style={{ padding: "6px 10px", color: C.text }}>
                                      {onEpicClick
                                        ? <button onClick={() => onEpicClick(e.name)} style={{ background: "none", border: "none", color: C.accent, cursor: "pointer", fontFamily: "inherit", fontSize: 12, padding: 0, textDecoration: "underline dotted" }} title="Open in Write-back">{e.name}</button>
                                        : e.name}
                                      {isLate && <span style={{ marginLeft: 6, color: C.accent2, fontSize: 10 }} title="This epic extends beyond the target date">↗ late</span>}
                                    </td>
                                    <td style={{ padding: "6px 10px", color: C.muted }}>{(Math.ceil(parseFloat(e.sp || 0) * 100) / 100).toFixed(2)}</td>
                                    <td style={{ padding: "6px 10px", color: C.amber, whiteSpace: "nowrap" }}>{e.analysisDue ? fmtDate(e.analysisDue) : "—"}</td>
                                    <td style={{ padding: "6px 10px", color: C.accent, fontWeight: 700 }}>{e.devs.toFixed(1)}</td>
                                    <td style={{ padding: "6px 10px", color: C.mutedLight }}>{e.devDays.toFixed(1)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}

          {/* ── Target date divider ──────────────────────────────────────── */}
          {overflowSprintStats.length > 0 && (
            <tr>
              <td colSpan={9} style={{ padding: "10px 14px", borderTop: `2px dashed ${C.accent2}55`, borderBottom: `2px dashed ${C.accent2}55`, background: C.accent2 + "0a", textAlign: "center" }}>
                <span style={{ color: C.accent2, fontSize: 10, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase" }}>
                  ── TARGET DATE{targetDate ? ` (${targetDate})` : ""} ──
                </span>
              </td>
            </tr>
          )}

          {/* ── Overflow sprints ─────────────────────────────────────────── */}
          {overflowSprintStats.map((s, oi) => {
            const key = `o${oi}`;
            const isOpen = openSet.has(key);
            const overflowIdx = s.idx;
            const minReq  = s.devsNeeded ?? 0;
            const staffed = staffingOverrides[overflowIdx] ?? teamSize;
            const gap     = staffed - minReq;
            const daysAfterTarget = (() => {
              if (!targetDate) return null;
              const t = parseDate(targetDate);
              if (!t || !s.start) return null;
              return Math.max(0, Math.round((s.start.getTime() - t.getTime()) / 86400000));
            })();
            return (
              <Fragment key={key}>
                <tr
                  onClick={() => toggle(key)}
                  style={{ borderBottom: `1px solid ${C.accent2}22`, background: C.accent2 + "10", cursor: "pointer" }}
                >
                  <td style={{ padding: "9px 14px", fontWeight: 600, whiteSpace: "nowrap" }}>
                    <span style={{ color: C.accent2 }}>{s.label}</span>
                    <span style={{ marginLeft: 8, fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", color: C.accent2, opacity: 0.75 }}>⚠ BEYOND TARGET</span>
                    {daysAfterTarget !== null && <span style={{ marginLeft: 6, fontSize: 9, color: C.muted }}>+{daysAfterTarget}d</span>}
                  </td>
                  <td style={{ padding: "9px 14px", color: C.muted, whiteSpace: "nowrap" }}>{fmtDate(s.start)}</td>
                  <td style={{ padding: "9px 14px", color: C.muted, whiteSpace: "nowrap" }}>{fmtDate(s.end)}</td>
                  <td style={{ padding: "9px 14px", color: C.mutedLight }}>{s.bizDays}</td>
                  <td style={{ padding: "9px 14px", color: C.amber, fontWeight: 600 }} title={`${Math.round(s.activeEpics.reduce((sum, e) => sum + e.devDays, 0) * (perDevVelocityPerDay || 0))} SP in progress this overflow sprint`}>
                    {(() => { const sp = Math.round(s.activeEpics.reduce((sum, e) => sum + e.devDays, 0) * (perDevVelocityPerDay || 0)); return sp > 0 ? sp : "—"; })()}
                  </td>
                  <td style={{ padding: "9px 14px", color: staffed < minReq ? C.accent2 : C.amber, fontWeight: 700, fontSize: 15 }} title="Devs needed to complete overflow work in this sprint">{minReq}</td>
                  <td style={{ padding: "4px 8px" }} onClick={e => e.stopPropagation()}>
                    <input type="number" min={0} value={staffed}
                      onChange={e => onStaffingChange(overflowIdx, Math.max(0, Number(e.target.value)))}
                      style={{ background: C.bg, color: C.text, border: `1px solid ${C.accent2}55`, borderRadius: 4, padding: "3px 7px", fontSize: 13, width: 56, fontFamily: "inherit", outline: "none" }} />
                  </td>
                  <td style={{ padding: "9px 14px", color: gap < 0 ? C.accent2 : gap === 0 ? C.mutedLight : C.amber, fontWeight: 700 }}>
                    {(() => {
                      const spPerDev = (perDevVelocityPerDay || 0) * (s.bizDays || 0);
                      const spGap = Math.round(gap * spPerDev);
                      const demandShortfall = minReq - staffed;
                      const demandShortfallSP = demandShortfall > 0 ? Math.round(demandShortfall * spPerDev) : 0;
                      const gapStr = gap > 0 ? `+${gap}` : String(gap);
                      const spStr  = spGap > 0 ? `+${spGap}` : String(spGap);
                      const titleStr = `Slack = staffed minus devs used. Negative or red SP = shortfall for overflow work.${demandShortfallSP > 0 ? ` −${demandShortfallSP} SP undeliverable (need ${demandShortfall} more devs)` : ""}`;
                      return <span title={titleStr}>{gapStr}{spGap !== 0 && <span style={{ color: spGap < 0 ? C.accent2 : C.mutedLight, fontWeight: spGap < 0 ? 700 : 400, fontSize: 10, marginLeft: 4 }}>({spStr} SP)</span>}{gap === 0 && demandShortfallSP > 0 && <span style={{ color: C.accent2, fontWeight: 700, fontSize: 10, marginLeft: 4 }}>(−{demandShortfallSP} SP)</span>}</span>;
                    })()}
                  </td>
                  <td style={{ padding: "9px 14px", textAlign: "center", fontSize: 11 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 5, justifyContent: "center" }}>
                      <span style={{ color: C.muted, fontSize: 10 }}>{s.activeEpics.length} epic{s.activeEpics.length !== 1 ? "s" : ""}</span>
                      <span style={{ color: C.accent2 }}>{isOpen ? "▲" : "▼"}</span>
                    </span>
                  </td>
                </tr>
                {isOpen && (
                  <tr style={{ background: C.accent2 + "06" }}>
                    <td colSpan={9} style={{ padding: "0 0 6px 36px", borderBottom: `1px solid ${C.accent2}33` }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginTop: 4 }}>
                        <thead>
                          <tr>{["Epic","Total SP","Analysis Due","Devs this sprint","Dev-days"].map(h => (
                            <th key={h} style={{ textAlign: "left", color: C.muted, padding: "4px 10px", fontWeight: 500, fontSize: 10, letterSpacing: "0.08em" }}>{h}</th>
                          ))}</tr>
                        </thead>
                        <tbody>
                          {s.activeEpics.map((e, ei) => (
                            <tr key={ei} style={{ borderTop: `1px solid ${C.border}22`, background: C.accent2 + "08" }}>
                              <td style={{ padding: "6px 10px", color: C.text }}>
                                {onEpicClick
                                  ? <button onClick={() => onEpicClick(e.name)} style={{ background: "none", border: "none", color: C.accent, cursor: "pointer", fontFamily: "inherit", fontSize: 12, padding: 0, textDecoration: "underline dotted" }} title="Open in Write-back">{e.name}</button>
                                  : e.name}
                                <span style={{ marginLeft: 6, color: C.accent2, fontSize: 10 }}>↗ overflow</span>
                              </td>
                              <td style={{ padding: "6px 10px", color: C.muted }}>{(Math.ceil(parseFloat(e.sp || 0) * 100) / 100).toFixed(2)}</td>
                              <td style={{ padding: "6px 10px", color: C.amber, whiteSpace: "nowrap" }}>{e.analysisDue ? fmtDate(e.analysisDue) : "—"}</td>
                              <td style={{ padding: "6px 10px", color: C.accent, fontWeight: 700 }}>{e.devs.toFixed(1)}</td>
                              <td style={{ padding: "6px 10px", color: C.mutedLight }}>{e.devDays.toFixed(1)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}

          {/* ── Overflow summary ─────────────────────────────────────────── */}
          {overflowEpicCount > 0 && (
            <tr>
              <td colSpan={9} style={{ padding: "10px 14px", borderTop: `1px solid ${C.accent2}44`, background: C.accent2 + "08", textAlign: "right" }}>
                <span style={{ color: C.accent2, fontSize: 11, fontWeight: 600 }}>
                  {overflowEpicCount} epic{overflowEpicCount !== 1 ? "s" : ""} · {overflowTotalSP.toFixed(1)} SP scheduled beyond target date
                </span>
              </td>
            </tr>
          )}
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
function GanttView({ assignedEpics, sprints, extendedBuildMap, targetDate, extendedSprints }) {
  const colors = [C.accent,"#7c3aed","#ec4899",C.amber,C.accent2,"#06b6d4","#84cc16","#f97316","#a78bfa","#34d399"];
  if (!sprints.length || !assignedEpics.length) return <div style={{ color: C.muted, padding: "48px 0", textAlign: "center" }}>No data.</div>;

  // For overflow epics use extended plan segments; use extendedSprints for column lookup
  const allSprints = extendedSprints || sprints;
  const usedIndices = new Set();
  assignedEpics.forEach(ep => {
    const segs = (ep.warning && extendedBuildMap?.[ep.id]?.segments?.length)
      ? extendedBuildMap[ep.id].segments
      : (ep.segments || []);
    segs.forEach(s => usedIndices.add(s.sprintIdx));
  });
  const visibleSprints = allSprints.map((s, i) => ({ ...s, origIdx: i })).filter(s => usedIndices.has(s.origIdx));

  // Identify the sprint column that contains (or immediately follows) the target date
  const targetDateObj = targetDate ? parseDate(targetDate) : null;
  let targetColOrigIdx = -1;
  if (targetDateObj) {
    const t = targetDateObj.getTime();
    for (const s of visibleSprints) {
      if (s.start.getTime() <= t && t <= s.end.getTime()) { targetColOrigIdx = s.origIdx; break; }
    }
    if (targetColOrigIdx === -1) {
      const after = visibleSprints.find(s => s.start.getTime() > t);
      if (after) targetColOrigIdx = after.origIdx;
    }
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ padding: "6px 12px", textAlign: "left", color: C.muted, minWidth: 220, position: "sticky", left: 0, background: C.surface, zIndex: 2 }}>Epic</th>
            <th style={{ padding: "6px 10px", color: C.muted, minWidth: 50, textAlign: "center" }}>SP</th>
            <th style={{ padding: "6px 10px", color: C.muted, minWidth: 110, textAlign: "left", whiteSpace: "nowrap" }}>Build Complete</th>
            {visibleSprints.map(s => {
              const isTarget = s.origIdx === targetColOrigIdx;
              return (
                <th key={s.origIdx} style={{ padding: "4px 2px", color: isTarget ? C.accent2 : C.muted, minWidth: 38, textAlign: "center", borderLeft: isTarget ? `2px solid ${C.accent2}99` : undefined }}>
                  <div style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", height: 66, fontSize: 9 }}>
                    {isTarget && <span style={{ display: "block", marginBottom: 2, fontSize: 8 }}>◄ target</span>}
                    {s.label}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {assignedEpics.map((ep, ri) => {
            const color = colors[ri % colors.length];
            const isOverflow = !!ep.warning;
            const effectiveSegs = (isOverflow && extendedBuildMap?.[ep.id]?.segments?.length)
              ? extendedBuildMap[ep.id].segments
              : (ep.segments || []);
            const effectiveBuild = (isOverflow && extendedBuildMap?.[ep.id]?.buildComplete)
              ? extendedBuildMap[ep.id].buildComplete
              : ep.buildComplete;
            const segMap = {};
            effectiveSegs.forEach(seg => { segMap[seg.sprintIdx] = seg; });
            return (
              <tr key={ep.id} style={{ borderBottom: `1px solid ${C.border}22`, opacity: isOverflow ? 0.65 : 1 }}>
                <td style={{ padding: "6px 12px", color: isOverflow ? C.muted : C.text, position: "sticky", left: 0, background: C.surface, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={ep.name}>
                  {ep.name || `Epic ${ri + 1}`}
                  {isOverflow && <span style={{ marginLeft: 6, color: C.accent2, fontSize: 9 }}>↑ overflow</span>}
                </td>
                <td style={{ padding: "6px 10px", color: C.muted, textAlign: "center" }}>{(parseFloat(ep.sp)||0).toFixed(2)}</td>
                <td style={{ padding: "6px 10px", color: isOverflow ? C.accent2 : C.accent, fontWeight: 600, fontSize: 11, whiteSpace: "nowrap", fontStyle: isOverflow ? "italic" : "normal" }}>
                  {effectiveBuild ? fmtDate(effectiveBuild) : "—"}
                  {isOverflow && effectiveBuild && <span style={{ marginLeft: 4, fontSize: 9 }}>↗</span>}
                </td>
                {visibleSprints.map(s => {
                  const seg = segMap[s.origIdx];
                  const isTarget = s.origIdx === targetColOrigIdx;
                  return (
                    <td key={s.origIdx} style={{ padding: "3px 2px", textAlign: "center", borderLeft: isTarget ? `2px solid ${C.accent2}99` : undefined, background: isTarget ? C.accent2 + "09" : undefined }}>
                      {seg ? (
                        <div title={`${seg.devs} dev(s) · ${seg.devDays.toFixed(1)} dev-days`} style={{
                          background: isOverflow ? "transparent" : color,
                          border: isOverflow ? `1.5px dashed ${color}` : "none",
                          borderRadius: 3, height: 22, minWidth: 34,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 9, color: isOverflow ? color : "#000", fontWeight: 700,
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


// ── Jira Import Tab ─────────────────────────────────────────────────────────────
function JiraImportTab({ jiraBase, setJiraBase, jiraToken, setJiraToken, jiraJql, setJiraJql, fixVersionScope, setFixVersionScope, onImport, existingCount }) {
  const [showToken, setShowToken] = useState(false);
  const [status, setStatus] = useState(null);   // null | "loading" | "done" | "error"
  const [msg, setMsg] = useState("");
  const [progress, setProgress] = useState({ fetched: 0, total: 0 });
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const abortRef = useRef(null);

  async function doFetch() {
    const base  = jiraBase.trim().replace(/\/$/, "");
    const token = jiraToken.trim();
    const jql   = jiraJql.trim();
    if (!base || !token || !jql) {
      setMsg("Fill in Jira Base URL, Bearer Token, and JQL."); setStatus("error"); return;
    }
    sessionStorage.setItem("sp_jiraBase", base);
    sessionStorage.setItem("sp_jiraJql", jql);
    const ac = new AbortController();
    abortRef.current = ac;
    setStatus("loading"); setMsg(""); setProgress({ fetched: 0, total: 0 });
    const allIssues = [];
    try {
      await fetchStoriesPaginated({
        base, token, jql, fields: STORY_FIELDS, signal: ac.signal,
        onPage: (issues, _start, total) => {
          allIssues.push(...issues);
          setProgress({ fetched: allIssues.length, total });
        },
      });
      // Collect epic keys and fetch their SP + fixVersions from Jira
      const epicKeys = [...new Set(allIssues.map(i => i.fields?.["customfield_10002"]).filter(Boolean))];
      const epicSpMap = {};
      const epicFixVersionMap = {};
      if (epicKeys.length) {
        setProgress(p => ({ ...p, fetched: p.fetched }));
        const epicIssues = await fetchIssuesByKeys({ base, token, keys: epicKeys, fields: [F_SP, "fixVersions"], signal: ac.signal });
        epicIssues.forEach(i => {
          const sp = parseFloat(i.fields?.[F_SP]);
          if (sp > 0) epicSpMap[i.key] = sp;
          const fv = i.fields?.fixVersions;
          if (Array.isArray(fv) && fv.length) {
            epicFixVersionMap[i.key] = fv.map(v => v.name).filter(Boolean);
          }
        });
      }
      const { epics, storyMap, orphanStories } = groupStoriesByEpic(allIssues, epicSpMap, epicFixVersionMap, fixVersionScope);
      onImport(epics, storyMap);
      setStatus("done");
      const orphanNote = orphanStories.length ? ` · ${orphanStories.length} stories had no epic link (excluded)` : "";
      setMsg(`✓ ${allIssues.length} stories → ${epics.length} epic${epics.length !== 1 ? "s" : ""}${orphanNote}. Switched to Epic Input.`);
    } catch (e) {
      if (e.name === "AbortError") { setStatus(null); setMsg("Fetch stopped."); }
      else { setStatus("error"); setMsg(`Error: ${e.message}`); }
    } finally {
      abortRef.current = null;
    }
  }

  function handleFetch() {
    if (existingCount > 0 && !confirmOverwrite) { setConfirmOverwrite(true); return; }
    setConfirmOverwrite(false);
    doFetch();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 760 }}>
      <div style={{ color: C.muted, fontSize: 11, lineHeight: 1.8 }}>
        Fetch stories from Jira via the local proxy on{" "}
        <span style={{ color: C.accent }}>localhost:8765</span>. Stories are grouped by epic
        (customfield_10002). Results populate the{" "}
        <span style={{ color: C.accent }}>Epic Input</span> tab for planning and enable the{" "}
        <span style={{ color: C.accent }}>Write-back</span> tab for pushing dates back to Jira.
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <label style={labelStyle()}>Jira base URL</label>
          <input value={jiraBase} onChange={e => setJiraBase(e.target.value)}
            placeholder="https://your-company.atlassian.net/jira"
            style={inputStyle({ width: 280 })} />
        </div>
        <div>
          <label style={labelStyle()}>Bearer token</label>
          <div style={{ display: "flex", gap: 6 }}>
            <input value={jiraToken} onChange={e => setJiraToken(e.target.value)}
              type={showToken ? "text" : "password"} placeholder="PAT"
              style={inputStyle({ width: 200 })} />
            <button onClick={() => setShowToken(v => !v)} style={btnStyle(C.muted)}>
              {showToken ? "hide" : "show"}
            </button>
          </div>
        </div>
      </div>

      <div>
        <label style={labelStyle()}>JQL query</label>
        <textarea value={jiraJql} onChange={e => setJiraJql(e.target.value)} rows={4}
          placeholder={`project = BMO AND type in (Story,"Feature Configuration",Task) AND status in ("Analysis","Ready for Build","Build") ORDER BY cf[10002] ASC`}
          style={inputStyle({ width: "100%", resize: "vertical", lineHeight: 1.6 })} />
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <label style={labelStyle()} title="When set, epics whose Fix Version differs from this value will use story sum SP only (ignores epic estimate). Leave blank to always use epic estimate.">Fix Version scope <span style={{ color: C.muted }}>(optional)</span></label>
          <input value={fixVersionScope} onChange={e => { setFixVersionScope(e.target.value); sessionStorage.setItem("sp_fixVersionScope", e.target.value); }}
            placeholder="e.g. R1.1"
            style={inputStyle({ width: 140 })} />
        </div>
        <div style={{ color: C.muted, fontSize: 10, lineHeight: 1.5, paddingBottom: 4, maxWidth: 460 }}>
          If set: when the epic's Fix Version ≠ this value, story sum is used instead of the epic SP estimate.
          Useful when R1.1 stories belong to an R1 epic whose total estimate covers more than this scope.
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        {confirmOverwrite ? (
          <>
            <span style={{ color: C.amber, fontSize: 12 }}>⚠ This will replace {existingCount} existing epic{existingCount !== 1 ? "s" : ""}.</span>
            <button onClick={() => { setConfirmOverwrite(false); doFetch(); }} style={btnStyle(C.accent2)}>Confirm replace</button>
            <button onClick={() => setConfirmOverwrite(false)} style={btnStyle(C.muted)}>Cancel</button>
          </>
        ) : (
          <>
            <button onClick={handleFetch} disabled={status === "loading"} style={btnStyle(C.accent, status === "loading")}>
              {status === "loading"
                ? `Fetching… ${progress.fetched}${progress.total ? ` / ${progress.total}` : ""}`
                : "↓ Fetch from Jira"}
            </button>
            {status === "loading" && (
              <button onClick={() => abortRef.current?.abort()} style={btnStyle(C.accent2)}>✕ Stop</button>
            )}
          </>
        )}
      </div>

      {msg && (
        <div style={{
          padding: "10px 14px", borderRadius: 6, fontSize: 12,
          background: status === "error" ? C.accent2 + "15" : C.accent + "15",
          border: `1px solid ${status === "error" ? C.accent2 : C.accent}44`,
          color: status === "error" ? C.accent2 : C.accent,
        }}>{msg}</div>
      )}

      <div style={{ color: C.muted, fontSize: 10, lineHeight: 2, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
        <span style={{ color: C.mutedLight, letterSpacing: "0.08em" }}>FIELD MAPPING</span><br />
        Epic link <code style={{ color: C.amber }}>customfield_10002</code> &nbsp;·&nbsp;
        SP <code style={{ color: C.amber }}>customfield_10006</code> &nbsp;·&nbsp;
        Analysis Due <code style={{ color: C.amber }}>customfield_10304</code> (read) &nbsp;·&nbsp;
        Dev Due <code style={{ color: C.amber }}>customfield_10305</code> (write) &nbsp;·&nbsp;
        Test Due <code style={{ color: C.amber }}>customfield_10306</code> (write)
      </div>
    </div>
  );
}

// ── Write-back Tab ────────────────────────────────────────────────────────────
function WritebackTab({ storyMap, epicRows, perDevVelocityPerDay, jiraBase, jiraToken, focusEpicKey, testWeeks = 6 }) {
  const [selected, setSelected] = useState(new Set());
  const [statuses, setStatuses] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  // epicKey → string: user-overridden SP budget
  const [epicBudgets, setEpicBudgets] = useState({});

  // Scroll to the focused epic row when navigated from Sprint Demand
  useEffect(() => {
    if (!focusEpicKey) return;
    const el = document.getElementById(`wb-epic-${CSS.escape(focusEpicKey)}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusEpicKey]);

  // Build epic groups with proportional SP redistribution
  const epicGroups = useMemo(() => {
    return Object.entries(storyMap).map(([epicKey, stories]) => {
      const epicRow    = epicRows.find(e => e.epicKey === epicKey || e.name === epicKey);
      const sumStorySP = stories.reduce((s, st) => s + (parseFloat(st.sp) || 0), 0);
      // Default budget: from planned epic SP; fallback to raw story sum
      const planBudget = epicRow ? (parseFloat(epicRow.sp) || sumStorySP) : sumStorySP;
      const budgetStr  = epicBudgets[epicKey] ?? String(planBudget);
      const budget     = parseFloat(budgetStr) || Math.max(sumStorySP, 1);

      const rows = [...stories]
        .sort((a, b) => a.key.localeCompare(b.key))
        .map(story => {
          const stSP = parseFloat(story.sp) || 0;
          // Proportional share of epic budget; equal split when all SPs are 0
          const effectiveSP = sumStorySP > 0
            ? budget * (stSP / sumStorySP)
            : budget / Math.max(stories.length, 1);
          const { devDue, testDue } = calcStoryDates(story, perDevVelocityPerDay, effectiveSP, testWeeks * 5);
          const newDevDueStr  = devDue  ? fmtDate(devDue)  : null;
          const newTestDueStr = testDue ? fmtDate(testDue) : null;
          return {
            ...story, epicKey, effectiveSP,
            newDevDue: devDue, newTestDue: testDue, newDevDueStr, newTestDueStr,
            devChanged:  newDevDueStr  !== null && newDevDueStr  !== story.currentDevDue,
            testChanged: newTestDueStr !== null && newTestDueStr !== story.currentTestDue,
            hasDate: !!devDue,
          };
        });

      return { epicKey, planBudget, sumStorySP, budgetStr, rows };
    }).sort((a, b) => a.epicKey.localeCompare(b.epicKey));
  }, [storyMap, epicRows, epicBudgets, perDevVelocityPerDay]);

  const allRows        = useMemo(() => epicGroups.flatMap(g => g.rows), [epicGroups]);
  const selectableRows = allRows.filter(r => r.hasDate);
  const allSelected    = selectableRows.length > 0 && selectableRows.every(r => selected.has(r.key));

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(selectableRows.map(r => r.key)));
  }
  function toggleGroup(rows) {
    const keys = rows.filter(r => r.hasDate).map(r => r.key);
    const groupAllOn = keys.every(k => selected.has(k));
    setSelected(prev => {
      const next = new Set(prev);
      keys.forEach(k => groupAllOn ? next.delete(k) : next.add(k));
      return next;
    });
  }
  function toggle(key) {
    setSelected(prev => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; });
  }
  function setBudget(epicKey, val) {
    setEpicBudgets(prev => ({ ...prev, [epicKey]: val }));
  }

  async function handleSubmit() {
    const base  = jiraBase.trim().replace(/\/$/, "");
    const token = jiraToken.trim();
    if (!base || !token) return;

    // Only submit rows that have dates AND have actually changed
    const toSubmit = allRows.filter(r => selected.has(r.key) && r.hasDate && (r.devChanged || r.testChanged));
    if (!toSubmit.length) {
      setStatuses(prev => ({ ...prev, __info: "All selected stories already up to date \u2014 nothing to write." }));
      return;
    }

    setSubmitting(true);
    setProgress({ done: 0, total: toSubmit.length });
    setStatuses(prev => {
      const next = { ...prev };
      delete next.__info;
      toSubmit.forEach(r => { next[r.key] = "pending"; });
      return next;
    });

    const BATCH = 10;
    for (let i = 0; i < toSubmit.length; i += BATCH) {
      const batch = toSubmit.slice(i, i + BATCH);
      await Promise.all(batch.map(async row => {
        const fields = {};
        if (row.newDevDueStr)  fields[F_DEV_DUE]  = row.newDevDueStr;
        if (row.newTestDueStr) fields[F_TEST_DUE] = row.newTestDueStr;
        try {
          await updateIssue({ base, token, key: row.key, fields });
          setStatuses(prev => ({ ...prev, [row.key]: "ok" }));
        } catch (e) {
          setStatuses(prev => ({ ...prev, [row.key]: `error: ${e.message}` }));
        }
        setProgress(prev => ({ ...prev, done: prev.done + 1 }));
      }));
    }
    setSubmitting(false);
  }

  if (!Object.keys(storyMap).length) {
    return (
      <div style={{ color: C.muted, textAlign: "center", padding: "64px 0", fontSize: 13 }}>
        No Jira data loaded — use the <span style={{ color: C.accent }}>Jira Import</span> tab first.
      </div>
    );
  }

  const selectedCount   = allRows.filter(r => selected.has(r.key)).length;
  const changedCount    = allRows.filter(r => selected.has(r.key) && r.hasDate && (r.devChanged || r.testChanged)).length;
  const unchangedCount  = selectedCount - changedCount;
  const baseForLinks    = jiraBase.trim().replace(/\/$/, "");
  const canSubmit       = !submitting && selectedCount > 0 && !!jiraBase.trim() && !!jiraToken.trim();
  const submitLabel     = submitting
    ? `Submitting\u2026 ${progress.done} / ${progress.total}`
    : `\u2191 Submit ${changedCount} changed`;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 10 }}>
        <div style={{ color: C.muted, fontSize: 11, lineHeight: 1.8 }}>
          Eff. SP = epic budget × (story SP ÷ sum story SPs). Dev Due = Analysis Due + ⌈eff. SP ÷ {perDevVelocityPerDay.toFixed(3)}⌉ biz days. Test Due = Dev Due + {testWeeks * 5} biz days ({testWeeks} wks).
          Edit <span style={{ color: C.amber }}>SP budget</span> per epic to override.
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {statuses.__info && <span style={{ color: C.mutedLight, fontSize: 11 }}>{statuses.__info}</span>}
          {!submitting && unchangedCount > 0 && <span style={{ color: C.muted, fontSize: 11 }}>{unchangedCount} unchanged (will skip)</span>}
          <button onClick={handleSubmit} disabled={!canSubmit} style={btnStyle(C.accent, !canSubmit)}>
            {submitLabel}
          </button>
        </div>
      </div>

      {(!jiraBase.trim() || !jiraToken.trim()) && (
        <div style={{ padding: "8px 14px", background: C.amber + "15", border: `1px solid ${C.amber}44`, borderRadius: 6, color: C.amber, fontSize: 11, marginBottom: 10 }}>
          ⚠ Set Jira Base URL and Bearer Token in the Jira Import tab before submitting.
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              <th style={{ padding: "8px 10px", width: 32 }}>
                <input type="checkbox" checked={allSelected} onChange={toggleAll}
                  style={{ cursor: "pointer", accentColor: C.accent }} />
              </th>
              {["Story","Summary","Status","Product","POD","SP → Eff. SP","Analysis Due","New Dev Due","Curr Dev Due","New Test Due","Curr Test Due","Write-back"].map(h => (
                <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: C.muted, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 500, whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {epicGroups.map(({ epicKey, planBudget, sumStorySP, budgetStr, rows }) => {
              const groupKeys  = rows.filter(r => r.hasDate).map(r => r.key);
              const groupAllOn = groupKeys.length > 0 && groupKeys.every(k => selected.has(k));
              return [
                <tr key={`hdr-${epicKey}`} id={`wb-epic-${epicKey}`} style={{ background: focusEpicKey === epicKey ? C.accent + "18" : C.surface2, borderTop: `2px solid ${focusEpicKey === epicKey ? C.accent : C.border}`, transition: "background 0.4s" }}>
                  <td style={{ padding: "8px 10px", textAlign: "center" }}>
                    <input type="checkbox" checked={groupAllOn} onChange={() => toggleGroup(rows)}
                      disabled={groupKeys.length === 0 || submitting}
                      style={{ cursor: groupKeys.length > 0 ? "pointer" : "default", accentColor: C.accent }} />
                  </td>
                  <td colSpan={2} style={{ padding: "8px 10px" }}>
                    <span style={{ color: C.text, fontWeight: 700, fontSize: 13 }}>{epicKey}</span>
                    <span style={{ color: C.muted, fontSize: 10, marginLeft: 10 }}>
                      {rows.length} stor{rows.length !== 1 ? "ies" : "y"}
                    </span>
                  </td>
                  <td style={{ padding: "6px 10px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ color: C.muted, fontSize: 10 }}>SP budget</span>
                      <input type="number" min={0} step={1} value={budgetStr}
                        onChange={e => setBudget(epicKey, e.target.value)}
                        style={inputStyle({ width: 64, padding: "3px 7px" })} />
                      <span style={{ color: C.muted, fontSize: 10 }}>
                        plan: <span style={{ color: C.amber }}>{planBudget}</span>
                        &nbsp;· raw sum: <span style={{ color: C.mutedLight }}>{sumStorySP.toFixed(2)}</span>
                      </span>
                    </div>
                  </td>
                  <td colSpan={9} />
                </tr>,
                ...rows.map(row => {
                  const st = statuses[row.key];
                  const rowBg = st === "ok"             ? C.accent  + "10"
                              : st?.startsWith("error") ? C.accent2 + "10"
                              : "transparent";
                  return (
                    <tr key={row.key} style={{ borderBottom: `1px solid ${C.border}18`, background: rowBg }}>
                      <td style={{ padding: "5px 10px", textAlign: "center" }}>
                        <input type="checkbox" disabled={!row.hasDate || submitting}
                          checked={selected.has(row.key)} onChange={() => toggle(row.key)}
                          style={{ cursor: row.hasDate ? "pointer" : "default", accentColor: C.accent }} />
                      </td>
                      <td style={{ padding: "5px 10px", whiteSpace: "nowrap" }}>
                        <a href={`${baseForLinks}/browse/${row.key}`} target="_blank" rel="noopener"
                          style={{ color: C.accent, textDecoration: "none", fontWeight: 600 }}>{row.key}</a>
                      </td>
                      <td style={{ padding: "5px 10px", color: C.text, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.summary}>{row.summary}</td>
                      <td style={{ padding: "5px 10px", color: C.muted, whiteSpace: "nowrap", fontSize: 11 }}>{row.status || "\u2014"}</td>
                      <td style={{ padding: "5px 10px", color: C.muted, whiteSpace: "nowrap", fontSize: 11, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis" }} title={row.product}>{row.product || "\u2014"}</td>
                      <td style={{ padding: "5px 10px", color: C.muted, whiteSpace: "nowrap", fontSize: 11 }}>{row.pod || "\u2014"}</td>
                      <td style={{ padding: "5px 10px", whiteSpace: "nowrap" }}>
                        <span style={{ color: C.muted }}>{(parseFloat(row.sp) || 0).toFixed(2)}</span>
                        <span style={{ color: C.border, margin: "0 5px" }}>→</span>
                        <span style={{ color: C.accent, fontWeight: 700 }}>{row.effectiveSP.toFixed(2)}</span>
                      </td>
                      <td style={{ padding: "5px 10px", color: C.muted, whiteSpace: "nowrap" }}>
                        {row.analysisDue ? fmtDate(row.analysisDue) : "—"}
                      </td>
                      <td style={{ padding: "5px 10px", color: row.devChanged ? C.accent : C.muted, fontWeight: row.devChanged ? 700 : 400, whiteSpace: "nowrap" }}>
                        {row.newDevDueStr ?? "—"}
                      </td>
                      <td style={{ padding: "5px 10px", color: C.muted, whiteSpace: "nowrap" }}>
                        {row.currentDevDue ?? "—"}
                      </td>
                      <td style={{ padding: "5px 10px", color: row.testChanged ? C.amber : C.muted, fontWeight: row.testChanged ? 700 : 400, whiteSpace: "nowrap" }}>
                        {row.newTestDueStr ?? "—"}
                      </td>
                      <td style={{ padding: "5px 10px", color: C.muted, whiteSpace: "nowrap" }}>
                        {row.currentTestDue ?? "—"}
                      </td>
                      <td style={{ padding: "5px 10px", whiteSpace: "nowrap" }}>
                        {st === "ok"                    ? <Tag color={C.accent}>✓ Updated</Tag>
                          : st === "pending"            ? <Tag color={C.amber}>…</Tag>
                          : st?.startsWith("error")     ? <Tag color={C.accent2}>{st.replace("error: ", "").slice(0, 28)}</Tag>
                          : !row.hasDate                ? <Tag color={C.muted}>No date</Tag>
                          : row.devChanged || row.testChanged ? <Tag color={C.amber}>Changed</Tag>
                          : <Tag color={C.muted}>Same</Tag>}
                      </td>
                    </tr>
                  );
                }),
              ];
            })}
          </tbody>
        </table>
        {allRows.length === 0 && (
          <div style={{ color: C.muted, textAlign: "center", padding: "32px 0" }}>No stories found in story map.</div>
        )}
      </div>
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
  const [targetDate, setTargetDate] = useState("2026-09-28");
  const [sprintLengthDays, setSprintLengthDays] = useState(14);
  const [sprintStart, setSprintStart] = useState("2026-02-16");
  const [startSprintNum, setStartSprintNum] = useState(90);
  const [activeTab, setActiveTab] = useState("Epic Input");
  const [devDueMode, setDevDueMode] = useState("planned"); // "planned" | "solo"
  const [jiraBase, setJiraBase] = useState(() => sessionStorage.getItem("sp_jiraBase") || "");
  const [jiraToken, setJiraToken] = useState("");
  const [jiraJql, setJiraJql] = useState(() => sessionStorage.getItem("sp_jiraJql") || "");
  const [jiraFixVersionScope, setJiraFixVersionScope] = useState(() => sessionStorage.getItem("sp_fixVersionScope") || "");
  const [storyMap, setStoryMap] = useState({});
  const [writebackFocusKey, setWritebackFocusKey] = useState(null);
  const [maxDevsPerEpic, setMaxDevsPerEpic] = useState(2);
  const [staffingOverrides, setStaffingOverrides] = useState({});
  const [testWeeks, setTestWeeks] = useState(6);

  const { perDevVelocityPerDay, teamSize } = useMemo(() => {
    const rows = parseTSV(teamRaw);
    const vals = rows.slice(1).map(r => parseFloat(r[velCol])).filter(v => !isNaN(v) && v > 0);
    const size = vals.length || 1;
    return { perDevVelocityPerDay: vals.reduce((a, b) => a + b, 0) / size, teamSize: size };
  }, [teamRaw, velCol]);

  const parsedEpics = useMemo(() => epicRows.map(e => ({
    id: e.id, name: e.name, sp: parseFloat(e.sp) || 0, analysisDue: parseDate(e.analysisDue),
    maxDevs: parseInt(e.maxDevs) > 0 ? parseInt(e.maxDevs) : null,
    pod: e.pod || "",
  })), [epicRows]);

  const numSprints = useMemo(() => {
    const start = parseDate(sprintStart);
    const end   = parseDate(targetDate);
    if (!start || !end || end <= start) return 1;
    return Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (sprintLengthDays * 24 * 60 * 60 * 1000)));
  }, [sprintStart, targetDate, sprintLengthDays]);

  const totalDevsArray = useMemo(() =>
    Array.from({ length: numSprints }, (_, i) => staffingOverrides[i] ?? teamSize),
    [numSprints, staffingOverrides, teamSize]);

  // Uncapped plan: gives minimum required devs per sprint (reverse planning)
  const { sprintStats: uncappedStats } = useMemo(() => runPlan({
    epics: parsedEpics, perDevVelocityPerDay, totalDevs: 999,
    sprintStartDate: parseDate(sprintStart) || new Date("2026-02-16"),
    numSprints, startSprintNum, maxDevsPerEpic, sprintLengthDays,
  }), [parsedEpics, perDevVelocityPerDay, sprintStart, numSprints, startSprintNum, maxDevsPerEpic, sprintLengthDays]);

  const { sprintStats: teamSprintStats, assignedEpics: teamAssignedEpics, sprints: teamSprints } = useMemo(() => runPlan({
    epics: parsedEpics, perDevVelocityPerDay, totalDevs: totalDevsArray,
    sprintStartDate: parseDate(sprintStart) || new Date("2026-02-16"),
    numSprints, startSprintNum, maxDevsPerEpic, sprintLengthDays,
  }), [parsedEpics, perDevVelocityPerDay, totalDevsArray, sprintStart, numSprints, startSprintNum, maxDevsPerEpic, sprintLengthDays]);

  // Solo plan: 1 dev total — shows what sequential solo execution looks like
  const { sprintStats: soloSprintStats, assignedEpics: soloAssignedEpics, sprints: soloSprints } = useMemo(() => runPlan({
    epics: parsedEpics, perDevVelocityPerDay, totalDevs: 1,
    sprintStartDate: parseDate(sprintStart) || new Date("2026-02-16"),
    numSprints, startSprintNum, maxDevsPerEpic: 1, sprintLengthDays,
  }), [parsedEpics, perDevVelocityPerDay, sprintStart, numSprints, startSprintNum, sprintLengthDays]);

  const sprintStats    = devDueMode === "solo" ? soloSprintStats    : teamSprintStats;
  const assignedEpics  = devDueMode === "solo" ? soloAssignedEpics  : teamAssignedEpics;
  const sprints        = devDueMode === "solo" ? soloSprints        : teamSprints;

  // Extended plan: 3× horizon + 12 sprints — used for projected build dates beyond the window
  const extendedNumSprints = numSprints * 3 + 12;
  const { assignedEpics: extendedAssignedEpics, sprintStats: extendedSprintStats, sprints: extendedSprints } = useMemo(() => {
    const extDevsArray = Array.from({ length: extendedNumSprints }, (_, i) => staffingOverrides[i] ?? teamSize);
    return runPlan({
      epics: parsedEpics, perDevVelocityPerDay,
      totalDevs: devDueMode === "solo" ? 1 : extDevsArray,
      sprintStartDate: parseDate(sprintStart) || new Date("2026-02-16"),
      numSprints: extendedNumSprints, startSprintNum,
      maxDevsPerEpic: devDueMode === "solo" ? 1 : maxDevsPerEpic,
      sprintLengthDays,
    });
  }, [parsedEpics, perDevVelocityPerDay, devDueMode, staffingOverrides, teamSize, sprintStart, extendedNumSprints, startSprintNum, maxDevsPerEpic, sprintLengthDays]);
  const extendedBuildMap = useMemo(() => {
    const m = {};
    extendedAssignedEpics.forEach(e => { m[e.id] = e; });
    return m;
  }, [extendedAssignedEpics]);
  // Overflow sprints = extended plan sprints beyond the main window that have active epics
  const overflowSprintStats = useMemo(() =>
    extendedSprintStats.slice(numSprints).filter(s => s.activeEpics.length > 0),
    [extendedSprintStats, numSprints]);

  const totalSP = parsedEpics.reduce((a, e) => a + e.sp, 0);
  const scheduled = assignedEpics.filter(e => e.buildComplete && !e.warning).length;
  const warnings  = assignedEpics.filter(e => e.warning).length;

  // Scope risk metrics
  const overflowSP = useMemo(() =>
    assignedEpics.filter(e => e.warning).reduce((s, e) => s + (e.sp || 0), 0),
    [assignedEpics]);
  const targetDateObj = useMemo(() => parseDate(targetDate), [targetDate]);
  const remainingBizDays = useMemo(() => {
    const start = parseDate(sprintStart) || new Date();
    return targetDateObj ? bizDaysBetween(start, targetDateObj) : 0;
  }, [sprintStart, targetDateObj]);
  const devsNeededToClose = (overflowSP > 0 && remainingBizDays > 0 && perDevVelocityPerDay > 0)
    ? overflowSP / (perDevVelocityPerDay * remainingBizDays) : 0;

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

      {/* Scope risk banner */}
      {overflowSP > 0 && (
        <div style={{ background: C.accent2 + "18", borderBottom: `1px solid ${C.accent2}44`, padding: "7px 28px", display: "flex", alignItems: "center", gap: 20, fontSize: 11 }}>
          <span style={{ color: C.accent2, fontWeight: 700, letterSpacing: "0.06em" }}>⚠ SCOPE RISK</span>
          <span style={{ color: C.muted }}>{warnings} epic{warnings !== 1 ? "s" : ""} overflow the sprint window</span>
          <span style={{ color: C.accent2, fontWeight: 600 }}>{overflowSP.toFixed(1)} SP at risk</span>
          {devsNeededToClose > 0 && <span style={{ color: C.amber }}>≈ {devsNeededToClose.toFixed(1)} additional devs needed to close by target</span>}
        </div>
      )}

      <div style={{ display: "flex", minHeight: "calc(100vh - 68px)" }}>
        {/* Sidebar */}
        <div style={{ width: 272, borderRight: `1px solid ${C.border}`, padding: "18px 16px", flexShrink: 0, background: C.surface, display: "flex", flexDirection: "column", gap: 14, overflowY: "auto" }}>
          <div style={{ color: C.muted, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase" }}>● Sprint Config</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <label style={{ color: C.muted, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase" }}>Start sprint #</label>
              <input type="number" min={1} max={999} value={startSprintNum} onChange={e => setStartSprintNum(Number(e.target.value))}
                style={inputStyle({ width: "100%", marginTop: 3 })} />
            </div>
            <div>
              <label style={{ color: C.muted, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase" }}>Sprint days</label>
              <input type="number" min={1} max={30} value={sprintLengthDays} onChange={e => setSprintLengthDays(Math.max(1, Number(e.target.value)))}
                style={inputStyle({ width: "100%", marginTop: 3 })} />
            </div>
            <div style={{ gridColumn: "1/3" }}>
              <label style={{ color: C.muted, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase" }}>Sprint 1 start</label>
              <input type="date" value={sprintStart} onChange={e => setSprintStart(e.target.value)}
                style={inputStyle({ width: "100%", marginTop: 3 })} />
            </div>
            <div style={{ gridColumn: "1/3" }}>
              <label style={{ color: C.muted, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase" }} title="Planning horizon · drives sprint count and reverse-planning deadline">Target date ⓘ</label>
              <input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)}
                style={inputStyle({ width: "100%", marginTop: 3 })} />
            </div>
            <div style={{ gridColumn: "1/3", color: C.muted, fontSize: 10 }}>
              → <span style={{ color: C.accent }}>{numSprints} sprint{numSprints !== 1 ? "s" : ""}</span>
            </div>
          </div>

          <div style={{ height: 1, background: C.border }} />
          <div style={{ color: C.muted, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase" }}>● Concurrency</div>
          <div>
            <label style={{ color: C.muted, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase" }} title="Max devs that can work one epic simultaneously. Override per epic in Epic Input.">Max devs / epic ⓘ</label>
            <input type="number" min={1} max={teamSize} value={maxDevsPerEpic} onChange={e => setMaxDevsPerEpic(Math.max(1, Number(e.target.value)))}
              style={inputStyle({ width: 60, marginTop: 3 })} />
          </div>
          <div>
            <label style={{ color: C.muted, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase" }} title="Business weeks allocated for testing after build complete.">Test window ⓘ</label>
            <input type="number" min={1} max={52} value={testWeeks} onChange={e => setTestWeeks(Math.max(1, Math.min(52, Number(e.target.value) || 6)))}
              style={inputStyle({ width: 60, marginTop: 3 })} />
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
            → <span style={{ color: C.accent, fontWeight: 600 }}>{teamSize} devs</span> · <span style={{ color: C.accent, fontWeight: 600 }}>{perDevVelocityPerDay.toFixed(4)} SP/dev/day</span> · <span style={{ color: C.mutedLight, fontWeight: 500 }}>{(perDevVelocityPerDay * teamSize).toFixed(4)} SP/day total</span>
          </div>

          <div style={{ height: 1, background: C.border }} />
          <div style={{ color: C.muted, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase" }}>● Planning Mode</div>
          <div style={{ display: "flex", gap: 0, background: C.bg, borderRadius: 6, border: `1px solid ${C.border}`, overflow: "hidden" }}>
            {["planned", "solo"].map(mode => (
              <button key={mode} onClick={() => setDevDueMode(mode)} style={{
                flex: 1, background: devDueMode === mode ? C.accent + "22" : "none",
                border: "none", borderRight: mode === "planned" ? `1px solid ${C.border}` : "none",
                color: devDueMode === mode ? C.accent : C.muted,
                padding: "7px 0", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase",
                cursor: "pointer", fontFamily: "inherit", fontWeight: devDueMode === mode ? 700 : 400,
                transition: "all 0.15s",
              }}>{mode === "planned" ? "Team" : "Solo (1 dev)"}</button>
            ))}
          </div>
          <div style={{ color: C.muted, fontSize: 10, lineHeight: 1.7 }}>
            {devDueMode === "planned"
              ? <>Test Due = <span style={{ color: C.accent }}>Planned</span> build + 20 days. Sprint demand uses full team capacity.</>
              : <>Test Due = <span style={{ color: C.amber }}>Solo</span> build + 20 days. All views show 1-dev sequential execution.</>
            }
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
            tabs={["Epic Input","Jira Import","Write-back","Sprint Demand","Utilisation Chart","Gantt"]}
            active={activeTab}
            onChange={setActiveTab}
          />
          <div style={{ flex: 1, padding: "20px 24px", overflowY: "auto", overflowX: "auto" }}>
            {activeTab === "Epic Input" && <EpicInputTab epics={epicRows} onChange={setEpicRows} assignedEpics={assignedEpics} extendedBuildMap={extendedBuildMap} sprints={sprints} extendedSprints={extendedSprints} perDevVelocityPerDay={perDevVelocityPerDay} teamSize={teamSize} devDueMode={devDueMode} maxDevsPerEpic={maxDevsPerEpic} targetDate={targetDate} testWeeks={testWeeks} />}
            {activeTab === "Jira Import" && (
              <JiraImportTab
                jiraBase={jiraBase} setJiraBase={setJiraBase}
                jiraToken={jiraToken} setJiraToken={setJiraToken}
                jiraJql={jiraJql} setJiraJql={setJiraJql}
                fixVersionScope={jiraFixVersionScope} setFixVersionScope={setJiraFixVersionScope}
                existingCount={epicRows.filter(e => e.name || e.sp).length}
                onImport={(epics, sm) => { setEpicRows(epics); setStoryMap(sm); setActiveTab("Epic Input"); }}
              />
            )}
            {activeTab === "Write-back" && (
              <WritebackTab
                storyMap={storyMap}
                epicRows={epicRows}
                perDevVelocityPerDay={perDevVelocityPerDay}
                jiraBase={jiraBase}
                jiraToken={jiraToken}
                focusEpicKey={writebackFocusKey}
                testWeeks={testWeeks}
              />
            )}
            {activeTab === "Sprint Demand" && <SprintDemandTab sprintStats={sprintStats} uncappedStats={uncappedStats} teamSize={teamSize} staffingOverrides={staffingOverrides} onStaffingChange={(i, v) => setStaffingOverrides(prev => ({ ...prev, [i]: v }))} onEpicClick={epicKey => { setWritebackFocusKey(epicKey); setActiveTab("Write-back"); }} perDevVelocityPerDay={perDevVelocityPerDay} overflowSprintStats={overflowSprintStats} targetDate={targetDate} numSprints={numSprints} />}
            {activeTab === "Utilisation Chart" && <UtilChart sprintStats={sprintStats} teamSize={teamSize} />}
            {activeTab === "Gantt" && <GanttView assignedEpics={assignedEpics} sprints={sprints} extendedBuildMap={extendedBuildMap} targetDate={targetDate} extendedSprints={extendedSprints} />}
          </div>
        </div>
      </div>
    </div>
  );
}
