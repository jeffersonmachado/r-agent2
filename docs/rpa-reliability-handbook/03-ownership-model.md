# RPA Reliability Handbook - 03 Ownership Model

## Objetivo
Definir quem e o dono provavel da falha para acelerar resposta e evitar retrabalho.

## Owners
- `APPLICATION`: bug funcional da aplicacao sob teste.
- `AUTOMATION`: fragilidade da automacao (selector, assert, timing do script).
- `INFRASTRUCTURE`: instabilidade de rede, browser, ambiente, dependencia externa.
- `UNCERTAIN`: quando evidencias sao insuficientes.

## Regras de Mapeamento
- HTTP 5xx recorrente + DOM estavel -> `APPLICATION`.
- `selector not found` com pagina carregada -> `AUTOMATION`.
- timeout global, browser crash, DNS/connect failures -> `INFRASTRUCTURE`.
- sinais mistos sem dominancia -> `UNCERTAIN`.

## Impacto na Decisao Final
- `APPLICATION` -> `FAIL_APPLICATION_BUG`
- `AUTOMATION` -> `FAIL_AUTOMATION_BUG`
- `INFRASTRUCTURE` -> `FAIL_INFRASTRUCTURE`
- `UNCERTAIN` -> `FAIL_UNKNOWN`

## Limitacoes
- Ownership e inferencia probabilistica.
- Erros em cascata podem mascarar owner real.

## Boas Praticas
- Correlacionar owner com evidencias (console/http/dom).
- Evitar "passar para outro time" sem dados objetivos.
