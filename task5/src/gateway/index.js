import '../shared/env.js';
import { startTracing } from '../shared/tracing.js';

startTracing('gateway');
await import('./boot.js');
