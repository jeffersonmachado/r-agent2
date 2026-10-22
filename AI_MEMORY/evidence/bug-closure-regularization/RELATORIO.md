# Regularização de fechamentos sem prova

Gerado em 2026-10-22T17:49:09.797Z · commit `a122ad8bde6d0934ba0b46a61d2cbf7045ef6f78` · fingerprint `231995a055f4…`

> **Não autoritativo.** Este relatório descreve trabalho de re-verificação. A fila oficial não foi
> alterada por este script, e nenhuma prova foi assinada: a assinatura é do dono da chave ancorada.

## Resumo

| Classe | Itens |
|---|---|
| AGUARDA_ASSINATURA_E_ANCORA | 6 |
| TESTE_FALHOU_AGORA | 1 |
| REQUER_DECISAO_HUMANA | 3 |

## Itens

| Defeito | Sev | Estado declarado | Classe | Teste | Log |
|---|---|---|---|---|---|
| AUDITORIA-BRANCH-INVENTORY | P3 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/audit/branchInventory.test.js | AI_MEMORY/evidence/bug-closure-regularization/AUDITORIA-BRANCH-INVENTORY.log |
| AUDITORIA-CHECKPOINT-PROTOCOL | P3 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/audit/checkpointTool.test.js | AI_MEMORY/evidence/bug-closure-regularization/AUDITORIA-CHECKPOINT-PROTOCOL.log |
| AUDITORIA-FASE-B-CADEIA-FORA-DO-AGREGADO | P3 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/audit/auditEntrypointArtifact.test.js | AI_MEMORY/evidence/bug-closure-regularization/AUDITORIA-FASE-B-CADEIA-FORA-DO-AGREGADO.log |
| DEF-STATESYNC-EXEMPTION-STALE | P3 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/frontend/stateSyncExemptionExactness.test.js | AI_MEMORY/evidence/bug-closure-regularization/DEF-STATESYNC-EXEMPTION-STALE.log |
| H18-JORNADA-FUNCIONAL-BROWSER | P3 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/journeyDetectors.test.js | AI_MEMORY/evidence/bug-closure-regularization/H18-JORNADA-FUNCIONAL-BROWSER.log |
| MISSAO-A-L1-IMPACTO | P3 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/coverage/impactGraph.test.js | AI_MEMORY/evidence/bug-closure-regularization/MISSAO-A-L1-IMPACTO.log |
| MISSAO-A-L2-L3-ORQUESTRADOR | P3 | VERIFIED | TESTE_FALHOU_AGORA | tests/unit/coverage/impactRunner.test.js | AI_MEMORY/evidence/bug-closure-regularization/MISSAO-A-L2-L3-ORQUESTRADOR.log |
| MISSAO-B3-REUSO-PROVENIENCIA | P3 | VERIFIED | REQUER_DECISAO_HUMANA | — | — |
| MISSAO-B4-REVISAO-INDEPENDENTE | P3 | VERIFIED | REQUER_DECISAO_HUMANA | — | — |
| MISSAO-DEMO-SELF-ENGINEERING | P3 | VERIFIED | REQUER_DECISAO_HUMANA | — | — |

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

