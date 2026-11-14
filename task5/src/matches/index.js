import '../shared/env.js';
import { startTracing } from '../shared/tracing.js';

startTracing('matches');
await import('./boot.js');
