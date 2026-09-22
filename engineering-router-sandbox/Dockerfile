# Imagem de execução do sandbox do Engineering Model Router V1 (ER-V1-FINAL-001).
#
# Executa testCommands (npm/npx jest/node/git) de patches gerados por LLM, código NÃO
# CONFIÁVEL. Mesma base já usada por api/Dockerfile (node:22-bookworm-slim) para não
# introduzir uma segunda cadeia de imagens a manter — só adiciona git (ausente na slim) e um
# usuário non-root fixo, sem privilégio de instalar nada em runtime.
FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

# UID/GID fixos e não-privilegiados — nunca root dentro do container, mesmo que o container
# escape de algum cap-drop (defesa em profundidade).
RUN groupadd --gid 10001 sandbox \
    && useradd --uid 10001 --gid sandbox --no-create-home --shell /usr/sbin/nologin sandbox

USER sandbox
WORKDIR /workspace
