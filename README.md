
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
- PostgreSQL e Redis acessíveis

### Setup completo
```bash
# 1. Clonar e entrar no diretório
git clone <repo> r-agent2
cd r-agent2

# 2. Bootstrap — valida pré-requisitos, instala backend+frontend, copia .env e config.json, migra banco
npm run bootstrap

# 3. Subir em desenvolvimento
npm run dev              # backend + frontend + RAG juntos
npm run start:api        # só backend (porta 3000)
npm run dev:frontend     # só frontend Vite (porta 5173)
```

### Comandos oficiais

| Categoria      | Comando                        | O que faz                                          |
|----------------|--------------------------------|----------------------------------------------------|
| Backend        | `npm run start:api`            | Inicia API (Node.js/Express)                       |
| Dev            | `npm run dev`                  | Inicia backend + frontend (nodemon)                |
| Frontend       | `npm run frontend:build`       | Build de produção do frontend                      |
| Frontend       | `npm run frontend:smoke`       | Valida artefato do frontend (bloqueante)           |
| Frontend       | `npm run frontend:test`        | Testes unitários do frontend                       |
| Testes         | `npm run test:unit`            | Testes unitários do backend (Jest)                 |
| DB             | `npm run db:migrate`           | Aplica migrações pendentes                         |
| Bootstrap      | `npm run bootstrap:check`      | Verifica pré-requisitos sem instalar               |
| Gate CI        | `npm run pipeline:gate`        | **Go/no-go unificado**: unit + frontend + QA mesh  |
| Release        | `npm run zip:release`          | Empacota, audita e gera manifesto SHA-256          |
| Release        | `npm run release:official`     | Pipeline completo: tests → build → pkg → zip       |
| QA             | `npm run qa:mesh`              | Executa QA Mesh (todos os adaptors)                |
| Validação      | `npm run system:release-gate`  | Gate de release (requer artefato aprovado em dist/)|
| Evidência      | `npm run system:release-evidence-pack` | Empacota evidências de release          |

### Configuração (clone limpo)
```bash
# O bootstrap cria automaticamente .env e api/data/config.json a partir dos examples.
# Edite os arquivos gerados com valores reais antes de subir:
#   .env                     → ENCRYPTION_KEY obrigatório
#   api/data/config.json     → ports, integrações, features
cp env.example .env
cp api/data/config.example.json api/data/config.json
```

### Empacotamento de release
```bash
# Gerar ZIP auditado + manifesto SHA-256
npm run zip:release

# Pipeline oficial completo (testes + build + packaging):
npm run release:official

# O artefato fica em dist/<nome>.zip + dist/<nome>.manifest.json
```
- O script **bloqueia** se detectar `.env`, `.token.env`, dumps ou backups.
- Mantém automaticamente apenas os 3 ZIPs mais recentes em `dist/`.
- `system:release-gate` verifica manifesto com `audit: passed` antes de autorizar deploy.

---

## Test Setup

Run `npm install` before any Jest-based validation. The default source ZIP for this repository excludes `node_modules`, so tests are only reproducible after a clean install in the unpacked workspace.

Vertical Beauty/Fitness validation commands:

- `npm run test:vertical:unit`
- `npm run test:vertical:integration`
- `node scripts/vertical-e2e-validate.js`
