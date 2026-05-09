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
 * fields: { "customfield_": "2026-06-10", ... }
 * Retries up to `retries` times on HTTP 429 with exponential back-off.
 */
export async function updateIssue({ base, token, key, fields }, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`${PROXY_BASE}/api/jira/update`, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${token}`,
        "X-Jira-Base":   base,
      },
      body: JSON.stringify({ key, fields }),
    });
    if (res.status === 429 && attempt < retries) {
      await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
      continue;
    }
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.errorMessages?.join(", ") || e.message || `HTTP ${res.status}`);
    }
    return res.status;
  }
  throw new Error(`HTTP 429: rate limited after ${retries} retries for ${key}`);
}
