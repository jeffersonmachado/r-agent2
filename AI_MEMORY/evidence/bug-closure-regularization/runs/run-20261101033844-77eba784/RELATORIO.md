# Regularização de fechamentos sem prova

Gerado em 2026-11-01T03:38:55.233Z · commit `3441bcacac223f381adfbc749bff054c58fdf358` · fingerprint `85fb543ba3a3…`
Execução `run-20261101033844-77eba784` · escopo **PARCIAL** · processados 1 de 1 · cobertura **PARCIAL** (não cobre o inventário)

> **Não autoritativo.** Este relatório descreve trabalho de re-verificação. A fila oficial não foi
> alterada por este script, e nenhuma prova foi assinada: a assinatura é do dono da chave ancorada.

## Resumo

| Classe | Itens |
|---|---|
| AGUARDA_ASSINATURA_E_ANCORA | 1 |

## Itens

| Defeito | Sev | Estado declarado | Classe | Teste | Log |
|---|---|---|---|---|---|
| AUDITORIA-BRANCH-INVENTORY | P3 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/audit/branchInventory.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261101033844-77eba784/logs/AUDITORIA-BRANCH-INVENTORY.log |

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

