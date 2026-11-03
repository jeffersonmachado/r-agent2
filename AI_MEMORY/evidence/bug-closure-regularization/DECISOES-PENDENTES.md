# Decisões pendentes — 12 fechamentos sem prova e sem teste em lugar nenhum

Os outros 118 já têm prova montada (88 `AGUARDA_ASSINATURA_E_ANCORA` + 30 `AGUARDA_INSUMOS_HUMANOS`).
Estes 12 esgotaram TODAS as fontes de evidência automática: campo `regressionTest`, caminho citado
na `evidence`, e suíte adicionada pelo próprio commit do fix. Não há teste para executar —
e prova sem teste executado não existe.

| Defeito | Sev | Título | Evidência declarada na época |
|---|---|---|---|
| HARDENING-ENG-GOV-RELEASE-CANDIDATE-IDENTIDADE-FOREIGN-RUN | P0 | Criar run governado novo torna o CANDIDATO entregue um artefato de outro run | RESOLVIDO por ciclo completo e provado: (1) selo V2 21/21 dentro do run R3 rap-governed-20261016144931085-033e1239 (apos corrigir o defeito do handshake ambiguo, commit a5449d15e); (2) candidato r-agent2-20261016-130247 selado (exit 1 inten |
| FASE6-NOVO-CANDIDATO-POR-MUDANCA-DE-FINGERPRINT | P1 | Fix da FASE 6 mudou o sourceFingerprint: falta gerar novo candidato e nova certi | dist/candidate/r-agent2-20261017-040050.candidate.zip + dist/release/r-agent2-20261017-040050.{zip,manifest.json,payload.zip,delivered.identity.json} + governance/governance-chain.json (root 99e1de118ee4f399…) + reports/governance-chain-rep |
| L1-RUNTIME-EVIDENCE-NAO-REPRODUZIVEL | P1 | Coleta da evidencia de runtime restringia o Jest a um teste e dependia de sobra  | scripts/governance/collect-engineering-router-runtime-evidence.js (executa o ARQUIVO inteiro e extrai o teste-alvo de assertionResults); medicao: em arvore limpa EXACT_PATCH_PROMOTION dava promoted=false e PROVIDER_MODEL_FAILURE_REROUTE ter |
| P1-5 | P1 | Degradacao da busca hibrida do RAG deixa de ser assimetrica | rag-service/services/hybrid_search.py + rag-service 156 passed VERIFICADO: rag-service/tests/test_hybrid_search.py exit=0 em arvore limpa (2f35742d23c7). |
| P1-6 | P1 | DSN do Postgres resolvido e provas de isolamento realmente EXECUTAM | rag-service/config/settings.py (AliasChoices) + 156 passed / 0 skipped (antes: isolamento 100% SKIPPED) VERIFICADO: rag-service/tests/test_hybrid_isolation_real_db.py exit=0 em arvore limpa (2f35742d23c7). |
| P1-CI-SEM-INTEGRACAO | P1 | Gate/CI do branch de desenvolvimento nao rodava NENHUMA suite de integracao | scripts/ci/dev-branch-gate.js passo L0b (npx jest tests/integration/engineering --maxWorkers=2, fail-closed) + .github/workflows/dev-branch-ci.yml job dev-branch-integration com services pgvector/redis e migrations. Prova: a primeira execuc |
| HARDENING-ENG-GOV-RELEASE-AGREGADO-EXIGE-WORKTREE-CONGELADO | P2 | Gate agregado exige worktree CONGELADO — commitar durante o run quebra a promoca | AI_MEMORY/evidence/AUDIT_ENTRYPOINT.json + /tmp/agg7.log (linha RED_TO_FIX) + timeline medida |
| HARDENING-ENG-GOV-RELEASE-PONTEIROS-CLOSURE-ORFAOS | P2 | Ponteiros de fechamento na raiz estao stale e nenhum gate os mantem | AI_MEMORY/evidence/AUDIT_ENTRYPOINT.md (secao "Ponteiros stale na raiz") + FINAL_RAP_RELEASE_CLOSURE.json (marcado SUPERSEDED) + AGENTS.md (secao de auditoria externa) |
| MISSAO-B8-ESTADOS-FILA | P2 | B8: modelo de estados da fila com hook fail-closed e validador | scripts/governance/validate-hardening-queue.js + reports/hardening-queue-report.json; prova do hook em /tmp/provar-b8.sh (11/11 casos: fixed_unverified/failed/pending/in_progress/typo/desconhecido BLOQUEIAM; verified/prevention_active/done/ |
| MISSAO-B3-REUSO-PROVENIENCIA | P3 | B3: reuso de lotes — verificado, NAO e defeito (rigor por desenho) | scripts/governance/run-release-suites.js:186 (avaliarReusoDeLote) + :207 (exitCodeDoRelatorioReusado) — leitura direta do codigo; analise registrada em /memories/repo/r-agent2-b4-independencia-revisao.md |
| MISSAO-B4-REVISAO-INDEPENDENTE | P3 | B4: revisao independente — verificado, NAO e defeito (rigor maximo) | api/services/engineeringMission/missionReviewService.js:157-165 — leitura direta; analise registrada em /memories/repo/r-agent2-b4-independencia-revisao.md |
| MISSAO-DEMO-SELF-ENGINEERING | P3 | Demonstracao de self-engineering: o RAP encontrou defeitos reais que passaram po | Os 6 defeitos abaixo foram encontrados PELO PROPRIO SISTEMA durante esta sessao, com prova reproduzivel: (1) DEF-TIMEBOMB-EVOSYNC-JANELA30D — encontrado pela 1a execucao real do L1 (1 de 219 testes); prova: passa isolado 8/8 apos correcao,  |

## Como fechar cada um

1. **Reabrir** (`OPEN`) — honesto quando não há teste: volta a bloquear e alguém corrige de verdade.
2. **Escrever o teste de regressão** e mapear em `config/bug-closure-test-map.json`
   (`{ "<ID>": "tests/..." }`) — a regularização passa a gerar a prova para ele.
3. **Aceitar risco** pelo mecanismo próprio (`RISK_ACCEPTED` com assinatura ancorada) — nunca
   como "resolvido", porque aceitar risco não é corrigir.

## Resumo

- Pendentes: **12** (P0=1, P1=5, P2=3, P3=3)

