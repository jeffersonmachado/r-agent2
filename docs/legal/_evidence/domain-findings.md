# Evidência — domínio, banco e reutilização

Data da inspeção: 2026-10-05. Somente discovery/documentação. Testes pesados e gates são coordenados pelo agente principal; resultados atuais estão no registro consolidado, não inferidos da existência de um arquivo de teste.

## Blockers confirmados no código e dependência de Legal

| ID sugerido | Componente / prova | Risco concreto | Condição de desbloqueio |
|---|---|---|---|
| B-LEGAL-CRM-PERSISTENCE | [crm/routes.js](../../../api/modules/crm/routes.js):23-29/192/273: escrita accounts/contacts em Map; leitura contacts DB :220 e Map :228. [registerRoutes.js](../../../api/app/registerRoutes.js):121/255 → [routeRegistry.js](../../../api/app/routeRegistry.js):79 → app.use :269. | Restart perde clientes/empresas escritos nessa API; quando DB disponível, POST contact não é visto na listagem DB. Invariantes de persistência/core compartilhado não atendidos nessa superfície. | CRM delega a MarketingLead/WorkspaceEntity persistidos, reads/writes/IDs consistentes; account vira extensão core persistida quando necessário; DB outage falha. Alternativa DB existe hoje, logo não é MISSING CRM. |
| B-LEGAL-AGENDA-PERSISTENCE | [scheduleService.js](../../../api/services/scheduleService.js):39/45-48/91 Map. Montado [support-debug/routes.js](../../../api/modules/support-debug/routes.js):29/48 e [routeRegistry.js](../../../api/app/routeRegistry.js):70; [tool-registry/index.js](../../../src/core/cognitive/tool-registry/index.js):417/621-628 aponta ao mesmo serviço. | Agenda humana/IA efêmera; tenant ausente vira `default`; disponibilidade HTTP é hardcoded `available:true` ([support-debug/routes.js](../../../api/modules/support-debug/routes.js):62-65). | Convergir serviço/rotas/tools a ResourceBooking/recursos DB ou extensão genérica, provar restart/tenant/conflict/RBAC, sem default implícito. |
| B-LEGAL-DEADLINE-CONFIRMATION | [Task.js](../../../api/db/models/Task.js):15-26 guarda só due_date/status; [scheduleService.js](../../../api/services/scheduleService.js):118-120 confirma sem autoria/base; nenhum LegalDeadline/calendário judicial no inventário. | Sistema atual não diferencia estimativa de prazo confirmado; reutilizar confirm genérico criaria promoção sem revisão humana. | Máquina de estados + aprovação/policy persistida sobre revisão/base, teste negativo IA/payload/concorrência. É blocker de ativação jurídica, não afirmação de que o core deveria conhecer lei hoje. |
| B-LEGAL-SCHEDULER-DELIVERY | [schedulerService.js](../../../api/services/schedulerService.js):70-78 engole enqueue falho e :84-87 avança próxima execução. Worker runtime iniciado [startWorkers.js](../../../api/runtime/startWorkers.js):94-96. | Trigger de alerta pode ser consumido sem job persistido; não é só backlog de funcionalidade judicial. | Transação/outbox/ack entre trigger e enqueue; falha não avança silenciosamente; concorrência/restart/retry comprovados. |
| B-LEGAL-RELATION-TENANT (escopo Task/Booking) | [WorkspaceOperationsService.js](../../../api/services/workspace/WorkspaceOperationsService.js):37-55 cria Task antes do link; :106-129 aceita resource/entity/task IDs sem scoped lookup; [20260429100000-evolve-workspace-production-core.js](../../../api/db/migrations/20260429100000-evolve-workspace-production-core.js):19-39/81-95 sem FKs. | Integridade de relação same-tenant não imposta nesse caminho; ID estrangeiro pode ser registrado e Task parcial pode permanecer se entity link falhar. Não prova exfiltração por si só. | Validação scoped e transação antes da escrita + FKs/unicidade quando apropriado; probes com IDs reais de outro tenant e sem linha parcial. Integrar com revisão de segurança antes de decidir severidade final. |

IDs acima são sugestões para a matriz consolidada; nela podem ser agrupados com findings de segurança/approval para evitar contagem duplicada. `B-LEGAL-DEADLINE-CONFIRMATION` representa prerequisite específico da nova vertical. Project auto-seed é REFACTOR de uma dependência opcional, não blocker global se Matter não usar Project. RAG e canal tenant/HITL são tratados pelos outros reviews, não contados novamente aqui.

## Linhas sugeridas para LEGAL_GAP_MATRIX

Percentuais são estimativa de reaproveitamento funcional, não cobertura medida. Classification é a superfície de uso; jobs/adapters internos continuam com principal próprio e tenancy obrigatória.

| Capability | Existing implementation | Files | Reuse % | Gap | Required change | Risk | Priority | Dependency | Classification | Status |
|---|---|---|---:|---|---|---|---|---|---|---|
| Gestão de clientes | MarketingLead + WorkspaceEntity; CRM HTTP Map | `api/services/marketing/marketingService.js:226`; `api/services/workspace/WorkspaceEntityService.js:67`; `api/modules/crm/routes.js:23` | 75% | CRUD compartilhado efêmero/divergente | Convergir à mesma fonte DB | CRITICAL | P0 | persistência/tenant | PRODUCTION | BLOCKER |
| Processos judiciais | Workspace/Project/Case oferecem contexto, não cadastro judicial | `api/db/models/WorkspaceEntity.js:19`; `api/services/caseService.js:2`; `api/db/models/Project.js:17` | 25% | Tribunal/identificador/sigilo/lifecycle ausentes | Compor Matter e LegalCase com core | HIGH | P1 | clientes/ACL | PRODUCTION | MISSING |
| Movimentações | IntegrationInboundEvent + EventLedger | `api/services/integration/integrationInboundEventService.js:44`; `api/services/eventLedgerService.js:24` | 50% | Registro judicial normalizado/source/revisões ausentes | Importer/perfil relacional e eventos | HIGH | P1 | LegalCase/SourceAdapter | PRODUCTION | EXTEND |
| Documentos | RagDocument/File + artifact/blob store | `api/db/models/RagDocument.js:21`; `api/db/models/RagDocumentFile.js:24`; `lib/artifactStore.js:341` | 75% | Versionamento/matter ACL/source | Extensão documental compartilhada + ACL | CRITICAL | P0 | RAG ACL/tenant/storage | PRODUCTION | BLOCKER |
| Prazos | Task due_date + Bookings/jobs | `api/db/models/Task.js:24`; `api/services/scheduleService.js:118` | 25% | Estados de certeza/calendar/policy inexistentes | Deadline record+human confirm versionada | CRITICAL | P0 | durable approval/fonte | PRODUCTION | BLOCKER |
| Agenda | Agenda Map; Booking DB | `api/services/scheduleService.js:39`; `api/services/workspace/WorkspaceOperationsService.js:118` | 50% | Rotas/tools agenda não persistem | Reaproveitar Booking com service comum | CRITICAL | P0 | persistência/relations | PRODUCTION | BLOCKER |
| Audiências | ResourceBooking/Task | `api/db/models/ResourceBooking.js:9`; `api/modules/workspace/workspace.routes.js:35` | 50% | Tipo judicial/partes/local/approval | Perfil de compromisso e vínculos | HIGH | P2 | agenda/processo | PRODUCTION | EXTEND |
| Perícias | Resource/Availability/Booking | `api/services/workspace/WorkspaceOperationsService.js:92/106/118` | 50% | Relações/documents/confirmed event | Compor recurso+Task+document | HIGH | P2 | agenda/ACL | PRODUCTION | EXTEND |
| Atividades | Task relacional + tasks JSONB + ProjectItem | `api/db/models/Task.js:13`; `api/services/tasksService.js:51`; `api/db/models/ProjectItem.js:17` | 75% | Autoridades de tarefa divergentes, sem update relacional | Consolidar serviços core, links jurídicos | MEDIUM | P1 | persistência/tenant | PRODUCTION | REFACTOR |
| Jurisprudência | Documento+RAG+Evidence | `api/db/models/RagDocument.js:21`; `api/db/models/Evidence.js:21` | 50% | Referência/source-verification ausente | Documento tipado/citação verificada | HIGH | P2 | RAG ACL/source | PRODUCTION | EXTEND |
| Minutas | Documento+geração IA+approval de engenharia como padrão | `api/db/models/RagDocument.js:21`; `api/services/engineeringMission/missionApprovalService.js:67` | 50% | Versão/revisão/approval jurídico não existe | Extensão documental e HITL core | HIGH | P2 | durable HITL/doc versions | PRODUCTION | EXTEND |
| Notificação interna | NotificationDelivery/execution job | `api/services/notificationService.js:421` | 50% | internal é SKIPPED noop | Entrega real/WS/estado/inbox de alerta | HIGH | P1 | scheduler/retry/tenant | PRODUCTION | PARTIAL |
| Scheduler/alertas críticos | Schedule DB, scheduler, queue worker | `api/services/schedulerService.js:70/84`; `api/runtime/startWorkers.js:94` | 75% | Falha de enqueue consumida | Trigger atomic/ack+failure tests | CRITICAL | P0 | DB/job idempotency | PRODUCTION | BLOCKER |
| Source adapters | R-Bridge registry/4 models/provider EVO | `api/services/integration/providerContract.js:30`; `api/services/integration/integrationSyncService.js:37` | 75% | Resource/importer dispatch fixed Fitness | Generalizar registro de recursos/importers | HIGH | P1 | case/movement/provenance | PRODUCTION | EXTEND |
| Project apoio | Project/List/Item/Member | `api/services/projectManagement/projectManagementService.js:305/436` | 50% | GET cria demo e template QA automaticamente | Separar seed DEVELOPMENT e API operacional | MEDIUM | P1 se usado | Project opcional | PRODUCTION | REFACTOR |

## DOCUMENTATION_DRIFT e UNPROVEN

- Documentação/memória fala em CRM completo e agenda reusável; código montado contém Maps e divergência POST/GET. Tratar como DOCUMENTATION_DRIFT quando a matriz citar prontidão genérica de CRM/agenda.
- [AGENTS.md](../../../AGENTS.md) proíbe persistência fallback em memória; as rotas atuais de CRM e scheduleService ainda fazem isso. Não esconder a contradição por serem componentes anteriores à vertical.
- Project GET semeia `Projeto Demo RAP` e template com descrição QA no tenant vazio; [projectManagementService.js](../../../api/services/projectManagement/projectManagementService.js):305-330/436. Não reusar esse comportamento para Matter.
- Os aliases [api/models/Task.js](../../../api/models/Task.js) e os outros dez reexportam `api/db/models`; não existem dois models relacionalmente distintos. A duplicação real é serviço tasks JSONB versus Workspace Task.
- Tests de Schedule explicitamente aceitam tenant `default`: [scheduleService.test.js](../../../tests/unit/scheduleService.test.js):86. PASS desses testes não comprova o invariante constitucional de tenant obrigatório.
- Project unit possui só KPI e validação de nome; schedule/scheduler testam Maps/coerção; notification tests mockam SMTP. Sem prova de law-calendar, matéria/document ACL, related-ID tenant, real SMTP tenant e prazo humano: UNPROVEN.
- `Evidence.confidence/strength` vem de extrator/ranking de textos, não de chain-of-custody jurídico. O storage hash detecta conteúdo diferente, não comprova autoria ou assinatura.

## Comandos/testes sugeridos ao coordenador

Não executar migrations para investigar; usar `db:migrate:status` e wave live DB sob o runtime autorizado. Nenhum comando abaixo é resultado PASS por estar listado.

```text
npx jest tests/unit/caseManagement.test.js tests/unit/scheduleService.test.js tests/unit/schedulerService.coercion.test.js tests/unit/notificationService.test.js tests/unit/taskModuleRoutes.test.js --runInBand
npx jest api/services/__tests__/workspaceCore.test.js api/services/__tests__/projectManagementService.test.js tests/unit/integrationHub.test.js tests/unit/integrationAdversarial.test.js tests/unit/executionQueueBatchClaim.test.js --runInBand
npx jest tests/unit/artifactStorePostgres.test.js tests/integration/ragFileIntegration.test.js tests/integration/tenantRequired.test.js --runInBand
npm run db:migrate:status
npm run wave:db-integrity
npm run report:tenant-isolation
npm run validate:route-mounts
```

Novas provas necessárias em implementação futura: CRM POST→GET→restart com mesmo DB; agenda humana/tool→restart; recurso tenant B recusado em booking A; Task failure não persiste parcialmente; scheduler enqueue falho mantém trigger devido; concorrência confirma prazo só uma vez/revisão vigente; notification internal entrega de verdade; provider tenant correto; original/version hash/approval binding; soft archive/retention. São testes futuros, não adicionados nesta missão.
