# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

# Copia engine primeiro para /app/engine/ (caminho absoluto)
# O código do frontend usa ../../../engine/ que resolve para /app/engine/
COPY engine/ /app/engine/

# Copia arquivos de dependências do frontend (otimização de cache)
COPY frontend/package.json frontend/package-lock.json* ./frontend/

# Instala todas as dependências (incluindo devDependencies para build)
WORKDIR /app/frontend
RUN npm config set fetch-retries 5 && \
    npm config set fetch-retry-factor 2 && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000 && \
    for attempt in 1 2 3; do \
        npm ci && break; \
        if [ "$attempt" -eq 3 ]; then exit 1; fi; \
        echo "npm ci failed on attempt $attempt, retrying..." >&2; \
    done && \
    npm cache clean --force

# Copia código fonte do frontend
COPY frontend/ ./

# Aceita argumentos de build para Vite
ARG VITE_BASE_PATH=/r-agent2/
ARG VITE_API_BASE_URL=/r-agent2/api
ENV VITE_BASE_PATH=$VITE_BASE_PATH
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

# Build da aplicação em modo produção
# Garante que NODE_ENV=production para que as variáveis de ambiente sejam definidas corretamente
RUN NODE_ENV=production \
    VITE_BASE_PATH=$VITE_BASE_PATH \
    VITE_API_BASE_URL=$VITE_API_BASE_URL \
    npm run build

# Stage 2: Production
FROM nginx:alpine

# Copia arquivos buildados
COPY --from=builder /app/frontend/dist /usr/share/nginx/html

# Copia configuração do nginx
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

# Cria diretório para logs
RUN mkdir -p /var/log/nginx

# Expõe porta
EXPOSE 80

# Healthcheck
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD sh -c "wget -qO- http://127.0.0.1/ | grep -qi 'html' || exit 1"

# Comando para iniciar nginx
CMD ["nginx", "-g", "daemon off;"]
