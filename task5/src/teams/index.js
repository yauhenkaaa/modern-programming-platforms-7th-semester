import '../shared/env.js';
import { startTracing } from '../shared/tracing.js';

startTracing('teams');
await import('./boot.js');
