# release-clean-check

## Escopo

O comando `npm run system:release-clean-check` valida alteracoes pendentes com base em `git status --porcelain`.

## Limitacao explicita

Se o workspace nao tiver diretório `.git`, o check retorna `SKIP` com sucesso (`exit 0`) e mensagem explicita:

- `workspace sem .git (check aplicavel apenas em repositorio Git)`

Esse comportamento evita falso erro em ambientes empacotados/sandbox sem metadados Git.
