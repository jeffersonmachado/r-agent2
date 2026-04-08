
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

## Caminho Oficial (clone limpo -> operação)

### Pré-requisitos oficiais
- Node.js: 20.19.x ou 22.12.x+
- npm: 10+
- PostgreSQL e Redis acessíveis

### Comandos oficiais únicos
- npm run system:bootstrap
- npm run system:validate
- npm run system:release
- npm run system:deploy

Esses quatro comandos formam o fluxo principal do projeto.

### Fluxo operacional recomendado
```bash
git clone <repo> r-agent2
cd r-agent2
npm ci
npm run system:bootstrap
npm run system:validate
npm run system:release
# dry-run por padrão
npm run system:deploy
```

### Contratos operacionais
- Trilha oficial detalhada: docs/official-path.md
- Governança de runtime real vs sintético: docs/runtime-governance.md
- Contrato de release/deploy por artefato aprovado: docs/release-contract.md

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

# Pipeline oficial completo (validação + gate + packaging + manifestos)
npm run system:release

# O artefato fica em dist/<nome>.zip + dist/<nome>.manifest.json
```
- O script **bloqueia** se detectar `.env`, `.token.env`, dumps ou backups.
- Mantém automaticamente apenas os 3 ZIPs mais recentes em `dist/`.
- `system:release-gate` consome apenas as evidências geradas em `system:validate`.
- `system:deploy` exige `audit: passed` e `goNoGo: GO` no manifesto do artefato antes de extrair e aplicar deploy.

---

## Test Setup

Run `npm install` before any Jest-based validation. The default source ZIP for this repository excludes `node_modules`, so tests are only reproducible after a clean install in the unpacked workspace.

Vertical Beauty/Fitness validation commands:

- `npm run test:vertical:unit`
- `npm run test:vertical:integration`
- `node scripts/vertical-e2e-validate.js`
