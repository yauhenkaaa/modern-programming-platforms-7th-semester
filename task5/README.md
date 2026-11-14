# Football GraphQL

Федерация: gateway `:4000` (Query/Mutation) и три подграфа. Подписка live-счёта вынесена на matches `:4001` (`graphql-ws`): `@apollo/gateway@2.14` не исполняет Subscription, а Apollo Router требует лицензию GraphOS. Поэтому сервер — `@apollo/server@4.13` (интерфейс gateway v1; Server 5 ждёт v2).

```
browser :5173 --HTTP--> gateway :4000 --> matches :4001 (SQLite)
                      |-> teams   :4002     \-> ws live
                      \-> users   :4003
ingest --> football-data.org, TheSportsDB, football-data.co.uk CSV
Prometheus :9090  Grafana :3001  Jaeger :16686
```

## Запуск

```
npm install
npm run ingest
npm run dev
```

Ключ football-data.org — `FOOTBALL_DATA_KEY` в `.env` (регистрация на https://www.football-data.org/client/register). С ключом приходят эмблемы, судья и счёт по таймам; синтетика не добирается. Бесплатный тариф не отдаёт авторов голов, поэтому протокол (удары, угловые, фолы, жёлтые и красные) берётся из CSV football-data.co.uk. TheSportsDB (`THESPORTSDB_KEY`, публичный ключ `123`) добавляет эмблему и канал клуба, если они есть в ответе. Повторная загрузка: `docker compose run --rm -e INGEST_FORCE=1 ingest`. Для трасс: Jaeger и `OTEL_SDK_DISABLED=false`.

`docker compose run --rm ingest`, затем `docker compose up`. Grafana анонимно на http://localhost:3001, Jaeger http://localhost:16686, метрики http://localhost:4000/metrics.

## Запросы

Вложенный: `leagues { seasons { matches(first:1) { edges { node { homeTeam { players { name } } } } } } }`

Фильтр: `matches(first:5, filter:{status:"FINISHED", minGoals:1}, sort:[{field:"DATE",direction:"DESC"}]) { totalCount edges { node { id } } }`

Мутация: `mutation($id:ID!){ createFavorite(matchId:$id, note:"lab"){ id } }`

Подписка (ws://localhost:4001/graphql): `subscription { matchScoreUpdated { matchId minute homeGoals awayGoals status } }`

Батч: `mutation($ops:[UserOpInput!]!){ batchUserOps(ops:$ops){ ok results { kind id } } }`

## Защита

N+1: в логе подграфа одна строка `dataloader batch` с `batchSize` > 1 на запрос карточки. Метрики и дашборд Football GraphQL — Grafana. Сквозной trace gateway → подграф → `sqlite.query` — Jaeger (сервис `gateway`). Лимиты: глубина 8, сложность 500, APQ, 180 запросов/мин на IP.
