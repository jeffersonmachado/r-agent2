# Official Path

Este repositório adota uma trilha operacional única com quatro comandos oficiais.

## Comandos oficiais

1. npm run system:bootstrap
2. npm run system:validate
3. npm run system:release
4. npm run system:deploy

## Contrato por comando

### system:bootstrap
- valida versão de Node/NPM
- prepara arquivos mínimos de configuração
- instala dependências base de forma limpa
- roda migração
- sobe API temporariamente e valida `/health`, `/health/ready` e `/health/selftest`
- gera build e sobe preview do frontend para smoke de bootstrap

### system:validate
- valida contratos
- roda backend unit
- roda frontend unit
- roda frontend build
- roda frontend smoke
- roda QA mesh
- consolida `qa/smoke-evidence.json`
- gera qa/system-validate-report.json
- classifica runtime em qa/runtime-governance-report.json

### system:release
- executa system:validate
- gera artefato limpo auditado com hash/manifest
- executa release gate sem reexecutar validate
- emite go/no-go sem reexecutar gate
- emite manifesto e resumo de release

### system:deploy
- exige artefato aprovado (dist/*.zip com manifest audit=passed e goNoGo=GO)
- padrão dry-run
- deploy real apenas com SYSTEM_DEPLOY_EXECUTE=1
- extrai o ZIP para diretório temporário e executa deploy a partir do artefato extraído
- registra `qa/deploy-report.json`
- quando `API_PUBLIC_PORT`, `FRONTEND_PORT`, `RAG_PORT`, `POSTGRES_PUBLIC_PORT`, `REDIS_PORT` ou `AMI_PUBLIC_PORT` não são informados, reutiliza a porta atual da stack ou escolhe uma alternativa explícita se a padrão estiver ocupada

## Uso recomendado

- Novas automações devem chamar somente os quatro comandos oficiais.
