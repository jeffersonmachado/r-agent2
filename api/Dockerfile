FROM node:20-alpine

WORKDIR /app

# Copiamos package.json para instalar dependências (se houver)
COPY package.json package-lock.json* ./

# Instalamos dependências de produção (se houver)
RUN npm ci --only=production || true

# Copiamos o engine completo (necessário para validator, flowSimulation, replay)
COPY engine/ ./engine/

# Copiamos o servidor da API
COPY api/server.js ./api/server.js

ENV NODE_ENV=production
ENV API_PORT=3000

EXPOSE 3000

CMD ["node", "api/server.js"]


