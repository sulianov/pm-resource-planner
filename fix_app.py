with open(r'C:\sprint-planner\src\App.jsx', encoding='utf-8') as f:
    content = f.read()

# ── 1. Fix POD field ID in epicGrouping.js (already done separately) ──────────

# ── 2. Fix Epic Input header: replace old "Sprints","Status" with Devs + Sprint(s) + POD ──
old_ei_header = ',"Sprints","Status",""].map(h => {\n                const isSolo = h === "Solo Dev Due Date \u24d8";\n                const isFF   = h === "Full Focus \u24d8";\n                const isTestDue = h.startsWith("Test Due");\n                const isActive = (devDueMode === "solo" && isSolo) || (devDueMode === "planned" && h === "Planned Dev Due Date \u2197");\n                return (\n                  <th key={h}\n                    title={\n                      isFF      ? `All ${teamSize} dev${teamSize !== 1 ? "s" : ""} swarm this epic immediately after analysis \u2014 theoretical lower bound, ignores contention` :\n                      isSolo    ? "Projection for 1 dev, no contention" :\n                      isTestDue ? `Derived from ${devDueMode === "solo" ? "Solo" : "Planned"} Dev Due Date` : undefined\n                    }\n                    style={{ padding: "8px 12px", textAlign: "left",\n                      color: isFF ? "#a78bfa" : isActive ? C.accent : isSolo ? C.mutedLight : C.muted,\n                      fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: isActive ? 700 : 500,\n                      whiteSpace: "nowrap", cursor: isFF || isSolo || isTestDue ? "help" : "default" }}>{h}</th>'

new_ei_header = ',"Devs \u24d8","Sprint(s)","POD","Status",""].map(h => {\n                const isSolo = h === "Solo Dev Due Date \u24d8";\n                const isFF   = h === "Full Focus \u24d8";\n                const isTestDue = h.startsWith("Test Due");\n                const isDevs = h === "Devs \u24d8";\n                const isActive = (devDueMode === "solo" && isSolo) || (devDueMode === "planned" && h === "Planned Dev Due Date \u2197");\n                return (\n                  <th key={h}\n                    title={\n                      isFF      ? `All ${teamSize} dev${teamSize !== 1 ? "s" : ""} swarm this epic immediately after analysis \u2014 theoretical lower bound, ignores contention` :\n                      isSolo    ? "Projection for 1 dev, no contention" :\n                      isTestDue ? `Derived from ${devDueMode === "solo" ? "Solo" : "Planned"} Dev Due Date` :\n                      isDevs    ? "Peak devs allocated to this epic in any single sprint" : undefined\n                    }\n                    style={{ padding: "8px 12px", textAlign: "left",\n                      color: isFF ? "#a78bfa" : isActive ? C.accent : isSolo ? C.mutedLight : C.muted,\n                      fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: isActive ? 700 : 500,\n                      whiteSpace: "nowrap", cursor: isFF || isSolo || isTestDue || isDevs ? "help" : "default" }}>{h}</th>'

if old_ei_header in content:
    content = content.replace(old_ei_header, new_ei_header, 1)
    print('EI header OK')
else:
    print('EI header NOT FOUND')

# ── 3. Fix Epic Input cell: replace old Sprints count with Devs + Sprint(s) + POD ──
old_ei_cell = '                  <td style={{ padding: "8px 12px", color: C.mutedLight, fontSize: 12 }}>\n                    {calc?.segments?.length > 0 ? `${calc.segments.length}` : "\u2014"}\n                  </td>'
new_ei_cell = ('                  <td style={{ padding: "8px 12px", color: C.mutedLight, fontSize: 12 }}>\n'
               '                    {calc?.segments?.length > 0 ? Math.max(...calc.segments.map(s => s.devs)) : "\u2014"}\n'
               '                  </td>\n'
               '                  <td style={{ padding: "8px 12px", color: C.mutedLight, fontSize: 11, whiteSpace: "nowrap" }}>\n'
               '                    {calc?.segments?.length > 0\n'
               '                      ? calc.segments.map(s => (sprints[s.sprintIdx]?.label ?? `S${s.sprintIdx}`).replace("Sprint ", "S")).join(", ")\n'
               '                      : "\u2014"}\n'
               '                  </td>\n'
               '                  <td style={{ padding: "8px 12px", color: C.mutedLight, fontSize: 11, whiteSpace: "nowrap" }}>\n'
               '                    {(assignedEpics.find(a => a.id === ep.id) ?? {}).pod || "\u2014"}\n'
               '                  </td>')

if old_ei_cell in content:
    content = content.replace(old_ei_cell, new_ei_cell, 1)
    print('EI cell OK')
else:
    print('EI cell NOT FOUND')

# ── 4. Fix Copy CSV: add Peak Devs, Sprint(s), POD ────────────────────────────
old_csv_header = '"Peak Devs","Sprint(s)","Status"'
new_csv_header = '"Peak Devs","Sprint(s)","POD","Status"'
if old_csv_header in content:
    content = content.replace(old_csv_header, new_csv_header, 1)
    print('CSV header OK')
elif '"Sprints","Status"' in content:
    content = content.replace('"Sprints","Status"', '"Peak Devs","Sprint(s)","POD","Status"', 1)
    print('CSV header (old) OK')
else:
    print('CSV header NOT FOUND')

old_csv_vals = '        peakDevs,\n        sprintLabels,\n        calc?.warning ? "Overflow"'
new_csv_vals = '        peakDevs,\n        sprintLabels,\n        (assignedEpics.find(a => a.id === ep.id) ?? {}).pod || "",\n        calc?.warning ? "Overflow"'
if old_csv_vals in content:
    content = content.replace(old_csv_vals, new_csv_vals, 1)
    print('CSV vals OK')
else:
    # maybe peakDevs/sprintLabels not yet there
    old_csv_old = '        calc?.segments?.length ?? "",\n        calc?.warning ? "Overflow"'
    new_csv_old = '        peakDevs,\n        sprintLabels,\n        (assignedEpics.find(a => a.id === ep.id) ?? {}).pod || "",\n        calc?.warning ? "Overflow"'
    if old_csv_old in content:
        content = content.replace(old_csv_old, new_csv_old, 1)
        print('CSV vals (old) OK')
    else:
        print('CSV vals NOT FOUND')

# ── 5. Fix broken WritebackTab rows (corrupted from prev patch) ───────────────
# Locate and replace the entire broken rows.map block
broken_marker = '   8                <tr key={row.key}'
fixed_rows = '''                  return (
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
                        <span style={{ color: C.border, margin: "0 5px" }}>\u2192</span>
                        <span style={{ color: C.accent, fontWeight: 700 }}>{row.effectiveSP.toFixed(2)}</span>
                      </td>
                      <td style={{ padding: "5px 10px", color: C.muted, whiteSpace: "nowrap" }}>
                        {row.analysisDue ? fmtDate(row.analysisDue) : "\u2014"}
                      </td>
                      <td style={{ padding: "5px 10px", color: row.devChanged ? C.accent : C.muted, fontWeight: row.devChanged ? 700 : 400, whiteSpace: "nowrap" }}>
                        {row.newDevDueStr ?? "\u2014"}
                      </td>
                      <td style={{ padding: "5px 10px", color: C.muted, whiteSpace: "nowrap" }}>
                        {row.currentDevDue ?? "\u2014"}
                      </td>
                      <td style={{ padding: "5px 10px", color: row.testChanged ? C.amber : C.muted, fontWeight: row.testChanged ? 700 : 400, whiteSpace: "nowrap" }}>
                        {row.newTestDueStr ?? "\u2014"}
                      </td>
                      <td style={{ padding: "5px 10px", color: C.muted, whiteSpace: "nowrap" }}>
                        {row.currentTestDue ?? "\u2014"}
                      </td>
                      <td style={{ padding: "5px 10px", whiteSpace: "nowrap" }}>
                        {st === "ok"                    ? <Tag color={C.accent}>\u2713 Updated</Tag>
                          : st === "pending"            ? <Tag color={C.amber}>\u2026</Tag>
                          : st?.startsWith("error")     ? <Tag color={C.accent2}>{st.replace("error: ", "").slice(0, 28)}</Tag>
                          : !row.hasDate                ? <Tag color={C.muted}>No date</Tag>
                          : row.devChanged || row.testChanged ? <Tag color={C.amber}>Changed</Tag>
                          : <Tag color={C.muted}>Same</Tag>}
                      </td>
                    </tr>
                  );'''

if broken_marker in content:
    # Find start of the broken block and the end tr tag
    start = content.find(broken_marker)
    # Find the matching closing ); after the tr
    end = content.find('\n                  );\n                }),', start)
    if end != -1:
        end = end + len('\n                  );\n                }),')
        content = content[:start] + fixed_rows + '\n                }),\n' + content[end:]
        print('WB rows fixed (broken marker)')
    else:
        print('WB rows end NOT FOUND')
else:
    print('WB rows broken marker NOT FOUND - checking for existing correct version')
    if 'row.pod || "\\u2014"' in content or 'row.pod || "\u2014"' in content:
        print('WB rows already correct')
    else:
        print('WB rows unknown state')

# ── 6. Fix WritebackTab header: add Status, Product, POD if missing ───────────
old_wb_header = '"Story","Summary","SP \u2192 Eff. SP","Analysis Due","New Dev Due","Curr Dev Due","New Test Due","Curr Test Due","Status"'
new_wb_header = '"Story","Summary","Status","Product","POD","SP \u2192 Eff. SP","Analysis Due","New Dev Due","Curr Dev Due","New Test Due","Curr Test Due","Write-back"'
if old_wb_header in content:
    content = content.replace(old_wb_header, new_wb_header, 1)
    print('WB header fixed')
elif '"Story","Summary","Status","Product","POD"' in content:
    print('WB header already correct')
else:
    print('WB header unknown state - searching...')
    idx = content.find('"Story","Summary"')
    print(repr(content[idx:idx+200]))

# ── 7. Fix WB epic header colSpan ─────────────────────────────────────────────
# Should be 10 total columns (checkbox + 11 data cols, epic header uses colSpan for remainder)
# header cols: Story, Summary, Status, Product, POD, SP→Eff SP, Analysis Due, New Dev Due, Curr Dev Due, New Test Due, Curr Test Due, Write-back = 12 data cols
# epic header: checkbox(1) + colSpan(2) for epic name + sp budget(1) + colSpan(rest)
# rest = 12 - 3 = 9
for old_cs, new_cs in [('<td colSpan={6} />', '<td colSpan={9} />'),
                        ('<td colSpan={8} />', '<td colSpan={9} />')]:
    if old_cs in content:
        content = content.replace(old_cs, new_cs, 1)
        print(f'colSpan {old_cs} -> 9 OK')

with open(r'C:\sprint-planner\src\App.jsx', 'w', encoding='utf-8') as f:
    f.write(content)
print('DONE')
