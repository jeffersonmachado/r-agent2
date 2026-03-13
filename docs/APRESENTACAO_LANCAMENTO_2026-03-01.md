# Lançamento v1 — 01/03/2026
## Plataforma Omnichannel + Filas + PBX

Data da apresentação: 14/02/2026  
Release candidate atual: `v2026.03.01-rc5`

---

## 1. Objetivo do lançamento

- Colocar em produção o recorte vendável v1 com foco em:
  - ChatPro-like omnichannel (L-05)
  - Filas físicas (L-01)
  - PBX com TTS/ASR e eventos de chamada (L-03/L-04)
- Garantir operação com evidência técnica e critérios de Go/No-Go.

---

## 2. Escopo funcional (o que entra)

- Atendimento omnichannel com consistência conversa-ticket.
- Jornada completa de filas físicas: kiosk, station e panel.
- Voz PBX com:
  - chamada real (originate/click2call)
  - eventos `ringing/answered/ended` integrados ao runtime.
- Gate operacional com evidências consolidadas em QA.

---

## 3. Evidências de prontidão (status atual)

- RC validado: `v2026.03.01-rc5`.
- Workflow `Stack Test (Docker Compose)`:
  - Run `22020947013`: **SUCCESS**.
  - Job `Prewarm imagens de teste (GHCR)`: success.
  - Job `Autotest com stack completa`: success.
- Backlog e checklist atualizados em `docs/O_QUE_FALTA.md`.

---

## 4. Problemas encontrados e correções aplicadas

- Falha de pull GHCR no autoteste:
  - correção: login GHCR no job de autotest.
- Falha de autenticação RPA no stack:
  - correção: pin da origem do `RPA_TOKEN` para config de teste.
- Falha de permissão em `frontend/node_modules` no runner:
  - correção: recuperação automática e fallback de limpeza via container.

---

## 5. Critérios de Go/No-Go

- `npm run system:release-gate` com resultado PASS.
- `npm run system:go-no-go` com `decision=GO`.
- Selftest sem `FAIL`.
- Evidências obrigatórias:
  - L-01, L-02, L-03, L-04 e L-05 em `pass` no `qa/smoke-evidence.json`.

---

## 6. Plano de execução da janela

- **D-7 (22/02/2026)**:
  - freeze técnico
  - baseline de gate e selftest
  - confirmação de owners/on-call.
- **D-1 (28/02/2026)**:
  - `release-window` (modo rápido)
  - `go-no-go`
  - drill de rollback.
- **D0 (01/03/2026)**:
  - publicação
  - smoke pós-release
  - consolidação das evidências finais.

---

## 7. Operação e contingência

- Rollback playbook: `docs/ROLLBACK_PLAYBOOK_SUITES_CRITICAS.md`.
- Comando de contingência: `npm run system:release-contingency`.
- Evidências mínimas a arquivar:
  - `qa/release-gate-report.json`
  - `qa/go-no-go-report.json`
  - `qa/rollback-drill-report.json`
  - `qa/release-window-report.json`
  - `qa/smoke-evidence.json`.

---

## 8. Riscos residuais monitorados

- Regressão de permissões em workspace do runner.
- Degradação de integração PBX em ambiente de release.
- Instabilidade de fila/event dispatcher sob carga.

Mitigação: gate obrigatório, rollback drill e monitoramento por selftest/SLA.

---

## 9. Decisão proposta

- **Recomendação técnica**: seguir para janela de lançamento de 01/03/2026.
- Condição: manter gate e go/no-go como bloqueadores formais.
- Próximo marco: execução do checklist D-7 com geração de status consolidado.

---

## 10. Apêndice (referências)

- Backlog e plano operacional: `docs/O_QUE_FALTA.md`
- Roadmap Now/Next/Later: `docs/ROADMAP_3A5_ANOS.md`
- Runbook de suítes: `docs/RUNBOOK_SUITES_V1.md`
- Workflow validado: `https://github.com/jeffersonmachado/r-agent2/actions/runs/22020947013`
