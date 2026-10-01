'use strict';

function write(level, msg, fields) {
  const line = Object.assign({ ts: new Date().toISOString(), level, msg }, fields || {});
  const stream = level === 'error' ? process.stderr : process.stdout;
  stream.write(JSON.stringify(line) + '\n');
}

function info(msg, fields) { write('info', msg, fields); }
function warn(msg, fields) { write('warn', msg, fields); }
function error(msg, fields) { write('error', msg, fields); }

module.exports = { info, warn, error };
