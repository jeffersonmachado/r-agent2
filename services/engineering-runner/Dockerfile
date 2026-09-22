# syntax=docker/dockerfile:1
# Engineering Runner — DEVELOPMENT ONLY (ER-V1-SEAL-003).
#
# Único container do projeto autorizado a ter o Docker socket do host montado — a API principal
# (chatbot-api) NUNCA recebe /var/run/docker.sock. Contexto de build: raiz do monorepo (reusa
# código já provado: api/services/engineeringRouter/executionSandbox.js,
# engine/engineeringRouter/secretRedaction.js — mesmos arquivos, mesma estrutura relativa, nunca
# forkados).
#
# Roda como root DENTRO deste container por necessidade real: falar com o Docker socket do host
# exige o mesmo nível de privilégio equivalente a root no host (é a natureza do próprio socket,
# não uma escolha de conveniência) — isso NUNCA reduz o isolamento do SANDBOX em si, que continua
# non-root/network=none/cap-drop=ALL/read-only (ver executionSandbox.js, ER-V1-FINAL-001,
# inalterado). O runner nunca executa código do LLM diretamente — só invoca `docker run` com
# argumentos estruturados já validados; o conteúdo gerado pelo LLM roda exclusivamente dentro do
# sandbox descartável non-root.

FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends docker.io git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY services/engineering-runner/package.json ./services/engineering-runner/package.json
COPY services/engineering-runner/src ./services/engineering-runner/src

# Código provado da plataforma, REUSADO (não forkado) — caminhos relativos idênticos aos do
# monorepo (mesmo padrão de services/mcp-research/Dockerfile).
COPY api/services/engineeringRouter/executionSandbox.js ./api/services/engineeringRouter/executionSandbox.js
COPY engine/engineeringRouter/secretRedaction.js ./engine/engineeringRouter/secretRedaction.js

EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.ENGINEERING_RUNNER_PORT||process.env.PORT||'8090')+'/health',(r)=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

WORKDIR /app/services/engineering-runner
CMD ["node", "src/index.js"]
