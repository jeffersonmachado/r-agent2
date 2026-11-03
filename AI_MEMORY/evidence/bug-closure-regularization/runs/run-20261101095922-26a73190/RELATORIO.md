# Regularização de fechamentos sem prova

Gerado em 2026-11-01T09:59:41.266Z · commit `c92fa9432b5a8645cd77f8c9ea57839f1f3f56c4` · fingerprint `ba0673e3cf27…`
Execução `run-20261101095922-26a73190` · escopo **PARCIAL** · processados 2 de 2 · cobertura **PARCIAL** (não cobre o inventário)

> **Não autoritativo.** Este relatório descreve trabalho de re-verificação. A fila oficial não foi
> alterada por este script, e nenhuma prova foi assinada: a assinatura é do dono da chave ancorada.

## Resumo

| Classe | Itens |
|---|---|
| AGUARDA_ASSINATURA_E_ANCORA | 2 |

## Itens

| Defeito | Sev | Estado declarado | Classe | Teste | Log |
|---|---|---|---|---|---|
| MISSAO-B3-REUSO-PROVENIENCIA | P3 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/releaseSuiteRunner.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261101095922-26a73190/logs/MISSAO-B3-REUSO-PROVENIENCIA.log |
| MISSAO-B4-REVISAO-INDEPENDENTE | P3 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/engineeringMission/reviewIndependenceProof.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261101095922-26a73190/logs/MISSAO-B4-REVISAO-INDEPENDENTE.log |

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

