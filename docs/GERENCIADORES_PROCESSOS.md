# Gerenciadores de Processos (Padrão Oficial)

Este projeto adota **Docker Compose** como padrão único de execução operacional.

## Modos suportados

- Desenvolvimento local: `npm run dev` / `npm run dev:api` / `npm run dev:frontend`
- Operação integrada (oficial): `docker compose` com runtime externo

## Padrão obrigatório

1. Definir `RUNTIME_ROOT` fora do workspace.
2. Subir stack por `docker-compose.prod.yml` (ou compose equivalente do ambiente).
3. Executar validações oficiais antes de release.

## Comandos oficiais

```bash
# Build imagens
npm run deploy:build

# Subir stack
npm run deploy:up

# Status/logs
npm run deploy:status
npm run deploy:logs

# Derrubar stack
npm run deploy:down
```

## Política operacional

- Release é bloqueada se validações de build/smoke/empacotamento falharem.
- Runtime local dentro do repositório não é permitido.
