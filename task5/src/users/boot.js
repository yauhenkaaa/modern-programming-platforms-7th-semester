import { createLogger } from '../shared/logger.js';
import { migrateUsers, openDb } from '../shared/db.js';
import { startService } from '../shared/server.js';
import { buildUsers, contextFor } from './schema.js';

const db = openDb('users.db');
migrateUsers(db);
const log = createLogger('users');

await startService({
  name: 'users',
  port: Number(process.env.PORT || 4003),
  apollo: { schema: buildUsers(db) },
  context: contextFor(db, log),
});
