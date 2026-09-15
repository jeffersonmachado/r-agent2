# Official Path

Este repositório adota uma trilha operacional única com quatro comandos oficiais.

A autoridade única de release completo (selagem + publicação) é `npm run release:seal` (planeje com `npm run release:seal:plan`): ele orquestra as fases prepare → candidate → final → publish → consolidate. `system:release` e `zip:release` são etapas internas do pipeline de release (validação+empacotamento e helper de pacote), invocadas pelas fases do `release:seal`, e não a autoridade de release.

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
- o runtime root é resolvido automaticamente pela aplicação (`/var/lib/ragent2` em produção, `~/.local/share/ragent2-runtime` em dev); sem overrides específicos, report/evidências do validate são escritos em `<runtime root>/qa/...` e `<runtime root>/qa-mesh/...`
- no smoke L-04 (PBX call events -> runtime) em modo `direct`, o fluxo exige intenção explícita de banco:
	- definir `TEST_DATABASE_URL`, ou
	- definir `PBX_CALL_EVENTS_RUNTIME_ALLOW_DB_FALLBACK=1`
	- o cenário oficial do `qa:mesh` já injeta `PBX_CALL_EVENTS_RUNTIME_ALLOW_DB_FALLBACK=1`

### system:release
- etapa interna do pipeline de release (validação + empacotamento), não a autoridade de release — a selagem/publicação completa é `npm run release:seal`
- executa system:validate
- exige workspace sem resíduos de runtime conhecidos (`npm run runtime:clean:check`)
- gera artefato limpo auditado com hash/manifest
- executa release gate sem reexecutar validate
- emite go/no-go sem reexecutar gate
- emite manifesto e resumo de release
- o runtime root é resolvido automaticamente (sem overrides específicos): manifest/gate/go-no-go/summary/rollback drill/evidências são escritos sob `<runtime root>/qa/...` e `<runtime root>/qa/release-evidence/...`

### system:deploy
- exige artefato aprovado (dist/*.zip com manifest audit=passed e goNoGo=GO)
- padrão dry-run
- deploy real apenas com SYSTEM_DEPLOY_EXECUTE=1
- extrai o ZIP para diretório temporário e executa deploy a partir do artefato extraído
- registra `qa/deploy-report.json`
- o deploy report é escrito em `<runtime root>/qa/deploy-report.json` (sem override específico)
- quando `API_PUBLIC_PORT`, `FRONTEND_PORT`, `RAG_PORT`, `POSTGRES_PUBLIC_PORT`, `REDIS_PORT` ou `AMI_PUBLIC_PORT` não são informados, reutiliza a porta atual da stack ou escolhe uma alternativa explícita se a padrão estiver ocupada

## Uso recomendado

- Novas automações devem chamar somente os quatro comandos oficiais.
- Para release completo (selagem + publicação), chame `npm run release:seal`; não encadeie `system:release`/`zip:release` à mão como substituto do ciclo.
- Antes de empacotar release em um workspace de desenvolvimento, execute `npm run runtime:clean`.
