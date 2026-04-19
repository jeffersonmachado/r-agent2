ARG API_BASE_IMAGE=r-agent2-api-base:test

FROM node:22-bookworm-slim AS builder

ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer

WORKDIR /app

# Instala dependências do sistema necessárias (build)
# OBS: Playwright não é suportado em Alpine/musl; usamos Debian slim.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Copia arquivos de dependências primeiro (para cache de layers)
COPY package.json package-lock.json* ./

# Instala apenas dependências de produção no builder
RUN npm ci --omit=dev && \
    npm exec -- puppeteer browsers install chrome && \
    npm cache clean --force

# Copia apenas o código necessário (sem tests)
COPY engine/ ./engine/
COPY core/ ./core/
COPY api/ ./api/
COPY rpa/ ./rpa/
COPY infra/ ./infra/
COPY contracts/ ./contracts/
COPY config/ ./config/
COPY pipeline/ ./pipeline/
COPY qa/ ./qa/
COPY qa-mesh/ ./qa-mesh/
COPY lib/ ./lib/
COPY scripts/ ./scripts/

FROM ${API_BASE_IMAGE} AS runtime

ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer

WORKDIR /app

# Copia apenas artefatos do builder
COPY --from=builder /app/package.json /app/package-lock.json* ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.cache ./.cache
COPY --from=builder /app/engine ./engine
COPY --from=builder /app/core ./core
COPY --from=builder /app/api ./api
COPY --from=builder /app/rpa ./rpa
COPY --from=builder /app/infra ./infra
COPY --from=builder /app/contracts ./contracts
COPY --from=builder /app/config ./config
COPY --from=builder /app/pipeline ./pipeline
COPY --from=builder /app/qa ./qa
COPY --from=builder /app/qa-mesh ./qa-mesh
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/scripts ./scripts

# Compatibilidade: a API referencia múltiplos módulos de runtime em tests/rpa/**.
COPY tests/rpa ./tests/rpa
COPY tests/helpers/errorClassifier.js ./tests/helpers/errorClassifier.js

# Remove dependências de desenvolvimento no runtime
RUN npm prune --omit=dev && \
    npm cache clean --force && \
    mkdir -p /app/api/data /app/tests/rpa/reports /app/tests/rpa/replay /app/.cache/puppeteer

# Mantém entrypoint
RUN chmod +x ./api/entrypoint.sh

# Expõe porta padrão da API
ENV API_PORT=3000
EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Entrypoint executa migrations + seed + server
ENTRYPOINT ["./api/entrypoint.sh"]
