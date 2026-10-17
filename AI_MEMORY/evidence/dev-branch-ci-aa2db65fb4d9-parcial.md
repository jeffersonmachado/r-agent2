# Gate em fases da branch de desenvolvimento — aa2db65fb4d9 (PARCIAL)

- **veredito**: `BLOQUEADO_POR_DEFEITOS`
- **equivale a validação completa**: `false`
- **fases pedidas**: `A,C,D`
- **fases concluídas**: `(nenhuma)`
- **branch**: `dev/engineering-hardening`
- **sha exato avaliado**: `aa2db65fb4d9771ac605960ef108a6f209cb670b`
- **gerado em**: 2026-10-17T11:36:03.079Z
- **gate efetivo**: LOCAL — o runner do GitHub não inicia jobs por limite de gastos da conta

## Pré-voo (fase A)

| check | resultado | detalhe |
|---|---|---|
| `A1-identidade-commit` | ok | HEAD=aa2db65fb4d9771ac605960ef108a6f209cb670b |
| `A2-sha-esperado` | ok | não exigido nesta execução |
| `A3-arvore-limpa` | ok | NÃO exigida nesta execução; árvore SUJA (12+) |
| `A4-inventario-defeitos` | ok | 93 item(ns) |
| `A5-dependencias` | ok | node_modules presente |
| `A5b-jest` | ok | binário do Jest |
| `A6-node` | ok | node 22.12.0 |
| `A7-regras-preventivas` | ok | 7 presentes |
| `A8-evidencia-anterior` | ok | do mesmo commit |

Inventário de defeitos: 93 item(ns), 61 aberto(s), 59 bloqueante(s) para certificação.

## Autorizações de fase (Bug Closure First)

| fase | operação | decisão | motivos |
|---|---|---|---|
| C | `L0_COMPLETO` | **DENIED** | BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO, TESTE_DIRECIONADO_PENDENTE |

**BLOQUEIO**: fase C — `FASE_NAO_AUTORIZADA` BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO,TESTE_DIRECIONADO_PENDENTE

## Passos executados (comando, exit code, duração, sha256 da saída)

(nenhum passo executado)

## Estado do runner do GitHub (medido)

```json
{
  "medido": true,
  "execucoesNaBranch": 1,
  "ultimaExecucao": {
    "databaseId": 39028210259,
    "headSha": "aa2db65fb4d9771ac605960ef108a6f209cb670b",
    "conclusao": "failure",
    "criadaEm": "2026-10-17T11:18:43Z"
  }
}
```

## Como reconferir a evidência

```bash
node scripts/ci/dev-branch-gate.js --fases A,C,D   # reexecuta as mesmas fases
git log -1 --format=%H -- AI_MEMORY/evidence/dev-branch-ci-aa2db65fb4d9-parcial.md   # commit que publicou esta evidência
```

`evidenceSha256` = `cc7dc68fb36508808a7aaf8524d83ccd7a214e92710abfc4ff1738f9327212c7` (sha256 do payload sem este campo).

```json
{
  "schemaVersion": 2,
  "kind": "dev-branch-ci-evidence",
  "comando": "node scripts/ci/dev-branch-gate.js",
  "veredito": "BLOQUEADO_POR_DEFEITOS",
  "equivalenteAValidacaoCompleta": false,
  "escopo": "PARCIAL",
  "fasesPedidas": [
    "A",
    "C",
    "D"
  ],
  "fasesConcluidas": [],
  "sha": "aa2db65fb4d9771ac605960ef108a6f209cb670b",
  "shaCurto": "aa2db65fb4d9",
  "branch": "dev/engineering-hardening",
  "escopoDefeitos": null,
  "runnerDoGithub": {
    "medido": true,
    "execucoesNaBranch": 1,
    "ultimaExecucao": {
      "databaseId": 39028210259,
      "headSha": "aa2db65fb4d9771ac605960ef108a6f209cb670b",
      "conclusao": "failure",
      "criadaEm": "2026-10-17T11:18:43Z"
    }
  },
  "gateEfetivo": "LOCAL (o runner do GitHub nao inicia jobs por limite de gastos da conta)",
  "preVoo": {
    "ok": true,
    "checks": [
      {
        "id": "A1-identidade-commit",
        "ok": true,
        "detalhe": "HEAD=aa2db65fb4d9771ac605960ef108a6f209cb670b"
      },
      {
        "id": "A2-sha-esperado",
        "ok": true,
        "detalhe": "não exigido nesta execução"
      },
      {
        "id": "A3-arvore-limpa",
        "ok": true,
        "detalhe": "NÃO exigida nesta execução; árvore SUJA (12+)"
      },
      {
        "id": "A4-inventario-defeitos",
        "ok": true,
        "detalhe": "93 item(ns)"
      },
      {
        "id": "A5-dependencias",
        "ok": true,
        "detalhe": "node_modules presente"
      },
      {
        "id": "A5b-jest",
        "ok": true,
        "detalhe": "binário do Jest"
      },
      {
        "id": "A6-node",
        "ok": true,
        "detalhe": "node 22.12.0"
      },
      {
        "id": "A7-regras-preventivas",
        "ok": true,
        "detalhe": "7 presentes"
      },
      {
        "id": "A8-evidencia-anterior",
        "ok": true,
        "detalhe": "do mesmo commit",
        "bloqueante": false
      }
    ],
    "achados": [],
    "inventario": {
      "total": 93,
      "abertos": 61,
      "bloqueantesParaCertificacao": 59,
      "semSeveridadeAbertos": 38,
      "bloqueioExterno": 3,
      "riscoAceito": 0,
      "porEstado": {
        "FIXED_PENDING_VERIFICATION": 53,
        "BLOCKED_EXTERNAL": 3,
        "RESOLVED": 18,
        "VERIFIED": 14,
        "OPEN": 5
      },
      "porSeveridade": {
        "P0": 12,
        "P1": 19,
        "P2": 3,
        "NAO_DECLARADA": 59
      }
    },
    "erroInventario": null,
    "arvoreSuja": true,
    "arquivosSujos": [
      "M AI_MEMORY/hardening-queue.json",
      " M governance/canonical-release-decision.js",
      " M governance/governance-chain.js",
      " M reports/api-surface-report.json",
      " M reports/db-integrity-report.json",
      " M reports/page-surface-report.json",
      "?? AI_MEMORY/evidence/dev-branch-ci-aa2db65fb4d9-parcial.md",
      "?? governance/bug-closure/",
      "?? scripts/ci/dev-branch-gate.new.js",
      "?? scripts/governance/evaluate-execution-eligibility.js",
      "?? tests/unit/governance/bugClosureFirst.test.js",
      "?? tests/unit/governance/governanceChainContract.test.js"
    ],
    "evidenciaAnterior": {
      "sha": "aa2db65fb4d9771ac605960ef108a6f209cb670b",
      "veredito": "PASS_PARCIAL",
      "escopo": "PARCIAL"
    }
  },
  "autorizacoes": [
    {
      "fase": "C",
      "operacao": "L0_COMPLETO",
      "allowed": false,
      "decision": "DENIED",
      "reasonCodes": [
        "BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO",
        "TESTE_DIRECIONADO_PENDENTE"
      ],
      "requiredActions": [
        "registrar teste direcionado APROVADO (targetedTestPassing=true) para cada defeito aberto antes de ampliar a execução"
      ],
      "blockingFindings": [
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "P0-1",
          "severity": "P0",
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "Identidade de aprovacao derivada do ator autenticado"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "P0-2",
          "severity": "P0",
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "Evidencia ausente nunca e PASS (imutabilidade do evidence manifest)"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "P0-3",
          "severity": "P0",
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "Proveniencia do Security Gate consegue falhar (fail-closed)"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "P0-4",
          "severity": "P0",
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "Waiver em duas etapas com segregacao de funcoes e escopo"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "P0-5",
          "severity": "P0",
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "Suite E2E do Security Gate contra Postgres real"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "P1-1",
          "severity": "P1",
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "Gates unit/integration declaram a CATEGORIA da evidencia"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "P1-2",
          "severity": "P1",
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "Revisao independente verificavel (vinculada a tentativa + independencia nos dados)"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "P1-3",
          "severity": "P1",
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "Promocao verificada obrigatoria para GREEN"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "P1-4",
          "severity": "P1",
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "Regra preventiva exige teste EXECUTADO e regras ativas passam a ser consultadas"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "P1-5",
          "severity": "P1",
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "Degradacao da busca hibrida do RAG deixa de ser assimetrica"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "P1-6",
          "severity": "P1",
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "DSN do Postgres resolvido e provas de isolamento realmente EXECUTAM"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "P1-7",
          "severity": "P1",
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "Fila de triagem de seguranca mostra o estado da REMEDIACAO submetida"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "P1-8",
          "severity": "P1",
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "Inventario do sistema regenerado"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "P1-9",
          "severity": "P1",
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "Contrato unico de evidencias (campos obrigatorios, runId/lineage, FAIL vs INCOMPLETE)"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "P1-12",
          "severity": "P1",
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "Evidencia STALE declarada valid=true atestando a decisao final do run corrente"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "P1-13",
          "severity": "P1",
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "Regenerar qa/smoke-evidence.json (prova exigida cujo produtor esta em workflow DESABILITADO)"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "P1-10",
          "severity": "P1",
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "Self-engineering E2E governado (relatorio agregado obsoleto)"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "P1-11",
          "severity": "P1",
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "Destravar empacotamento e selagem (ciclo release:seal completo)"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "P1-15",
          "severity": "P1",
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "PASS 5 escreve membro da chain (evidence-manifest) DEPOIS da atestacao"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "P1-16",
          "severity": "P1",
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "Lotes do runner autoritativo nao se isolavam (conexoes e processos-filho vazavam)"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "P1-17",
          "severity": "P1",
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "Dívida de segurança do Security Release Gate (47 -> 0 bloqueantes; gate GO)"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "H9-IDENTIDADE-PORTA",
          "severity": null,
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "D5/D6: unidade ativa que nao serve + porta ocupada por processo estranho (supervisao dev)"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "H10-VEREDITO-GATE-SEGURANCA",
          "severity": null,
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "Veredito do Security Release Gate deixa de ser mascarado pela avaliacao de risco"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "H11-ESCOPO-DIFERIDO",
          "severity": null,
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "Regressao da Fase 9: escopo diferido explicito + fixtures com evidencia de integracao"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "H12-RAG-REPARO",
          "severity": null,
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "Reparo de documentos RAG (2 falhas ECONNREFUSED) — indice HEALTHY de novo"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "H13-RUNNER-COMPLETO",
          "severity": null,
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "Agregado deixa de mascarar falhas: runner completo dos validadores"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "H14-CDR-SUPERVISIONADO",
          "severity": null,
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "CDR do Asterisk nao morre mais em silencio (ponte + backend)"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "H15-DIST-RECIBO-STALE",
          "severity": null,
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "Higiene do dist/: recibo do verifier STALE deixa de poluir a avaliacao"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "H16-MUTACAO-SUPERFICIE-NO-RUN",
          "severity": null,
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "Runner atribui falha causada por mutacao da superficie provada durante o run"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "H17-HOOKS-EDITOR",
          "severity": null,
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "Editor: quebra das Rules of Hooks no seletor de modelos (achado da jornada browser)"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "H18-JORNADA-FUNCIONAL-BROWSER",
          "severity": null,
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "Detector de jornada funcional com acoes reais (e metrica de efeito honesta)"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "H19-DIST-CAUSA-UNICA",
          "severity": null,
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "validate:dist reduzido a causa unica (payload ausente = P1-11)"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "DIV-PUREZA-ENGINE",
          "severity": null,
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "Dívida de pureza de camadas em engine/ (83 issues; ~70 reais) — exige injeção de relógio/logger"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "N5-REENTREGA",
          "severity": null,
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "Reentregar o release depois das melhorias N1-N3 (ciclo de selagem pos-commit em superficie provada)"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "DEF-TEARDOWN-DRAIN-WORKER",
          "severity": null,
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "BATCH_EXIT_CODE_NONZERO: worker drenando depois do Sequelize fechar (0 testes falhados, exit=1)"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "DEF-WS-AUTH-POS-LOGIN",
          "severity": null,
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "WebSocket nao autentica apos o LOGIN: usuario sem tempo real ate dar F5"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "DEF-REMOVECHILD-HEADER-ENHANCEMENT",
          "severity": null,
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "removeChild (React) por enhancement de header que movia/substituia nos do React"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "DEF-QUEUE-DELETE-DB-ONLY",
          "severity": null,
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "DELETE /queues nao removia fila existente so no banco (reaparecia na listagem)"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "MISSAO-A-L1-IMPACTO",
          "severity": null,
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "L1: seleção de validação por impacto (grafo de imports + fail-closed)"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "DEF-TIMEBOMB-EVOSYNC-JANELA30D",
          "severity": null,
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "Teste evoSyncIntegration fixava frequency30d e venceu sozinho em 03/10/2026"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "DEF-STATESYNC-EXEMPTION-STALE",
          "severity": null,
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "Isenção de state-sync declarava 4 setInterval onde havia 3 (resíduo)"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "MISSAO-A-L2-L3-ORQUESTRADOR",
          "severity": null,
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "L2/L3 + EngineeringValidationOrchestrator sobre o L1"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "DEF-FLAKY-MISSIONFULLE2E-SOB-CARGA",
          "severity": null,
          "state": "BLOCKED_EXTERNAL",
          "detail": "engineeringMissionFullE2E flaky sob carga BLOQUEIA o agregado e a selagem"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "MISSAO-B8-ESTADOS-FILA",
          "severity": null,
          "state": "RESOLVED",
          "detail": "B8: modelo de estados da fila com hook fail-closed e validador"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "MISSAO-B1-CADEIA-CRIPTOGRAFICA",
          "severity": null,
          "state": "VERIFIED",
          "detail": "B1: cadeia criptografica existia mas NENHUM gate a recalculava"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "MISSAO-B9-CI-GITHUB-ACTIONS",
          "severity": null,
          "state": "BLOCKED_EXTERNAL",
          "detail": "B9: CI do GitHub bloqueado por budget — release-governance.yml nao protege publicacao"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "MISSAO-B3-REUSO-PROVENIENCIA",
          "severity": null,
          "state": "VERIFIED",
          "detail": "B3: reuso de lotes — verificado, NAO e defeito (rigor por desenho)"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "MISSAO-B4-REVISAO-INDEPENDENTE",
          "severity": null,
          "state": "VERIFIED",
          "detail": "B4: revisao independente — verificado, NAO e defeito (rigor maximo)"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "MISSAO-B5-VINCULO-DEFEITO-PREVENCAO",
          "severity": null,
          "state": "VERIFIED",
          "detail": "B5: vinculo defeito -> commit -> prevencao executavel"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "MISSAO-DEMO-SELF-ENGINEERING",
          "severity": null,
          "state": "VERIFIED",
          "detail": "Demonstracao de self-engineering: o RAP encontrou defeitos reais que passaram por todos os gates"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "H15-CDR-LAST-FAIL",
          "severity": null,
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "CDR nao morre mais em silencio com o backend REGISTRADO sobre conexao que falhou"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "H16-V2SEAL-PASSO-SEM-MOTIVO",
          "severity": null,
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "Passo obrigatorio do selo V2 que falha passa a registrar o MOTIVO no relatorio"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "H17-PREFLIGHT-ASK-AI-TTL",
          "severity": null,
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "Preflight do selo checa o TTL da evidencia do Ask-AI (fail-fast em 4 s)"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "HARDENING-ENG-GOV-RELEASE-P0-6",
          "severity": null,
          "state": "RESOLVED",
          "detail": "Reuso de lote do runner autoritativo nao pode mascarar exit code divergente"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "HARDENING-ENG-GOV-RELEASE-P0-5",
          "severity": null,
          "state": "RESOLVED",
          "detail": "Eliminar falsos verdes de cobertura (L1) e fazer a malha REALMENTE executar"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "HARDENING-ENG-GOV-RELEASE-P0-2",
          "severity": null,
          "state": "RESOLVED",
          "detail": "Cadeia criptografica reconstruida e assinada a cada ciclo (selo imutavel)"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "HARDENING-ENG-GOV-RELEASE-P0-3",
          "severity": null,
          "state": "RESOLVED",
          "detail": "Certificar ANTES de publicar (ordem de fase do selo)"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "HARDENING-ENG-GOV-RELEASE-P0-4",
          "severity": null,
          "state": "RESOLVED",
          "detail": "Autoridade unica de decisao de release (fim da comparacao por substring)"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "HARDENING-ENG-GOV-RELEASE-P0-7",
          "severity": null,
          "state": "BLOCKED_EXTERNAL",
          "detail": "Protecao da branch main (gate executavel; bloqueio externo comprovado)"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "HARDENING-ENG-GOV-RELEASE-P1-11",
          "severity": null,
          "state": "RESOLVED",
          "detail": "TTL/frescor de evidencia: autoridade unica com 5 regras e vinculacao por run"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "HARDENING-ENG-GOV-RELEASE-MESH-EVIDENCE-POISONING",
          "severity": null,
          "state": "RESOLVED",
          "detail": "Execucao da malha sem lineage destruia a evidencia governada (agregado em vermelho)"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "HARDENING-ENG-GOV-RELEASE-EVIDENCIA-DENTRO-DO-RUN",
          "severity": null,
          "state": "VERIFIED",
          "detail": "Evidencia runtime so vale se produzida DENTRO da janela de um run governado aberto"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "HARDENING-ENG-GOV-RELEASE-CANDIDATE-IDENTIDADE-FOREIGN-RUN",
          "severity": null,
          "state": "VERIFIED",
          "detail": "Criar run governado novo torna o CANDIDATO entregue um artefato de outro run"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "HARDENING-ENG-GOV-RELEASE-MESH-EXECUCAO-VAZIA-AINDA-GERA-EVIDENCIA",
          "severity": null,
          "state": "OPEN",
          "detail": "Malha grava artefato governado mesmo executando ZERO resultados (--scenario-id da wave nao casa)"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "HARDENING-ENG-GOV-RELEASE-HANDSHAKE-AMBIGUO",
          "severity": null,
          "state": "RESOLVED",
          "detail": "Harness aceitava LOG JSON do produto como handshake do worker de lease (selo V2 abortado)"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "HARDENING-ENG-GOV-RELEASE-HANDSHAKE-FENCE-UNDEFINED",
          "severity": null,
          "state": "RESOLVED",
          "detail": "FENCE_AVANCOU com antes=undefined: log JSON do produto confundido com handshake (selo V2 abortado)"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "HARDENING-ENG-GOV-RELEASE-SBOM-RUN-WINDOW",
          "severity": null,
          "state": "RESOLVED",
          "detail": "SBOM anterior ao startedAt do run derruba o security gate (exit 3) mesmo com risco GO"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "HARDENING-ENG-GOV-RELEASE-AUDITORIA-GIT-ENTRYPOINT",
          "severity": null,
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "Auditoria externa via git: ponto de entrada unico derivado"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "HARDENING-ENG-GOV-RELEASE-AGREGADO-SEM-RELATORIO-PROPRIO",
          "severity": null,
          "state": "OPEN",
          "detail": "O gate agregado nao persiste veredito proprio do run corrente"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "HARDENING-ENG-GOV-RELEASE-PONTEIROS-CLOSURE-ORFAOS",
          "severity": null,
          "state": "RESOLVED",
          "detail": "Ponteiros de fechamento na raiz estao stale e nenhum gate os mantem"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "HARDENING-ENG-GOV-RELEASE-AGREGADO-EXIGE-WORKTREE-CONGELADO",
          "severity": null,
          "state": "RESOLVED",
          "detail": "Gate agregado exige worktree CONGELADO — commitar durante o run quebra a promocao do E2E"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "HARDENING-ENG-GOV-RELEASE-RUNTIME-EVIDENCE-DIAGNOSTICO-ENGANOSO",
          "severity": null,
          "state": "OPEN",
          "detail": "runtime-evidence reporta \"crash antes do reporter\" quando o teste falha por assercao"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "HARDENING-ENG-GOV-RELEASE-TAXONOMIA-PERSISTENCIA-AI-MEMORY-EVIDENCE",
          "severity": null,
          "state": "OPEN",
          "detail": "AI_MEMORY/evidence/ fora da taxonomia canônica de persistência JSON"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "AUDITORIA-CHECKPOINT-PROTOCOL",
          "severity": null,
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "Checkpoints incrementais auditáveis (gravador executável + runbook + ponteiro)"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "AUDITORIA-ENTRYPOINT-TRAVAS",
          "severity": null,
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "Travas do ponto de entrada de auditoria (regressão do agg8 + epoch recalculável)"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "AUDITORIA-BRANCH-INVENTORY",
          "severity": null,
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "Inventário auditável das 2497 branches locais (2468 do loop autônomo)"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "AUDITORIA-FASE-B-TESTE-MUTAVA-EVIDENCIA-GOVERNADA",
          "severity": null,
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "Teste de unidade regravava artefato governado e derrubava a integridade temporal"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "AUDITORIA-FASE-B-CADEIA-FORA-DO-AGREGADO",
          "severity": null,
          "state": "FIXED_PENDING_VERIFICATION",
          "detail": "Cadeia criptografica: analise corrigida — elos derivados vs imutaveis, e estado exposto na auditoria"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "AUDITORIA-FASE-B-FALSO-POSITIVO-SCANNER-FILA",
          "severity": null,
          "state": "OPEN",
          "detail": "Inventario de persistencia registra escrita fantasma da fila oficial (falso positivo do scanner)"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "P0-FALSO-GO-ESTADO-DE-GATE-NAO-PERMITIDO",
          "severity": "P0",
          "state": "VERIFIED",
          "detail": "Falso GO: gate com status nao permitido (NOT_EXECUTED/UNKNOWN/SKIPPED/arbitrario) certificava"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "P0-IDENTIDADE-AUSENTE-E-ACEITA-COMO-COERENTE",
          "severity": "P0",
          "state": "VERIFIED",
          "detail": "Identidade ausente era tratada como identidade coerente (aprovava sem runId/commit/fingerprint)"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "P0-AVALIADOR-CONFIAVA-EM-CAMPO-VALID-GRAVADO",
          "severity": "P0",
          "state": "VERIFIED",
          "detail": "Avaliador canonico confiava no campo chain.valid GRAVADO em vez de recalcular a cadeia"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "P0-ESTADO-E-VEREDITO-PODEM-DISCORDAR",
          "severity": "P0",
          "state": "VERIFIED",
          "detail": "state=CERTIFIED_GO coexistindo com veredito nao-ok (consumidor que le state via GO falso)"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "P1-ENTREGA-EXIT-CODE-DESCARTAOO-GREP-COMO-AUTORIDADE",
          "severity": "P1",
          "state": "VERIFIED",
          "detail": "Verificacao de ENTREGA descartava o exit code e usava grep de texto positivo como autoridade"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "P1-SELO-PUSH-ORIGIN-MAIN-NO-OP-FALSO-PUSH-OK",
          "severity": "P1",
          "state": "VERIFIED",
          "detail": "Selo publicava ref fixa (main) e imprimia \"push ok\" sem publicar o commit da branch em uso"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "P0-CADEIA-APARENCIA-DE-VALIDA-APOS-ALTERACAO",
          "severity": "P0",
          "state": "RESOLVED",
          "detail": "Cadeia criptografica declarava valid=true sobre conteudo alterado e o agregado aprovava lendo o campo persistido"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "FASE6-NOVO-CANDIDATO-POR-MUDANCA-DE-FINGERPRINT",
          "severity": null,
          "state": "VERIFIED",
          "detail": "Fix da FASE 6 mudou o sourceFingerprint: falta gerar novo candidato e nova certificacao preservando o anterior como historico"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "P0-RUN-SEM-SOURCE-COMMIT-IDENTIDADE-DE-RELEASE-IMPOSSIVEL",
          "severity": "P0",
          "state": "RESOLVED",
          "detail": "Run governado nunca registrava o commit: identidade de release INCOMPLETA para sempre e GO definitivo impossivel"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "P1-STAGING-DIST-GOVERNANCE-ARTIFACTS-DERRUBA-VALIDATE-DIST",
          "severity": "P1",
          "state": "RESOLVED",
          "detail": "Certificacao deixa staging transitorio em dist/ e o agregado falha em validate:dist"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "P0-PRODUTORES-GRAVAM-LINEAGE-SEM-SOURCECOMMIT",
          "severity": "P0",
          "state": "RESOLVED",
          "detail": "Produtores que carimbam o proprio lineage gravam runId + sourceFingerprint mas NAO sourceCommit: GO definitivo continua impossivel"
        }
      ]
    }
  ],
  "bloqueio": {
    "fase": "C",
    "operacao": "L0_COMPLETO",
    "code": "FASE_NAO_AUTORIZADA",
    "detail": "BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO,TESTE_DIRECIONADO_PENDENTE",
    "requiredActions": [
      "registrar teste direcionado APROVADO (targetedTestPassing=true) para cada defeito aberto antes de ampliar a execução"
    ]
  },
  "passos": [],
  "falhas": [],
  "evidenceSha256": "cc7dc68fb36508808a7aaf8524d83ccd7a214e92710abfc4ff1738f9327212c7"
}
```
