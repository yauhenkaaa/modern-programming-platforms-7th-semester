export function qs(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value) !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? '?' + text : '';
}

export async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error?.message || 'Ошибка запроса');
    error.details = data.error?.details || [];
    error.status = response.status;
    throw error;
  }
  return data;
}
