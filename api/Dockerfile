FROM node:22-bookworm-slim AS builder

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

# Instala dependências (inclui dev deps no builder)
RUN npm ci && \
    npm cache clean --force

# Copia apenas o código necessário (sem tests)
COPY engine/ ./engine/
COPY api/ ./api/
COPY rpa/ ./rpa/
COPY infra/ ./infra/
COPY contracts/ ./contracts/
COPY config/ ./config/
COPY qa/ ./qa/
COPY lib/ ./lib/
COPY scripts/ ./scripts/

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

# Instala dependências de runtime e Playwright
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libwayland-client0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
  && rm -rf /var/lib/apt/lists/*

# Copia apenas artefatos do builder
COPY --from=builder /app/package.json /app/package-lock.json* ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/engine ./engine
COPY --from=builder /app/api ./api
COPY --from=builder /app/rpa ./rpa
COPY --from=builder /app/infra ./infra
COPY --from=builder /app/contracts ./contracts
COPY --from=builder /app/config ./config
COPY --from=builder /app/qa ./qa
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/scripts ./scripts

# Compatibilidade: a API referencia o runner RPA legado em `tests/rpa/*`.
# Copiamos apenas o código necessário (não a suíte inteira de testes).
COPY tests/rpa/*.js ./tests/rpa/
COPY tests/rpa/rpa.config.json ./tests/rpa/rpa.config.json
COPY tests/rpa/utils ./tests/rpa/utils
COPY tests/rpa/seeds ./tests/rpa/seeds
COPY tests/helpers/errorClassifier.js ./tests/helpers/errorClassifier.js

# Remove dependências de desenvolvimento no runtime
RUN npm prune --omit=dev && \
    npm cache clean --force && \
    mkdir -p /app/api/data /app/tests/rpa/reports /app/tests/rpa/replay

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
