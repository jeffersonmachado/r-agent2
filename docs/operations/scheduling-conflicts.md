# Scheduling Conflicts

## Quando usar

- alertas de conflito recorrente
- agenda fora de working hours
- schedules sem relacao explicita

## Como executar

- consultar `/api/admin/tenant/:id/alerts`
- rodar job OCC com `ENABLE_OCC_HEALTH_JOB=true`

## Como validar

- alertas resolvidos apos correcoes
- novos snapshots OCC mostrando queda de conflitos

## Como reverter

- desfazer apenas os ajustes operacionais do tenant afetado
- rerodar o health check
