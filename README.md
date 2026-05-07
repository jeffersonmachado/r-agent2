
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
npm run system:reproducibility
npm run system:validate
npm run system:release
# dry-run por padrão
npm run system:deploy
```

### Gate local no servidor (pré-deploy)
Use um gate local para bloquear deploy quando validação/release falhar.

```bash
# validação rápida (sem deploy)
npm run deploy:gate:quick

# validação oficial completa (sem deploy)
npm run deploy:gate:official

# validação + deploy automático só se PASS
npm run deploy:gate -- --profile official --deploy-cmd "npm run deploy:prod:nobuild"

# com rollback opcional em caso de falha no deploy
npm run deploy:gate -- --profile official --deploy-cmd "npm run deploy:prod" --rollback-cmd "npm run deploy:down && npm run deploy:up"
```

- Script: `scripts/deploy-gate.sh`
- Perfis: `official` (usa `system:release`) e `quick` (`system:validate` + `zip:release:clean` + `system:release-gate`)
- Por padrão, sem `--deploy-cmd`, o fluxo apenas valida e nao executa deploy.

### Reprodutibilidade de bootstrap/build/smoke
```bash
# caminho padrão (usa dependências já instaladas)
npm run system:reproducibility

# modo clone limpo (inclui install de deps)
SYSTEM_REPRO_INSTALL_DEPS=1 npm run system:reproducibility

# inclui bootstrap completo (sem probes de serviço)
SYSTEM_REPRO_RUN_BOOTSTRAP_FULL=1 npm run system:reproducibility
```
- Relatório gerado em `qa/reproducibility-report.json` (ou `REPRODUCIBILITY_REPORT_PATH`).

### Hardening de configuração de IA
```bash
# valida docs + providers suportados + config.example sem segredos em bloco ai
npm run system:ai-hardening

# modo estrito (exige ENCRYPTION_KEY válida)
AI_HARDENING_REQUIRE_ENCRYPTION_KEY=1 npm run system:ai-hardening
```
- Relatório gerado em `qa/ai-hardening-report.json` (ou `AI_HARDENING_REPORT_PATH`).

### Contratos operacionais
- Trilha oficial detalhada: docs/official-path.md
- Runtime mutável e volumes oficiais: docs/runtime-paths.md
- Checklist de release artefatual: docs/release-checklist.md
- Governança de runtime real vs sintético: docs/runtime-governance.md
- Contrato de release/deploy por artefato aprovado: docs/release-contract.md

### Nota de segurança (smoke L-04 em modo direct)
- Para executar `test:pbx:call-events-runtime:smoke` com `PBX_CALL_EVENTS_RUNTIME_INSERT_MODE=direct`, declare intenção explícita de banco:
	- `TEST_DATABASE_URL=<url>` ou
	- `PBX_CALL_EVENTS_RUNTIME_ALLOW_DB_FALLBACK=1`
- O cenário oficial via `qa:mesh` já define `PBX_CALL_EVENTS_RUNTIME_ALLOW_DB_FALLBACK=1`.

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
# limpar resíduos operacionais do workspace antes do pacote
npm run runtime:clean

# Gerar ZIP auditado + manifesto SHA-256
npm run zip:release:clean

# Pipeline oficial completo (validação + gate + packaging + manifestos)
npm run system:release

# O artefato fica em dist/<nome>.zip + dist/<nome>.manifest.json
```
- O script **bloqueia** se detectar `.env`, `.token.env`, dumps ou backups.
- `npm run runtime:clean:check` falha se ainda houver runtime local transitório no workspace.
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
