# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS build

WORKDIR /app

ENV NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false

COPY package*.json ./
RUN if [ -f package-lock.json ]; then \
      npm ci; \
    else \
      npm install; \
    fi

COPY index.html vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json ./
COPY public ./public
COPY src ./src

RUN npm run build

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=4310 \
    CRM_HOST=0.0.0.0 \
    CRM_DATA_DIR=/app/data \
    CRM_SECURE_COOKIE=true

WORKDIR /app

RUN mkdir -p /app/data && chown node:node /app/data

COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node server ./server

USER node

EXPOSE 4310

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4310/api/health').then((response)=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "server/index.mjs"]
