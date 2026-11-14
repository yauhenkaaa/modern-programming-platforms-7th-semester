export const GATEWAY = 'http://127.0.0.1:4000/graphql';
export const LIVE_WS = 'ws://127.0.0.1:4001/graphql';

export function userId() {
  return localStorage.getItem('userId') || 'demo';
}

async function post(body) {
  const res = await fetch(GATEWAY, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': userId() },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return json;
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function gql(query, variables, { apq = false } = {}) {
  if (!apq) return post({ query, variables });
  const sha256Hash = await sha256(query);
  const extensions = { persistedQuery: { version: 1, sha256Hash } };
  const first = await post({ extensions, variables });
  const missing = first.errors?.some((error) => error.extensions?.code === 'PERSISTED_QUERY_NOT_FOUND');
  if (!missing) return first;
  return post({ query, variables, extensions });
}

export function showErrors(json) {
  if (!json?.errors?.length) return '';
  return `<div class="error">${json.errors.map((error) => error.message).join('; ')}</div>`;
}
