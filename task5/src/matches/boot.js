import { createLogger } from '../shared/logger.js';
import { migrateMatches, openDb } from '../shared/db.js';
import { startService } from '../shared/server.js';
import { buildMatches, contextFor, liveSchema } from './schema.js';
import { seedLive, startLive } from './live.js';

const db = openDb('matches.db');
migrateMatches(db);
const log = createLogger('matches');
seedLive(db);
startLive();

await startService({
  name: 'matches',
  port: Number(process.env.PORT || 4001),
  apollo: { schema: buildMatches(db) },
  context: contextFor(db, log),
  wsSchema: liveSchema(),
});
