export function qs(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value) !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? '?' + text : '';
}

export async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = sessionStorage.getItem('token');
  if (token) headers.set('Authorization', 'Bearer ' + token);
  const response = await fetch(path, { ...options, headers });
  if (response.status === 401 && !path.startsWith('/api/auth/login')) {
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('user');
    if (window.location.pathname !== '/login') window.location.assign('/login');
  }
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error?.message || 'Ошибка запроса');
    error.details = data.error?.details || [];
    error.status = response.status;
    throw error;
  }
  return data;
}
