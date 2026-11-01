# Regularização de fechamentos sem prova

Gerado em 2026-11-01T08:28:54.650Z · commit `ab6069e0351350a6e14b4961f78f07a9fecfd893` · fingerprint `f11b8df06b06…`
Execução `run-20261101082836-451f44b5` · escopo **PARCIAL** · processados 3 de 3 · cobertura **PARCIAL** (não cobre o inventário)

> **Não autoritativo.** Este relatório descreve trabalho de re-verificação. A fila oficial não foi
> alterada por este script, e nenhuma prova foi assinada: a assinatura é do dono da chave ancorada.

## Resumo

| Classe | Itens |
|---|---|
| AGUARDA_ASSINATURA_E_ANCORA | 3 |

## Itens

| Defeito | Sev | Estado declarado | Classe | Teste | Log |
|---|---|---|---|---|---|
| CI-MAIN-JEST-AMBIENTE | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/ciWorkflowContract.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261101082836-451f44b5/logs/CI-MAIN-JEST-AMBIENTE.log |
| CI-WAVE-REFRESH-SEM-RUN-GOVERNADO | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/ciWorkflowContract.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261101082836-451f44b5/logs/CI-WAVE-REFRESH-SEM-RUN-GOVERNADO.log |
| P1-CI-SEM-INTEGRACAO | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/ciWorkflowContract.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261101082836-451f44b5/logs/P1-CI-SEM-INTEGRACAO.log |

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

