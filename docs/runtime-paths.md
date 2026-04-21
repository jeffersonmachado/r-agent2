# Runtime Paths

Este projeto separa produto e estado mutável por meio de paths de runtime explícitos.

## Regra operacional

- Código, contratos e documentação vivem no repositório.
- Sessões, stores vetoriais, aprendizado adaptativo, artefatos transitórios de QA e evidências de release vivem fora do repositório.
- Quando um path não for informado explicitamente, o runtime deve preferir diretórios externos do ambiente em vez de gravar no workspace.
- O `system:validate` segue essa regra: com `RUNTIME_ROOT` definido e sem overrides específicos, escreve saídas em `<RUNTIME_ROOT>/qa/...` e `<RUNTIME_ROOT>/qa-mesh/...`.
- O mesmo padrão vale para a cadeia oficial de release/deploy: manifest, gate, go/no-go, launch plan, rollback drill, summary e deploy report passam a respeitar `RUNTIME_ROOT` quando não houver override explícito.
- Scripts utilitários e smokes executáveis isoladamente também seguem o mesmo padrão quando não recebem um path explícito: `generate-runtime-report`, `check-green`, `validate-go-technical`, `validate-ia-rollout-internal` e as evidências `L-01` a `L-07` passam a cair em `<RUNTIME_ROOT>/qa/...` por default.

## Variáveis oficiais

- `RUNTIME_ROOT`: raiz única de runtime mutável da API para replay/recording e estados transitórios.
- `WWEBJS_AUTH_PATH`: diretório de autenticação do `whatsapp-web.js`.
- `RAG_DATA_ROOT`: raiz mutável do serviço RAG.
- `VECTOR_STORE_PATH`: store vetorial persistente.
- `ADAPTIVE_LEARNING_DATA_PATH`: aprendizado adaptativo do RAG.
- `QA_MESH_SYSTEM_VALIDATE_DIR`: saída transitória do `system:validate` para QA Mesh.
- `RELEASE_EVIDENCE_BASE_DIR`: raiz das evidências transitórias de release.

## Padrão recomendado por ambiente

### Docker / Compose

- API: `/var/lib/ragent2`
- Runtime root da API: `/var/lib/ragent2/runtime`
- RAG: `/var/lib/ragent2/rag`
- WhatsApp auth: `/var/lib/ragent2/whatsapp/auth`
- QA Mesh system validate: `/var/lib/ragent2/qa-mesh/system-validate`
- Release evidence: `/var/lib/ragent2/release-evidence`

### Desenvolvimento local

- Preferir paths fora do clone, por exemplo em `/var/lib/ragent2` ou em diretório dedicado do usuário.
- Evitar gravar em `api/data/wa_sessions`, `rag-service/data/vector_store`, `rag-service/data/adaptive_learning`, `qa/release-evidence` e `qa-mesh/system-validate`.

## Volumes oficiais em Compose

- `api-runtime` ou equivalente: monta `/var/lib/ragent2` para a API.
- `rag-runtime` ou equivalente: monta `/var/lib/ragent2/rag` para o serviço RAG.
- Volumes específicos de PBX continuam separados para mídia e gravações.

## Higiene antes de release

- Executar `npm run runtime:clean:check` para detectar resíduos no workspace.
- Executar `npm run runtime:clean` para remover resíduos conhecidos.
- Executar `npm run zip:release:clean` para empacotar após a limpeza.