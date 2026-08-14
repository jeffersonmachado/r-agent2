# Gerenciadores de Processos

Este projeto utiliza:

- `nodemon` para desenvolvimento local
- `docker compose` como padrão operacional

## Instalação

```bash
npm install
chmod +x scripts/setup-process-managers.sh
./scripts/setup-process-managers.sh
```

## Desenvolvimento

```bash
# API com auto-reload
npm run dev:api

# Frontend
npm run dev:frontend

# Ambos
npm run dev
```

## Operação (padrão oficial)

```bash
# Build
npm run deploy:build

# Subir stack
npm run deploy:up

# Status e logs
npm run deploy:status
npm run deploy:logs

# Derrubar stack
npm run deploy:down
```

## Reinício via UI

A interface de configuração detecta automaticamente o processo em execução:

- `nodemon`: reinício automático
- `none`: reinício manual

## Observações

- Runtime deve usar runtime root fora do workspace (resolvido automaticamente).
- Release depende das validações oficiais de build/smoke/empacotamento.

