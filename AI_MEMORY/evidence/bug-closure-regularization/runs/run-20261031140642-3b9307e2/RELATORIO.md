# Regularização de fechamentos sem prova

Gerado em 2026-10-31T14:06:50.457Z · commit `078737b84fbd9f53fc0401d5f89280e1cc4de541` · fingerprint `d5b817b10d97…`
Execução `run-20261031140642-3b9307e2` · escopo **PARCIAL** · processados 2 de 2 · cobertura **PARCIAL** (não cobre o inventário)

> **Não autoritativo.** Este relatório descreve trabalho de re-verificação. A fila oficial não foi
> alterada por este script, e nenhuma prova foi assinada: a assinatura é do dono da chave ancorada.

## Resumo

| Classe | Itens |
|---|---|
| ESTRUTURA_INCOMPLETA | 2 |

## Itens

| Defeito | Sev | Estado declarado | Classe | Teste | Log |
|---|---|---|---|---|---|
| AUDITORIA-ENTRYPOINT-TRAVAS | P1 | VERIFIED | ESTRUTURA_INCOMPLETA | tests/unit/audit/auditEntrypointArtifact.test.js | AI_MEMORY/evidence/bug-closure-regularization/AUDITORIA-ENTRYPOINT-TRAVAS.log |
| AUDITORIA-FASE-B-TESTE-MUTAVA-EVIDENCIA-GOVERNADA | P1 | VERIFIED | ESTRUTURA_INCOMPLETA | tests/unit/audit/auditEntrypointArtifact.test.js | AI_MEMORY/evidence/bug-closure-regularization/AUDITORIA-FASE-B-TESTE-MUTAVA-EVIDENCIA-GOVERNADA.log |

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

