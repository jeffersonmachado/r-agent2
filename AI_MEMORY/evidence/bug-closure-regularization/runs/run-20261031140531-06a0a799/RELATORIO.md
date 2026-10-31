# Regularização de fechamentos sem prova

Gerado em 2026-10-31T14:05:38.250Z · commit `40c1f07807dbc0ba55247c52f17ff28dfd5c5b4e` · fingerprint `d5b817b10d97…`
Execução `run-20261031140531-06a0a799` · escopo **PARCIAL** · processados 3 de 3 · cobertura **PARCIAL** (não cobre o inventário)

> **Não autoritativo.** Este relatório descreve trabalho de re-verificação. A fila oficial não foi
> alterada por este script, e nenhuma prova foi assinada: a assinatura é do dono da chave ancorada.

## Resumo

| Classe | Itens |
|---|---|
| REQUER_DECISAO_HUMANA | 1 |
| AGUARDA_INSUMOS_HUMANOS | 2 |

## Itens

| Defeito | Sev | Estado declarado | Classe | Teste | Log |
|---|---|---|---|---|---|
| HARDENING-ENG-GOV-RELEASE-CANDIDATE-IDENTIDADE-FOREIGN-RUN | P0 | VERIFIED | REQUER_DECISAO_HUMANA | — | — |
| HARDENING-ENG-GOV-RELEASE-EVIDENCIA-DENTRO-DO-RUN | P0 | VERIFIED | AGUARDA_INSUMOS_HUMANOS | tests/unit/governance/waveEvidenceSameRunPreflight.test.js | AI_MEMORY/evidence/bug-closure-regularization/HARDENING-ENG-GOV-RELEASE-EVIDENCIA-DENTRO-DO-RUN.log |
| HARDENING-ENG-GOV-RELEASE-MESH-EVIDENCE-POISONING | P0 | RESOLVED | AGUARDA_INSUMOS_HUMANOS | tests/unit/qa-mesh/failureIntelligenceLineage.test.js | AI_MEMORY/evidence/bug-closure-regularization/HARDENING-ENG-GOV-RELEASE-MESH-EVIDENCE-POISONING.log |

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

