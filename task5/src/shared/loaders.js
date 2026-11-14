import DataLoader from 'dataloader';

export function makeLoader(name, log, batchFn) {
  return new DataLoader(async (keys) => {
    log.info({ loader: name, batchSize: keys.length }, 'dataloader batch');
    return batchFn(keys);
  }, { cacheKeyFn: (key) => String(key) });
}

export const marks = (ids) => ids.map(() => '?').join(',');

export function indexBy(rows, ids, key = 'id') {
  const map = new Map(rows.map((row) => [String(row[key]), row]));
  return ids.map((id) => map.get(String(id)) || null);
}

export function groupBy(rows, ids, foreign, mapFn = (row) => row) {
  const grouped = new Map(ids.map((id) => [String(id), []]));
  for (const row of rows) grouped.get(String(row[foreign]))?.push(mapFn(row));
  return ids.map((id) => grouped.get(String(id)) || []);
}
