import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchStoriesPaginated,
  fetchIssuesByKeys,
  updateIssue,
} from "./jiraService.js";

// ── Fetch mock helpers ────────────────────────────────────────────────────────
function mockFetch(responses) {
  // responses: array of { ok, status, body } consumed in order
  let call = 0;
  return vi.fn().mockImplementation(() => {
    const r = responses[call++] ?? responses[responses.length - 1];
    return Promise.resolve({
      ok:     r.ok ?? true,
      status: r.status ?? 200,
      json:   () => Promise.resolve(r.body),
    });
  });
}

const CREDS = { base: "https://jira.example.com", token: "tok-abc" };
const FIELDS = ["summary", "customfield_10006"];

beforeEach(() => { vi.stubGlobal("fetch", undefined); });
afterEach(() => { vi.unstubAllGlobals(); });

// ════════════════════════════════════════════════════════════════════════════
// fetchStoriesPaginated
// ════════════════════════════════════════════════════════════════════════════
describe("fetchStoriesPaginated", () => {
  it("calls /api/jira with correct headers and body", async () => {
    const fetch = mockFetch([{ body: { issues: [], total: 0 } }]);
    vi.stubGlobal("fetch", fetch);

    await fetchStoriesPaginated({ ...CREDS, jql: "project=BMO", fields: FIELDS, onPage: () => {} });

    expect(fetch).toHaveBeenCalledOnce();
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe("http://localhost:8765/api/jira");
    expect(opts.method).toBe("POST");
    expect(opts.headers["Authorization"]).toBe("Bearer tok-abc");
    expect(opts.headers["X-Jira-Base"]).toBe("https://jira.example.com");
    const body = JSON.parse(opts.body);
    expect(body.jql).toBe("project=BMO");
    expect(body.fields).toEqual(FIELDS);
  });

  it("calls onPage for a single-page result", async () => {
    const issues = [{ key: "BMO-1" }, { key: "BMO-2" }];
    vi.stubGlobal("fetch", mockFetch([{ body: { issues, total: 2 } }]));

    const pages = [];
    await fetchStoriesPaginated({ ...CREDS, jql: "", fields: [], onPage: (iss) => pages.push(iss) });

    expect(pages).toHaveLength(1);
    expect(pages[0]).toEqual(issues);
  });

  it("paginates across multiple pages", async () => {
    const page1 = [{ key: "BMO-1" }];
    const page2 = [{ key: "BMO-2" }];
    vi.stubGlobal("fetch", mockFetch([
      { body: { issues: page1, total: 2 } },
      { body: { issues: page2, total: 2 } },
    ]));

    const allIssues = [];
    await fetchStoriesPaginated({ ...CREDS, jql: "", fields: [], onPage: (iss) => allIssues.push(...iss) });

    expect(allIssues).toHaveLength(2);
    expect(allIssues[0].key).toBe("BMO-1");
    expect(allIssues[1].key).toBe("BMO-2");
  });

  it("stops pagination when issues array is empty (guard against infinite loop)", async () => {
    // total says 5 but second page returns empty — should stop
    vi.stubGlobal("fetch", mockFetch([
      { body: { issues: [{ key: "BMO-1" }], total: 5 } },
      { body: { issues: [],                 total: 5 } },
    ]));

    const allIssues = [];
    await fetchStoriesPaginated({ ...CREDS, jql: "", fields: [], onPage: (iss) => allIssues.push(...iss) });

    expect(allIssues).toHaveLength(1);
  });

  it("throws an error on non-ok HTTP response", async () => {
    vi.stubGlobal("fetch", mockFetch([{
      ok: false, status: 401,
      body: { errorMessages: ["Unauthorized"] },
    }]));

    await expect(
      fetchStoriesPaginated({ ...CREDS, jql: "", fields: [] })
    ).rejects.toThrow("Unauthorized");
  });

  it("throws HTTP status when error body has no errorMessages", async () => {
    vi.stubGlobal("fetch", mockFetch([{ ok: false, status: 500, body: {} }]));

    await expect(
      fetchStoriesPaginated({ ...CREDS, jql: "", fields: [] })
    ).rejects.toThrow("HTTP 500");
  });

  it("passes AbortSignal through to fetch", async () => {
    const fetch = mockFetch([{ body: { issues: [], total: 0 } }]);
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();

    await fetchStoriesPaginated({ ...CREDS, jql: "", fields: [], signal: controller.signal });

    expect(fetch.mock.calls[0][1].signal).toBe(controller.signal);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// fetchIssuesByKeys
// ════════════════════════════════════════════════════════════════════════════
describe("fetchIssuesByKeys", () => {
  it("fetches a single chunk of up to 50 keys", async () => {
    const issues = [{ key: "BMO-1" }, { key: "BMO-2" }];
    const fetch = mockFetch([{ body: { issues } }]);
    vi.stubGlobal("fetch", fetch);

    const result = await fetchIssuesByKeys({ ...CREDS, keys: ["BMO-1", "BMO-2"], fields: FIELDS });

    expect(fetch).toHaveBeenCalledOnce();
    expect(result).toEqual(issues);
  });

  it("generates JQL with key in (...) clause", async () => {
    const fetch = mockFetch([{ body: { issues: [] } }]);
    vi.stubGlobal("fetch", fetch);

    await fetchIssuesByKeys({ ...CREDS, keys: ["BMO-1", "BMO-2"], fields: [] });

    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.jql).toContain("BMO-1");
    expect(body.jql).toContain("BMO-2");
    expect(body.jql).toMatch(/key in/i);
  });

  it("splits 51 keys into two chunks of 50 and 1", async () => {
    const keys = Array.from({ length: 51 }, (_, i) => `BMO-${i + 1}`);
    const fetch = mockFetch([
      { body: { issues: keys.slice(0, 50).map(k => ({ key: k })) } },
      { body: { issues: keys.slice(50).map(k => ({ key: k }))   } },
    ]);
    vi.stubGlobal("fetch", fetch);

    const result = await fetchIssuesByKeys({ ...CREDS, keys, fields: [] });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(51);
  });

  it("returns empty array for empty key list", async () => {
    vi.stubGlobal("fetch", mockFetch([]));

    const result = await fetchIssuesByKeys({ ...CREDS, keys: [], fields: [] });

    expect(result).toEqual([]);
  });

  it("throws on non-ok HTTP response", async () => {
    vi.stubGlobal("fetch", mockFetch([{ ok: false, status: 403, body: { errorMessages: ["Forbidden"] } }]));

    await expect(
      fetchIssuesByKeys({ ...CREDS, keys: ["BMO-1"], fields: [] })
    ).rejects.toThrow("Forbidden");
  });

  it("concatenates results from all chunks", async () => {
    const chunk1 = Array.from({ length: 50 }, (_, i) => ({ key: `BMO-${i}` }));
    const chunk2 = [{ key: "BMO-50" }];
    vi.stubGlobal("fetch", mockFetch([
      { body: { issues: chunk1 } },
      { body: { issues: chunk2 } },
    ]));

    const keys = [...chunk1.map(i => i.key), "BMO-50"];
    const result = await fetchIssuesByKeys({ ...CREDS, keys, fields: [] });

    expect(result).toHaveLength(51);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// updateIssue
// ════════════════════════════════════════════════════════════════════════════
describe("updateIssue", () => {
  it("calls /api/jira/update with correct method and headers", async () => {
    const fetch = mockFetch([{ status: 204, body: {} }]);
    vi.stubGlobal("fetch", fetch);

    await updateIssue({ ...CREDS, key: "BMO-1", fields: { customfield_10305: "2026-06-01" } });

    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe("http://localhost:8765/api/jira/update");
    expect(opts.method).toBe("POST");
    expect(opts.headers["Authorization"]).toBe("Bearer tok-abc");
    expect(opts.headers["X-Jira-Base"]).toBe("https://jira.example.com");
  });

  it("sends key and fields in the request body", async () => {
    const fetch = mockFetch([{ status: 200, body: {} }]);
    vi.stubGlobal("fetch", fetch);

    const fields = { customfield_10305: "2026-07-01" };
    await updateIssue({ ...CREDS, key: "BMO-42", fields });

    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.key).toBe("BMO-42");
    expect(body.fields).toEqual(fields);
  });

  it("returns the HTTP status code on success", async () => {
    vi.stubGlobal("fetch", mockFetch([{ status: 204, body: {} }]));

    const status = await updateIssue({ ...CREDS, key: "BMO-1", fields: {} });

    expect(status).toBe(204);
  });

  it("throws on non-ok response with errorMessages", async () => {
    vi.stubGlobal("fetch", mockFetch([{
      ok: false, status: 400,
      body: { errorMessages: ["Field validation failed"] },
    }]));

    await expect(
      updateIssue({ ...CREDS, key: "BMO-1", fields: {} })
    ).rejects.toThrow("Field validation failed");
  });

  it("throws HTTP status when error body has no errorMessages", async () => {
    vi.stubGlobal("fetch", mockFetch([{ ok: false, status: 500, body: {} }]));

    await expect(
      updateIssue({ ...CREDS, key: "BMO-1", fields: {} })
    ).rejects.toThrow("HTTP 500");
  });

  it("throws message from body.message when present", async () => {
    vi.stubGlobal("fetch", mockFetch([{
      ok: false, status: 422,
      body: { message: "Issue is closed" },
    }]));

    await expect(
      updateIssue({ ...CREDS, key: "BMO-1", fields: {} })
    ).rejects.toThrow("Issue is closed");
  });
});
