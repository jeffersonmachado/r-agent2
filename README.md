
# Results Autonomous Platform

The **Results Autonomous Platform (RAP)** is an **Autonomous Operations Platform** designed to:

- understand operational events
- maintain operational state
- make decisions
- execute actions
- continuously learn

## Core Loop

Events → State → Decision → Execution → Learning

## Documentation

See `/docs` for architecture, capabilities, verticals, and roadmap.

---

## Quick Start (clone limpo → ambiente rodando)

### Pré-requisitos
- Node.js `>=22.12.0` (use `nvm use` — versão em `.nvmrc`)
- npm `>=10.0.0`
- PostgreSQL e Redis acessíveis (configure em `.env`)

### Setup completo
```bash
# 1. Clonar e entrar no diretório
git clone <repo> r-agent2
cd r-agent2

# 2. Bootstrap (valida pré-requisitos, instala deps backend+frontend, migra banco)
npm run bootstrap

# 3. Subir em desenvolvimento
npm run dev        # backend + frontend + RAG juntos
# ou separadamente:
npm run start:api            # só backend (porta 3000)
npm run dev:frontend         # só frontend Vite (porta 5173)
```

### Comandos essenciais

| Categoria      | Comando                      | O que faz                             |
|----------------|------------------------------|---------------------------------------|
| Backend        | `npm run start:api`          | Inicia API (Node.js/Express)          |
| Frontend       | `npm run frontend:build`     | Build de produção do frontend         |
| Frontend       | `npm run frontend:smoke`     | Valida artefato do frontend           |
| Frontend       | `npm run frontend:test`      | Testes unitários do frontend          |
| Testes         | `npm run test:unit`          | Testes unitários do backend (Jest)    |
| Testes         | `npm run test:flow`          | Testes de fluxo                       |
| DB             | `npm run db:migrate`         | Aplica migrações pendentes            |
| Release        | `npm run zip:release`        | Empacota, audita e gera manifesto     |
| Validação      | `npm run bootstrap:check`    | Verifica pré-requisitos sem instalar  |
| Validação      | `npm run validate:invariants`| Valida invariantes do sistema         |

### Variáveis de ambiente obrigatórias
Copie `env.example` para `.env` e preencha antes de subir:
```bash
cp env.example .env
# Edite .env com: DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, REDIS_HOST, etc.
```

### Empacotamento de release
```bash
# Release com auditoria automática + manifesto SHA-256
npm run zip:release

# O artefato fica em dist/<nome>.zip
# Junto com dist/<nome>.manifest.json para rastreabilidade
```
- O script **bloqueia** a release se encontrar arquivos sensíveis (`.env`, `.token.env`, dumps, backups).
- Mantém automaticamente apenas os 3 ZIPs mais recentes em `dist/`.

---

## Test Setup

Run `npm install` before any Jest-based validation. The default source ZIP for this repository excludes `node_modules`, so tests are only reproducible after a clean install in the unpacked workspace.

Vertical Beauty/Fitness validation commands:

- `npm run test:vertical:unit`
- `npm run test:vertical:integration`
- `node scripts/vertical-e2e-validate.js`
