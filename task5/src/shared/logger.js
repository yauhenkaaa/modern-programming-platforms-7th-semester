import pino from 'pino';
import { trace } from '@opentelemetry/api';
import { env } from './env.js';

export function createLogger(service) {
  return pino({
    level: env.logLevel,
    base: { service },
    mixin() {
      const ctx = trace.getActiveSpan()?.spanContext();
      return ctx?.traceId ? { traceId: ctx.traceId } : {};
    },
  });
}
