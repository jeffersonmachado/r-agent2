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

## Evidência same-run (proveniência de QA no seal)

Vigente desde 2026-09-19 (gate `QA_EVIDENCE_SAME_RUN`,
`npm run validate:qa-evidence-same-run`, bloqueante no agregado). O defeito que
o gate fecha: `stamp-report-lineage.js` preservava o `generatedAt` original e
anexava o `runId`/`sourceFingerprint` do run mais recente — um relatório
produzido às 10:46 passou a carregar o runId de um run criado às 20:18. Isso não
é evidência same-run, é **adoção retroativa de lineage**, pior que não ter
lineage: o engine de certificação passa a aceitar como prova de um run algo que
aquele run nunca executou.

A classificação canônica dos artefatos por **modo de produção** vive em
`config/runtime-evidence-artifacts.json` (módulo puro
`scripts/governance/lib/runtime-evidence-artifacts.js`, compartilhado entre o
gate e o produtor, para que "recusar estampar" e "reprovar no gate" nunca
divirjam):

- **RUNTIME_EVIDENCE** (6 artefatos: `qa-mesh/go-no-go-report.json`,
  `qa-mesh/release-gate-report.json`, `qa-mesh/intelligence/latest.json`,
  `qa/enterprise/pbx-voice-flow-prod-like.json`,
  `qa/enterprise/human-handoff-full-validation.json`,
  `qa/enterprise/omnichannel-unified-replay.json`) — resultado da **execução**
  de algo (mesh, smoke prod-like, replay). Não recomputável por leitura do
  source. Exige lineage **na origem**: `runId` + `sourceFingerprint` resolvidos
  por `scripts/governance/lib/resolve-run-lineage.js` **antes** de executar, e
  prova temporal — `generatedAt` dentro da janela `[started_at, completed_at]`
  do run, com `runId` existente em `GovernanceRun` e `sourceFingerprint` igual
  ao do run.
- **DERIVED_REPORT** (relatórios de `reports/` recomputáveis por validador
  determinístico) — o stamp só é aceitável quando o validador foi executado
  no run.

`scripts/governance/stamp-report-lineage.js` **recusa** carimbar qualquer
artefato RUNTIME_EVIDENCE (`RUNTIME_EVIDENCE_REQUIRES_ORIGIN_LINEAGE`) — o
retroactive-lineage não tem mais caminho. O `meshHistory` recebe lineage na
origem: `pipeline/entrypoints/runQaMesh.js` resolve o run antes da execução (e
avisa explicitamente quando grava sem lineage) e `qa-mesh/meshRunner.js` grava
`runId`/`sourceFingerprint` no relatório.

Violações tipadas do gate: `QA_EVIDENCE_LINEAGE_MISSING` (sem runId ou
fingerprint), `QA_EVIDENCE_RUN_UNKNOWN` (runId ausente no banco de runs),
`QA_EVIDENCE_SAME_RUN_VIOLATION` (`generatedAt` anterior ao `started_at` do run
— produzido antes do run, não pode ser prova dele),
`QA_EVIDENCE_SOURCE_MISMATCH` (fingerprint difere do run) e
`QA_EVIDENCE_NO_TIMESTAMP` (sem `generatedAt` não há prova temporal). Relatório:
`reports/qa-evidence-same-run-report.json`.

### Onde isso muda o `release:seal`

- **Fase `prepare`**: depois da convergência/criação do run governado e **antes**
  de exigir o veredito `SEAL_GO`, o seal **executa o QA Mesh canônico dentro do
  próprio run** (`RUNNING_IN_PIPELINE=1 npm run qa:mesh`, ~35 min), com o
  lineage resolvido na origem. Se o mesh falhar, o seal **aborta** — sem
  evidência same-run não há seal.
- **Fase `consolidate`**: depois da varredura agregada e dos reparos de lineage
  (só DERIVED_REPORT), se o gate agregado ainda falhar o seal **aborta** —
  evidência same-run/lineage exige reexecução real, nunca carimbo.
