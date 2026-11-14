import { GraphQLError } from 'graphql';
import { ApolloGateway, IntrospectAndCompose, RemoteGraphQLDataSource } from '@apollo/gateway';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { LRUCache } from 'lru-cache';
import depthLimit from 'graphql-depth-limit';
import { getComplexity, simpleEstimator } from 'graphql-query-complexity';
import { context, propagation } from '@opentelemetry/api';
import { env } from '../shared/env.js';
import { cacheCounter } from '../shared/metrics.js';
import { startService } from '../shared/server.js';

class ApqCache {
  constructor() { this.store = new LRUCache({ max: 500, ttl: 1000 * 60 * 30 }); }
  async get(key) {
    const value = this.store.get(key);
    cacheCounter.inc({ result: value ? 'hit' : 'miss' });
    return value;
  }
  async set(key, value) { this.store.set(key, value); }
  async delete(key) { return this.store.delete(key); }
}

class ForwardingSource extends RemoteGraphQLDataSource {
  willSendRequest({ request, context: gqlContext }) {
    const headers = request.http?.headers;
    if (!headers) return;
    headers.set('x-user-id', gqlContext?.userId || 'demo');
    const carrier = {};
    propagation.inject(context.active(), carrier);
    for (const [key, value] of Object.entries(carrier)) headers.set(key, value);
  }
}

const rule = depthLimit(8);
function depthRule(ctx) {
  const intro = ctx.getDocument().definitions.some((node) => node.kind === 'OperationDefinition'
    && node.selectionSet.selections.some((sel) => sel.name?.value === '__schema' || sel.name?.value === '__type'));
  return intro ? {} : rule(ctx);
}

function complexityPlugin(max = 500) {
  return {
    async requestDidStart() {
      return {
        async didResolveOperation({ request, document, schema, operationName }) {
          if (operationName === 'IntrospectionQuery') return;
          const complexity = getComplexity({
            schema, query: document, variables: request.variables, operationName,
            estimators: [simpleEstimator({ defaultComplexity: 1 })],
          });
          if (complexity > max) throw new GraphQLError(`Query complexity ${complexity} exceeds ${max}`);
        },
      };
    },
  };
}

async function waitReady(url) {
  const health = url.replace(/\/graphql$/, '/health');
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(health);
      if (res.ok) return;
    } catch { /* subgraph still booting */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`subgraph not ready: ${health}`);
}

await Promise.all([env.matchesUrl, env.teamsUrl, env.usersUrl].map(waitReady));

const gateway = new ApolloGateway({
  supergraphSdl: new IntrospectAndCompose({
    subgraphs: [
      { name: 'matches', url: env.matchesUrl },
      { name: 'teams', url: env.teamsUrl },
      { name: 'users', url: env.usersUrl },
    ],
    pollIntervalInMs: 30000,
  }),
  buildService({ url }) { return new ForwardingSource({ url }); },
});

const limiter = new RateLimiterMemory({ points: env.rateLimit, duration: 60 });

await startService({
  name: 'gateway',
  port: Number(process.env.PORT || 4000),
  apollo: {
    gateway,
    validationRules: [depthRule],
    persistedQueries: { cache: new ApqCache(), ttl: 1800 },
    plugins: [complexityPlugin()],
  },
  before(app) {
    app.use('/graphql', async (req, res, next) => {
      try {
        await limiter.consume(req.header('x-api-key') || req.ip || 'local');
        next();
      } catch {
        res.status(429).json({ errors: [{ message: 'rate limit exceeded', extensions: { code: 'RATE_LIMITED' } }] });
      }
    });
  },
  context: async ({ req }) => ({ userId: req.headers['x-user-id'] || 'demo' }),
});
