# Tenant Onboarding Operacional

## Quando usar

- entrada de novo tenant em producao

## Checklist

- validar feature flags essenciais
- validar URA e RAG do tenant
- validar health snapshot inicial
- validar dashboards Beauty/Fitness, quando habilitados

## Como validar

- `/api/admin/tenants/health`
- `/api/admin/tenant/:id/metrics`
- `/api/admin/tenant/:id/alerts`

## Como reverter

- desabilitar flags do tenant
- bloquear tenant se houver risco operacional alto
