import CircuitBreaker from 'opossum';

export function createHttp(name, { timeoutMs = 15000 } = {}) {
  async function once(url, options = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...options,
        signal: ctrl.signal,
        headers: { 'user-agent': 'football-lab/1.0', ...(options.headers || {}) },
      });
      const body = await res.text();
      if (res.status === 429 || res.status >= 500) {
        const error = new Error(`HTTP ${res.status} ${url}`);
        error.status = res.status;
        throw error;
      }
      return { status: res.status, body };
    } finally {
      clearTimeout(timer);
    }
  }

  const breaker = new CircuitBreaker(once, {
    timeout: timeoutMs + 1000,
    errorThresholdPercentage: 60,
    volumeThreshold: 5,
    resetTimeout: 20000,
    name,
  });

  async function request(url, options, { retries = 3, pause = 400 } = {}) {
    let last;
    for (let attempt = 0; attempt < retries; attempt += 1) {
      try {
        return await breaker.fire(url, options);
      } catch (error) {
        last = error;
        await new Promise((resolve) => setTimeout(resolve, pause * 2 ** attempt));
      }
    }
    throw last;
  }

  return {
    breaker,
    async text(url, options, retry) {
      const res = await request(url, options, retry);
      return res.status >= 400 ? null : res.body;
    },
    async json(url, options, retry) {
      const text = await this.text(url, options, retry);
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    },
  };
}
