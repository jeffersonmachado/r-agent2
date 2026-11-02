# Regularização de fechamentos sem prova

Gerado em 2026-11-02T14:49:45.002Z · commit `a15f550e3522b48a49fb2d7cc6c948fdf2b60f01` · fingerprint `68b2804492d5…`
Execução `run-20261102144624-0ab94197` · escopo **PARCIAL** · processados 3 de 3 · cobertura **PARCIAL** (não cobre o inventário)

> **Não autoritativo.** Este relatório descreve trabalho de re-verificação. A fila oficial não foi
> alterada por este script, e nenhuma prova foi assinada: a assinatura é do dono da chave ancorada.

## Resumo

| Classe | Itens |
|---|---|
| AGUARDA_ASSINATURA_E_ANCORA | 3 |

## Itens

| Defeito | Sev | Estado declarado | Classe | Teste | Log |
|---|---|---|---|---|---|
| ENG-LEASE-FENCE-NAO-VALIDADO | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/integration/engineeringBugLoop.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261102144624-0ab94197/logs/ENG-LEASE-FENCE-NAO-VALIDADO.log |
| CI-INTEG-JEST-DUAS-SUITES-BLOCKED | P2 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/integration/governanceApprovalFullWorkerE2E.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261102144624-0ab94197/logs/CI-INTEG-JEST-DUAS-SUITES-BLOCKED.log |
| ENG-FENCING-OPT-IN-NO-FIX-LOOP | P2 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/integration/engineeringBugLoop.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261102144624-0ab94197/logs/ENG-FENCING-OPT-IN-NO-FIX-LOOP.log |

## Leitura das classes

- `AGUARDA_ASSINATURA_E_ANCORA` — teste re-executado com sucesso no HEAD, artefato de saída
  gravado com sha256, prova montada e estruturalmente válida. Falta **apenas** a assinatura
  Ed25519 da autoridade ancorada (e as âncoras externas provisionadas no ambiente).
- `AGUARDA_INSUMOS_HUMANOS` — teste re-executado com sucesso; falta `negativeEvidence`/
  `humanAuthorization` (P0), que são declarações humanas e não podem ser geradas aqui.
- `TESTE_FALHOU_AGORA` — a correção declarada não se sustenta no código atual ⇒ candidato a REABRIR.
- `AMBIENTE_INDISPONIVEL` — o teste exigiu infraestrutura ausente (ex.: Postgres); não é veredito.
- `REQUER_AJUSTE_DE_MODELO` — estado persistido (RESOLVED/RISK_ACCEPTED) sem transição canônica de fechamento.
- `REQUER_DECISAO_HUMANA` — nenhum teste de regressão citado/existente: reabrir ou aceitar risco.
- `ESTRUTURA_INCOMPLETA` — prova montada mas algo estrutural falhou; ver `provasAusentes`.

