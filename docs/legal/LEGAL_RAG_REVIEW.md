# LEGAL — revisão de RAG e Knowledge Plane

Data da análise: 2026-10-05. Escopo: discovery do código atual; nenhuma ingestão de dados jurídicos, alteração de código ou consulta a segredos. Referências `arquivo:linha` apontam para símbolos inspecionados nesta revisão. Resultados consolidados dos testes existentes: [evidências da avaliação](./_evidence/validation.md).

## Decisão

Reutilizar o RAG existente, o Knowledge Plane e pgvector. **A segregação vetorial existe, mas a segregação ponta a ponta não está garantida: `B-LEGAL-RAG-ACL` é BLOCKER.** O CRUD documental permite ler conteúdo SYSTEM ou restrito do mesmo tenant sem aplicar a política usada no retrieval. Não é ausência de teste apenas: o handler executável reproduziu a violação com dependências sintéticas e sem efeitos externos; veja [probe e limites](./_evidence/security-findings.md).

## Implementação encontrada

| Componente real | Evidência de código | Reutilização Legal e limite |
|---|---|---|
| Documento, original e permissões | [`RagDocument.js:19`](../../api/db/models/RagDocument.js), campos `permissions/domain/classification/sensitivity` em 44–63; [`RagDocumentFile.js:43`](../../api/db/models/RagDocumentFile.js), BLOB original | Reutilizar documento e binário; especializar metadados e relações do domínio. `tenant_key` dos models permite null; os serviços exigem tenant. Não há ACL por equipe de processo nem versionamento jurídico tipado nesses models. |
| Esquema de segregação | [`20260801000001-add-rag-domain-segregation.js`](../../api/db/migrations/20260801000001-add-rag-domain-segregation.js), colunas/constraints de documentos e chunks | Não criar vector store jurídico paralelo. Preservar coerência OPERATIONAL/SYSTEM e índices. |
| Knowledge Router canônico | [`knowledge-router.js:162`](../../src/core/knowledge-plane/knowledge-router.js), `resolveKnowledgeContext`; adapter `resolveRetrievalScope:292` | Resolve domínio por classificação autenticada; PRODUCTION não recupera SYSTEM. O antigo [`domainRouter.js`](../../api/services/rag/domainRouter.js) ainda existe, mas a rota e `ragService` consultam o Knowledge Plane. |
| Boundary HTTP de query | [`ragQueryRoutes.js:31`](../../api/modules/rag-documents/rag/ragQueryRoutes.js), `handleRagQueryRoutes`; `POST /rag/query` | Tenant autenticado + `rag:query`; domínio solicitado passa pela autorização em 38–45. O payload não fornece roles/agentId autoritativos. |
| ACL de retrieval | [`ragService.js:117`](../../api/services/ragService.js), `buildEffectiveAccessFilters`; `queryRag:274` | Roles/id vêm do ator. Scope externo é recusado em 289–299; scopes internos têm marca criada pelo Knowledge Plane. |
| Serviço interno Python | [`main.py:75`](../../rag-service/main.py), `require_internal_token`; [`internal_auth.py`](../../rag-service/services/internal_auth.py) | Todas as rotas `/rag*` exigem token interno forte, inclusive search/index/health. Não confundir token de serviço com autorização do usuário: Python confia na política resolvida por Node. |
| Recuperação SQL | [`vector_store.py:235`](../../rag-service/services/vector_store.py), `VectorStore.search`, filtros em 267–278 | SQL filtra tenant, domínio, classificação, sensitivity, roles, agents e documento pai ativo/indexado antes de ordenar vetores. Reutilização alta; preservar controle no SQL. |
| Ingestão/embeddings | [`index.py:60`](../../rag-service/api/routes/index.py), `index_document`; normalização de domínio em 82, secrets em 87; [`embedding_service.py`](../../rag-service/services/embedding_service.py) | Chunking, hashes, embeddings, dedup e persistência transacional existentes. Não reimplementar para Legal. Padrões de secrets não equivalem a proteção de dados pessoais ou sigilo. |
| Retrieve-only | [`search.py:37`](../../rag-service/api/routes/search.py), `SearchRequest`; serializer em 48; [`ragService.js`](../../api/services/ragService.js), `searchChunks` | Busca sem geração para análise/fonte jurídica. Serializer preserva documentId, chunkIndex, hashes e sourceVersion; validar proveniência da origem global. |
| Resposta/ausência de fonte | [`query.py:558`](../../rag-service/api/routes/query.py), `Source`; sem chunks em 577–604 | Há abstention explícita sem chunks e lista de fontes. Com chunks, o texto gerado não recebe validação determinística de citações/precedentes. Similaridade/confidence não comprova existência de precedente. |
| Cache | [`ragResponseCache.js:73`](../../api/services/rag/ragResponseCache.js), `buildCacheKey`, `invalidateTenant:150`; [`ragDocumentsService.js:727`](../../api/services/ragDocumentsService.js) | Chave inclui escopo fornecido pelo serviço e identidade/ACL; writes invalidam entradas do tenant. Cache é derivado, não fonte documental. |
| Contexto cognitivo | [`ragResolver.js:43`](../../src/core/cognitive/context-engine/ragResolver.js), resolver `rag` | Propaga ator; resultado inclui sources. Falha retorna null em 80–85. Futuras ações jurídicas dependentes de fonte devem recusar contexto insuficiente por Outcome Contract, pois o resolver é best effort. |

## Segregação e caminhos alternativos

O caminho vetorial é `POST /rag/query → resolveRetrievalScope → queryRag → token interno → VectorStore.search`. A consulta Python mantém ACL também no retry de relevância; reduzir `minScore` não remove o escopo. `test_domain_segregation.py` cobre a ausência de fallback entre domínios e `test_vector_store_search_sql.py:79` verifica as cláusulas SQL.

O caminho documental vivo é [`registerRoutes.js:126`](../../api/app/registerRoutes.js) → [`routeRegistry.js:63`](../../api/app/routeRegistry.js) → [`platform-content/routes.js:124`](../../api/modules/platform-content/routes.js) → [`handleRagRoutes.js:17`](../../api/modules/rag-documents/handleRagRoutes.js) → [`ragCoreRoutes.js:18`](../../api/modules/rag-documents/rag/ragCoreRoutes.js). Não há guard de classificação nesses wrappers. [`buildRagRouteContext.js:11`](../../api/routing/contextBuilders/buildRagRouteContext.js) transmite auth/permissão/tenant e serviços, sem ACL documental.

As rotas GET abaixo exigem `rag:read` e tenant, mas não consultam domínio, classificação, sensibilidade ou `permissions.roles/agents` do documento:

- `GET /rag/documents`, handler em `ragCoreRoutes.js:21`; `listDocuments` em [`ragDocumentsService.js:460`](../../api/services/ragDocumentsService.js) filtra tenant/source/categoria/status/search e hidrata conteúdo.
- `GET /rag/documents/:id`, handler em `ragCoreRoutes.js:90`; `getDocumentWithContent:544` procura id + tenant.
- `GET /rag/documents/:id/download`, handler em `ragCoreRoutes.js:67`; `getDocumentFileFromDb:252` procura document_id + tenant_key e entrega bytes sem carregar/policiar o documento pai.

**B-LEGAL-RAG-ACL — BLOCKER/P0:** alinhar list/detail/download/stats e mutações documentais à mesma autoridade de acesso do retrieval, incluindo o binário. Um ator com `rag:read` não deve acessar SYSTEM pela leitura direta. Testar PRODUCTION, SUPPORT e DEVELOPMENT; roles/agents negados; sensibilidade; documento inativo; metadados e original; URL direta. O probe da avaliação retornou 200 para documento sintético `SYSTEM/DEVELOPMENT/RESTRICTED` com roles/agents que excluíam o ator PRODUCTION. Isso prova o caminho do handler; não afirma exposição de um documento real.

## Conhecimento global e sensibilidade jurídica

[`knowledge-router.js:381`](../../src/core/knowledge-plane/knowledge-router.js), `resolveRetrievalTenantKeys`, e [`domain_policy.py:211`](../../rag-service/services/domain_policy.py), `resolve_scope_tenant_keys`, incluem por design `[tenant atual, tenant operacional global]` em OPERATIONAL. O global default é `system`; SYSTEM permanece no tenant atual. Não é wildcard nem seleção pelo payload. Porém a elegibilidade global depende do tenant/domínio/ACL; não há um campo de publicação pública por documento na cláusula SQL em `vector_store.py:267`.

Legal deve manter processos/clientes/peças e orientações privadas no tenant do escritório. Jurisprudência ou modelos compartilhados só podem entrar no corpus global após validação da fonte e autorização explícita de publicação. Não transferir peças de cliente ao tenant `system`. O chunk reconstituído recebe `tenantId=self.tenant_id` em `vector_store.py:347`, mesmo quando vem do global: estender proveniência para preservar o tenant de origem real e distinguir fonte pública/privada. Isto é **EXTEND**, não prova de vazamento entre dois tenants privados.

**Sensibilidade atual não representa sigilo jurídico entre operadores.** [`domain_policy.py:31`](../../rag-service/services/domain_policy.py) concede somente PUBLIC/INTERNAL a PRODUCTION, CONFIDENTIAL a SUPPORT e RESTRICTED a DEVELOPMENT. `ragCoreRoutes.js:12` usa a mesma escala para criação. Um advogado operacional não deve ganhar SUPPORT/DEVELOPMENT para acessar um processo confidencial. É necessária autorização de conteúdo/assunto independente da classificação de experiência, preservando a proibição SYSTEM para PRODUCTION. Status **REFACTOR/P0** para receber corpus sigiloso, em dependência de `B-LEGAL-RAG-ACL`.

## Gaps jurídicos sem arquitetura paralela

| Necessidade | Status | Mudança futura necessária |
|---|---|---|
| Processos, documentos e peças do tenant | EXTEND | Relações tipadas ao domínio Legal + ACL por matter/equipe, versão documental, hash do original e cadeia de custódia. Reutilizar RAG e storage. |
| Jurisprudência verificável | PARTIAL | Registrar tribunal/origem/identificador/versão/data de coleta e validar toda citação da resposta contra as fontes recuperadas. Fonte ausente deve impedir precedente inventado; prompt não é gate. |
| Minutas | EXTEND | Produzir rascunho versionado relacionado ao documento/modelo; revisão humana vinculada ao hash. Não transformar geração em peça aprovada. |
| Prompt injection | PARTIAL | `query.py:621` fornece system prompt separado que trata documentos como não confiáveis; autorização SQL/kernel deve permanecer independente da LLM. Não há prova de resistência universal a injeções. |
| Dados pessoais na ingestão | PARTIAL | Detector de secrets não classifica dados pessoais/segredo de justiça. Política explícita de minimização e acesso; varredura adequada ao corpus sem armazenar conteúdos em logs. |
| Perguntas/aprendizado | REFACTOR | [`adaptive_learning.py:108`](../../rag-service/services/adaptive_learning.py), `<tenant>_learning.json`; gravação em 190–218 e query em 560–597 persistem texto operacional. Para dados jurídicos: DB governado, retenção/deleção, ACL e opt-in; configuração JSON versionada não é equivalente a registros operacionais JSON. |
| Limites de upload | BLOCKER | `B-LEGAL-UPLOAD-LIMIT`, detalhado na [revisão de segurança](./LEGAL_SECURITY_REVIEW.md). |

## Prova existente e documentação divergente

Testes localizados: [`ragTenantScopeGuard.test.js:94`](../../tests/unit/ragTenantScopeGuard.test.js), isolamento das rotas; [`ragAgentSegregation.test.js:25`](../../tests/unit/ragAgentSegregation.test.js), tools/domínios; [`ragPersistenceRequired.test.js:17`](../../tests/unit/ragPersistenceRequired.test.js), sem fallback de persistência; [`test_domain_segregation.py`](../../rag-service/tests/test_domain_segregation.py), ingestão/secrets/token/retrieval; [`test_vector_store_search_sql.py`](../../rag-service/tests/test_vector_store_search_sql.py), ACL SQL; [`test_global_operational_scope.py`](../../rag-service/tests/test_global_operational_scope.py), união global controlada. Não cobrem o bypass GET demonstrado nem autorização por processo jurídico. Execuções desta missão ficam no [registro central](./_evidence/validation.md); localizar teste não significa PASS.

`DOCUMENTATION_DRIFT`: [`domain-segregation.md:61`](../rag/domain-segregation.md) ainda descreve `auditor→SUPPORT`, enquanto a política atual exige platformRole e auditor de tenant puro é PRODUCTION; a execução usa Knowledge Plane, não apenas o router legado. O mesmo doc em 32 descreve igualdade de tenant, enquanto o código atual usa união operacional global controlada. O comentário `ragResponseCache.js:16` diz ausência de invalidação por reindex, mas `invalidateTenant:150` existe e writes o chamam. Relatórios PASS históricos de retrieval não certificam todas as rotas documentais.
