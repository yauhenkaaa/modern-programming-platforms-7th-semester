import { Registry, Histogram, Counter, collectDefaultMetrics } from 'prom-client';

export const register = new Registry();
collectDefaultMetrics({ register });

export const resolverHist = new Histogram({
  name: 'graphql_resolver_duration_seconds',
  help: 'Resolver duration in seconds',
  labelNames: ['service', 'field'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
  registers: [register],
});

export const opCounter = new Counter({
  name: 'graphql_operations_total',
  help: 'GraphQL operations',
  labelNames: ['service', 'operation', 'name'],
  registers: [register],
});

export const errorCounter = new Counter({
  name: 'graphql_errors_total',
  help: 'GraphQL request errors',
  labelNames: ['service'],
  registers: [register],
});

export const cacheCounter = new Counter({
  name: 'graphql_apq_cache_total',
  help: 'APQ cache lookups',
  labelNames: ['result'],
  registers: [register],
});

export function metricsPlugin(service) {
  return {
    async requestDidStart() {
      return {
        async didResolveOperation(ctx) {
          opCounter.inc({
            service,
            operation: ctx.operation?.operation || 'unknown',
            name: ctx.request.operationName || 'anon',
          });
        },
        async executionDidStart() {
          return {
            willResolveField({ info }) {
              const stop = resolverHist.startTimer({
                service,
                field: `${info.parentType.name}.${info.fieldName}`,
              });
              return () => stop();
            },
          };
        },
        async didEncounterErrors() {
          errorCounter.inc({ service });
        },
      };
    },
  };
}
