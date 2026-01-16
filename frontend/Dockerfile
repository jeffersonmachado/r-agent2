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
RUN npm ci && \
    npm cache clean --force

# Copia código fonte do frontend
COPY frontend/ ./

# Aceita VITE_BASE_PATH como argumento de build
ARG VITE_BASE_PATH=/r-agent2/
ENV VITE_BASE_PATH=$VITE_BASE_PATH

# Build da aplicação em modo produção
# Garante que NODE_ENV=production para que as variáveis de ambiente sejam definidas corretamente
RUN NODE_ENV=production npm run build

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
    CMD wget --quiet --tries=1 --spider http://localhost/ || exit 1

# Comando para iniciar nginx
CMD ["nginx", "-g", "daemon off;"]


