# Regularização de fechamentos sem prova

Gerado em 2026-11-03T00:18:01.366Z · commit `7f7840aef2b83dedaf64b6aec85e0842dd7e4708` · fingerprint `203f3dc5115a…`
Execução `run-20261103001621-d5a23663` · escopo **PARCIAL** · processados 4 de 4 · cobertura **PARCIAL** (não cobre o inventário)

> **Não autoritativo.** Este relatório descreve trabalho de re-verificação. A fila oficial não foi
> alterada por este script, e nenhuma prova foi assinada: a assinatura é do dono da chave ancorada.

## Resumo

| Classe | Itens |
|---|---|
| AGUARDA_ASSINATURA_E_ANCORA | 4 |

## Itens

| Defeito | Sev | Estado declarado | Classe | Teste | Log |
|---|---|---|---|---|---|
| ENG-LEASE-FENCE-NAO-VALIDADO | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/integration/engineeringBugLoop.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261103001621-d5a23663/logs/ENG-LEASE-FENCE-NAO-VALIDADO.log |
| ENG-TESTES-VACUOSOS-PROVADOS-POR-MUTACAO | P2 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/integration/engineeringBugLoop.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261103001621-d5a23663/logs/ENG-TESTES-VACUOSOS-PROVADOS-POR-MUTACAO.log |
| H20-RUN-ORFAO-PROJECAO-STALE | P2 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/convergenceFixpoint.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261103001621-d5a23663/logs/H20-RUN-ORFAO-PROJECAO-STALE.log |
| MISSAO-A-L2-L3-ORQUESTRADOR | P3 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/coverage/impactRunner.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261103001621-d5a23663/logs/MISSAO-A-L2-L3-ORQUESTRADOR.log |

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

