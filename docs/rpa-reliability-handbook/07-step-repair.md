# RPA Reliability Handbook - 07 Step Repair

## Objetivo
Aplicar ajustes temporarios no passo para tentar recuperar execucao sem alterar contrato externo.

## Tipos de Repair
- Relax de assert (contains em vez de exact em cenarios de corpo amplo).
- Insercao de espera antes da acao.
- Troca de seletor pelo melhor candidato.
- Insercao de precondicao simples (ex.: garantir foco no campo).

## Regras de Seguranca
- Reparos sao ephemeros da execucao atual.
- Sem gravacao automatica em seed.
- Sempre gerar evidencia da transformacao aplicada.

## Limitacoes
- Repair agressivo pode mascarar regressao real.

## Boas Praticas
- Marcar claramente em relatorio quando houve repair.
- Revisar repairs frequentes para convergir em correcao definitiva.
