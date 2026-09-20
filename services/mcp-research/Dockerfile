# syntax=docker/dockerfile:1
# MCP Research container — imagem mínima, non-root, deps pinadas, sem segredos.
# Contexto de build: raiz do monorepo (o serviço REUTILIZA código da plataforma:
# api/services/research/nativeResearchProvider.js, api/services/askAi/injectionGuard.js,
# src/core/mcp/endpoint-policy.js — mesmos arquivos, mesma estrutura relativa).

FROM node:22-alpine AS deps
WORKDIR /app/services/mcp-research
COPY services/mcp-research/package.json services/mcp-research/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
RUN addgroup -S rap && adduser -S -G rap rap
WORKDIR /app

COPY --from=deps /app/services/mcp-research/node_modules ./services/mcp-research/node_modules
COPY services/mcp-research/package.json ./services/mcp-research/package.json
COPY services/mcp-research/src ./services/mcp-research/src

# Código provado da plataforma, REUSADO (não forkado) — caminhos relativos
# idênticos aos do monorepo para que os requires resolvam sem adaptação.
COPY api/services/research/nativeResearchProvider.js ./api/services/research/nativeResearchProvider.js
COPY api/services/research/apiSearchBackend.js ./api/services/research/apiSearchBackend.js
COPY api/services/askAi/injectionGuard.js ./api/services/askAi/injectionGuard.js
COPY src/core/mcp/endpoint-policy.js ./src/core/mcp/endpoint-policy.js

RUN chown -R rap:rap /app
USER rap

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||'8080')+'/health',(r)=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

WORKDIR /app/services/mcp-research
CMD ["node", "src/index.js"]
