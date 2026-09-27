# Скаутинг КХЛ

Учебное SPA: скаут-отчёты по игрокам КХЛ. Сервер — Express и PostgreSQL без ORM, клиент — React. Старое EJS-приложение в корне (`npm start`, порт 3000) к этому проекту не относится.

## Docker

Скопируйте `.env.example` в `.env` и задайте пароль. Затем:

```
docker compose up --build
```

Клиент: http://localhost:8080. База наружу не публикуется. При старте сервер применяет схему и, если `RUN_SEED=true`, заполняет данные. Загруженные файлы лежат в volume `uploads`.

## Локально

Нужны Node.js 20+ и PostgreSQL.

```
cd server
copy .env.example .env
npm install
npm run migrate
npm run seed
npm run dev
```

В другом терминале: `cd client && npm install && npm run dev`. Клиент: http://localhost:5173, API проксируется на порт 3001.

`npm run migrate -- --fresh` пересоздаёт схему. `npm run seed:verify` проверяет объём сида.

## API

Ошибки: `{ "error": { "code", "message", "details": [{ "field", "message" }] } }`.

- `GET /api/health`
- `GET /api/dictionaries`
- `GET /api/players?q=&limit=` и `GET /api/players/:id`
- `GET /api/players/leaders`
- `GET /api/reports` — фильтры, `sort`, `order`, `page`, `limit`
- `GET /api/reports/:id`
- `POST /api/reports` — `multipart/form-data`, файл в поле `document`
- `PATCH /api/reports/:id` — только переданные поля, остальные не меняются. Пустое тело — 400. `removeDocument=true` снимает файл.
- `PUT /api/reports/:id` — полная замена: все обязательные поля нужны, пропущенные необязательные становятся `null`, отсутствие файла удаляет документ.
- `DELETE /api/reports/:id` — удаляет отчёт и файл.

`PUT` и `PATCH` не взаимозаменяемы: правка в интерфейсе шлёт `PATCH`.
