#!/bin/sh
set -e
until node -e "require('./src/db').query('SELECT 1').then(()=>process.exit(0)).catch(()=>process.exit(1))"; do
  echo "waiting for database"
  sleep 2
done
node src/db.js
if [ "$RUN_SEED" = "true" ]; then
  node scripts/seed.js
fi
exec node src/index.js
