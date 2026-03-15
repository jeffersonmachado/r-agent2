# RPA Reliability Handbook - 13 OCC Integration

## Objetivo
Integrar o motor de confiabilidade ao fluxo operacional do OCC (observabilidade e resposta).

## Sinais para Painel OCC
- distribuicao de `finalDecision` por seed/tenant,
- top fingerprints recorrentes,
- taxa de `PASS_WITH_RECOVERY`,
- taxa de `FAIL_APPLICATION_BUG` vs `FAIL_AUTOMATION_BUG`,
- strategies com melhor taxa de recuperacao.

## Alertas Recomendados
- aumento abrupto de `FAIL_INFRASTRUCTURE`.
- novo fingerprint `CRITICAL` sem historico.
- crescimento de flakiness acima de limiar.

## Playbooks Operacionais
1. Falha de aplicacao recorrente: abrir incidente de produto com evidencias anexas.
2. Falha de automacao recorrente: priorizar patch suggestion em backlog de testes.
3. Falha de infraestrutura: acionar SRE/ambiente e validar dependencia externa.

## Integração com Relatorios
- consumir artefatos em `tests/rpa/reports/bugs/`.
- anexar replay e screenshot em ticket de incidente.

## Limitacoes
- Sem agregador central, visao OCC pode ficar fragmentada por ambiente.

## Boas Praticas
- Definir SLO de confiabilidade de execucao RPA.
- Revisar semanalmente top fingerprints e top strategies.
