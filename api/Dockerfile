ARG API_BASE_IMAGE=r-agent2-api-base:test

FROM node:22-bookworm-slim AS builder

ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer

# O lock referencia @results/auth via link file:../../packages/auth. O npm ci
# só resolve esse link quando o projeto está a pelo menos 2 níveis da raiz do
# filesystem (relpath(path, resolve(path, '../../packages/auth')) precisa
# preservar os dois '..'; em /app o resolve "grampeia" na raiz e o arborist
# quebra em #loadLink). Por isso o build roda em /build/r-agent2 e o pacote
# irmão é materializado a partir da cópia versionada vendor/auth.
WORKDIR /build/r-agent2

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

# Materializa o pacote irmão ../../packages/auth (link do package-lock)
COPY vendor/auth/ /build/packages/auth/

# Instala apenas dependências de produção no builder
RUN npm ci --omit=dev && \
    npm exec -- puppeteer browsers install chrome && \
    npm cache clean --force

# Copia apenas o código necessário (sem tests)
COPY engine/ ./engine/
COPY core/ ./core/
COPY src/ ./src/
COPY api/ ./api/
COPY tools/system/ ./tools/system/
COPY rpa/ ./rpa/
COPY infra/ ./infra/
COPY contracts/ ./contracts/
COPY config/ ./config/
COPY governance/ ./governance/
COPY pipeline/ ./pipeline/
COPY qa/ ./qa/
COPY qa-mesh/ ./qa-mesh/
COPY lib/ ./lib/
COPY scripts/ ./scripts/

FROM ${API_BASE_IMAGE} AS runtime

ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer
ENV WWEBJS_AUTH_PATH=/var/lib/ragent2/whatsapp/auth
ENV QA_MESH_SYSTEM_VALIDATE_DIR=/var/lib/ragent2/qa-mesh/system-validate
ENV RELEASE_EVIDENCE_BASE_DIR=/var/lib/ragent2/release-evidence

WORKDIR /app

# Materializa o pacote irmão: node_modules/@results/auth é um symlink
# relativo (../../../../packages/auth) que resolve para /packages/auth.
COPY vendor/auth/ /packages/auth/

# Copia apenas artefatos do builder
COPY --from=builder /build/r-agent2/package.json /build/r-agent2/package-lock.json* ./
COPY --from=builder /build/r-agent2/node_modules ./node_modules
COPY --from=builder /app/.cache ./.cache
COPY --from=builder /build/r-agent2/engine ./engine
COPY --from=builder /build/r-agent2/core ./core
COPY --from=builder /build/r-agent2/src ./src
COPY --from=builder /build/r-agent2/api ./api
COPY --from=builder /build/r-agent2/tools/system ./tools/system
COPY --from=builder /build/r-agent2/rpa ./rpa
COPY --from=builder /build/r-agent2/infra ./infra
COPY --from=builder /build/r-agent2/contracts ./contracts
COPY --from=builder /build/r-agent2/config ./config
COPY --from=builder /build/r-agent2/governance ./governance
COPY --from=builder /build/r-agent2/pipeline ./pipeline
COPY --from=builder /build/r-agent2/qa ./qa
COPY --from=builder /build/r-agent2/qa-mesh ./qa-mesh
COPY --from=builder /build/r-agent2/lib ./lib
COPY --from=builder /build/r-agent2/scripts ./scripts

# Compatibilidade: a API ainda lê seeds/flows versionados em tests/rpa/**.
COPY tests/rpa ./tests/rpa
COPY tests/helpers/errorClassifier.js ./tests/helpers/errorClassifier.js

# node_modules já é production-only (npm ci --omit=dev no builder);
# não rodar npm prune aqui: em /app (profundidade 1) o arborist quebra no
# link ../../packages/auth. Apenas garante os diretórios de runtime.
RUN mkdir -p /app/api/data /app/governance /app/.cache/puppeteer /var/lib/ragent2/whatsapp/auth /var/lib/ragent2/qa-mesh/system-validate /var/lib/ragent2/release-evidence /var/lib/ragent2/runtime/rpa/reports /var/lib/ragent2/runtime/rpa/replay /var/lib/ragent2/runtime/rpa/seeds /var/lib/ragent2/runtime/rpa/flows /var/lib/ragent2/runtime/pbx/recordings

# Mantém entrypoint
RUN chmod +x ./api/entrypoint.sh

# Expõe porta padrão da API
ENV API_PORT=3001
EXPOSE 3001

# Healthcheck
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Entrypoint executa migrations + seed + server
ENTRYPOINT ["./api/entrypoint.sh"]
