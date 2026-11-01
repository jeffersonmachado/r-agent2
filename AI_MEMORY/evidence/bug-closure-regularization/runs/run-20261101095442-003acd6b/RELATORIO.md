# Regularização de fechamentos sem prova

Gerado em 2026-11-01T09:56:21.475Z · commit `d1b052e33910a2936d0095a5bd061a77c561210c` · fingerprint `ba0673e3cf27…`
Execução `run-20261101095442-003acd6b` · escopo **PARCIAL** · processados 2 de 2 · cobertura **PARCIAL** (não cobre o inventário)

> **Não autoritativo.** Este relatório descreve trabalho de re-verificação. A fila oficial não foi
> alterada por este script, e nenhuma prova foi assinada: a assinatura é do dono da chave ancorada.

## Resumo

| Classe | Itens |
|---|---|
| AGUARDA_ASSINATURA_E_ANCORA | 2 |

## Itens

| Defeito | Sev | Estado declarado | Classe | Teste | Log |
|---|---|---|---|---|---|
| V2-EVIDENCIA-REAL-NO-HEAD | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/integration/governanceApprovalFullWorkerE2E.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261101095442-003acd6b/logs/V2-EVIDENCIA-REAL-NO-HEAD.log |
| MISSAO-A-L2-L3-ORQUESTRADOR | P3 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/coverage/impactRunner.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261101095442-003acd6b/logs/MISSAO-A-L2-L3-ORQUESTRADOR.log |

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

