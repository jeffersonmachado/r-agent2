# release-clean-check

## Escopo

O comando `npm run system:release-clean-check` valida dois pontos:

- alteracoes pendentes com base em `git status --porcelain`
- residuos operacionais ainda rastreados no indice Git (ex.: `qa-mesh/isolated-run*`, `api/data/wa_sessions`, `rag-service/data/vector_store`)
- resíduos operacionais conhecidos ainda presentes no workspace (`.wwebjs_auth`, `qa/release-evidence`, `qa-mesh/meshHistory`, `rag-service/data/vector_store`, etc.)

Se houver resíduos, o check falha e orienta a executar `npm run runtime:clean`.

## Limitacao explicita

Se o workspace nao tiver diretório `.git`, o check retorna `SKIP` com sucesso (`exit 0`) e mensagem explicita:

- `workspace sem .git (check aplicavel apenas em repositorio Git)`

Esse comportamento evita falso erro em ambientes empacotados/sandbox sem metadados Git.
