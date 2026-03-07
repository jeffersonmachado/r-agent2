# Backfill de Relacoes Verticais

Este documento cobre a execucao segura dos backfills relacionais de Fitness e Beauty para fechamento da transicao de `metadata` legado para relacoes explicitas.

## Pre-requisitos

- Banco com backup recente e validado.
- API parada ou janela de baixa escrita para reduzir concorrencia.
- Migracoes aplicadas ate:
  - `20260307021000-add-fitness-schedule-relations.js`
  - `20260307030000-add-beauty-schedule-relations.js`

## Ordem recomendada

1. Executar `dry-run` da Fitness.
2. Executar `dry-run` da Beauty.
3. Validar contagens e amostras no banco.
4. Executar `apply` da Fitness.
5. Executar `apply` da Beauty.
6. Validar dashboards e consultas operacionais.

## Parametros suportados

- `--tenant=<tenant>`: isola um tenant.
- `--start=<ISO date>`: filtra schedules a partir da data.
- `--end=<ISO date>`: filtra schedules ate a data.
- `--status=<csv>`: filtra por status, por exemplo `scheduled,confirmed`.
- `--limit=<n>`: limita a quantidade total processada.
- `--batch-size=<n>`: define o tamanho do lote de execucao.
- `--dry-run`: nao grava nada; e o padrao do CLI.
- `--apply`: executa a migracao real.

Exemplo de dry-run controlado:

```bash
node scripts/backfill-fitness-schedule-relations.js \
  --tenant=system \
  --start=2026-01-01 \
  --end=2026-03-31 \
  --status=scheduled,confirmed \
  --limit=500 \
  --batch-size=100 \
  --dry-run
```

## Fitness

Dry-run:

```bash
node scripts/backfill-fitness-schedule-relations.js --tenant=system --dry-run
```

Apply:

```bash
node scripts/backfill-fitness-schedule-relations.js --tenant=system --apply
```

Campos de saida:

- `processedSchedules`: total filtrado/analisado
- `eligibleSchedules`: schedules com contexto legado util
- `migrableSchedules`: schedules com relacoes faltantes
- `migratedSchedules`: schedules realmente gravados no apply
- `touchedSchedules`: alias operacional para schedules com relacoes a criar
- `createdProfessionals`: relacoes profissional criadas
- `createdResources`: relacoes recurso criadas
- `alreadyMigrated`: schedules ja normalizados
- `ignoredSchedules`: schedules fora do escopo da vertical ou sem contexto legado
- `noDataSchedules`: schedules com contexto insuficiente para migrar
- `inconsistentSchedules`: schedules com lacunas/duplicidades/divergencia
- `validation`: resumo de faltas, duplicidades e divergencias
- `errors`: erros por schedule, quando houver

## Beauty

Dry-run:

```bash
node scripts/backfill-beauty-schedule-relations.js --tenant=system --dry-run
```

Apply:

```bash
node scripts/backfill-beauty-schedule-relations.js --tenant=system --apply
```

Campos de saida:

- `processedSchedules`: total filtrado/analisado
- `eligibleSchedules`: schedules com contexto Beauty legado
- `migrableSchedules`: schedules com relacoes faltantes
- `migratedSchedules`: schedules realmente gravados no apply
- `touchedSchedules`: alias operacional para schedules com relacoes a criar
- `createdProfessionals`: relacoes profissional criadas
- `createdServices`: relacoes servico criadas
- `alreadyMigrated`: schedules ja normalizados
- `ignoredSchedules`: schedules fora do escopo Beauty
- `noDataSchedules`: schedules Beauty sem ids suficientes no legado
- `inconsistentSchedules`: schedules com lacunas/duplicidades apos conciliacao
- `validation`: resumo de faltas e duplicidades
- `errors`: erros por schedule, quando houver

## Validacao pos-execucao

- Conferir se `migrableSchedules` caiu para zero em novo `dry-run`.
- Conferir se `errors` esta vazio.
- Conferir se `validation.missing*` e `validation.duplicate*` estao zerados ou com divergencias justificadas.
- Conferir amostras:
  - Fitness: `fitness_schedule_professionals`, `fitness_schedule_resources`
  - Beauty: `beauty_schedule_professionals`, `beauty_schedule_services`
- Validar dashboards:
  - `/fitness-dashboard`
  - `/beauty-dashboard`
- Validar consultas operacionais:
  - conflitos de profissional/recurso na Fitness
  - agenda por profissional e fidelidade na Beauty

## Rollback logico

Os scripts sao idempotentes e apenas materializam relacoes a partir de dados legados. O rollback recomendado e logico:

1. identificar o tenant afetado
2. remover apenas relacoes criadas indevidamente nas tabelas novas
3. manter `metadata` legado intacto

Nao ha rollback automatico em migration porque isso aumentaria risco operacional em bases grandes.

## Procedimento recomendado em ambiente real

1. Fazer backup validado do banco e registrar a janela de mudanca.
2. Rodar Fitness e Beauty em `dry-run` com filtros conservadores por tenant e periodo.
3. Revisar o JSON final e os logs por lote antes de aplicar.
4. Executar `--apply` primeiro em tenants menores ou periodos limitados.
5. Repetir `dry-run` apos o apply; o esperado e `migrableSchedules = 0`.
6. Validar:
   - dashboard de Fitness com agenda por profissional/recurso
   - dashboard de Beauty com agenda e booking minimo
   - conflitos operacionais no scheduling central
7. Se houver inconsistencias:
   - corrigir o legado manualmente no tenant afetado
   - remover apenas relacoes novas indevidas
   - reexecutar o backfill filtrando o mesmo tenant/periodo
