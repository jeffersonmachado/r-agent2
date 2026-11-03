# Regularização de fechamentos sem prova

Gerado em 2026-11-01T08:21:05.619Z · commit `36606cf05442ef933fca1cf1c27901168aea445a` · fingerprint `f11b8df06b06…`
Execução `run-20261101082057-5349ee1c` · escopo **PARCIAL** · processados 1 de 1 · cobertura **PARCIAL** (não cobre o inventário)

> **Não autoritativo.** Este relatório descreve trabalho de re-verificação. A fila oficial não foi
> alterada por este script, e nenhuma prova foi assinada: a assinatura é do dono da chave ancorada.

## Resumo

| Classe | Itens |
|---|---|
| AGUARDA_ASSINATURA_E_ANCORA | 1 |

## Itens

| Defeito | Sev | Estado declarado | Classe | Teste | Log |
|---|---|---|---|---|---|
| MISSAO-B8-ESTADOS-FILA | P2 | RESOLVED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/hardeningQueueStates.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261101082057-5349ee1c/logs/MISSAO-B8-ESTADOS-FILA.log |

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

