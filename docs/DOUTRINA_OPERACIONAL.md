# Doutrina Operacional e Configuração Única

Convenções operacionais, arquitetura de configuração e procedimentos padrão para r-agent2 em qualquer ambiente (desenvolvimento, teste, produção).

---

## 1. Princípios fundamentais

### 1.1 Separação produto ↔ runtime

- **Produto**: Código, contratos, testes, documentação (vive no git)
- **Runtime**: Sessões, stores, aprendizado, evidências, logs de release (vive fora do workspace)

Quando uma decisão arquitetural tiver impacto em path, aplicar esta regra:
> *"Se é estado mutável ou transitório, deve respeitar o runtime_root por default"*

### 1.2 Convenção de configuração em cascata

Para qualquer path que precise ser externalizável:

```
1. Explicit override (env var específico, e.g. PHYSICAL_QUEUE_EVIDENCE_PATH)
2. Runtime root (resolvido automaticamente: /var/lib/ragent2 em produção, ~/.local/share/ragent2-runtime em dev)
3. Default (path workspace relativo, e.g. qa/l01-physical-queue-evidence.json)
```

Implementação unitária via `tools/system/lib/runtime-paths.js`:
- `runtimeAwarePath(rootDir, defaultRelPath, explicitEnvVar)` — aplica cascata
- `resolveWorkspacePath(rootDir, targetPath)` — resolve absolute/relative
- `getRuntimeRoot(rootDir)` — obtém o runtime_root resolvido

---

## 2. Variáveis de ambiente oficiais

### 2.1 Universais (aplicadas ponta-a-ponta)

| Variável | Descrição | Recomendação Docker | Recomendação Dev Local |
|----------|-----------|---------------------|------------------------|
| — (sem env var) | Runtime root é resolvido pela aplicação | `/var/lib/ragent2` (default em produção) | `~/.local/share/ragent2-runtime` (default em dev) |
| `NODE_ENV` | Ambiente (development, test, production) | `production` | `development` |
| `LOG_LEVEL` | Nível de logging (debug, info, warn, error) | `info` ou `debug` | `debug` |

### 2.2 Específicas por domínio

#### API / QA

| Variável | Default | Precedência | Uso |
|----------|---------|-------------|-----|
| `TEST_BASE_URL` | — | Explícito | URL da API para smoke tests |
| `FRONTEND_URL` | `http://localhost:5173` | Config/explícito | URL do frontend |
| `PHYSICAL_QUEUE_EVIDENCE_PATH` | `qa/l01-physical-queue-evidence.json` | Explícito > runtime_root | L-01 smoke evidence |
| `URA_PUBLISH_EVIDENCE_PATH` | `qa/l02-ura-publish-rollback-evidence.json` | Explícito > runtime_root | L-02 smoke evidence |
| `BPMN_EDITOR_EVIDENCE_PATH` | `qa/l06-bpmn-editor-evidence.json` | Explícito > runtime_root | L-06 smoke evidence |
| `BPMN_EDITOR_SMOKE_REPORT_PATH` | `qa/smoke/l06-bpmn-editor-smoke.md` | Explícito > runtime_root | L-06 smoke report |
| `RPA_REPLAY_SCALE_EVIDENCE_PATH` | `qa/l07-rpa-replays-scale-evidence.json` | Explícito > runtime_root | L-07 scale test |
| `QA_RESULT_PATH` | `qa/qa-result.json` | Explícito > runtime_root | IA rollout validator |

#### RAG Service

| Variável | Default | Precedência | Uso |
|----------|---------|-------------|-----|
| `RAG_DATA_ROOT` | `rag-service/data` | Explícito > runtime_root | Raiz mutable do RAG |
| `VECTOR_STORE_PATH` | `rag-service/data/vector_store` | Explícito | Store vetorial persistente |
| `ADAPTIVE_LEARNING_DATA_PATH` | `rag-service/data/adaptive_learning` | Explícito | Aprendizado adaptativo |

#### WhatsApp / Auth

| Variável | Default | Precedência | Uso |
|----------|---------|-------------|-----|
| `WWEBJS_AUTH_PATH` | `api/data/wa_sessions` | Explícito > runtime_root | Autenticação WhatsApp Web.js |

#### Release / Governance

| Variável | Default | Precedência | Uso |
|----------|---------|-------------|-----|
| `RELEASE_EVIDENCE_BASE_DIR` | `qa/release-evidence` | Explícito > runtime_root | Evidências de release (manifest, gates, summary, etc) |
| `QA_MESH_SYSTEM_VALIDATE_DIR` | `qa-mesh/system-validate` | Explícito > runtime_root | Saídas do system:validate para QA Mesh |

---

## 3. Estrutura de paths canônica

### 3.1 Por ambiente

#### Docker / Compose (Recomendado para produção e teste)

```
/var/lib/ragent2/                    ← runtime_root
├── runtime/                          ← Core runtime (API cache, RPA session state)
├── qa/                               ← QA evidências (smokes, reports)
├── qa-mesh/                          ← QA Mesh outputs (system-validate, mesh runs)
├── release-evidence/                 ← Release gates, manifests, summaries
├── rag/                              ← RAG data (vector store, learning)
├── whatsapp/
│   └── auth/                         ← WhatsApp Web.js sessions
├── logs/                             ← Application logs
└── reports/                          ← Build/test reports
```

Configuração Compose:
```yaml
services:
  api:
    volumes:
      - api-runtime:/var/lib/ragent2
  rag:
    volumes:
      - rag-runtime:/var/lib/ragent2/rag
volumes:
  api-runtime: {}
  rag-runtime: {}
```

#### Desenvolvimento local (Flexível)

```
~/.local/share/ragent2-runtime/      ← runtime_root (recomendado)
  ou /tmp/ragent2-runtime-$USER/     ← Alternativa temporária
```

Ou simplesmente deixar `runtime_root` indefinido — o default computado é `~/.local/share/ragent2-runtime` (fora do workspace), com fallback para `os.tmpdir()/ragent2-runtime` quando não houver `HOME`. Valor explícito dentro do workspace continua sendo erro.

### 3.2 Paths que devem estar isolados (NUNCA em workspace)

- `$runtime_root/qa-mesh/system-validate` — saídas do npm run system:validate
- `$runtime_root/qa/release-evidence` — manifests, gates, summaries
- `$runtime_root/rag-service/data/vector_store` — vetores
- `$runtime_root/rag-service/data/adaptive_learning` — modelos personalizados
- `api/data/wa_sessions` (ou `$runtime_root/whatsapp/auth`) — sessões WhatsApp
- `$runtime_root/qa/l01-l07*` — smoke test evidências

### 3.3 Paths que podem estar em workspace (durante dev, desaconselhado em prod)

- `qa/` — evidências de teste (durante dev local)
- `reports/` — relatórios de build (temporários)
- `frontend/dist/` — build do frontend (regenerável)

**Higiene obrigatória antes de release:**
```bash
npm run runtime:clean:check        # Detectar resíduos
npm run runtime:clean              # Remover resíduos conhecidos
npm run zip:release:clean          # Empacotar limpo
```

---

## 4. Operações padrão (Workflows)

### 4.1 Desenvolvimento local iterativo

```bash
# 1. Setup inicial
npm ci
cp env.example .env
export runtime_root=~/.local/share/ragent2-runtime

# 2. Build & serve
npm run dev

# 3. Smoke tests isolados (com runtime_root, fallback workspace se indefinido)
npm run test:physical:smoke              # L-01
npm run test:ura:publish-rollback:smoke  # L-02
npm run test:bpmn:smoke                  # L-06
# ... etc

# 4. Validação local full
npm run system:validate                  # Lê de runtime_root, escreve lá

# 5. Limpeza periódica
npm run runtime:clean
```

### 4.2 Bootstrap & Validation (QA / Release)

```bash
# 1. Prepare environment
export runtime_root=/var/lib/r-agent2-runtime  # ou similar
export NODE_ENV=test
npm ci

# 2. Bootstrap (seeds, migrations, config)
npm run system:bootstrap

# 3. System validate (official QA Mesh pipeline)
npm run system:validate
# → Outputs: qa-mesh/system-validate/meshReport.json + evidence

# 4. Check verdicts
npm run check:green                      # Read qa/final-verdict.json
```

**Expected behavior:**
- Scripts respeitam `runtime_root` para evidências/reports
- Fallback para workspace-relative defaults se `runtime_root` indefinido
- Official `npm run system:validate` é a única validação obrigatória

### 4.3 Release Gate & Decision

> **Autoridade de release:** A autoridade única de release completo (selagem + publicação) é `npm run release:seal` (planeje com `npm run release:seal:plan`). O encadeamento abaixo documenta etapas internas para depuração: `system:release` e `zip:release` são etapas internas do pipeline de release (validação+empacotamento e helper de pacote), invocadas pelas fases do `release:seal`, e não a autoridade de release.

```bash
export runtime_root=/var/lib/r-agent2-release

# 1. Execute gate (reads verdicts, applies governance)
npm run system:release-gate
# → Outputs: qa-mesh/release-gate-report.json (in runtime_root)

# 2. Generate manifest & evidence pack
npm run system:release-manifest
npm run system:release-evidence-pack
# → Outputs: evidences + SHA-256 manifest in runtime_root/qa/release-evidence/

# 3. Release decision (GO / NO_GO)
npm run system:go-no-go
# → Outputs: qa-mesh/go-no-go-report.json (in runtime_root)

# 4. Summary & approval
npm run system:release-summary
# → Outputs: qa-mesh/release-summary.json (in runtime_root)
```

**Governance rules:**
- `max_failure_rate: 0.2` (80% pass rate minimum)
- `min_execution_ratio: 0.7` (70% coverage minimum)
- Critical domains: core, pbx, omnichannel
- Blocking domains: trigger NO_GO if failed

### 4.4 Cleanup & Housekeeping

```bash
# Before every release
npm run runtime:clean:check
# ↓ if fails:
npm run runtime:clean

# List what would be removed
npm run runtime:clean -- --dry-run

# Verify absence of runtime residues
ls -la api/data/wa_sessions 2>&1 | grep -i "no such\|cannot"
ls -la rag-service/data/vector_store 2>&1 | grep -i "no such\|cannot"
ls -la qa-mesh/system-validate 2>&1 | grep -i "no such\|cannot"
```

---

## 5. Configuração centralizada por ambiente

### 5.1 `.env` pattern

```bash
# Universal
NODE_ENV=production
LOG_LEVEL=info
runtime_root=/var/lib/ragent2

# API
TEST_BASE_URL=http://localhost:3001
FRONTEND_URL=http://localhost:5173

# RAG
RAG_DATA_ROOT=${runtime_root}/rag
VECTOR_STORE_PATH=${runtime_root}/rag/vector_store
ADAPTIVE_LEARNING_DATA_PATH=${runtime_root}/rag/adaptive_learning

# WhatsApp Auth
WWEBJS_AUTH_PATH=${runtime_root}/whatsapp/auth

# Release/QA
RELEASE_EVIDENCE_BASE_DIR=${runtime_root}/release-evidence
QA_MESH_SYSTEM_VALIDATE_DIR=${runtime_root}/qa-mesh/system-validate
```

### 5.2 Precedência de configuração

1. **Explicit environment variable** (e.g., `PHYSICAL_QUEUE_EVIDENCE_PATH=/custom/path`)
2. **runtime_root-derived** (e.g., `runtime_root=/var/lib/ragent2` → `qa/l01-*` → `/var/lib/ragent2/qa/l01-*`)
3. **Default workspace-relative** (e.g., `qa/l01-physical-queue-evidence.json`)

Never hardcode paths. Always use the cascade pattern via `tools/system/lib/runtime-paths.js`.

---

## 6. Checklist pré-release

### 6.1 código & build

- [ ] `npm ci` completa sem erro
- [ ] `npm run frontend:test:unit` passa
- [ ] `npm run test:all` passa com cobertura adequada
- [ ] `npm run build` completa sem warning crítico
- [ ] Frontend `npm run build` completa
- [ ] Nenhum `TODO`, `FIXME`, `XXX` em código crítico não-documentado

### 6.2 Runtime residues

- [ ] `npm run runtime:clean:check` retorna "clean" ou lista vazia
- [ ] Se houver resíduos: `npm run runtime:clean` executado
- [ ] Verificar ausência manual de:
  - `api/data/wa_sessions/*` (exceto `.gitkeep`)
  - `rag-service/data/vector_store/*` (exceto `.gitkeep`)
  - `rag-service/data/adaptive_learning/*` (exceto `.gitkeep`)
  - `qa-mesh/system-validate/` (exceto `.gitkeep`)
  - `qa/release-evidence/` (exceto `.gitkeep`)
  - `frontend/dist/` (será regenerado)
  - `reports/` (será regenerado)

### 6.3 Validation

- [ ] `runtime_root` definido para release (não usar workspace)
- [ ] `npm run system:bootstrap` completa
- [ ] `npm run system:validate` retorna **GREEN (GO)** com executionQuality = "valid"
- [ ] `npm run check:green` retorna "GO"
- [ ] Todos os domínios críticos (core, pbx, omnichannel) passaram

### 6.4 Gatekeeping

- [ ] `npm run system:release-gate` aprova
- [ ] `npm run system:go-no-go` retorna **GO** (não NO_GO)
- [ ] `npm run system:release-manifest` gera manifesto + SHA-256
- [ ] `npm run system:release-summary` documenta critérios atendidos
- [ ] `npm run system:release-evidence-verify` aprova integrity

### 6.5 Artefato

- [ ] `npm run zip:release:clean` gera `dist/r-agent2-*.zip`
- [ ] ZIP contém apenas código+config, sem estado mutável
- [ ] SHA-256 manifest presente e válido
- [ ] Auditoria (`npm audit`) sem vulnerabilidades críticas

---

## 7. Regras governança (Go/No-Go)

### 7.1 Critério de aceite (GO)

| Critério | Threshold | Validator |
|----------|-----------|-----------|
| Execution coverage | ≥ 70% | system:validate |
| Pass rate | ≥ 80% | system:validate |
| Core domain pass rate | 100% | system:validate |
| PBX domain pass rate | ≥ 95% | system:validate |
| Omnichannel domain pass rate | ≥ 95% | system:validate |
| No infra errors | 0 infrastructure failures | system:validate |
| Release gate approval | All gates pass | system:release-gate |
| Code audit | No critical vulns | `npm audit` |
| Workspace clean | No residues | runtime:clean:check |

### 7.2 Critério de bloqueio (NO_GO)

- Qualquer domínio crítico falha completamente
- Pass rate < 80%
- Infra errors > 0
- Release gate rejeita
- Resíduos não-removíveis no workspace

---

## 8. Suporte a múltiplos ambientes

### 8.1 Desenvolvimento

```bash
# Sem runtime_root defino, fallback para workspace relativo
npm run system:validate
# → qa/system-validate-report.json (workspace)
```

### 8.2 CI/CD (GitHub Actions / Jenkins / GitLab)

```bash
export runtime_root=/tmp/r-agent2-runtime-$BUILD_ID
mkdir -p $runtime_root
npm ci
npm run system:validate
# → $runtime_root/qa-mesh/system-validate/...
# → Artifacts coletados após execução
```

### 8.3 Produção / Release

> A autoridade única de release completo (selagem + publicação) é `npm run release:seal`; a sequência abaixo são etapas internas para depuração (ver §4.3).

```bash
export runtime_root=/var/lib/r-agent2-release
export RELEASE_EVIDENCE_BASE_DIR=$runtime_root/evidences
npm run system:validate
npm run system:release-gate
npm run system:go-no-go
npm run system:release-summary
# → Tudo em $runtime_root, nunca no workspace
```

---

## 9. Troubleshooting operacional

### "scripts/test-*-smoke.js não encontram evidências"

**Causa:** runtime_root indefinido ou path errado
**Solução:**
```bash
export runtime_root=/path/to/runtime
node scripts/test-physical-queue-smoke.js  # Escreve em $runtime_root/qa/l01-...
```

### "npm run system:validate escreve em workspace, não em runtime_root"

**Causa:** runtime_root não definido antes da execução
**Solução:**
```bash
export runtime_root=/var/lib/ragent2
npm run system:validate  # Agora escreve em runtime_root/qa-mesh/...
```

### "Cleanup falha com 'resíduos não-removíveis'"

**Causa:** Permissões de arquivo ou path não acessível
**Solução:**
```bash
npm run runtime:clean:check -- --verbose  # Listar resíduos
sudo npm run runtime:clean  # Se necessário elevação
# ou manualmente:
rm -rf $runtime_root/qa-mesh/system-validate/*
rm -rf $runtime_root/release-evidence/*
```

### "CI pipeline falha porque runtime_root indefinido"

**Causa:** Variável não exportada em script de build
**Solução:**
```yaml
# GitHub Actions
env:
  runtime_root: /tmp/r-agent2-runtime-${{ github.run_id }}
before-script: mkdir -p $runtime_root
```

---

## 10. Changelog & Evolution

### v1.0 (Abril 2026)

- Consolidação de runtime paths em `tools/system/lib/runtime-paths.js`
- 8 smoke tests + 3 utilidades com suporte a `runtime_root`
- Variáveis de ambiente oficiais documentadas
- Release gate + go/no-go governance definida
- Cleanup procedures padronizadas

**Próximas evoluções:**
- Auto-configuration de .env por ambiente
- Healthcheck integrado para pre-release validation
- Dashboard de operações (status de runtime_root, evidências, approval)

---

## Referências

- [Runtime Paths Technical](./runtime-paths.md)
- [Release Checklist](./release-checklist.md)
- [System Validate Architecture](./API_ENDPOINTS_CODEBASE.md#validation)
- [Governance & Gates](../tools/system/)

