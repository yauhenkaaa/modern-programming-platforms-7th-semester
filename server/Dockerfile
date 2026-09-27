FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY scripts ./scripts
COPY seed-data ./seed-data
RUN mkdir -p /data/uploads && chown -R node:node /app /data/uploads
USER node
ENV UPLOAD_DIR=/data/uploads
EXPOSE 3001
CMD ["sh", "scripts/docker-entrypoint.sh"]
