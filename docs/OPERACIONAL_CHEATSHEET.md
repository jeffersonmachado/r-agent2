# Cheatsheet Operacional Rápido

Referência rápida de comandos e decisões operacionais para r-agent2.

---

## Setup Inicial

```bash
# Variáveis universais OBRIGATÓRIAS
export NODE_ENV=production           # ou development/test
export RUNTIME_ROOT=/var/lib/ragent2 # ou ~/.local/share/ragent2-runtime (dev)
export LOG_LEVEL=info                # ou debug/warn/error

# Verificação rápida
echo "RUNTIME_ROOT=$RUNTIME_ROOT"
echo "NODE_ENV=$NODE_ENV"
mkdir -p "$RUNTIME_ROOT"
```

---

## Desenvolvimento Local

```bash
# Start rápido
npm ci
export RUNTIME_ROOT=~/.local/share/ragent2-runtime
npm run dev

# Smoke testes isolados (respeitam RUNTIME_ROOT automaticamente)
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
export RUNTIME_ROOT=/var/lib/r-agent2-release
export NODE_ENV=production
mkdir -p "$RUNTIME_ROOT/qa-mesh" "$RUNTIME_ROOT/release-evidence"

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
| "Path not found in RUNTIME_ROOT" | `echo $RUNTIME_ROOT` | Defina ou crie diretório |
| Evidência em workspace (ruim) | `npm run runtime:clean:check` | Execute `npm run runtime:clean` |
| Validação falha | `npm run system:validate` | Verifique logs em `$RUNTIME_ROOT/qa-mesh/` |
| Gate rejeita | `npm run system:release-gate` | Revise verdicts em `$RUNTIME_ROOT/qa/` |
| Cleanup não remove | `sudo npm run runtime:clean` | Pode precisar elevação de privilégio |

---

## Variáveis Críticas por Ambiente

### Docker Production
```bash
RUNTIME_ROOT=/var/lib/ragent2
NODE_ENV=production
LOG_LEVEL=info
FRONTEND_URL=https://your-domain.com
TEST_BASE_URL=http://localhost:3001
```

### CI/CD (GitHub Actions / Jenkins)
```bash
RUNTIME_ROOT=/tmp/r-agent2-${GITHUB_RUN_ID}
NODE_ENV=test
LOG_LEVEL=debug
TEST_BASE_URL=http://localhost:3001
VECTOR_STORE_PATH=${RUNTIME_ROOT}/rag/vector_store
```

### Development Local
```bash
RUNTIME_ROOT=~/.local/share/ragent2-runtime
NODE_ENV=development
LOG_LEVEL=debug
# Restante pode usar defaults
```

---

## Decision Matrix

```
┌─ RUNTIME_ROOT definido? ────┐
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

- [ ] `echo $RUNTIME_ROOT` (não-vazio)
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
cat $RUNTIME_ROOT/qa-mesh/system-validate/meshReport.json

# Release gate decision
cat $RUNTIME_ROOT/qa-mesh/release-gate-report.json

# Go/no-go evidence
cat $RUNTIME_ROOT/qa-mesh/go-no-go-report.json

# Smoke test evidence
cat $RUNTIME_ROOT/qa/l01-physical-queue-evidence.json
cat $RUNTIME_ROOT/qa/l06-bpmn-editor-evidence.json

# Release summary
cat $RUNTIME_ROOT/qa-mesh/release-summary.json
```

---

## Environment File Template (.env.production)

```bash
# Node
NODE_ENV=production
LOG_LEVEL=info

# Paths (OBRIGATÓRIO)
RUNTIME_ROOT=/var/lib/ragent2
RELEASE_EVIDENCE_BASE_DIR=${RUNTIME_ROOT}/release-evidence
QA_MESH_SYSTEM_VALIDATE_DIR=${RUNTIME_ROOT}/qa-mesh/system-validate

# API
TEST_BASE_URL=http://localhost:3001
FRONTEND_URL=https://your-production-domain.com

# RAG
RAG_DATA_ROOT=${RUNTIME_ROOT}/rag
VECTOR_STORE_PATH=${VECTOR_STORE_PATH:-${RAG_DATA_ROOT}/vector_store}
ADAPTIVE_LEARNING_DATA_PATH=${ADAPTIVE_LEARNING_DATA_PATH:-${RAG_DATA_ROOT}/adaptive_learning}

# WhatsApp
WWEBJS_AUTH_PATH=${RUNTIME_ROOT}/whatsapp/auth

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

# Pre-release gate (requer RUNTIME_ROOT)
npm run system:release-gate

# Evidence retention (mantém últimos 10 releases)
npm run release:evidence:prune --keep=10
```

---

## Exit Codes

| Code | Significado | Ação |
|------|-----------|------|
| 0 | SUCCESS / GO | Proceder com release |
| 1 | FAILURE / NO_GO | Revisar evidências, correção necessária |
| 2 | SETUP ERROR | Verificar RUNTIME_ROOT, variáveis |
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

# Utilities (respeitam RUNTIME_ROOT)
npm run test:physical-queue-smoke    # L-01
npm run test:bpmn-editor-smoke       # L-06
npm run system:release-summary       # Document approval

# Cleanup
npm run runtime:clean:check          # Detect residues
npm run runtime:clean                # Remove residues
npm run zip:release:clean            # Package safely
```

