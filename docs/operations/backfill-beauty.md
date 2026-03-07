# Backfill Beauty

## Quando usar

- apos habilitar relacoes explicitas da Beauty
- antes de tratar `metadata` apenas como compatibilidade

## Como executar

```bash
node scripts/backfill-beauty-schedule-relations.js --tenant=SEU_TENANT --dry-run
node scripts/backfill-beauty-schedule-relations.js --tenant=SEU_TENANT --apply
```

## Como validar

- `migrableSchedules = 0` em novo `dry-run`
- bookings Beauty resolvendo profissional e servico por relacao explicita

## Como reverter

- remover apenas relacoes novas indevidas em `beauty_schedule_professionals` e `beauty_schedule_services`
- manter `metadata` legado intacto
