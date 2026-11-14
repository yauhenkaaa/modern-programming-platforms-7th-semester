import '../shared/env.js';
import { startTracing } from '../shared/tracing.js';

startTracing('users');
await import('./boot.js');
