# Regularização de fechamentos sem prova

Gerado em 2026-11-02T15:43:26.172Z · commit `a15f550e3522b48a49fb2d7cc6c948fdf2b60f01` · fingerprint `68b2804492d5…`
Execução `run-20261102154045-b7334607` · escopo **PARCIAL** · processados 2 de 2 · cobertura **PARCIAL** (não cobre o inventário)

> **Não autoritativo.** Este relatório descreve trabalho de re-verificação. A fila oficial não foi
> alterada por este script, e nenhuma prova foi assinada: a assinatura é do dono da chave ancorada.

## Resumo

| Classe | Itens |
|---|---|
| AGUARDA_ASSINATURA_E_ANCORA | 2 |

## Itens

| Defeito | Sev | Estado declarado | Classe | Teste | Log |
|---|---|---|---|---|---|
| CI-E2E-CREDENTIAL-SCOPE | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/integration/governanceApprovalFullWorkerE2E.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261102154045-b7334607/logs/CI-E2E-CREDENTIAL-SCOPE.log |
| ENG-PROVENIENCIA-REPRODUCAO-SOBRESCRITA | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/integration/engineeringBugLoop.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261102154045-b7334607/logs/ENG-PROVENIENCIA-REPRODUCAO-SOBRESCRITA.log |

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

