# Evidência de discovery — segurança, RAG e agentes

Data: 2026-10-05. Artefato de análise; não certificação/release. Código-fonte e dependências sintéticas reproduzem caminhos de erro/permissividade, sem ler dados reais, configurar serviços, acessar rede ou enviar mensagens. Testes existentes e gates reais são coordenados no [registro central](./domain-findings.md).

## Probe reproduzível

Fonte: [`security-probe.cjs`](./security-probe.cjs), somente ferramenta de análise. Requer dependências já instaladas do repo. Usa o mesmo estilo de auth/permission/deps fake de [`ragTenantScopeGuard.test.js:26`](../../../tests/unit/ragTenantScopeGuard.test.js) e injeta serviço WhatsApp como [`cognitiveCoreToolRegistry.test.js`](../../../tests/unit/cognitiveCoreToolRegistry.test.js). O handler, o kernel, o serializer, o compiler, a state machine e o store são os executáveis existentes. A identidade, documento, bytes, recipient e efeitos de serviço são sintéticos.

Comando executado: `node docs/legal/_evidence/security-probe.cjs`. Exit **0**, duração observada 0,327s. O exit significa que a coleta do diagnóstico concluiu; **não** significa que os controles passaram. Resultado:

| Caso | Resultado real no probe | Interpretação |
|---|---|---|
| PRODUCTION + rag:read, GET `/rag/documents` com doc do mesmo tenant SYSTEM/DEVELOPMENT/RESTRICTED, ACL role/agent alheios | 200, conteúdo restrito retornado | Bypass da policy documental. |
| Mesmo ator, GET `/rag/documents/synthetic-system-doc` | 200, conteúdo restrito retornado | Bypass direto por ID. |
| Mesmo ator, GET `/rag/documents/synthetic-system-doc/download` | 200, 27 bytes sintéticos | Binário não consulta ACL/policy do documento pai. |
| `messaging.sendWhatsAppMessage`, actor PRODUCTION + channel.send, sem confirmed/approval | Serviço fake invocado uma vez, somente 2 argumentos; tenant não propagado ao adapter | Policy autonomous + adapter global. Nenhuma mensagem real enviada. |
| Tool sintética `confirmation_required` com kernel real | Sem confirmed: erro confirmation_required; bare `confirmed:true`: aceita sem approval persistida | Guard atual existe, mas bool não prova aprovação vinculada. |
| Step HUMAN_TASK → serializer → compiler → state machine real | Tipo task.human preservado; erro `Unsupported canonical node type: task.human` | Bridge incompatível com runtime. |
| Step WAIT_EVENT → mesmo caminho | Tipo event.wait preservado; erro `Unsupported canonical node type: event.wait` | Bridge incompatível com runtime. |
| `SequelizeProcessInstanceStore` com getSequelize fake null | write/load no mesmo objeto aceita; novo store não retém registro | Persistência implícita em memória quando DB ausente. Não foi simulada queda de DB vivo. |

O script inicialmente temporário `/tmp/legal-security-probe.cjs` foi executado durante a preparação; duas tentativas saíram 1 porque o próprio scaffold lia `compiled.nodesById`/`compiled.graph` em vez do shape real `compiled.executionGraph`. O scaffold foi corrigido pela leitura de `processCanonicalAdapter.js:246`, sem qualquer mudança no produto. A versão final preservada acima passou a coleta e os erros de task.human/event.wait são do runtime real. Nenhuma falha do scaffold foi usada como prova de blocker.

## IDs para a matriz consolidada

Percentuais abaixo expressam fração qualitativa de infraestrutura reutilizável da capacidade, não cobertura de testes, prontidão de segurança ou custo. Os documentos consolidados podem ajustar esses percentuais com a mesma definição. Não somar linhas de capacidades a contagem de blockers; cada ID representa um problema único.

| Capability | Existing implementation | Files | Reuse % | Gap | Required change | Risk | Priority | Dependency | Classification | Status |
|---|---|---|---:|---|---|---|---|---|---|---|
| RAG operacional jurídico | Knowledge Plane + Node RAG + pgvector | `src/core/knowledge-plane/knowledge-router.js:162`; `ragService.js:274`; `vector_store.py:235` | 85 | Taxonomia/provenance/ACL por matter, sensibilidade desacoplada de experiência | Estender corpus/fonte/ACL comuns; nenhuma RAG paralela | Alto, corpus confidencial | P0 | B-LEGAL-RAG-ACL, B-LEGAL-LOG-CONTENT | PRODUCTION | EXTEND |
| Segregação RAG/documentos ponta a ponta | Query segregada; GET documental somente tenant/rag:read | `ragCoreRoutes.js:21/67/90`; `ragDocumentsService.js:252/460/544` | 70 | B-LEGAL-RAG-ACL reproduzido | Policy/ACL no GET original/list/detail/stats/mutações | Crítico | P0 | Classificação/RBAC/Knowledge Plane | PRODUCTION | BLOCKER |
| Approval de ações críticas | Kernel bool confirmation + aprovação versionada de missão engenharia | `tool-registry/index.js:276/701`; `missionApprovalService.js:67/316`; `EngineeringMissionApproval.js:33` | 55 | B-LEGAL-ACTION-APPROVAL; não há approval jurídica vinculada | Contrato de aprovação comum aplicado no kernel/queue/serviço, human-only | Crítico | P0 | RBAC, evidence, durable | PRODUCTION | BLOCKER |
| Espera humana/evento cognitiva | Serializer + Process Runtime existente | `execution-router/index.js:77`; `processStateMachine.js:506` | 70 | B-LEGAL-DURABLE-HITL: tipos não suportados | Corrigir tradução/detecção ao modelo executável; testes integrados | Crítico para prazo/ato | P0 | B-LEGAL-DURABLE-PERSISTENCE, approval | PRODUCTION | BLOCKER |
| Durabilidade da execução | Stores Sequelize com fallback implícito InMemory | `processInstanceStore.js:281/289`; `processExecutionRepository.js:146`; `processCompiledDefinitionRepository.js:136` | 70 | B-LEGAL-DURABLE-PERSISTENCE reproduzido | Fail closed sem DB; stores teste explícitos; prova restart real | Crítico, perda de decisão/prazo | P0 | PostgreSQL, event ledger | PRODUCTION | BLOCKER |
| Canais externos com sender do escritório | WhatsApp/notification/queue core | `tool-registry/index.js:715`; `whatsappService.js:91`; `notificationService.js:136/434` | 75 | B-LEGAL-CHANNEL-TENANT; credencial/sender global no adapter | Reusar ChannelAccount/queue com ownership tenant e approval | Crítico, remetente errado | P0 | B-LEGAL-ACTION-APPROVAL | PRODUCTION | BLOCKER |
| Ingestão segura de arquivos | Busboy + extração PDF/OCR/texto + persistência RAG | `multipartParser.js:16/25`; `ragIngestionRoutes.js:61/99`; `fileExtractionService.js:346` | 65 | B-LEGAL-UPLOAD-LIMIT; limite depois do buffer; scan/quarentena não localizado | Limite streaming, quantidade/tamanho/campos, MIME/quarentena | Alto, DoS/conteúdo inseguro | P0 | Storage, RAG indexing | PRODUCTION | BLOCKER |
| Minimização de conteúdo operacional nos logs/aprendizado | Logger, Cognitive sanitize, adaptive learning JSON | `query.py:470`; `adaptive_learning.py:190/560`; `logger.js:63`; `sanitize.js:21` | 50 | B-LEGAL-LOG-CONTENT, caminho concreto; retenção/acesso sigiloso não provados | IDs/hashes nos logs; conteúdo autorizado no DB; ACL/retenção/deleção | Alto, sigilo/dados pessoais | P0 | Audit/ledger, DB, policy tenant | SUPPORT | BLOCKER |
| Agentes jurídicos | CorporateAgent + Supervisor + perfis genéricos | `CorporateAgent.js:19`; `agent-supervisor/index.js:105/176`; `agent-marketplace/service.js:62` | 80 | Intents/capabilities/outcomes Legal ausentes | Estender core, tools/serviços antes de novos perfis | Alto para ações | P1 | Blockers RAG/approval/durable/canais | PRODUCTION | EXTEND |
| Model routing operacional | AiProviderManager/Service, registry e credenciais tenant | `aiProviderManager.js:233/258`; `aiProviderService.js:860`; `tenantAIService.js:315` | 85 | Engineering router é CODER/REVIEWER; policy jurídica de tarefa/contexto não implementada | Estender política comum de seleção/modelo, sem acionar engenharia na operação | Alto, saída/sigilo | P1 | Policy de dados tenant, provedores | PRODUCTION | EXTEND |
| Jurisprudência verificável | RAG sources/abstention; MCP/integrações core | `query.py:558/577`; `search.py:69`; `mcp/tool-policy.js:194` | 60 | Sem conector judicial/validação de citações | Source adapter e validator de referências/versões com corpus autorizado | Alto, precedente inventado | P1 | RAG, LegalSourceAdapter | PRODUCTION | PARTIAL |
| Auditoria e evidência jurídica | AI Governance, evidence/entity/events, correlation | `ai-governance/service.js:15`; `evidence/routes.js:29`; `requestId.js:27` | 80 | ACL por matter/ator; evidence routes sem RBAC específico; sem prova vazamento técnico | Estender acesso/recurso/approval/evidence refs, reusar ledger/store | Alto, dados do assunto | P1 | Matter/case, RBAC, minimização | SUPPORT | EXTEND |

## Testes existentes sugeridos à coordenação

- Jest RAG/security: `tests/unit/ragDomainRouter.test.js`, `ragAgentSegregation.test.js`, `ragTenantScopeGuard.test.js`, `ragPersistenceRequired.test.js`, `ragResponseCache.test.js`, `cognitiveRagResolver.test.js`.
- Jest principal/agents/tools: `tests/unit/cognitivePrincipal.test.js`, `cognitiveCoreToolRegistry.test.js`, `cognitiveCorePipeline.test.js`, `agentSupervisor.test.js`, `executionRouter.test.js`, `executionRouterDurableRuntime.test.js`, `tests/unit/cognitive/outcomeContracts.test.js`, `processDurableRuntime.test.js`. Atenção: bridge durable usa memória sem DB em teste; não é prova de DB/restart.
- Jest MCP/policy: `tests/unit/mcpHardening.test.js`, `mcpControlPlaneAdversarial.test.js`, `mcpToolPolicy.test.js`, `mcpToolLifecycle.test.js`, `mcpServicePrincipalAuth.test.js`, `tests/unit/governance/policyAsCode.test.js`, `tests/unit/governance/agentPolicyBootstrap.test.js`.
- Python: `rag-service/tests/test_domain_segregation.py`, `test_vector_store_search_sql.py`, `test_global_operational_scope.py`, `test_index.py`, `test_search_retrieve_only.py`, `test_adaptive_learning.py`.
- Runtime/DB: `npm run report:tenant-isolation`; `npm run report:rag-domain-segregation`; gates reais de experiência/visibilidade coordenados pelo root. Não executar ingestão com conteúdo real para provar o bypass; usar fixtures descartáveis e cleanup governado.

## Limites e classificação da evidência

Controles SQL/token/principal têm implementação e testes específicos. A execução do probe não passa por auth real/HTTP/DB vivo nem constitui QA release: ela isola o handler e demonstra que não consulta a policy quando dependências devolvem documento do próprio tenant. A cadeia de mount foi confirmada por inspeção, e os serviços reais não aplicam ACL/domain nos lookups citados. A tool WhatsApp foi real, mas o envio foi fake. Os erros de espera usam serializer+compiler+state machine reais. Persistência usa store real com getSequelize nulo, e demonstra a escolha de Map, sem simular erro transitório de Postgres configurado.

`UNPROVEN`: criptografia de volumes/backups, retenção de conteúdo jurídico, acesso por equipe/matter, egress de provider autorizado, desafio de citações inventadas, resistência universal a prompt injection e ausência universal de leaks no restante do sistema. Não tratá-los como funcionais nem como incidentes automaticamente.

`DOCUMENTATION_DRIFT`: `docs/rag/domain-segregation.md:61` auditor→SUPPORT está desatualizado; query usa Knowledge Plane e não apenas o router legado; `ragResponseCache.js:16` contradiz invalidateTenant:150; bridge human/wait declarada no Execution Router produz tipos ausentes do runtime; teste “durable real” usa fallback em memória. Os arquivos canônicos não foram corrigidos nesta missão, para preservar escopo discovery.
