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
COPY api/services/engineeringRouter/safeEngineeringEnvironment.js ./api/services/engineeringRouter/safeEngineeringEnvironment.js
COPY engine/engineeringRouter/secretRedaction.js ./engine/engineeringRouter/secretRedaction.js
# ER-V1-SEALFIX-003 (Runner Trust Boundary): commandPolicy.js — revalidação independente de
# executable/args no runner (nunca confia que a API já validou). Achado real: faltava aqui até
# a validação ER-V1-SEALFIX-002 rodar o runner num container de verdade — em bare host (Jest) o
# `require()` sempre resolvia contra o monorepo real, mascarando a ausência deste COPY.
COPY engine/engineeringRouter/commandPolicy.js ./engine/engineeringRouter/commandPolicy.js
COPY engine/engineeringRouter/constants.js ./engine/engineeringRouter/constants.js

# L-1 (2026-10-20) — FECHAMENTO DE DEPENDÊNCIAS, NÃO LISTA DE CONVENIÊNCIA.
#
# Defeito medido ao vivo: `executionSandbox.js` passou a fazer
# `require('../../../governance/bug-closure/command-policy')` e o COPY correspondente nunca foi
# adicionado. O container REAL respondia, em toda execução de sandbox:
#   {"error":"Cannot find module '../../../governance/bug-closure/command-policy'","code":"MODULE_NOT_FOUND"}
# Rodando o mesmo código como processo bare no host (Jest) o `require()` resolve contra o monorepo
# e MASCARA a ausência — foi assim que a mesma classe de defeito voltou (ver ER-V1-SEALFIX-003 no
# comentário acima). A prevenção é `tests/unit/engineeringRunnerDockerfileClosure.test.js`, que
# calcula o fechamento transitivo de `require()` a partir das entradas do runner e reprova qualquer
# arquivo alcançado sem COPY. Ao adicionar dependência nova, o teste aponta o que falta.
COPY api/utils ./api/utils
COPY engine/shared ./engine/shared
COPY governance/bug-closure ./governance/bug-closure
COPY config/timeout-policy.json ./config/timeout-policy.json

EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.ENGINEERING_RUNNER_PORT||process.env.PORT||'8090')+'/health',(r)=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

WORKDIR /app/services/engineering-runner
CMD ["node", "src/index.js"]
