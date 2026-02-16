# Mapeamento de Campos das Telas

Gerado automaticamente em: 2026-02-16T03:12:56.246Z

Total (input/select/textarea): **435**
- Telas (pages): **47 arquivos**
- Componentes com campos: **16 arquivos**

## Telas (pages)

- frontend/src/pages/AgentsPage.jsx (13 campos)
- frontend/src/pages/AIToolsPage.jsx (5 campos)
- frontend/src/pages/AnalyticsPage.jsx (9 campos)
- frontend/src/pages/AuditPage.jsx (3 campos)
- frontend/src/pages/AutomationsPage.jsx (3 campos)
- frontend/src/pages/BackupPage.jsx (2 campos)
- frontend/src/pages/BulkMessagingPage.jsx (4 campos)
- frontend/src/pages/ChannelAccountsPage.jsx (3 campos)
- frontend/src/pages/ChannelHealthPage.jsx (1 campos)
- frontend/src/pages/ChatPage.jsx (1 campos)
- frontend/src/pages/ConfigPage.jsx (16 campos)
- frontend/src/pages/DashboardPage.jsx (2 campos)
- frontend/src/pages/DepartmentsPage.jsx (5 campos)
- frontend/src/pages/DeveloperKeysPage.jsx (1 campos)
- frontend/src/pages/ExportPage.jsx (2 campos)
- frontend/src/pages/FaqManagementPage.jsx (12 campos)
- frontend/src/pages/FlowEditorPage.jsx (3 campos)
- frontend/src/pages/GenerateSystemPage.jsx (18 campos)
- frontend/src/pages/InboxPage.jsx (11 campos)
- frontend/src/pages/KioskPage.jsx (2 campos)
- frontend/src/pages/KnowledgeBasePage.jsx (7 campos)
- frontend/src/pages/MarketingPage.jsx (21 campos)
- frontend/src/pages/MfaPage.jsx (4 campos)
- frontend/src/pages/OnboardingPage.jsx (1 campos)
- frontend/src/pages/OrdersPage.jsx (1 campos)
- frontend/src/pages/PbxPage.jsx (118 campos)
- frontend/src/pages/ProductDocsPage.jsx (7 campos)
- frontend/src/pages/QuickRepliesPage.jsx (8 campos)
- frontend/src/pages/RAGDocumentsPage.jsx (7 campos)
- frontend/src/pages/RbacPage.jsx (4 campos)
- frontend/src/pages/RpaReplaysPage.jsx (5 campos)
- frontend/src/pages/RpaSeedsPage.jsx (2 campos)
- frontend/src/pages/SegmentationPage.jsx (4 campos)
- frontend/src/pages/SlaPoliciesPage.jsx (1 campos)
- frontend/src/pages/SsoScimPage.jsx (2 campos)
- frontend/src/pages/StationPage.jsx (2 campos)
- frontend/src/pages/StorefrontOrderPage.jsx (5 campos)
- frontend/src/pages/SuperAdminPage.jsx (4 campos)
- frontend/src/pages/SupervisorPage.jsx (4 campos)
- frontend/src/pages/SupportPage.jsx (10 campos)
- frontend/src/pages/SystemStatusPage.jsx (2 campos)
- frontend/src/pages/TasksPage.jsx (1 campos)
- frontend/src/pages/TenantsPage.jsx (13 campos)
- frontend/src/pages/TicketMaintenancePage.jsx (6 campos)
- frontend/src/pages/WebScrapingPage.jsx (9 campos)
- frontend/src/pages/WhatsAppIvrPage.jsx (8 campos)
- frontend/src/pages/WhatsAppTemplatesPage.jsx (3 campos)

## Componentes Reutilizáveis

- frontend/src/components/DataGrid.jsx (1 campos)
- frontend/src/components/DevDashboard/DevDashboardHeader.jsx (2 campos)
- frontend/src/components/DevDashboard/FileEditor.jsx (6 campos)
- frontend/src/components/FlowAndRpaTestGeneratorDialog.jsx (7 campos)
- frontend/src/components/FlowCurrentDisplay.jsx (1 campos)
- frontend/src/components/FlowGeneratorDialog.jsx (11 campos)
- frontend/src/components/FlowTemplateSelector.jsx (1 campos)
- frontend/src/components/FlowTestChat.jsx (7 campos)
- frontend/src/components/Login.jsx (2 campos)
- frontend/src/components/LogViewer.jsx (1 campos)
- frontend/src/components/PropertyField.jsx (5 campos)
- frontend/src/components/QueueModal.jsx (3 campos)
- frontend/src/components/RpaConfigDialog.jsx (8 campos)
- frontend/src/components/RpaTestGeneratorDialog.jsx (1 campos)
- frontend/src/components/TenantSelectorModal.jsx (1 campos)
- frontend/src/components/TicketModal.jsx (3 campos)

## Detalhamento - Telas

### frontend/src/pages/AgentsPage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 271 | input | text |  |  |  | {filters.search} | Filtros |
| 284 | select | select |  |  |  | {filters.role} |  |
| 306 | select | select |  |  |  | {filters.status} |  |
| 365 | input | text |  |  |  | {formData.username} |  |
| 379 | input | email |  |  |  | {formData.email} |  |
| 392 | input | text |  |  |  | {formData.name} |  |
| 405 | input | password |  |  |  | {formData.password} |  |
| 421 | select | select |  |  |  | {formData.role} |  |
| 439 | input | checkbox |  |  |  | {formData.active} |  |
| 596 | input | email |  |  |  | {inviteFormData.email} | Email * |
| 606 | input | text |  |  |  | {inviteFormData.name} | Nome |
| 615 | select | select |  |  |  | {inviteFormData.role} | Papel * |
| 675 | input | email |  |  |  | {resetPasswordEmail} | Email * |

### frontend/src/pages/AIToolsPage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 161 | textarea | textarea |  |  |  | {suggestContext.userMessage} |  |
| 174 | textarea | textarea |  |  |  | {suggestContext.conversationHistory} |  |
| 265 | textarea | textarea |  |  |  | {rewriteData.message} |  |
| 278 | select | select |  |  |  | {rewriteData.tone} |  |
| 294 | input | text |  |  |  | {rewriteData.context} |  |

### frontend/src/pages/AnalyticsPage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 608 | select | select |  |  |  | {selectedWindowDays} |  |
| 620 | input | text |  |  |  | {selectedLocationId} |  |
| 629 | select | select |  |  |  | {selectedChannel} |  |
| 1107 | select | select |  |  |  | {selectedOrderHourMetric} |  |
| 1119 | input | number |  |  |  | {hourStart} |  |
| 1133 | input | number |  |  |  | {hourEnd} |  |
| 1314 | select | select |  |  |  | {selectedPhysicalHourMetric} |  |
| 1509 | input | date |  |  |  | {dateRange.startDate} |  |
| 1520 | input | date |  |  |  | {dateRange.endDate} |  |

### frontend/src/pages/AuditPage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 231 | input | text |  |  |  | {filters.username} | Filtros |
| 244 | select | select |  |  |  | {filters.action} |  |
| 265 | select | select |  |  |  | {filters.resource} |  |

### frontend/src/pages/AutomationsPage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 306 | select | select |  |  |  | {definition.trigger \|\| 'manual'} | Gatilho |
| 388 | textarea | textarea |  |  |  |  | Parâmetros (JSON) |
| 417 | textarea | textarea |  |  |  | {form.definitionJson} | Definição (JSON) |

### frontend/src/pages/BackupPage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 85 | textarea | textarea |  |  |  | {JSON.stringify(exportData, null, 2)} |  |
| 96 | textarea | textarea |  |  |  | {importJson} |  |

### frontend/src/pages/BulkMessagingPage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 301 | input | text |  |  |  | {formData.name} |  |
| 313 | textarea | textarea |  |  |  | {formData.message} |  |
| 326 | textarea | textarea |  |  |  | {formData.phoneNumbers} |  |
| 339 | input | number |  |  |  | {formData.rateLimit} |  |

### frontend/src/pages/ChannelAccountsPage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 325 | select | select |  |  |  | {form.type} | Tipo |
| 348 | select | select |  |  |  | {form.status} | Status |
| 379 | textarea | textarea |  |  |  | {form.configJson} | Config (JSON) |

### frontend/src/pages/ChannelHealthPage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 261 | input | checkbox |  |  |  | {autoRefresh} | Alertas (última janela) |

### frontend/src/pages/ChatPage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 159 | select | select |  |  |  | {selectedFlowId \|\| ''} | Fluxo: |

### frontend/src/pages/ConfigPage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 740 | select | select |  |  |  | {displayValue} |  |
| 774 | textarea | textarea |  |  |  | {displayValue} |  |
| 781 | input | {type} |  |  |  | {displayValue} |  |
| 1089 | input | checkbox |  |  |  | {domainConfig?.enabled \|\| false} |  |
| 1337 | select | select |  |  |  | {currentConfig.primary \|\| ''} |  |
| 1364 | select | select |  |  |  | {currentConfig.secondary \|\| ''} |  |
| 1393 | select | select |  |  |  | {currentConfig.model \|\| ''} |  |
| 1427 | input | number |  |  |  | {currentConfig.temperature ?? ''} |  |
| 1449 | input | number |  |  |  | {currentConfig.max_tokens ?? ''} |  |
| 1487 | select | select |  |  |  | {apiKeyProvider} |  |
| 1532 | input | password |  |  |  | {apiKey} |  |
| 1716 | input | checkbox |  |  |  | {editedConfig.features?.aiTasksEnabled \|\| false} | Features |
| 1733 | input | checkbox |  |  |  | {editedConfig.features?.useRealAiApi \|\| false} |  |
| 1766 | input | checkbox |  |  |  | {editedConfig.scripts?.dryRun \|\| false} |  |
| 2172 | input | checkbox |  |  |  | {phoneMaskingEnabled} |  |
| 2201 | textarea | textarea |  |  |  | {jsonText} |  |

### frontend/src/pages/DashboardPage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 570 | input | text |  |  |  | {searchTerm} | Filtros |
| 582 | select | select |  |  |  | {selectedCategory} |  |

### frontend/src/pages/DepartmentsPage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 277 | input | text |  |  |  | {formData.name} |  |
| 289 | textarea | textarea |  |  |  | {formData.description} |  |
| 302 | input | text |  |  |  | {formData.queueNames} |  |
| 315 | input | color |  |  |  | {formData.color} |  |
| 321 | input | text |  |  |  | {formData.color} |  |

### frontend/src/pages/DeveloperKeysPage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 134 | input | checkbox |  |  |  | {includeToken} | Exibir tokens |

### frontend/src/pages/ExportPage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 117 | input | date |  |  |  | {dateRange.startDate} | Período (opcional) |
| 128 | input | date |  |  |  | {dateRange.endDate} |  |

### frontend/src/pages/FaqManagementPage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 519 | input | text |  |  |  | {aiForm.name} |  |
| 531 | textarea | textarea |  |  |  | {aiForm.urlsText} |  |
| 598 | input | checkbox |  |  |  | {checked} |  |
| 644 | input | text |  |  | Buscar por pergunta ou resposta... | {filters.search} | Filtros |
| 656 | select | select |  |  |  | {filters.category} |  |
| 671 | select | select |  |  |  | {filters.status} |  |
| 823 | input | text |  |  |  | {formData.question} |  |
| 836 | textarea | textarea |  |  |  | {formData.answer} |  |
| 850 | input | text |  |  |  | {formData.category} |  |
| 862 | select | select |  |  |  | {formData.status} |  |
| 877 | input | text |  |  |  | {formData.tags} |  |
| 888 | input | checkbox |  |  |  | {formData.autoIndex} |  |

### frontend/src/pages/FlowEditorPage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 1977 | select | select |  |  |  | {flowEnvironment} | Env |
| 2403 | input | text |  |  |  | {sessionId} |  |
| 2571 | input | file |  |  |  |  |  |

### frontend/src/pages/GenerateSystemPage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 3682 | input | checkbox |  |  |  | {bootstrap} |  |
| 3691 | input | checkbox |  |  |  | {generateFlow} | Gerar tudo do zero (Bootstrap) |
| 3701 | input | checkbox |  |  |  | {generateRpa} | Gerar Fluxo |
| 3711 | input | checkbox |  |  |  | {generateSeed} | Gerar Teste RPA |
| 3721 | input | checkbox |  |  |  | {bootstrap ? true : includeQuestions} | Gerar Seed |
| 3731 | input | checkbox |  |  |  | {executeFullValidation} | Incluir perguntas (FAQ) no fluxo |
| 3754 | input | checkbox |  |  |  | {useRag} |  |
| 3766 | input | checkbox |  |  |  | {ragSources.flows} | RAG (interno) |
| 3775 | input | checkbox |  |  |  | {ragSources.qa} | Fluxos |
| 3784 | input | checkbox |  |  |  | {ragSources.docs} | QA |
| 3793 | input | checkbox |  |  |  | {ragSources.uploads \|\| false} | Documentação |
| 3818 | input | file |  | file-upload-input |  |  |  |
| 3958 | input | checkbox |  |  |  | {useWebScraping} |  |
| 4023 | select | select |  |  |  | {descriptionMode} | Modo da sugestão: |
| 4336 | input | radio | executionMode |  |  | dry-run |  |
| 4347 | input | radio | executionMode |  |  | real | DRY-RUN (padrão) |
| 4363 | select | select |  |  |  | {rpaMode} |  |
| 5412 | textarea | textarea |  |  |  | {initialFlowObjectiveDraft} |  |

### frontend/src/pages/InboxPage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 325 | select | select |  |  |  | {statusFilter} |  |
| 337 | select | select |  |  |  | {queueFilter} |  |
| 350 | input | text |  |  |  | {assignedFilter} |  |
| 359 | input | text |  |  |  | {tagFilter} |  |
| 368 | select | select |  |  |  | {channelFilter} |  |
| 382 | input | text |  |  |  | {slaMaxMinutes} |  |
| 390 | input | checkbox |  |  |  | {prioritizeSla} |  |
| 467 | input | text |  |  |  | {assignInput} | Atribuir para |
| 480 | select | select |  |  |  | {transferQueue} | Transferir |
| 490 | input | text |  |  |  | {transferAssigned} |  |
| 503 | textarea | textarea |  |  |  | {noteText} | Notas internas |

### frontend/src/pages/KioskPage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 136 | input | text |  |  |  | {customerIdInput} |  |
| 147 | input | number |  |  |  | {priority} |  |

### frontend/src/pages/KnowledgeBasePage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 248 | input | text |  |  | Buscar por título ou conteúdo... | {filters.search} | Filtros |
| 260 | select | select |  |  |  | {filters.category} |  |
| 373 | input | text |  |  |  | {formData.title} |  |
| 386 | textarea | textarea |  |  |  | {formData.content} |  |
| 399 | input | text |  |  |  | {formData.category} |  |
| 412 | input | text |  |  |  | {formData.tags} |  |
| 423 | input | checkbox |  |  |  | {formData.autoIndex} |  |

### frontend/src/pages/MarketingPage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 397 | input | text |  |  |  | {linkData.name} |  |
| 402 | input | text |  |  |  | {linkData.targetUrl} |  |
| 407 | input | text |  |  |  | {linkData.source} |  |
| 412 | input | text |  |  |  | {linkData.campaign} |  |
| 417 | input | text |  |  |  | {linkData.medium} |  |
| 422 | input | text |  |  |  | {linkData.content} |  |
| 427 | input | text |  |  |  | {linkData.term} |  |
| 432 | input | text |  |  |  | {linkData.code} |  |
| 582 | input | text |  |  | slug | {formData.slug} |  |
| 583 | input | text |  |  | nome | {formData.name} |  |
| 584 | select | select |  |  |  | {formData.status} |  |
| 613 | input | text |  |  | stage | {leadFilters.stage} |  |
| 614 | input | number |  |  | minScore | {leadFilters.minScore} |  |
| 642 | input | text |  |  | nome | {ruleData.name} |  |
| 643 | input | text |  |  | eventType | {ruleData.eventType} |  |
| 644 | input | number |  |  | delta | {ruleData.delta} |  |
| 672 | input | text |  |  | nome | {campaignData.name} |  |
| 673 | input | text |  |  | assunto | {campaignData.subject} |  |
| 674 | textarea | textarea |  |  | corpo texto | {campaignData.bodyText} |  |
| 675 | input | number |  |  | minScore (opcional) | {campaignData.minScore} |  |
| 680 | input | text |  |  | ID da campanha | {sendCampaignId} |  |

### frontend/src/pages/MfaPage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 196 | input | text |  |  |  | {tokenInput} | Token do app autenticador |
| 210 | input | text |  |  |  | {disableToken} | Token |
| 219 | input | text |  |  |  | {disableRecovery} | Recovery code |
| 233 | input | text |  |  |  | {recoveryCode} | Recovery code |

### frontend/src/pages/OnboardingPage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 194 | select | select |  |  |  | {segment} |  |

### frontend/src/pages/OrdersPage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 52 | select | select |  |  |  | {statusFilter} |  |

### frontend/src/pages/PbxPage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 1586 | input | text |  |  |  | {searchText} |  |
| 1691 | input | text |  |  | Ramal | {formExt.extension} |  |
| 1692 | input | text |  |  | Nome | {formExt.displayName} |  |
| 1693 | input | text |  |  | Usuário | {formExt.authUsername} |  |
| 1694 | input | text |  |  | Senha | {formExt.authPassword} |  |
| 1699 | input | checkbox |  |  |  | {!!formExt.provisioningEnabled} |  |
| 1706 | select | select |  |  |  | {formExt.provisioningVendor} |  |
| 1714 | input | text |  |  | MAC (12 hex, ex: 001122AABBCC) | {formExt.provisioningMac} |  |
| 1720 | input | text |  |  | Modelo (opcional) | {formExt.provisioningModel} |  |
| 1728 | select | select |  |  |  | {formExt.aclId} |  |
| 1757 | input | text |  |  | expiresInSec (opcional) | {rotateExpiresInSec} | atualizado: |
| 1795 | input | text |  |  | Ramal | {bulkRow.extension} |  |
| 1796 | input | text |  |  | Nome | {bulkRow.displayName} |  |
| 1797 | input | text |  |  | Usuário | {bulkRow.authUsername} |  |
| 1798 | input | text |  |  | Senha | {bulkRow.authPassword} |  |
| 1800 | input | checkbox |  |  |  | {!!bulkRow.provisioningEnabled} |  |
| 1807 | select | select |  |  |  | {bulkRow.provisioningVendor} |  |
| 1815 | input | text |  |  | MAC (ex: 001122AABBCC) | {bulkRow.provisioningMac} |  |
| 1926 | input | text |  |  | Nome (ex: Telefones VLAN) | {formAcl.name} |  |
| 1932 | input | text |  |  | Descrição (opcional) | {formAcl.description} |  |
| 1939 | input | checkbox |  |  |  | {formAcl.enabled !== false} |  |
| 1953 | textarea | textarea |  |  | {'deny (um por linha, ex):\n0.0.0.0/0'} | {formAcl.deny} |  |
| 1961 | textarea | textarea |  |  | {'permit (um por linha, ex):\n10.10.2.0/24'} | {formAcl.permit} |  |
| 2040 | input | text |  |  | Nome | {formTrunk.name} |  |
| 2041 | select | select |  |  |  | {formTrunk.type} |  |
| 2045 | input | text |  |  | Transport | {formTrunk.transport} |  |
| 2046 | input | text |  |  | Auth username | {formTrunk.authUsername} |  |
| 2047 | input | text |  |  | Auth password | {formTrunk.authPassword} |  |
| 2051 | input | text |  |  | AOR contact (ex: sip:provider.com) | {formTrunk.aorContact} |  |
| 2052 | input | text |  |  | Allow codecs | {formTrunk.endpointAllow} |  |
| 2088 | select | select |  |  |  | {formRoute.direction} |  |
| 2092 | input | text |  |  | Nome | {formRoute.name} |  |
| 2093 | input | number |  |  | Prioridade | {formRoute.priority} |  |
| 2095 | input | checkbox |  |  |  | {!!formRoute.enabled} |  |
| 2098 | select | select |  |  |  | {formRoute.matchMode} |  |
| 2108 | input | text |  |  | Ex: 011 | {formRoute.exactExten} | Número exato: |
| 2113 | input | text |  |  | Ex: 9 | {formRoute.dialPrefix} | Prefixo da discagem: |
| 2117 | select | select |  |  |  | {formRoute.actionType} | Destino: |
| 2125 | select | select |  |  |  | {formRoute.actionRef} | Referência: |
| 2130 | select | select |  |  |  | {formRoute.actionRef} | Referência: |
| 2135 | input | text |  |  |  | (não se aplica) |  |
| 2137 | input | text |  |  | Ex: 1001 | {formRoute.actionRef} |  |
| 2143 | input | number |  |  | Ex: 1 | {formRoute.stripPrefixLen} | Adicionar prefixo: |
| 2145 | input | text |  |  | Ex: 0 | {formRoute.addPrefix} | Adicionar prefixo: |
| 2184 | input | text |  |  | DID (ex: 551199999999) | {formDid.did} |  |
| 2186 | input | checkbox |  |  |  | {!!formDid.enabled} |  |
| 2189 | select | select |  |  |  | {formDid.destinationType} |  |
| 2196 | select | select |  |  |  | {formDid.destinationRef} |  |
| 2201 | select | select |  |  |  | {formDid.destinationRef} |  |
| 2209 | input | text |  |  |  | (não se aplica) |  |
| 2211 | input | text |  |  | Ex: 1001 | {formDid.destinationRef} |  |
| 2245 | input | text |  |  | Nome | {formIvr.name} |  |
| 2246 | input | text |  |  | Context suffix (opcional) | {formIvr.contextSuffix} |  |
| 2248 | input | checkbox |  |  |  | {!!formIvr.enabled} |  |
| 2253 | textarea | textarea |  |  |  | {formIvr.dialplanText} |  |
| 2285 | input | text |  |  | Nome da fila | {formQueue.name} |  |
| 2286 | input | text |  |  | Nome exibido | {formQueue.displayName} |  |
| 2287 | input | text |  |  | Strategy | {formQueue.strategy} |  |
| 2288 | input | number |  |  | timeout | {formQueue.timeout} |  |
| 2289 | input | number |  |  | retry | {formQueue.retry} |  |
| 2290 | input | number |  |  | wrapuptime | {formQueue.wrapuptime} |  |
| 2291 | input | number |  |  | maxlen | {formQueue.maxlen} |  |
| 2322 | select | select |  |  |  | {selectedQueueId} |  |
| 2328 | select | select |  |  |  | {formQm.memberType} |  |
| 2332 | input | text |  |  | memberRef (ex: 1001 ou PJSIP/x) | {formQm.memberRef} |  |
| 2333 | input | text |  |  | penalty | {formQm.penalty} |  |
| 2335 | input | checkbox |  |  |  | {!!formQm.paused} |  |
| 2444 | input | text |  |  |  | {audioKind} |  |
| 2449 | input | file |  |  |  |  |  |
| 2495 | input | checkbox |  |  |  | {!!recordingPolicy.enabled} |  |
| 2502 | input | text |  |  | Retenção (dias) | {recordingPolicy.retentionDays} |  |
| 2508 | input | checkbox |  |  |  | {!!recordingPolicy.maskPhoneNumbers} |  |
| 2516 | input | checkbox |  |  |  | {!!recordingPolicy.requireConsent} |  |
| 2562 | input | text |  |  | limit | {cdrFilters.limit} |  |
| 2563 | input | text |  |  | from (ISO) | {cdrFilters.from} |  |
| 2564 | input | text |  |  | to (ISO) | {cdrFilters.to} |  |
| 2565 | input | text |  |  | src | {cdrFilters.src} |  |
| 2566 | input | text |  |  | dst | {cdrFilters.dst} |  |
| 2567 | input | text |  |  | uniqueid | {cdrFilters.uniqueid} |  |
| 2604 | input | text |  |  | code (ex: ALMOCO) | {formPauseReason.code} |  |
| 2609 | input | text |  |  | descricao | {formPauseReason.description} |  |
| 2615 | input | checkbox |  |  |  | {!!formPauseReason.active} |  |
| 2656 | input | text |  |  | code (ex: INFO) | {formContactReason.code} |  |
| 2661 | input | text |  |  | descricao | {formContactReason.description} |  |
| 2667 | input | checkbox |  |  |  | {!!formContactReason.active} |  |
| 2708 | input | text |  |  | id (opcional) | {formCampaign.id} |  |
| 2713 | input | text |  |  | nome | {formCampaign.name} |  |
| 2718 | input | text |  |  | status | {formCampaign.status} |  |
| 2723 | input | datetime-local |  |  |  | {formCampaign.startAt} |  |
| 2729 | input | datetime-local |  |  |  | {formCampaign.endAt} |  |
| 2736 | input | checkbox |  |  |  | {!!formCampaign.click2callEnabled} |  |
| 2744 | input | checkbox |  |  |  | {!!formCampaign.recordEnabled} |  |
| 2803 | select | select |  |  |  | {ccSelectedCampaignId} |  |
| 2817 | input | text |  |  | DDD (opcional) | {campaignListDraftRow.ddd} |  |
| 2822 | input | text |  |  | Telefone | {campaignListDraftRow.phone} |  |
| 2827 | input | text |  |  | Chave/Identificador (opcional) | {campaignListDraftRow.key} |  |
| 2898 | input | text |  |  | id (opcional) | {formScheduled.id} |  |
| 2903 | input | datetime-local |  |  |  | {formScheduled.scheduledAt} |  |
| 2908 | input | text |  |  | DDD | {formScheduled.ddd} |  |
| 2913 | input | text |  |  | phone (ex: 5511999999999) | {formScheduled.phone} |  |
| 2918 | input | text |  |  | status | {formScheduled.status} |  |
| 2923 | input | text |  |  | descricao | {formScheduled.description} |  |
| 2969 | select | select |  |  |  | {formClick2Call.campaignId} |  |
| 2975 | input | text |  |  | target (ramal/fila) | {formClick2Call.target} |  |
| 2980 | input | text |  |  | DDD | {formClick2Call.ddd} |  |
| 2985 | input | text |  |  | phone (ex: 5511999999999) | {formClick2Call.phone} |  |
| 2998 | input | text |  |  | channel (opcional) | {formClick2Call.channel} |  |
| 3003 | input | text |  |  | context (opcional) | {formClick2Call.context} |  |
| 3008 | input | text |  |  | exten (opcional) | {formClick2Call.exten} |  |
| 3013 | input | number |  |  | priority | {formClick2Call.priority} |  |
| 3019 | input | number |  |  | timeout (ms) | {formClick2Call.timeoutMs} |  |
| 3030 | input | text |  |  | nome | {row.key} | Variáveis (opcional): |
| 3035 | input | text |  |  | valor | {row.value} |  |
| 3097 | select | select |  |  |  | {legacyXmlEntity} |  |
| 3116 | input | text |  |  | ID do item | {legacyXmlDraftId} |  |
| 3130 | input | text |  |  | campo | {row.key} |  |
| 3136 | input | text |  |  | valor | {row.value} |  |
| 3223 | input | text |  |  | janela em horas | {pbxAuditHours} | Atualizado em: |

### frontend/src/pages/ProductDocsPage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 253 | input | text |  |  | Buscar por título ou conteúdo... | {filters.search} | Filtros |
| 265 | select | select |  |  |  | {filters.productId} |  |
| 378 | input | text |  |  |  | {formData.title} |  |
| 391 | input | text |  |  |  | {formData.productId} |  |
| 404 | textarea | textarea |  |  |  | {formData.content} |  |
| 417 | input | text |  |  |  | {formData.tags} |  |
| 428 | input | checkbox |  |  |  | {formData.autoIndex} |  |

### frontend/src/pages/QuickRepliesPage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 240 | select | select |  |  |  | {filters.category} | Filtros |
| 255 | select | select |  |  |  | {filters.tag} |  |
| 270 | input | text |  |  | Buscar por título ou mensagem... | {filters.search} |  |
| 373 | input | text |  |  |  | {formData.title} |  |
| 390 | textarea | textarea |  |  |  | {formData.message} |  |
| 415 | textarea | textarea |  |  |  | {previewVarsText} | Preview (variáveis) |
| 446 | input | text |  |  |  | {formData.tags} |  |
| 458 | select | select |  |  |  | {formData.category} |  |

### frontend/src/pages/RAGDocumentsPage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 2631 | input | text |  |  | Buscar por título, conteúdo ou ID... | {filters.search} | Filtros |
| 2643 | select | select |  |  |  | {filters.domain} |  |
| 2665 | select | select |  |  |  | {filters.source} |  |
| 2680 | select | select |  |  |  | {filters.status} |  |
| 3448 | textarea | textarea |  |  |  | {queryText} |  |
| 4663 | input | text |  |  |  | {editingSynonym.term} |  |
| 4674 | textarea | textarea |  |  |  | {editingSynonym.synonyms.join('\n')} |  |

### frontend/src/pages/RbacPage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 131 | input | text |  |  |  | {assignAgentId} | Agent ID |
| 140 | select | select |  |  |  | {assignRole} | Role |
| 158 | input | text |  |  |  | {newRoleName} | Nome |
| 167 | textarea | textarea |  |  |  | {newRolePermissions} | Permissões (uma por linha: recurso:acao) |

### frontend/src/pages/RpaReplaysPage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 449 | input | text |  |  |  | {searchText} |  |
| 463 | select | select |  |  |  | {filterResult} |  |
| 479 | select | select |  |  |  | {filterDateRange} |  |
| 497 | select | select |  |  |  | {sortBy} |  |
| 925 | select | select |  |  |  | {playbackSpeed} |  |

### frontend/src/pages/RpaSeedsPage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 682 | input | text |  |  |  | {newSeedName} |  |
| 698 | input | text |  |  |  | {newSeedUrl} |  |

### frontend/src/pages/SegmentationPage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 120 | input | text |  |  |  | {filters.tags} | Filtros |
| 131 | select | select |  |  |  | {filters.category} |  |
| 148 | select | select |  |  |  | {filters.status} |  |
| 163 | input | text |  |  |  | {filters.search} |  |

### frontend/src/pages/SlaPoliciesPage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 300 | input | checkbox |  |  |  | {form.enabled} | Ativo |

### frontend/src/pages/SsoScimPage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 101 | textarea | textarea |  |  |  | {ssoJson} |  |
| 109 | textarea | textarea |  |  |  | {scimJson} |  |

### frontend/src/pages/StationPage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 193 | input | text |  |  |  | {stationId} |  |
| 254 | input | text |  |  |  | {transferToQueueId} |  |

### frontend/src/pages/StorefrontOrderPage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 94 | input | text |  |  |  | {customerName} | Nome (opcional) |
| 99 | input | text |  |  |  | {customerPhone} | Telefone/WhatsApp (opcional) |
| 104 | input | text |  |  |  | {address} | Endereço (opcional) |
| 109 | textarea | textarea |  |  |  | {itemsText} | Itens (um por linha, ex.: 2x Pizza) |
| 118 | textarea | textarea |  |  |  | {notes} | Observações (opcional) |

### frontend/src/pages/SuperAdminPage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 231 | input | text |  |  |  | {filters.search} | Buscar |
| 241 | select | select |  |  |  | {filters.status} | Status |
| 254 | select | select |  |  |  | {filters.plan} | Plano |
| 437 | select | select |  |  |  | {impersonateAgentId} | Agente |

### frontend/src/pages/SupervisorPage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 229 | select | select |  |  |  | {groupBy} |  |
| 240 | select | select |  |  |  | {period} |  |
| 251 | input | datetime-local |  |  |  | {from} |  |
| 260 | input | datetime-local |  |  |  | {to} |  |

### frontend/src/pages/SupportPage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 1617 | input | text |  | assign-ticket-input |  | {assignedTo \|\| (agent?.username \|\| agent?.id \|\| '')} |  |
| 1645 | select | select |  |  |  | {quickReplySelectedCategory} | Quick Replies |
| 1720 | textarea | textarea |  | send-message-textarea |  | {messageText} |  |
| 1916 | input | text |  |  |  | {tagInput} |  |
| 2161 | select | select |  |  |  | {selectedCloseReasonId} |  |
| 2180 | input | text |  |  |  | {selectedCloseReasonName} |  |
| 2197 | input | text |  |  |  | {closeTagsInput} |  |
| 2269 | input | tel |  | new-conversation-phone |  | {newConversationPhone} | <label |
| 2292 | select | select |  | new-conversation-queue |  | {newConversationQueue} | <label |
| 2313 | textarea | textarea |  | new-conversation-message |  | {newConversationMessage} | <label |

### frontend/src/pages/SystemStatusPage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 231 | input | checkbox |  |  |  | {autoRefresh} |  |
| 240 | select | select |  |  |  | {refreshInterval} | Auto-atualizar |

### frontend/src/pages/TasksPage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 227 | select | select |  |  |  | {form.priority} | Prioridade |

### frontend/src/pages/TenantsPage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 339 | input | text |  |  |  | {filters.search} | Filtros |
| 352 | select | select |  |  |  | {filters.status} |  |
| 369 | select | select |  |  |  | {filters.plan} |  |
| 429 | input | text |  |  |  | {formData.name} |  |
| 442 | input | url |  |  |  | {formData.site} |  |
| 457 | textarea | textarea |  |  |  | {formData.ramo_atividade} |  |
| 472 | textarea | textarea |  |  |  | {formData.objetivo} |  |
| 571 | select | select |  |  |  | {formData.plan} |  |
| 587 | input | checkbox |  |  |  | {formData.active} |  |
| 641 | textarea | textarea |  |  |  | {contextFormData.ramo_atividade} |  |
| 653 | textarea | textarea |  |  |  | {contextFormData.objetivo} |  |
| 665 | input | url |  |  |  | {contextFormData.site_oficial} |  |
| 678 | select | select |  |  |  | {contextFormData.prioridade} |  |

### frontend/src/pages/TicketMaintenancePage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 360 | input | checkbox |  |  |  | {autoRefresh} |  |
| 501 | input | text |  |  |  | {newQueueName} | Criar Nova Fila: |
| 630 | select | select |  |  |  | {filters.status} | Status: |
| 643 | select | select |  |  |  | {filters.queue} | Fila: |
| 658 | input | text |  |  | ID, telefone, mensagem... | {filters.search} | Buscar: |
| 688 | select | select |  |  |  | {pagination.limit} |  |

### frontend/src/pages/WebScrapingPage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 337 | input | url |  |  |  | {url} |  |
| 350 | textarea | textarea |  |  |  | {urls} |  |
| 383 | input | text |  |  |  | {options.category} | Opções |
| 395 | input | text |  |  |  | {options.tags} |  |
| 407 | input | text |  |  |  | {options.contentSelector} |  |
| 420 | input | text |  |  |  | {options.removeSelectors} |  |
| 433 | input | number |  |  |  | {options.concurrency} |  |
| 448 | input | number |  |  |  | {options.timeout} |  |
| 461 | input | checkbox |  |  |  | {options.autoIndex} |  |

### frontend/src/pages/WhatsAppIvrPage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 121 | input | checkbox |  |  |  | {enabled} |  |
| 133 | input | text |  |  |  | {deptData.name} | Nome |
| 137 | input | text |  |  |  | {deptData.queue} | Fila |
| 140 | input | checkbox |  |  |  | {deptData.enabled} | Ativo |
| 174 | input | text |  |  |  | {ruleData.keyword} | Palavra-chave |
| 178 | select | select |  |  |  | {ruleData.departmentId} | Departamento |
| 187 | input | number |  |  |  | {ruleData.priority} | Prioridade |
| 190 | input | checkbox |  |  |  | {ruleData.enabled} | Ativo |

### frontend/src/pages/WhatsAppTemplatesPage.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 293 | select | select |  |  |  | {statusFilter} |  |
| 310 | select | select |  |  |  | {categoryFilter} |  |
| 327 | select | select |  |  |  | {languageFilter} |  |

## Detalhamento - Componentes

### frontend/src/components/DataGrid.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 82 | select | select |  |  |  | {pageSize} |  |

### frontend/src/components/DevDashboard/DevDashboardHeader.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 48 | input | checkbox |  |  |  | {autoRefresh} |  |
| 57 | select | select |  |  |  | {refreshInterval} | Auto-atualizar |

### frontend/src/components/DevDashboard/FileEditor.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 14 | input | text |  |  |  | null |  |
| 131 | input | checkbox |  |  |  | {value} |  |
| 147 | input | number |  |  |  | {value} |  |
| 163 | textarea | textarea |  |  |  | {String(value)} |  |
| 194 | input | text |  |  |  | {String(data)} |  |
| 371 | textarea | textarea |  |  |  | {fileContent} |  |

### frontend/src/components/FlowAndRpaTestGeneratorDialog.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 322 | textarea | textarea |  |  |  | {description} |  |
| 371 | input | checkbox |  |  |  | {useRag} |  |
| 387 | input | checkbox |  |  |  | {ragSources.includes(source)} | Selecione as fontes: |
| 404 | input | checkbox |  |  |  | {useWebScraping} |  |
| 466 | input | checkbox |  |  |  | {generateRpaTest} |  |
| 480 | select | select |  |  |  | {rpaMode} | Modo de geração: |
| 497 | input | checkbox |  |  |  | {autoResolveDependencies} |  |

### frontend/src/components/FlowCurrentDisplay.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 32 | select | select |  |  |  | {String(kind \|\| displayedFlow?.kind \|\| 'chat').toLowerCase() === 'voice' ? 'voice' : 'chat'} | Tipo: |

### frontend/src/components/FlowGeneratorDialog.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 591 | textarea | textarea |  |  |  | {description} |  |
| 617 | input | checkbox |  |  |  | {useRag} |  |
| 629 | input | checkbox |  |  |  | {ragSourcesFlags.flows === true} | Usar RAG (conhecimento já indexado) |
| 639 | input | checkbox |  |  |  | {ragSourcesFlags.qa === true} | Fluxos |
| 649 | input | checkbox |  |  |  | {ragSourcesFlags.docs === true} | QA |
| 668 | input | checkbox |  |  |  | {useWebScraping} |  |
| 731 | input | checkbox |  |  |  | {includeQuestions} |  |
| 830 | textarea | textarea |  |  |  | {questionsText} |  |
| 922 | input | checkbox |  |  |  | {generateRpaTest} |  |
| 936 | select | select |  |  |  | {rpaMode} | Gerar teste RPA (opcional) |
| 1011 | input | checkbox |  |  |  | {rememberOptions} |  |

### frontend/src/components/FlowTemplateSelector.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 363 | select | select |  |  |  | {scopeFilter} | Escopo: |

### frontend/src/components/FlowTestChat.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 604 | input | checkbox |  |  |  | {ttsEnabled} | 🔊 Voz |
| 637 | input | checkbox |  |  |  | {aiTasksEnabled} | IA Habilitada |
| 795 | input | checkbox |  |  |  |  | <label |
| 819 | input | radio | {`radio-${msg.id} |  |  |  | <label |
| 836 | select | select |  |  |  |  |  |
| 1053 | input | file |  |  |  |  |  |
| 1064 | input | text |  |  |  | {inputText} |  |

### frontend/src/components/Login.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 433 | input | text |  |  |  | {username} |  |
| 471 | input | password |  |  |  | {password} |  |

### frontend/src/components/LogViewer.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 192 | input | checkbox |  |  |  | {autoScroll} |  |

### frontend/src/components/PropertyField.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 124 | input | checkbox |  |  |  | {checked} |  |
| 178 | select | select |  |  |  | {value \|\| ''} |  |
| 963 | select | select |  |  |  | {rule.condition?.op \|\| 'equals'} |  |
| 1023 | select | select |  |  |  | {rule.next \|\| ''} |  |
| 1213 | select | select |  |  |  | {schedule.next \|\| ''} |  |

### frontend/src/components/QueueModal.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 340 | input | checkbox |  |  |  | {autoRefresh} |  |
| 477 | input | text |  |  |  | {assignedTo} |  |
| 497 | textarea | textarea |  |  |  | {messageText} |  |

### frontend/src/components/RpaConfigDialog.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 110 | input | number |  |  |  | {config.slowMo} | Velocidade de Execução |
| 187 | input | hidden |  |  |  | {false} |  |
| 206 | input | number |  |  |  | {config.timeout} |  |
| 221 | input | number |  |  |  | {config.maxRetries} |  |
| 236 | input | number |  |  |  | {config.retryDelay} |  |
| 256 | input | checkbox |  |  |  | {config.stepByStep} | Modo de Execução |
| 280 | input | checkbox |  |  |  | {config.screenshotOnFailure} | Opções Adicionais |
| 295 | input | checkbox |  |  |  | {config.devtools} |  |

### frontend/src/components/RpaTestGeneratorDialog.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 132 | input | checkbox |  |  |  | {autoResolveDependencies} |  |

### frontend/src/components/TenantSelectorModal.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 389 | input | text |  |  |  | {filterText} |  |

### frontend/src/components/TicketModal.jsx

| Linha | Tag | Tipo | Name | ID | Placeholder | Binding | Rótulo próximo |
|---:|---|---|---|---|---|---|---|
| 348 | input | checkbox |  |  |  | {autoRefresh} |  |
| 450 | input | text |  |  |  | {assignedTo} | <div |
| 475 | textarea | textarea |  |  |  | {messageText} |  |
