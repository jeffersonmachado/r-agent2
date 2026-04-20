# Documentação Operacional - Índice Consolidado

Navegação pela doutrina operacional, configuração e procedures do r-agent2.

---

## 📋 Comenzar aqui (First Steps)

### Para operadores/DevOps
1. **[Cheatsheet Operacional](./OPERACIONAL_CHEATSHEET.md)** ← Comece aqui
   - 5 min para setup
   - Referência rápida de comandos
   - Decision matrix

2. **[Doutrina Operacional](./DOUTRINA_OPERACIONAL.md)** ← Entender conceitos
   - Princípios de separação produto/runtime
   - Variáveis configuração completas
   - Workflows por ambiente
   - Checklists pré-release

### Para desenvolvedores
1. **[Runtime Paths - Técnico](./runtime-paths.md)** ← Implementação
   - Como usar `tools/system/lib/runtime-paths.js`
   - Padrão de cascata de paths
   - Setup Docker vs Development

2. **[Release Checklist](./release-checklist.md)** ← Antes de mergear
   - Validação código
   - Workspace cleanup
   - Gate approval

---

## 🎯 Por Tarefa

### Setup Inicial (Dev Local)

```bash
# Quick start
export RUNTIME_ROOT=~/.local/share/ragent2-runtime
npm ci
npm run dev

# Reference: Cheatsheet → "Setup Inicial", "Desenvolvimento Local"
```

**Documentação:** [OPERACIONAL_CHEATSHEET.md#setup-inicial](./OPERACIONAL_CHEATSHEET.md#setup-inicial)

### Smoke Tests (Qual rodar?)

**L-01 Physical Queue**
- Arquivo: `scripts/test-physical-queue-smoke.js`
- Evidência: `qa/l01-physical-queue-evidence.json`
- Env var (override): `PHYSICAL_QUEUE_EVIDENCE_PATH`

**L-02 URA Publish**
- Arquivo: `scripts/test-ura-publish-rollback-smoke.js`
- Evidência: `qa/l02-ura-publish-rollback-evidence.json`

**L-03 PBX Voice / TTS / ASR**
- Arquivo: `scripts/test-pbx-voice-tts-asr-smoke.js`
- Evidência: `qa/l03-pbx-voice-tts-asr-evidence.json`

**L-04 PBX Call Events**
- Arquivo: `scripts/test-pbx-call-events-runtime-smoke.js`
- Evidência: `qa/l04-pbx-call-events-evidence.json`

**L-05 Inbox/Omnichannel**
- Arquivo: `scripts/test-inbox-runtime-smoke.js`
- Evidência: `qa/l05-chatpro-omnichannel-evidence.json`

**L-06 BPMN Editor**
- Arquivo: `scripts/test-bpmn-editor-smoke.js`
- Evidência: `qa/l06-bpmn-editor-evidence.json`
- Report: `qa/smoke/l06-bpmn-editor-smoke.md`
### Deployment Guides (Environment-Specific)
**L-07 RPA Replays Scale**
- Arquivo: `scripts/test-rpa-replays-scale-smoke.js`
- Evidência: `qa/l07-rpa-replays-scale-evidence.json`

**Todos respeitam `RUNTIME_ROOT`** se definido, caso contrário fallback workspace.

**Documentação:** [DOUTRINA_OPERACIONAL.md#41-desenvolvimento-local](./DOUTRINA_OPERACIONAL.md#41-desenvolvimento-local)

### System Validate (QA Mesh Pipeline)

```bash
export RUNTIME_ROOT=/var/lib/r-agent2-runtime
npm run system:validate
# → Outputs to $RUNTIME_ROOT/qa-mesh/system-validate/meshReport.json
```

**Decisão:** Retorna exit code 0 (GO) ou 1 (NO_GO)
**Governs:** Pass rate, execution coverage, critical domains

**Documentação:** [DOUTRINA_OPERACIONAL.md#42-bootstrap--validation](./DOUTRINA_OPERACIONAL.md#42-bootstrap--validation)

### Release Gate & Go/No-Go

```bash
export RUNTIME_ROOT=/var/lib/r-agent2-release
npm run system:release-gate     # Read verdicts, apply governance
npm run system:go-no-go         # Make decision (GO=0 / NO_GO=1)
npm run system:release-summary  # Document approval
```

**Decision criteria:**
- Core/PBX/Omnichannel domains must pass critical checks
- No workspace residues
- Gates approved

**Documentação:** [DOUTRINA_OPERACIONAL.md#43-release-gate--decision](./DOUTRINA_OPERACIONAL.md#43-release-gate--decision)

### Workspace Cleanup

```bash
npm run runtime:clean:check     # Detect residues (exit code 1 = found)
npm run runtime:clean           # Remove residues
npm run zip:release:clean       # Package safely
```

**What gets cleaned:**
- `qa-mesh/system-validate/`
- `qa/release-evidence/`
- `rag-service/data/vector_store/`
- `rag-service/data/adaptive_learning/`
- `api/data/wa_sessions/`
- `frontend/dist/`

**Documentação:** [DOUTRINA_OPERACIONAL.md#44-cleanup--housekeeping](./DOUTRINA_OPERACIONAL.md#44-cleanup--housekeeping)

---

## 🔧 Configuração por Ambiente

### Development Local
```bash
RUNTIME_ROOT=~/.local/share/ragent2-runtime  # Opcional
NODE_ENV=development
LOG_LEVEL=debug
# Restante usa defaults
```
[Detalhes →](./DOUTRINA_OPERACIONAL.md#81-desenvolvimento)

### Docker / Compose (Produção)
```bash
RUNTIME_ROOT=/var/lib/ragent2
NODE_ENV=production
LOG_LEVEL=info
RELEASE_EVIDENCE_BASE_DIR=/var/lib/ragent2/release-evidence
QA_MESH_SYSTEM_VALIDATE_DIR=/var/lib/ragent2/qa-mesh/system-validate
```
[Detalhes →](./DOUTRINA_OPERACIONAL.md#82-cicd-github-actions--jenkins--gitlab)

### CI/CD (GitHub Actions / Jenkins)
```bash
RUNTIME_ROOT=/tmp/r-agent2-runtime-$BUILD_ID
NODE_ENV=test
LOG_LEVEL=debug
```
[Detalhes →](./DOUTRINA_OPERACIONAL.md#82-cicd-github-actions--jenkins--gitlab)

---

## 📊 Variáveis de Ambiente - Lookup Rápido

### Tudo respeita cascata?

| Variável | Tipo | Default | Cascata | Uso |
|----------|------|---------|---------|-----|
| `RUNTIME_ROOT` | Universal | N/A | N/A | Raiz de runtime mutável |
| `PHYSICAL_QUEUE_EVIDENCE_PATH` | Específica | `qa/l01-*` | Sim | L-01 smoke |
| `BPMN_EDITOR_EVIDENCE_PATH` | Específica | `qa/l06-*` | Sim | L-06 smoke |
| `RELEASE_EVIDENCE_BASE_DIR` | Específica | `qa/release-evidence` | Sim | Release gates |
| `QA_MESH_SYSTEM_VALIDATE_DIR` | Específica | `qa-mesh/system-validate` | Sim | System validate |
| `RAG_DATA_ROOT` | Específica | `rag-service/data` | Sim | RAG mutable root |
| `VECTOR_STORE_PATH` | Específica | `rag-service/data/vector_store` | Sim | RAG vectors |
| `WWEBJS_AUTH_PATH` | Específica | `api/data/wa_sessions` | Sim | WhatsApp auth |

**Completa → [DOUTRINA_OPERACIONAL.md#2-variáveis-de-ambiente-oficiais](./DOUTRINA_OPERACIONAL.md#2-variáveis-de-ambiente-oficiais)**

---

## ⚠️ Troubleshooting

### "Path not found / Evidência em workspace"
**Causa:** RUNTIME_ROOT não definido
**Solução:** `export RUNTIME_ROOT=/path` antes de scripts
[Troubleshooting guide →](./DOUTRINA_OPERACIONAL.md#9-troubleshooting-operacional)

### "npm run system:validate escreve em workspace"
**Causa:** RUNTIME_ROOT não exportado
**Solução:** Exportar antes, ou redefinir em .env
[Troubleshooting guide →](./DOUTRINA_OPERACIONAL.md#9-troubleshooting-operacional)

### "Cleanup encontra resíduos não-removíveis"
**Causa:** Permissões de arquivo
**Solução:** `sudo npm run runtime:clean` ou checagem manual
[Troubleshooting guide →](./DOUTRINA_OPERACIONAL.md#9-troubleshooting-operacional)

---

## 📚 Documentação Relacionada

### Técnica (Para devs implementando)
- [Runtime Paths - Implementação](./runtime-paths.md) — Como usar `tools/system/lib/runtime-paths.js`
- [API Endpoints Codebase](./API_ENDPOINTS_CODEBASE.md) — Rotas do sistema de validação
- [System Validate Architecture](./API_ENDPOINTS_CODEBASE.md#validation) — Arquitetura do validate

### Operacional (Para ops/release)
- [Release Checklist](./release-checklist.md) — Pré-voos antes de release
- [Doutrina Operacional](./DOUTRINA_OPERACIONAL.md) — Completo (este documento)
- [Cheatsheet Operacional](./OPERACIONAL_CHEATSHEET.md) — Rápido

### Configuração (Para setup)
- [CONFIGURACAO_IA.md](./CONFIGURACAO_IA.md) — Setup IA
- [CONFIGURACAO_RAG_CENTRALIZADA.md](./CONFIGURACAO_RAG_CENTRALIZADA.md) — RAG
- [OPERACAO_PRODUCAO.md](./OPERACAO_PRODUCAO.md) — Produção geral

---

## 🎯 Próximas Fases

Após "Doutrina operacional e config única":
1. Endurecimento configuração de IA
2. Modularização hotspots backend
3. Consolidação modular frontend
4. Pipeline frontend e release
5. Validação final e relatório


## ✅ Fases Completas

- ✅ **Wave 1** — Core runtime utilities (scripts/check-green.js, etc.)
- ✅ **Wave 2** — Smoke tests + internal validator (8 testers + L-00)
- ✅ **Separar produto e runtime** — Path separation, RUNTIME_ROOT, cleanup
- ✅ **Doutrina operacional e config única** — Unified operational doctrine
- ✅ **Environment-specific deployment guides** — Dev, Docker, CI/CD, Hardening

## ⏳ Próximas Fases

- [ ] **Endurecimento configuração IA** — IA framework hardening
- [ ] **Modularização hotspots backend** — Break down monolithic APIs
- [ ] **Consolidação modular frontend** — Component architecture
- [ ] **Pipeline frontend e release** — Build + deploy automation
- [ ] **Validação final e relatório** — End-to-end verification

## 📝 Changelog Documentação

### v1.0 (20 de abril de 2026)

**Novos documentos:**
- `DOUTRINA_OPERACIONAL.md` — Consolidação completa
- `OPERACIONAL_CHEATSHEET.md` — Referência rápida

**Consolidado a partir de:**
- runtime-paths.md (técnico → mantido)
- release-checklist.md (pré-flight → mantido)
- CONFIGURACAO_IA.md (IA → não consolidado, separado)
- Novas convenções de env vars

**Padrões agora únicos:**
- Cascata de paths: explícito > RUNTIME_ROOT > default
- Governança: GO/NO_GO baseado em thresholds
- Limpeza: npm run runtime:clean:check obrigatório
- Setup: export RUNTIME_ROOT + npm ci padrão

---

## Contato / Suporte Operacional

**Dúvidas sobre...**
- Setup / variáveis → Ver [OPERACIONAL_CHEATSHEET.md](./OPERACIONAL_CHEATSHEET.md)
- Governance / Release → Ver [DOUTRINA_OPERACIONAL.md#7-regras-governança](./DOUTRINA_OPERACIONAL.md#7-regras-governança)
- Implementação / Paths → Ver [runtime-paths.md](./runtime-paths.md)
- Pre-flight checks → Ver [release-checklist.md](./release-checklist.md)

