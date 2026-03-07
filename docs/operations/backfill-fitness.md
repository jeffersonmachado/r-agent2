# Backfill Fitness

## Quando usar

- apos migracoes de relacoes explicitas da Fitness
- antes de desligar dependencia principal de `metadata`

## Como executar

```bash
node scripts/backfill-fitness-schedule-relations.js --tenant=SEU_TENANT --dry-run
node scripts/backfill-fitness-schedule-relations.js --tenant=SEU_TENANT --apply
```

## Como validar

- `migrableSchedules = 0` em novo `dry-run`
- dashboards Fitness carregando agenda e conflitos

## Como reverter

- remover apenas relacoes novas indevidas em `fitness_schedule_professionals` e `fitness_schedule_resources`
- manter `metadata` legado intacto
