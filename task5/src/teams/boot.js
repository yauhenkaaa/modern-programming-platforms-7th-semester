import { createLogger } from '../shared/logger.js';
import { migrateTeams, openDb } from '../shared/db.js';
import { startService } from '../shared/server.js';
import { buildTeams, contextFor } from './schema.js';

const db = openDb('teams.db');
migrateTeams(db);
const log = createLogger('teams');

await startService({
  name: 'teams',
  port: Number(process.env.PORT || 4002),
  apollo: { schema: buildTeams(db) },
  context: contextFor(db, log),
});
