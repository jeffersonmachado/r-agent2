# Release Checklist

Checklist oficial de empacotamento e release do RAP / r-agent2.

## Pré-condições

- `npm ci`
- `.env` válido com `ENCRYPTION_KEY`
- `api/data/config.json` válido
- serviços necessários acessíveis ou stack de teste pronta

## Higiene do workspace

- `npm run runtime:clean:check`
- Se falhar, executar `npm run runtime:clean`
- Confirmar ausência de resíduos em `api/data/wa_sessions`, `rag-service/data/vector_store`, `rag-service/data/adaptive_learning`, `qa-mesh/system-validate`, `qa/release-evidence`, `frontend/.vite`, `reports`, `recordings`, `replays`

## Validação oficial

- `npm run system:bootstrap`
- `npm run system:validate`

## Empacotamento

- `npm run zip:release:clean`
- Confirmar geração de ZIP e manifesto SHA-256 em `dist/`
- Confirmar auditoria do artefato sem padrões proibidos

## Gate e decisão

- `npm run system:release-gate`
- `npm run system:go-no-go`
- `npm run system:release-manifest`
- `npm run system:release-summary`

## Evidências

- Se usar evidência externa, confirmar `RELEASE_EVIDENCE_BASE_DIR`
- Verificar `node tools/system/release-evidence-verify.js`
- Aplicar retenção com `node tools/system/release-evidence-prune.js` quando necessário

## Critério de aceite

- build e smoke do frontend aprovados
- backend validado
- release gate aprovado
- artefato limpo e auditado
- runtime mutável isolado do repositório