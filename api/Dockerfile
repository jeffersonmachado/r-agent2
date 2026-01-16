FROM node:22-alpine AS base

WORKDIR /app

# Instala dependências do sistema necessárias
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    && rm -rf /var/cache/apk/*

# Copia arquivos de dependências primeiro (para cache de layers)
COPY package.json package-lock.json* ./

# Instala dependências de produção
RUN npm ci --only=production && \
    npm cache clean --force

# Copia código da aplicação
COPY engine/ ./engine/
COPY api/ ./api/
COPY infra/ ./infra/
COPY contracts/ ./contracts/
COPY config/ ./config/
COPY qa/ ./qa/
COPY tests/ ./tests/
COPY lib/ ./lib/

# Cria diretório de dados se não existir
RUN mkdir -p /app/api/data

# Define variáveis de ambiente
ENV NODE_ENV=production
ENV API_PORT=3000

# Expõe porta
EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Copia entrypoint
COPY api/entrypoint.sh ./api/entrypoint.sh
RUN chmod +x ./api/entrypoint.sh

# Entrypoint executa migrations + seed + server
ENTRYPOINT ["./api/entrypoint.sh"]


