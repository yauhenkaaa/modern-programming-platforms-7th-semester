import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(root, '.env') });

export const rootDir = root;
export const env = {
  footballDataKey: process.env.FOOTBALL_DATA_KEY || '',
  sportsDbKey: process.env.THESPORTSDB_KEY || '123',
  dataDir: path.resolve(root, process.env.DATA_DIR || 'data'),
  matchesUrl: process.env.MATCHES_URL || 'http://127.0.0.1:4001/graphql',
  teamsUrl: process.env.TEAMS_URL || 'http://127.0.0.1:4002/graphql',
  usersUrl: process.env.USERS_URL || 'http://127.0.0.1:4003/graphql',
  otelEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://127.0.0.1:4318',
  otelDisabled: process.env.OTEL_SDK_DISABLED === 'true',
  rateLimit: Number(process.env.RATE_LIMIT_POINTS || 180),
  ingestCron: process.env.INGEST_CRON || '0 */6 * * *',
  ingestForce: process.env.INGEST_FORCE === '1',
  logLevel: process.env.LOG_LEVEL || 'info',
  port: Number(process.env.PORT || 4000),
};
