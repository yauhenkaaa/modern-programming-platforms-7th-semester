import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { env } from './env.js';

export function startTracing(serviceName) {
  if (env.otelDisabled) return null;
  const base = env.otelEndpoint.replace(/\/$/, '');
  const url = base.endsWith('/v1/traces') ? base : `${base}/v1/traces`;
  const sdk = new NodeSDK({
    serviceName,
    traceExporter: new OTLPTraceExporter({ url }),
    instrumentations: [getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { enabled: false },
    })],
  });
  sdk.start();
  const shutdown = () => sdk.shutdown().catch(() => {});
  process.once('SIGTERM', shutdown);
  return sdk;
}
