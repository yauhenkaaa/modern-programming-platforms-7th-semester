import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import { ApolloServerPluginLandingPageLocalDefault } from '@apollo/server/plugin/landingPage/default';
import { ApolloServerPluginInlineTraceDisabled } from '@apollo/server/plugin/disabled';
import { WebSocketServer } from 'ws';
import { useServer } from 'graphql-ws/use/ws';
import { createLogger } from './logger.js';
import { metricsPlugin, register } from './metrics.js';

export async function startService({ name, port, apollo, context, wsSchema, before }) {
  const log = createLogger(name);
  const app = express();
  const httpServer = http.createServer(app);
  const cleanups = [];
  if (wsSchema) {
    const wss = new WebSocketServer({ server: httpServer, path: '/graphql' });
    const sockets = useServer({ schema: wsSchema }, wss);
    cleanups.push(() => sockets.dispose());
  }
  const { plugins: extraPlugins = [], ...rest } = apollo;
  const server = new ApolloServer({
    introspection: true,
    csrfPrevention: true,
    ...rest,
    plugins: [
      ApolloServerPluginDrainHttpServer({ httpServer }),
      ApolloServerPluginLandingPageLocalDefault({ embed: true, footer: false }),
      ApolloServerPluginInlineTraceDisabled(),
      metricsPlugin(name),
      {
        async serverWillStart() {
          return { async drainServer() { await Promise.all(cleanups.map((fn) => fn())); } };
        },
      },
      ...extraPlugins,
    ],
  });
  await server.start();
  app.use(cors());
  app.get('/health', (_req, res) => res.json({ ok: true, service: name }));
  app.get('/metrics', async (_req, res) => {
    res.setHeader('Content-Type', register.contentType);
    res.end(await register.metrics());
  });
  if (before) before(app);
  app.use('/graphql', express.json({ limit: '1mb' }), expressMiddleware(server, { context }));
  await new Promise((resolve) => httpServer.listen(port, '0.0.0.0', resolve));
  log.info({ port }, 'listening');
  const stop = async () => {
    log.info('shutdown');
    await server.stop();
    httpServer.close();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  return { log, app };
}
