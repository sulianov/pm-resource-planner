const PROXY_BASE = "http://localhost:8765";

/**
 * Paginated Jira story search via local proxy.
 * onPage(issues, startAt, total) is called for each page.
 */
export async function fetchStoriesPaginated({ base, token, jql, fields, onPage, signal }) {
  let startAt = 0;
  let total = Infinity;
  while (startAt < total) {
    const res = await fetch(`${PROXY_BASE}/api/jira`, {
      method: "POST",
      signal,
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${token}`,
        "X-Jira-Base":   base,
      },
      body: JSON.stringify({ jql, startAt, maxResults: 100, fields }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.errorMessages?.join(", ") || `HTTP ${res.status}`);
    }
    const data = await res.json();
    total = data.total ?? 0;
    if (onPage) onPage(data.issues || [], startAt, total);
    startAt += (data.issues || []).length;
    if (!(data.issues || []).length) break;
  }
}

/**
 * Fetch specific issues by key list and return their fields.
 * Splits into chunks of 50 to stay within JQL IN clause limits.
 */
export async function fetchIssuesByKeys({ base, token, keys, fields, signal }) {
  const results = [];
  const chunks = [];
  for (let i = 0; i < keys.length; i += 50) chunks.push(keys.slice(i, i + 50));
  for (const chunk of chunks) {
    const jql = `key in (${chunk.join(",")})`;
    const res = await fetch(`${PROXY_BASE}/api/jira`, {
      method: "POST",
      signal,
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${token}`,
        "X-Jira-Base":   base,
      },
      body: JSON.stringify({ jql, startAt: 0, maxResults: 50, fields }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.errorMessages?.join(", ") || `HTTP ${res.status}`);
    }
    const data = await res.json();
    results.push(...(data.issues || []));
  }
  return results;
}

/**
 * Update a Jira issue's fields via local proxy (PUT under the hood).
 * fields: { "customfield_10305": "2026-06-10", ... }
 */
export async function updateIssue({ base, token, key, fields }) {
  const res = await fetch(`${PROXY_BASE}/api/jira/update`, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${token}`,
      "X-Jira-Base":   base,
    },
    body: JSON.stringify({ key, fields }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.errorMessages?.join(", ") || e.message || `HTTP ${res.status}`);
  }
  return res.status;
}
