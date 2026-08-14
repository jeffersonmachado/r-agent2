# Cheatsheet Operacional Rápido

Referência rápida de comandos e decisões operacionais para r-agent2.

---

## Setup Inicial

```bash
# Variáveis universais OBRIGATÓRIAS
export NODE_ENV=production           # ou development/test
export runtime_root=/var/lib/ragent2 # ou ~/.local/share/ragent2-runtime (dev)
export LOG_LEVEL=info                # ou debug/warn/error

# Verificação rápida
echo "runtime_root=$runtime_root"
echo "NODE_ENV=$NODE_ENV"
mkdir -p "$runtime_root"
```

---

## Desenvolvimento Local

```bash
# Start rápido
npm ci
export runtime_root=~/.local/share/ragent2-runtime
npm run dev

# Smoke testes isolados (respeitam runtime_root automaticamente)
node scripts/test-physical-queue-smoke.js        # L-01
node scripts/test-ura-publish-rollback-smoke.js  # L-02
node scripts/test-bpmn-editor-smoke.js           # L-06
node scripts/test-rpa-replays-scale-smoke.js     # L-07

# Validação full
npm run system:validate

# Limpeza
npm run runtime:clean:check
npm run runtime:clean
```

---

## Release Pre-Flight

```bash
# 1️⃣ Environment Setup
export runtime_root=/var/lib/r-agent2-release
export NODE_ENV=production
mkdir -p "$runtime_root/qa-mesh" "$runtime_root/release-evidence"

# 2️⃣ Bootstrap & Validate
npm ci
npm run system:bootstrap
npm run system:validate

# 3️⃣ Check Verdict
npm run check:green

# 4️⃣ Release Gate
npm run system:release-gate
npm run system:go-no-go

# 5️⃣ Decision (GO = 0, NO_GO = 1)
if npm run check:green >/dev/null; then
  echo "✅ APPROVED FOR RELEASE"
  npm run system:release-summary
else
  echo "❌ RELEASE BLOCKED"
  exit 1
fi

# 6️⃣ Package
npm run zip:release:clean
ls -lh dist/r-agent2-*.zip
```

---

## Troubleshooting

| Problema | Comando | Solução |
|----------|---------|---------|
| "Path not found in runtime_root" | `echo $runtime_root` | Defina ou crie diretório |
| Evidência em workspace (ruim) | `npm run runtime:clean:check` | Execute `npm run runtime:clean` |
| Validação falha | `npm run system:validate` | Verifique logs em `$runtime_root/qa-mesh/` |
| Gate rejeita | `npm run system:release-gate` | Revise verdicts em `$runtime_root/qa/` |
| Cleanup não remove | `sudo npm run runtime:clean` | Pode precisar elevação de privilégio |

---

## Variáveis Críticas por Ambiente

### Docker Production
```bash
runtime_root=/var/lib/ragent2
NODE_ENV=production
LOG_LEVEL=info
FRONTEND_URL=https://your-domain.com
TEST_BASE_URL=http://localhost:3001
```

### CI/CD (GitHub Actions / Jenkins)
```bash
runtime_root=/tmp/r-agent2-${GITHUB_RUN_ID}
NODE_ENV=test
LOG_LEVEL=debug
TEST_BASE_URL=http://localhost:3001
VECTOR_STORE_PATH=${runtime_root}/rag/vector_store
```

### Development Local
```bash
runtime_root=~/.local/share/ragent2-runtime
NODE_ENV=development
LOG_LEVEL=debug
# Restante pode usar defaults
```

---

## Decision Matrix

```
┌─ runtime_root definido? ────┐
│   ├─ SIM → Use para evidências/reports
│   └─ NÃO → Use workspace defaults (desaconselhado em prod)
│
├─ npm run system:validate?
│   └─ Deve retornar exitCode 0 (GO) antes de release
│
├─ npm run system:release-gate?
│   └─ Deve aprovar todos os critérios
│
└─ Workspace limpo?
    └─ npm run runtime:clean:check deve retornar OK
```

---

## Checklist Pré-Release (5 min)

- [ ] `echo $runtime_root` (não-vazio)
- [ ] `npm ci` ✓
- [ ] `npm run system:bootstrap` ✓
- [ ] `npm run system:validate` retorna **GO** ✓  
- [ ] `npm run check:green` retorna **GO** ✓
- [ ] `npm run runtime:clean:check` retorna OK ✓
- [ ] `npm run system:release-gate` aprova ✓
- [ ] `npm run zip:release:clean` gera ZIP ✓
- [ ] **RELEASE APPROVED** → Deploy

---

## Logs úteis

```bash
# System validate report
cat $runtime_root/qa-mesh/system-validate/meshReport.json

# Release gate decision
cat $runtime_root/qa-mesh/release-gate-report.json

# Go/no-go evidence
cat $runtime_root/qa-mesh/go-no-go-report.json

# Canonical promotion metadata
cat $runtime_root/qa-mesh/canonical-promotion.json

# Canonical execution lock (deve existir apenas durante a execução full-registry)
cat $runtime_root/qa-mesh/canonical.lock.json

# Smoke test evidence
cat $runtime_root/qa/l01-physical-queue-evidence.json
cat $runtime_root/qa/l06-bpmn-editor-evidence.json

# Release summary
cat $runtime_root/qa-mesh/release-summary.json
```

### QA Mesh canônico

- Execução canônica só promove `meshReport.json`, `go-no-go-report.json`, `metrics.json` e `canonical-promotion.json` quando roda em pipeline e cobre o registry completo.
- O runner serializa a promoção canônica com `qa-mesh/canonical.lock.json`; se outra execução full-registry tentar promover ao mesmo tempo, ela falha rápido.
- O lock inclui `pid` do processo dono e locks stale são recuperados automaticamente quando o processo não existe mais.
- Se houver `canonical.lock.json` sem processo ativo correspondente, valide com `pgrep -f "meshRunner.js.*<executionId>"`; sem processo ativo, remover o arquivo é seguro antes de reexecutar.

---

## Environment File Template (.env.production)

```bash
# Node
NODE_ENV=production
LOG_LEVEL=info

# Paths (OBRIGATÓRIO)
runtime_root=/var/lib/ragent2
RELEASE_EVIDENCE_BASE_DIR=${runtime_root}/release-evidence
QA_MESH_SYSTEM_VALIDATE_DIR=${runtime_root}/qa-mesh/system-validate

# API
TEST_BASE_URL=http://localhost:3001
FRONTEND_URL=https://your-production-domain.com

# RAG
RAG_DATA_ROOT=${runtime_root}/rag
VECTOR_STORE_PATH=${VECTOR_STORE_PATH:-${RAG_DATA_ROOT}/vector_store}
ADAPTIVE_LEARNING_DATA_PATH=${ADAPTIVE_LEARNING_DATA_PATH:-${RAG_DATA_ROOT}/adaptive_learning}

# WhatsApp
WWEBJS_AUTH_PATH=${runtime_root}/whatsapp/auth

# Database / External Services
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
```

---

## Operações Contínuas

```bash
# Daily health check
npm run runtime:clean:check

# Weekly cleanup (se necessário)
npm run runtime:clean

# Pre-release gate (requer runtime_root)
npm run system:release-gate

# Evidence retention (mantém últimos 10 releases)
npm run system:release-evidence-prune --keep=10
```

---

## Exit Codes

| Code | Significado | Ação |
|------|-----------|------|
| 0 | SUCCESS / GO | Proceder com release |
| 1 | FAILURE / NO_GO | Revisar evidências, correção necessária |
| 2 | SETUP ERROR | Verificar runtime_root, variáveis |
| 3+ | INFRA ERROR | Verificar serviços, conectividade |

---

## Referência Rápida de Scripts

```bash
# Core validation
npm run system:validate              # Main QA pipeline
npm run system:bootstrap             # Setup environment

# Go/No-Go Governance
npm run system:release-gate          # Check release criteria
npm run system:go-no-go              # Decision maker
npm run check:green                  # Quick verdict check

# Utilities (respeitam runtime_root)
npm run test:physical:smoke          # L-01
npm run test:bpmn:smoke              # L-06
npm run system:release-summary       # Document approval

# Cleanup
npm run runtime:clean:check          # Detect residues
npm run runtime:clean                # Remove residues
npm run zip:release:clean            # Package safely
```

