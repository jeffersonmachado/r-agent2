# Release Contract

## Princípios

- Release sai de artefato aprovado, não de workspace vivo.
- Deploy só acontece se existir zip aprovado com manifesto `audit=passed` e `goNoGo=GO`.
- Evidência de execução é separada do código-fonte.

## Artefato aprovado

Gerado por npm run zip:release

Entregáveis mínimos:
- dist/<artifact>.zip
- dist/<artifact>.manifest.json (audit=passed, sha256)

Depois de `system:release`, o manifesto do artefato é carimbado com:
- goNoGo
- releaseGate
- validateResult
- runtimeGovernance
- approvedForDeploy

Bloqueios de contaminação incluem:
- .env / .token.env
- node_modules
- remote-dumps / remote-dumps2
- frontend_backup
- caches/auth do whatsapp web
- logs e artefatos de runtime
- evidências QA/mesh geradas

## Pipeline oficial de release

npm run system:release

Passos:
1. system:validate
2. zip:release
3. system:release-gate
4. system:go-no-go
5. system:release-manifest
6. system:release-summary

## Deploy oficial

npm run system:deploy

Comportamento:
- dry-run por padrão
- deploy real apenas com SYSTEM_DEPLOY_EXECUTE=1
- falha se não houver artefato aprovado
- extrai o ZIP para diretório temporário
- executa `deploy:up` e `deploy:status` a partir do conteúdo extraído
- registra evidência local em `qa/deploy-report.json`
- quando `API_PUBLIC_PORT`, `FRONTEND_PORT`, `RAG_PORT`, `POSTGRES_PUBLIC_PORT`, `REDIS_PORT` ou `AMI_PUBLIC_PORT` não são informados, reutiliza a porta atual da stack ou escolhe uma alternativa explícita se a padrão estiver ocupada

## Rollback

Rollback mínimo é governado por relatório de drill:
- qa/rollback-drill-report.json

Deploy/release devem manter referência ao último artefato aprovado para retorno controlado.
