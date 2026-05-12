# Seed de Tenants

Este repositório não usa mais o seed legado em JSON para tenants.

## Estado Atual

- Comando legado: `npm run seed:tenant`
- Resultado atual do comando: `Seed legado em JSON removido (DB-only)`
- Objetivo: deixar explícito que o seed de tenants agora depende do banco e dos fluxos reais da aplicação.

## Caminhos Relacionados

- `package.json` para o script `seed:tenant`
- `tests/rpa/seedPlatformRPA.js` para o fluxo de seed/plataforma usado em RPA
- `tests/rpa/README_SEED.md` para contexto operacional de seeds RPA
- `docs/TENANT_MULTI_TENANT.md` e `docs/TENANT_MULTI_TENANT_ARCHITECTURE.md` para o contexto multi-tenant

## Observações

- Se for necessário repovoar tenants para testes, use os fluxos DB-only e os scripts de seed RPA atualmente suportados.
- Não reintroduza o seed JSON antigo como fonte canônica.
