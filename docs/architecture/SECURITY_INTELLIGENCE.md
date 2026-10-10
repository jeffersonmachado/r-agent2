# RAP Version & Security Intelligence

Capacidade permanente de **descobrir, inventariar, avaliar e priorizar** versões e
vulnerabilidades de todos os componentes identificáveis do RAP.

- **Código:** `engine/securityIntel/` (puro) + `api/services/securityIntel/` (I/O)
- **CLI:** `node scripts/security-intel.js <discover|sbom|inventory|status|advisories|scan>`
- **Política declarativa:** `config/security-intel-policy.json`
- **Estado autoritativo:** Postgres (`security_*`) — JSON/artefato é apenas export/evidência
- **Gap fechado:** `governance/governance-maturity.js` declarava `sbom` e
  `dep_provenance` como `pass:false` (LEVEL_5). O SBOM agora existe, é validado e
  persistido com hash.

## 1. Por que esta capacidade existe

O RAP tinha versões **declaradas** (`AI_MEMORY/stack-versions.md`, sincronizado por
`scripts/stack-versions.js`) mas não tinha versões **efetivamente instaladas e em
execução**, nem correlação com vulnerabilidades publicadas. Declarado ≠ executado: o
inventário real mediu `express` declarado `^4.22.1` e resolvido `5.2.1`.

A capacidade existe para responder com evidência: *o que temos*, *o que está rodando*,
*o que isso significa em risco* e *de quando é essa informação*.

## 2. Arquitetura

```
CONTROL PLANE (única saída de rede)      LOCAL SCANNING PLANE (offline)
─────────────────────────────────        ──────────────────────────────────
osvConnector.js                          componentDiscoveryService.js
  OSV  /v1/query                           lockfiles, requirements, compose,
  CISA KEV (catálogo)                      runtime do host, probes de serviço
  FIRST EPSS (lote)                              ↓
        ↓                                 inventoryStoreService.js (Postgres)
security_advisories (normalizado,               ↓
  faixas afetadas em JSONB)               vulnerabilityScanService.js
        └──────────────────────────────►   correlação × Risk Engine
                                                ↓
                                          security_findings (+ _events)
```

**Módulos puros** (`engine/securityIntel/`, sem I/O, relógio ou aleatório):

| Módulo | Responsabilidade |
|---|---|
| `versionCore.js` | comparação SemVer 2.0.0, PEP 440, tuplas *coarse* de imagem; matching de faixas OSV (`introduced`/`fixed`/`last_affected`/`limit`) e comparator sets |
| `componentIdentity.js` | PURL, `bom-ref` canônico, fingerprint estrutural, UUID determinístico |
| `sbomBuilder.js` | geração e **validação** de SBOM CycloneDX 1.5 |
| `advisoryModel.js` | normalização de advisory e avaliação de aplicabilidade |
| `riskEngine.js` | priorização com fatores auditáveis |

**Serviços de I/O** (`api/services/securityIntel/`): `manifestReaders` (leitura das
fontes), `componentDiscoveryService` (orquestra fontes + probes + drift), `probes`
(Postgres/Redis/RAG/Docker), `inventoryStoreService` (persistência idempotente),
`sbomService`, `osvConnector`, `vulnerabilityScanService`.

## 3. Contratos inegociáveis

1. **Quatro classes de versão** — `DECLARED` (o que o manifesto pede), `RESOLVED` (o
   que o lockfile instalou), `BUILT` (imagem construída localmente), `RUNNING` (o que
   está em execução). Divergência entre elas é *drift* registrado, não ruído.
2. **Não comparável ≠ não afetado.** `compareVersions`/`matchesComponent` devolvem
   `null` (DESCONHECIDO) quando não é possível concluir. Nenhum caminho converte
   "não sei comparar" em "seguro".
3. **Probe ausente é indisponibilidade explícita.** Fonte que não pôde ser lida entra
   em `coverage.failed`/`unavailable` — nunca vira "inventário completo".
4. **Falha de fonte não é ausência de vulnerabilidade.** Falha de OSV/KEV/EPSS vai
   para `failures` e a base fica `DEGRADED`; a idade da base acompanha o relatório e
   base vencida é marcada como tal.
5. **Identidade não colapsa cópias distintas.** Duas instalações físicas do mesmo
   pacote (hoisted e aninhada) são componentes diferentes; identidade contraditória
   levanta conflito em vez de ser deduplicada em silêncio.
6. **Nenhuma escrita de JSON como estado.** Estado é Postgres; `audit:json-persistence`
   fica verde (`unknown=0`).
7. **Waiver nunca é criado pelo motor.** `MITIGATED` só existe com waiver vigente.

## 4. Dados

Migrations: `20261008190000-create-security-intelligence-core.js`,
`20261008210000-create-security-vulnerability-core.js`.

| Tabela | Papel |
|---|---|
| `security_components` | identidade corrente (única por `tenant_key` + `bom_ref`) |
| `security_component_versions` | histórico append-only das versões observadas por classe |
| `security_discovery_runs` | execução da coleta + cobertura + indisponibilidades + drift |
| `security_sbom_snapshots` | SBOM + SHA-256 (idempotente por tenant+hash) |
| `security_advisories` | advisory normalizado (faixas afetadas; KEV/EPSS com timestamp) |
| `security_advisory_syncs` | sincronização da base (hash do snapshot, idade, falhas) |
| `security_findings` | achado corrente (severidade, estado, prioridade, fatores, razão) |
| `security_finding_events` | histórico append-only (DETECTED/STATUS_CHANGED/RESOLVED) |

## 5. Operação

```bash
npm run security:discover      # coleta o inventário e persiste
npm run security:sbom          # gera/valida/persiste o SBOM CycloneDX
npm run security:inventory     # resumo do inventário persistido
npm run security:status        # idade da informação (coleta e SBOM)
npm run security:vector-index  # integridade do índice vetorial (RAG/pgvector)
npm run validate:security-release-gate   # decisão GO/NO_GO de release (exit 1 em NO_GO)

node scripts/security-intel.js advisories --limit 200 --rate 5   # OSV + KEV + EPSS
node scripts/security-intel.js scan --scope installed|direct|running
```

Modo do gate: `SECURITY_GATE_MODE=advisory` (ou `--informative`) mantém exit 0 mas o
relatório guarda a decisão REAL — advisory ≠ aprovado. Tenant do gate:
`SECURITY_GATE_TENANT` (default `system`).

Relatórios: `reports/security-intel-discovery-report.json`,
`reports/security-intel-report.json`, `reports/security-intel-advisories-report.json`,
`reports/security-intel-scan-report.json`,
`reports/security-intel-vector-index-report.json`,
`reports/security-release-gate-report.json` (com lineage); artefato:
`reports/security-intel/sbom-<sha>.cdx.json`.

### Como fazer a triagem (runbook)

Triagem é uma **decisão humana**. O que a capacidade oferece é a fila pronta: não
existe comando que "resolva" a triagem, e nenhum deles aplica correção em produção.

```bash
# 0) Frescor primeiro: base vencida (ou plano antigo) invalida a fila.
#    O ciclo completo em UMA entrada (ordem fixa, falha para o ciclo):
bash scripts/security-intel-sweep.sh                 # com egress (atualiza a base, ~6 min)
bash scripts/security-intel-sweep.sh --no-egress      # sem rede (~15 s medidos)
#    log fora do workspace: ~/.local/state/ragent2-security-intel/sweep-<ts>.log
#    Equivalente manual (se preferir passo a passo):
node scripts/security-intel.js advisories --scope installed --rate 5   # só se a base estiver velha
node scripts/security-intel.js scan --scope installed                  # correlação (offline)
node scripts/security-intel.js patches                                 # regenera candidatos

# 1) Fila de decisão: 3 buckets, com motivo, chaves reais e comando por pacote
node scripts/security-intel.js triage
#    -> reports/security-intel-triage.md (leitura humana) + .json (evidência)
```

Ciclo semanal sugerido (o egress é deliberado, fora da janela de release):

```cron
# domingo 03:17 UTC — o mesmo horário da atualização das waves técnicas
17 3 * * 0 cd /opt/results/ria/r-agent2 && bash scripts/security-intel-sweep.sh >> $HOME/.local/state/ragent2-security-intel/cron.log 2>&1
```

Como `systemd --user` (alternativa ao cron, com unidade própria):

```ini
# ~/.config/systemd/user/security-intel-sweep.service
[Service]
Type=oneshot
WorkingDirectory=/opt/results/ria/r-agent2
ExecStart=/usr/bin/bash scripts/security-intel-sweep.sh
```

```ini
# ~/.config/systemd/user/security-intel-sweep.timer
[Timer]
OnCalendar=Sun 03:17
Persistent=true
[Install]
WantedBy=timers.target
```

`reports/security-intel-triage.md` traz, por pacote: versão atual → alvo, advisories
(sem correção), risco da atualização, **quantos achados bloqueantes abertos** o pacote
resolve, por que aquele bucket, o **candidato recomendado** (o alvo que limpa todos os
advisories), os achados sem correção publicada e o **comando exato**. A ordem já é a ordem
de decisão: KEV primeiro, depois o que não tem remédio, depois o que exige aprovação, e
dev-only por último.

Duas leituras que o relatório força a fazer direito: (1) a cobertura da fila é medida por
**pacote** contra os bloqueios do gate (medido em 2026-10-09: **16 de 16** pacotes
bloqueadores estão na fila — nenhum ficou fora), porque o gate conta bloqueio por achado ×
cópia física e o inventário conta achado, e subtrair as duas contagens produziria uma
lacuna inventada; (2) pacotes puramente dev-only podem não ter candidato (a política decide
se o plano os cobre) e, nesse caso, não aparecem na fila.

O impacto por pacote conta apenas achado de **runtime**: achado em dependência dev-only é
exibido separado (`+N em dependência dev-only`) e nunca somado, porque dev-only não bloqueia
quando a política manda tratá-lo como aviso. Com essa separação as duas medidas independentes
passam a **concordar** (2026-10-09: a fila endereça 47 achados bloqueantes e o gate conta 47
bloqueios) — o relatório declara a concordância quando ela existe; ele nunca subtrai uma
contagem da outra.

| Bucket na fila | Decisão humana | Ação |
|---|---|---|
| **Sem correção publicada** (5 pacotes) | aceitar com controle compensatório **e registrar com prazo**, ou achar alternativa (trocar/remover a dependência, elevar o pacote pai) | `node scripts/security-intel.js waive --finding "<chave do achado>" --days <≤ máximo> --reason "<motivo>" --control "<controle>"` |
| **Exige aprovação humana** (4 pacotes) | autorizar a missão (Nível C) ou postergar com justificativa | `node scripts/security-intel.js patch-mission --candidate "<candidato recomendado>"` |
| **Missão isolada** (19 pacotes) | disparar a missão (roda em ambiente isolado com testes; **não** aplica em produção) | `node scripts/security-intel.js patch-mission --candidate "<candidato recomendado>"` |

Depois de cada ação, confirme o efeito medido (não a intenção):

```bash
node scripts/security-intel.js waivers          # isenções vigentes (como aprovador e prazo)
node scripts/security-intel.js patches          # candidatos restantes
npm run validate:security-release-gate          # decisão e contagem de bloqueios (exit 1 em NO_GO)
```

Regras de método: (1) se o contador de bloqueios não cair, a ação não resolveu — investigue
antes de registrar waiver; (2) waiver sem prazo, sem aprovador identificado ou para achado
que não é risco aberto é **recusado** pelo serviço; (3) revogar é sempre possível e devolve o
achado ao risco aberto; (4) dev-only não bloqueia release (é aviso) — trate por último.
Interface equivalente para triagem item a item: `/dev/security-intel` (filtros por
severidade/KEV, linha do tempo por achado, a **fila de triagem** com o comando pronto de
cada pacote e a seção de waivers para isentar/revogar). A fila exibida na tela vem do mesmo
serviço do CLI — não existe uma segunda fila calculada no frontend.

O seletor de achado da seção de waivers não é uma lista "dos primeiros N": ele é montado por
`frontend/src/shared/securityIntel/waiverOptions.js` em dois grupos. O primeiro, *Exigem
decisão (fila de triagem)*, traz **todos** os achados dos buckets que exigem decisão humana,
derivados da mesma fila, e continua completo mesmo quando a lista da API vem cortada ou o
usuário digita um filtro (o filtro estreita só o segundo grupo). Quando a API devolve menos
itens do que declara existir, a tela **diz o número** ("500 de 1091 achados abertos
carregados") em vez de truncar em silêncio; o mesmo vale para o inventário (25 linhas
exibidas) e para a tabela da fila (40 grupos). Tabelas com corte de EXIBIÇÃO declaram o corte;
nenhuma decisão da fila depende de estar dentro do corte.

### Cadências — o que é automático hoje

O **worker de monitoramento contínuo** (`api/services/securityIntel/securityIntelWorker.js`,
registrado em `api/runtime/startWorkers.js`) executa a cada 6h
(`SECURITY_INTEL_WORKER_INTERVAL_MS`, piso 60s; desligável com
`ENABLE_SECURITY_INTEL_WORKER=false`) um ciclo de **723 ms** medido:

1. sincronização da base de advisories — **só se** `SECURITY_INTEL_SYNC_ADVISORIES=1`
   **e** a base estiver vencida (egress é opt-in: o worker não toca a rede por padrão);
2. correlação inventário × advisories;
3. regeneração do plano de correção;
4. escalonamento (log de erro + `security_finding_events`) quando surge achado
   KEV/`CRITICAL`/`HIGH` novo.

Saúde do worker é **UP/DEGRADED/DOWN** e falha é visível — um monitor parado não pode
parecer saudável. Cadeia de `setTimeout` (nunca `setInterval`): o próximo ciclo só é
agendado depois que o anterior termina.

| Cadência | Situação |
|---|---|
| contínua (6h) | **automática** pelo worker — correlação + plano |
| por release | `discover` + `sbom` + `validate:security-release-gate` (manual no pipeline) |
| diária | sincronizar base: ligar `SECURITY_INTEL_SYNC_ADVISORIES=1` ou cron |
| semanal | inventário completo + drift + fim de suporte (a agendar) |
| sob nova CVE crítica | rodar `advisories --scope all` + `scan` sem esperar o ciclo |

## 6. Evidência medida (2026-10-08)

- Inventário: **1653 componentes** (96 diretos, 1529 transitivos), **816 arestas** de
  dependência, 13 fontes lidas / 0 ausentes, cobertura 100% com 4 limites declarados.
- Drift confirmado: `express` (`^4.22.1` → 5.2.1), `nodemailer` (`^8.0.7` → 9.0.3),
  `pdfjs-dist` (`^4.10.38` → 5.4.624).
- Runtime medido: Node 22.12.0, PostgreSQL 16.15, **pgvector 0.6.0**, Redis 7.0.15,
  Ubuntu 24.04, OpenSSL 3.0.15.
- SBOM: 1653 componentes, 816 arestas, **válido**, persistido (`sha256 b00f482c…`).
- Vulnerabilidades — **dois escopos medidos, e o escopo importa**:
  - ESCOPO PARCIAL (só dependências diretas, 83 pacotes distintos = 64 npm + 19
    PyPI): **298 advisories**, catálogo KEV com 1739 CVEs, 284 com EPSS, 1 KEV
    casado; 1653 componentes → **81 achados com risco** + **312 avaliações VEX**.
  - ESCOPO COMPLETO (1125 pacotes **instalados**, inclui transitivos; base de **654
    advisories**): **248 achados com risco** (3 CRITICAL, 118 HIGH, 108 MEDIUM, 10
    LOW, 9 INFORMATIONAL) + **843 avaliações VEX**; plano de correção com **108
    candidatos** (39 `DIRECT_BUMP`, 60 `TRANSITIVE_OVERRIDE`, 9 `NO_PATCH`; 79
    Nível B, 29 Nível C). Sweep de 374 s a 5 req/s com **0 falhas**
    (`reports/security-intel-advisories-report.json`).
  - **Lição**: a base só de diretos subestimou o risco em ~4x. Número de achados
    sem o escopo declarado é um número enganoso.
- **Release Security Gate: `NO_GO` (exit 1)** com **47 bloqueios de runtime** e 131
  avisos dev-only no escopo completo (o escopo parcial dava 21 bloqueios e 28
  avisos). Bloqueios do escopo PARCIAL, que permanecem no completo — este último
  acrescenta `@modelcontextprotocol/sdk`, `brace-expansion`, `braces` e
  `extract-zip` entre os primeiros:

  | Pacote | Serviço | Advisories | Severidade |
  |---|---|---|---|
  | `transformers@4.57.6` | rag-service | 11 | 1 CRITICAL + HIGH |
  | `nodemailer@8.0.7` | api | 3 | HIGH |
  | `torch@2.9.1+cpu` | rag-service | 2 | HIGH |
  | `postcss@8.4.49` | (ferramenta) | 2 | HIGH |
  | `uuid@9.0.1`, `uuid@8.3.2` | api | 2 | HIGH |
  | `ws@8.20.0` | api | 1 | HIGH |
  | `@modelcontextprotocol/sdk@1.30.0` | mcp | 1 | HIGH |

  O caso `nodemailer@8.0.7` **converge com o drift** detectado na Fase 1: a cópia
  8.0.7 é vulnerável e convive com a 9.0.3 em outro lugar da árvore.
- Verificação do índice vetorial: **DEGRADED** (só por `vector 0.6.0` < mínimo
  recomendado 0.8.0); índice HNSW **VÁLIDO**, planner **usa** o índice, 8460 chunks com
  0 nulos e 0 dimensões erradas.
- Dossiê de triagem (`node scripts/security-intel.js triage` →
  `reports/security-intel-triage.json` + `.md`): fila de decisão com motivo e comando
  por pacote, em três buckets. Medido 2026-10-09: 28 pacotes na fila (19 isolados,
  4 exigem aprovação humana, 5 sem correção publicada). Transformação pura
  (`engine/securityIntel/triageDossier.js`), sem I/O e com `now` injetado.
- Waivers de risco (`security_waivers` + `waiverService`): isenção FORMAL e
  TEMPORÁRIA. PROVA end-to-end contra o banco real (2026-10-08, em achado NÃO
  bloqueante para que a decisão de release não mudasse em nenhum instante): waiver
  criado ⇒ achado vira `MITIGATED` com `waiver_id` vinculado ⇒ gate reporta 1 waiver
  vigente e **mantém os mesmos 47 bloqueios** ⇒ revogação ⇒ achado volta a risco
  aberto e 0 waivers vigentes (`AI_MEMORY/evidence/security-intel/waiver-proof-2026-10-09.json`).
  A tabela nasce VAZIA: nada é isentado hoje. Regras recusadas por construção:
  expiração ausente/passada/prazo acima de `maxWaiverDays`, motivo sem substância,
  solicitante ausente e tentativa de isentar achado que não é risco aberto (VEX ou
  resolvido). A prova também revelou um defeito real: a criação não era atômica e
  uma falha ao gravar o evento deixava **isenção sem trilha** — hoje cada transição
  roda em transação.

  **Duas etapas desde 2026-10-10** (`requestWaiver` → `approveWaiver`): solicitar
  registra `PENDING_APPROVAL` e **não mitiga nada**; aprovar exige OUTRO ator
  (segregação de funções), o mesmo `scope_hash` do escopo pedido (alteração de
  pacote/serviço/severidade/prazo invalida a aprovação) e vence o CAS
  `PENDING_APPROVAL → ACTIVE` — aprovação concorrente ou replay perde a corrida em
  vez de mitigar duas vezes. A identidade de ambos os lados é derivada do contexto
  autenticado; declarar aprovador no corpo é recusado
  (`approval_identity_not_accepted`).
- Testes: **336 casos em 23 suítes** (`tests/unit/securityIntel/` + `api/modules/security-intel/`).
  **5 de resiliência** (`resilience.test.js`): ciclos **nunca se sobrepõem** (ciclo
  lento em andamento não deixa o próximo disparar), erro de ciclo é **capturado**
  (sem unhandled rejection que derrubaria a API) e o worker **continua tentando**,
  falha persistente derruba a saúde para `DEGRADED` com **recuperação** após um
  sucesso, `stop` cancela o agendamento de verdade (**nenhum ciclo fantasma**), e
  falha na sincronização da base **não é memorizada como base fresca**.
- Rotas HTTP: `api/modules/security-intel/routes.test.js` (6 casos) prova 401 anônimo,
  403 para ator PRODUCTION mesmo declarando classificação na query, 400 quando o
  tenant não é resolvível, 200 com risco separado de evidência VEX e 503 em falha de
  persistência.

### 6.1 Defeitos reais encontrados e corrigidos nesta fase

1. **Ecossistema PyPI não consultado** — o OSV exige `PyPI` (caixa exata) e o inventário
   é canônico em minúsculas: **nenhum** advisory do Python era obtido (400 `invalid
   ecosystem`). A falha era registrada (base `DEGRADED`), o que evitou o falso "sem
   vulnerabilidades". Só apareceu ao passar de 40 pacotes npm para 83 (npm + PyPI).
2. **CVSS publicado como VETOR → severidade subestimada → gate aprovava o que devia
   barrar.** O GitHub Advisory Database publica `CVSS:3.1/AV:N/...`; o normalizador só
   aceitava número, então todo achado caía para a severidade assumida (`MEDIUM`) e um
   `CRITICAL`/`HIGH` **não bloqueava o release**. Agora `engine/securityIntel/cvss.js`
   implementa o cálculo oficial da base (spec FIRST) com valores de referência testados
   (9.8 / 7.5 / 5.3 / 10.0). Prova: antes da correção o gate dizia `GO`; depois, `NO_GO`.
3. **Priorização sem exposição real** — achado de dependência *dev-only* bloqueava igual
   a risco de runtime. Agora dev-only é **aviso** (política
   `releaseGate.blockOnDevDependencies`, default `false`), com o flag `dev` vindo do
   inventário: `ws@8.18.3` (dev) não bloqueia enquanto `ws@8.20.0` (runtime) bloqueia —
   porque **cópias físicas distintas não são colapsadas**.
   A versão do Python em execução no serviço não é medida (lacuna registrada).
4. **Tela não alcançava as decisões (medido em 2026-10-08, com 1091 achados abertos)** —
   o seletor de achado da seção de waivers cortava a lista em 50 itens e a API devolvia no
   máximo 100: apenas **4 dos 35** achados de decisão humana eram selecionáveis; os outros
   **31** (nodemailer inteiro, uuid, basic-ftp, pytest, torch, sprintf-js, braces,
   extract-zip, a maior parte de transformers) só existiam pela CLI. A tela parecia completa
   porque o corte era silencioso. Correção: a seleção passa a ser derivada da **fila** pelo
   módulo puro `frontend/src/shared/securityIntel/waiverOptions.js` (bucket de decisão sempre
   completo, filtro que nunca remove decisão, limite da API **declarado** em vez de omitido),
   com regressão em `waiverOptions.test.js`. Verificado no browser: **35/35** alcançáveis.
5. **Dois números do mesmo painel contavam coisas diferentes (medido em 2026-10-08)** — a
   tabela de achados dizia "1091 achados abertos" enquanto o KPI dizia "248 achados abertos
   (risco)": **843 registros (77%) já haviam sido descartados por VEX** (`NOT_AFFECTED` /
   `FALSE_POSITIVE`) e continuavam contados/rotulados como abertos. No mesmo painel, o filtro
   *Somente KEV* devolvia **4** achados (todos `INFORMATIONAL` descartados por VEX) enquanto o
   KPI *Achados em KEV* dizia **0** — o usuário não tinha como saber qual número valia.
   A leitura do gate sempre foi a de risco (exclui VEX); a listagem não. Correção: a definição
   virou **uma constante só** (`VEX_EXCLUDED_STATUSES`), usada pelo resumo e pelo filtro
   `riskOnly` da listagem (KPI e tabela não podem divergir), com regressão em
   `tests/unit/securityIntel/findingsRiskOnly.test.js` (inclui a asserção de que o resumo e o
   filtro consomem **a mesma instância** da lista, não cópias literais). A tela mostra os dois
   números e mantém os descartados auditáveis por um toggle explícito: 248 em risco aberto,
   843 descartados por VEX, 1091 registrados — a soma fecha. Verificado no browser.
6. **Histórico de achado sem DATA (medido em 2026-10-08)** — o painel mostrava
   "— — Correção disponível · systemadmin": o serviço devolvia a linha crua do ORM, que
   expõe o carimbo como `createdAt` (o modelo usa `timestamps` + `underscored`), enquanto a
   tela lia `created_at`. O evento aparecia com data vazia — num recurso cujo propósito é
   responder "quando este risco apareceu, quem aceitou e por quê". Correção: `getFindingTimeline`
   normaliza e expõe `at` explícito (`null` quando não há carimbo — nunca uma data inventada),
   com regressão nos dois sentidos em `findingsRiskOnly.test.js`. Varredura da mesma classe em
   toda a tela: só restou `row.expires_at`, que o modelo de waiver declara explicitamente.
   Verificado no browser: `08/10/2026, 20:37:41 — Correção disponível · systemadmin`.
7. **A missão de correção não EXECUTAVA — HTTP 500 no INSERT (medido em 2026-10-09, executando a
   primeira missão de verdade)** — clicar *Executar* devolvia
   `22001 value too long for type character varying(255)`: `engineering_tasks.title` é
   varchar(255) e o orquestrador colocava ali o **objetivo inteiro** da missão (`objective` é
   `text`). Missão criada à mão tem objetivo curto e passava; a missão de segurança carrega o
   texto completo da spec (restrições + pré-condições) e estourava a coluna — a execução morria
   **antes de começar**. Correção em `missionOrchestratorService.buildTaskContract`: o título é
   RÓTULO (primeira linha, limitado a 255; usa o `title` da spec quando existe) e o texto
   completo continua em `objective`; regressão em `taskContractTitleLength.test.js` (6 casos).
8. **Todo patch era rejeitado por AUSÊNCIA de escopo (mesma medição)** — a task ia a RED com
   `NO_PATCH_SCOPE`: o coder produzia o patch **certo** (bump no `package.json`, 271/358 chars) e
   o validador o recusava porque o spec não declarava `allowedPaths` — e no Roteador escopo vazio
   NUNCA significa "tudo permitido" (ER-V1-FINAL-003), significa "nenhum patch é aceitável".
   Consequência: **a capacidade não corrigia nenhuma vulnerabilidade sozinha**. Correção: a
   correção declara o escopo mecanicamente (`dependencyScopeOf`: manifesto+lock do serviço;
   `rag-service/requirements.txt` no PyPI) e uma lista de caminhos **proibidos** (governança,
   gates, política de roteamento, CI, migrations, config, segredos) que o próprio boundary
   aplica; regressão em `patchMissionScope.test.js` (7 casos, com o `checkPathBoundary` real).
   Declarar nas opções da missão **não bastava**: o compilador só herda `allowedPaths` de uma
   versão anterior (`previousSpec ? previousSpec.allowedPaths : []`), então o escopo passou a
   entrar como NOVA VERSÃO do spec pelo caminho do operador ("Editar e aprovar") com
   `approveEdited: false` — aplicar escopo **nunca** aprova. Regressão: 3 casos novos em
   `patchMissionBridge.test.js` (inclui "aplicar escopo nunca aprova" e falha explícita com o
   `missionId`). Prova no browser: contrato exibido com `package.json package-lock.json` e
   `npm run test:unit`; as **duas** tentativas seguintes validaram com `ok=true` (`APPLIED`).
9. **O aceite não pode passar: a suíte do serviço está vermelha (estado de 2026-10-09)** — com
   o patch válido e aplicado, a task vai para `TESTING` e reprova porque `npm run test:unit`
   falha. Enquanto a suíte do serviço não estiver verde, **nenhuma missão chega a GREEN** e o
   caminho autônomo não fecha achado nenhum — o gate de segurança continua `NO_GO`. Medido
   também um **falso verde** na própria suíte: um teste que `require`-ia um script CLI executava
   `main()` e `process.exit(0)`, matando o Jest no meio — o run terminava **sem** `Test Suites:` e
   com **código de saída 0** mesmo com 13 suítes falhando (`--bail=0`). Guard
   `require.main === module` obrigatório em scripts requeridos por teste.10. **O ACEITE da missão era insatisfazível no ambiente em que roda (medido em 2026-10-09)** — duas
   causas independentes: (a) o worktree isolado **não herda estado** (`.env`, `api/data`,
   `reports` são ignorados/untracked), então a suíte do serviço reprova ali **com a árvore
   limpa**; (b) o deadline de UM comando de teste no Runner é a política `INTEGRATION_TEST`
   (**120 s**), enquanto `npm run test:unit` leva ~9 min. Resultado: missões com patch **válido**
   morriam em `TESTING` e o histórico do repositório era **1 GREEN em 75 aprovações** — não por
   qualidade de patch. Correção em duas partes (decisão explícita do dono):
   **(1) semear o estado** no worktree (`patchApplyService.seedWorkspaceState`: cópia de `.env`,
   `api/data`, `reports` — **cópia, nunca symlink**, porque symlink gravável para o repositório é
   o defeito ER-V1-FINAL-001; falha ao semear não derruba a materialização);
   **(2) aceite escopado**: prova MECÂNICA do alvo aplicado (o pacote resolvido tem versão
   ≥ alvo) + comando funcional que cabe no deadline (`npm run test:flow`, medido em 30 suítes /
   264 testes / 40 s). **Correção de uma afirmação desta própria seção (medida em 2026-10-09):**
   esses 264 testes são a medição **fora** do sandbox; **dentro** dele o comando ficava vermelho
   por `EACCES` no workspace — ver item 13. `test:flow` no workspace sandboxado mede
   45–47 s / 264 testes depois da correção de permissão.
   O que NÃO muda: a suíte completa e os gates de selo/release seguem obrigatórios no pipeline
   (`validate:governance-enforcement`, `npm run test:unit` humano/CI); o que muda é o que uma
   missão de **bump de dependência** precisa provar. O fechamento do achado não é afirmado pela
   missão: quem mede é o **Release Security Gate**, que re-escaneia e deixa de contar o achado
   como aberto. Limitação declarada: `frontend` não tem suíte executável no workspace isolado
   (`frontend/node_modules` não existe lá, e symlink gravável é proibido) — o sinal funcional do
   frontend é o núcleo determinístico compartilhado.
   Regressões: `patchMissionAcceptance.test.js` (7 casos) e `workspaceStateSeeding.test.js`
   (5 casos).
11. **O comando de prova não cabia no registro de execução (medido em 2026-10-09)** —
   `engineering_test_runs.command` é **varchar(255)** e a prova mecânica inline (`node -e`) tinha
   ~300 caracteres: o INSERT falhava com `22001 value too long for type character varying(255)` e
   o comando era gravado como **REJECTED sem nunca rodar** — a missão reportava uma falha de
   aceite que não aconteceu. Correção: `scripts/security-intel-verify-target.js` (comando de
   61–76 caracteres) e regressão que exige **todo** comando de aceite ≤ 255 chars
   (`patchMissionAcceptance.test.js`).
12. **A prova do aceite media a árvore errada (medido em 2026-10-09)** — a versão `installed` lia
   `node_modules`, que no workspace isolado é bind **READ-ONLY** do repositório do host
   (`executionSandbox`, `--network=none`): nenhum patch de dependência pode alterar aquela árvore,
   então a prova reprovaria **todo** patch correto — e "mediria" o host, não a correção. A prova
   passou a medir o **grafo declarado** (`package.json`: `overrides`/`dependencies` +
   `package-lock.json`), que é exatamente o que `allowedPaths` da missão declara, com
   `--expect=override|direct` vindo do **tipo** da correção (override transitivo exige entrada
   durável em `overrides`; lock editado à mão volta no próximo `npm install`), corroboração do
   lock (cópia resolvida abaixo do alvo ⇒ `NOT_APPLIED`) e fail-closed mantido (declaração não
   avaliável ⇒ `INCOMPARABLE`, nunca sucesso). `--source=installed` continua disponível para
   verificação **no host**, depois de `npm ci`.
13. **Escrita no workspace negada ao UID do sandbox (medido em 2026-10-09)** —
   `ensureWorkspaceReadableBySandbox` concedia apenas LEITURA (`go+rX`) embora o próprio docstring
   afirmasse "legível/gravável": o container roda com UID fixo **10001** e o worktree pertence ao
   UID do host. Testes que **gravam** no workspace falhavam com
   `EACCES: permission denied, mkdir '<workspace>/replays/simulation'`
   (`engine/__tests__/functionalFlows.test.js`) e derrubavam `npm run test:flow` **dentro** do
   sandbox — a mesma árvore fora dele passa **30/30 suítes, 264 testes, exit 0**. Correção:
   `ensureWorkspaceWritableBySandbox` concede `rwX` **exatamente ao UID do sandbox** via ACL
   (`setfacl` + default ACL para o que os testes criarem depois) e cai para `go+rwX` onde não há
   ACL; nunca altera o bit de execução do dono (único rastreado pelo git). Regressão:
   `sandboxWorkspaceWritePermission.test.js` (5 casos).

**Lacunas declaradas abertas (bloqueiam fechar achados; nenhum limiar de gate as resolve):**

- **O patch de dependência COMPLETO não é producível hoje.** O coder emite **apenas diff** (sem
  shell), o sandbox roda `--network=none` (sem registry) e `node_modules` é read-only. Medido:
  com `overrides` fora do lock, `npm ci` **falha** (`EUSAGE`, exit 1) — ou seja, o patch
  "só declaração" quebra o install do CI/release, e o lock **não pode** ser regenerado offline.
  Enquanto não existir um passo governado de materialização do lock (host, com rede) ou um cache
  npm pré-aquecido com a versão alvo, o aceite reprova **corretamente** e a missão de dependência
  não fecha.
- **As missões são materializadas a partir da `main`** (`missionSourceService`, `sourceRef='main'`;
  branch de missão é recusada como origem — `MISSION_SOURCE_REF_INVALID`). Medido em 2026-10-09: a
  `main` (`594dce8d`) **não contém** `engine/securityIntel/`, `api/services/securityIntel/` nem
  `scripts/security-intel*` — toda esta capability vive em
  `mission/engineer-router-memory-hardening-20261008` (42 commits à frente; `main` 0 atrás). Por
  isso o workspace da missão falha em `Cannot find module
  '<workspace>/scripts/security-intel-verify-target.js'`: **nenhum aceite que dependa de arquivo do
  repositório funciona antes desta capability estar na linha principal.** Enquanto isso não
  acontecer, o Patch Engine não fecha achado nenhum, e o gate de release construído a partir da
  `main` não inclui o `validate:security-release-gate`.

**Prova de que o aceite é satisfazível quando o artefato está COMPLETO (medido em 2026-10-09)** —
num worktree do commit da fase, com o mesmo script e o mesmo `engine/securityIntel/versionCore`:

1. `overrides` declarado e lock intocado ⇒
   `ALVO NAO APLICADO: lockfile ainda resolve js-yaml@4.3.1 < 4.3.2
   (packages[node_modules/cosmiconfig/node_modules/js-yaml])` (exit 1) — o caminho exato da cópia
   vulnerável, não um "falhou" genérico;
2. `npm install --package-lock-only --ignore-scripts` **executado no host** (com rede) ⇒ exit 0,
   diff final de 2 arquivos (`package.json` + `package-lock.json`, +22/−35);
3. prova ⇒ `ALVO DECLARADO: js-yaml js-yaml=^4.3.2 lock[4.3.2] >= 4.3.2` (exit 0) **e**
   `npm run test:flow` ⇒ **30/30 suítes, 264 testes, exit 0**.

Conclusão: a lacuna do lock é de **quem produz o lock**, não do critério de aceite — o aceite
distingue corretamente "declarado sem materializar" de "materializado".

- Docker local pode não conter as imagens de produção: nesse caso a lacuna é
  registrada em vez de assumir que o local representa o deploy.
- A base de advisories cobre apenas os pacotes já consultados (`advisories --limit`).
  Scan sobre pacote não consultado resulta em "sem achados", que NÃO é "sem
  vulnerabilidade" — a idade/escopo da base precisa ser lida junto do resultado.
  O inventário é canônico em minúsculas (`pypi`), e a tradução para o nome do provedor
  (`PyPI`) acontece na fronteira do conector — outros ecossistemas (Maven, Go, Debian)
  ainda **não** são traduzidos e falham explicitamente antes da rede.
- Achados de dependência **dev-only** não bloqueiam o release por padrão (são avisos):
  eles não vão a produção. Isso é política declarada, não omissão — e é auditável em
  `releaseGate.blockOnDevDependencies`.
- **Waivers ainda não existem** (tabela pendente): nada é isentado hoje. Como a
  política exige expiração, um waiver futuro sem data continuará **não** isentando.

## 8. Pendências (não implementadas nesta fase)

1. **Patch Engine** — implementado (Fase 4). Planeja e persiste candidatos e, com
autorização, submete missão ao Roteador Engenheiro; nunca aplica. O que falta é a
   **triagem humana** dos candidatos de Nível C e a execução das missões.

   Plano real dos 21 bloqueios (consolidado por pacote):

   | Pacote | Alvo recomendado | Advisories | Sem correção | Veredito |
   |---|---|---|---|---|
   | `transformers` 4.57.6 | 5.10.0 | 10 | **4** | **REQUER AÇÃO HUMANA** (Nível C) |
   | `torch` 2.9.1+cpu | 2.10.0 | 2 | **1** | **REQUER AÇÃO HUMANA** (Nível C) |
   | `nodemailer` 8.0.7 | 10.0.6 | 3 | 0 | limpo por bump MAJOR (Nível C) |
   | `uuid` 8.3.2 | 11.1.1 | 2 | 0 | limpo por bump MAJOR (Nível C) |
   | `postcss` 8.4.49 | 8.5.18 | 2 | 0 | limpo por bump MINOR (Nível B) |
   | `@modelcontextprotocol/sdk` 1.30.0 | 1.31.0 | 1 | 0 | limpo por bump MINOR (Nível B) |
   | `ws` 8.20.0 | 8.21.0 | 1 | 0 | limpo por bump MINOR (Nível B) |

   **Conclusão operacional:** `transformers` (CRITICAL) e `torch` **não são limpáveis
   por atualização** — 4 e 1 advisories respectivamente não têm versão corrigida
   publicada. Isso exige controle compensatório ou **waiver formal com expiração**,
   não um bump. É a diferença entre "atualizar dependências" e "aceitar risco com
   registro".
2. **Registrar o Release Security Gate no agregado**: o gate já existe, decide e sai 1 em
   `NO_GO` (`npm run validate:security-release-gate`), mas **não** foi incluído em
   `validate:governance-enforcement`. Motivo declarado: o estado atual é `NO_GO` por 47
   achados de runtime (com a base de advisories completa) ainda não tratados —
   registrá-lo agora bloquearia o release da plataforma por decisão que é do dono, não
   de uma correção isolada (mesmo precedente de `validate:layer-conventions`). Ordem
   correta: triar/mitigar os achados e SÓ ENTÃO registrar o gate.
3. **Agendamento do sweep** `--scope installed` (hoje é manual; o egress do worker é
   opt-in por decisão de segurança).
4. **Caso PostgreSQL/pgvector** — evidência coletada em 2026-10-08:
   - `vector 0.6.0` instalado (2 *minors* atrás das correções de HNSW/README de
     0.7+/0.8.x); PostgreSQL 16.15.
   - O índice vetorial existente é **HNSW** (`rag_chunks_embedding_hnsw_idx`,
     `vector_cosine_ops`, 15 MB).
   - **O índice está VÁLIDO** (`indisvalid/indisready/indislive = true`), o planner
     **usa** o HNSW para ordenação vetorial, e os embeddings estão íntegros:
     8460 chunks, **0 nulos, 0 com dimensão diferente de 384**.
   - Conclusão honesta: **a corrupção relatada NÃO se reproduz neste banco**.
     Afirmar "corrupção corrigida" seria fabricação. O risco real é de
     *versão* + *ausência de verificação* — não há check de integridade de índice
     vetorial em nenhum gate.
   - Próximo passo de maior valor: (a) coletar a verificação de integridade do
     HNSW (`indisvalid`, `vector_dims`, contagens) como check permanente da
     capacidade; (b) planejar a atualização de `vector` 0.6.0 → 0.8.x em ambiente
     isolado com regressão do ranking híbrido (vetorial + lexical + fusão RRF +
     filtros multi-tenant) antes de qualquer mudança em produção.
   - **BASELINE PRÉ-UPGRADE ESTABELECIDA** (2026-10-09) em
     `AI_MEMORY/evidence/security-intel/pgvector-upgrade-baseline-2026-10-09.json`:
     ambiente (0.6.0, PostgreSQL 16.15, 384 dimensões medidas = esperadas), índice HNSW
     `isValid/isReady/isLive = true` com planner **usando** o índice, 8460 chunks com
     **0 nulos e 0 dimensões erradas**, e a regressão de ranking híbrido
     (vetorial + lexical + RRF + **isolamento multi-tenant contra o banco real**) em
     **20 passed / 0 skipped / 0 failed** (26 s). Nota de método: os 4 testes de
     isolamento **eram pulados** por falta de `DATABASE_URL` no ambiente do pytest — a
     baseline só é completa quando eles rodam; o comando agora carrega o `.env`.
     **Critério de comparação após o upgrade:** mesmo comando, e o upgrade NÃO é
     validado se houver qualquer `failed`, se `passed` cair de 20, se aparecer skip por
     ambiente, ou se mudar qualquer eixo do índice (validade, nulos, dimensões,
     planner). Isso é pré-requisito técnico; a decisão de trocar a extensão continua
     sendo de produção.
   - **BLOQUEIO REAL NOMEADO** (verificado em 2026-10-09 pelo check
     `node scripts/governance/check-pgvector-upgrade-readiness.js`, evidência em
     `reports/pgvector-upgrade-readiness.json`): o servidor de banco **só oferece a
     versão 0.6.0** (`pg_available_extension_versions`); a 0.8.0 **não está instalada
     nem disponível**. Ou seja: o upgrade não é executável aqui — exige instalar o
     pacote da extensão no host do banco, fora do fluxo automático. E, como pgvector
     **não suporta downgrade**, o rollback é restaurar backup (`scripts/backup-postgres.sh`),
     nunca `ALTER EXTENSION UPDATE TO <versão antiga>`.

**Entregues nesta capacidade (com prova):** inventário de componentes, SBOM CycloneDX,
advisories + correlação (sweep de 1125 pacotes instalados), Risk Engine, Patch Engine +
ponte com o Roteador, Release Security Gate com exit real, APIs DEVELOPMENT + UI de
engenharia (segregação provada em teste e em HTTP real), worker contínuo, check de
integridade do índice vetorial, testes de falha/resiliência (5 casos) e **waivers
auditáveis com expiração obrigatória** — no CLI, na API e na UI (jornada validada em
browser real: isentar e revogar pela tela).

## 9. Matriz de aceitação (área → prova → estado)

Cada linha declara **o que foi provado**, não o que foi escrito. Estado possível:
`SATISFEITO`, `SATISFEITO COM RESSALVA` (funciona, com limite declarado),
`PENDENTE — DECISÃO` (depende de humano) ou `PENDENTE — TRABALHO`.

| Área | Prova medida | Estado |
|---|---|---|
| Inventário de componentes/versões | 1653 componentes (96 diretos, 1529 transitivos), 816 arestas, 13 fontes lidas / 0 ausentes, cobertura 100% com 4 limites declarados; classes DECLARED/RESOLVED/BUILT/RUNNING | SATISFEITO |
| SBOM | CycloneDX 1.5, 1653 componentes, **válido**, persistido (`sha256 b00f482c…`), geração idempotente por conteúdo | SATISFEITO |
| Descoberta de vulnerabilidades | OSV + catálogo KEV (1739 CVEs) + EPSS; base de **654 advisories**; sweep de **1125/1125 pacotes instalados** a 5 req/s em 374 s com 0 falhas; ciclo completo em UMA entrada (`scripts/security-intel-sweep.sh`, com log fora do workspace) e cadência semanal documentada (cron/systemd) | SATISFEITO (a cadência é documentada, não agendada pelo repo: egress é deliberado e fora da janela de release) |
| Correlação e triagem automática (VEX) | 248 achados com risco (3 CRITICAL, 118 HIGH, 108 MEDIUM, 10 LOW, 9 INFORMATIONAL) + 843 avaliações VEX em 966 ms, offline e idempotente | SATISFEITO |
| Avaliação de risco auditável | CVSS oficial (spec FIRST, **vetor convertido**, nunca assumido), KEV, EPSS, exposição por serviço e classe de versão; fatores e rationale persistidos por achado | SATISFEITO |
| Evidência e reprodutibilidade | `security_findings` + `security_finding_events` append-only, timeline por achado, SBOM versionado por sha256, toda medição com evidência em `AI_MEMORY/evidence/security-intel/` | SATISFEITO |
| Plano de correção | 108 candidatos (39 DIRECT_BUMP, 60 TRANSITIVE_OVERRIDE, 9 NO_PATCH), autonomia Nível A/B/C explícita; ponte com o Roteador Engenheiro só cria missão (nada aplica correção) e a fiação foi provada por teste com dublês (spec com contexto real do achado, idempotência por candidato, Nível C recusado antes de compilar, autoria registrada). Recusas também provadas em HTTP real (403/404) | SATISFEITO COM RESSALVA (nenhuma missão real foi submetida e a aplicação é decisão de produção/Nível C) |
| Gate de release | `validate:security-release-gate` decide e **sai 1** em NO_GO: 47 bloqueios de runtime + 131 avisos dev-only | SATISFEITO COM RESSALVA (não registrado no agregado — decisão do dono) |
| API de engenharia + segregação | 14 rotas DEVELOPMENT em 13 caminhos; 401 anônimo, 403 para ator PRODUCTION (mesmo com classificação na query), 400 sem tenant resolvível; `visibility-policy` PASS, `route-mounts` 62/62 | SATISFEITO |
| UI de engenharia | Página `/dev/security-intel` (menu DEVELOPMENT) validada em browser real: KPIs, tabelas, alerta de índice vetorial e jornada de waiver (isentar/revogar) | SATISFEITO |
| Monitoramento contínuo | Worker de 6 h sem egress por padrão, ciclo real de 723 ms, escalonamento de achado novo KEV/CRITICAL/HIGH; DEGRADED após 3 falhas e recuperação | SATISFEITO |
| Resiliência | 5 testes: ciclos nunca se sobrepõem, erro de ciclo capturado (sem unhandled rejection), falha persistente → DEGRADED com recuperação, restart limpo, sync parcial não memorizado | SATISFEITO |
| Waivers auditáveis | Tabela + serviço + scan + gate + CLI + API + UI; expiração obrigatória (NOT NULL), recusa de isenção sem substância/aprovador e de achado que não é risco aberto; prova end-to-end contra o banco real | SATISFEITO (nada isentado: 0 waivers vigentes) |
| Fila de triagem | `triage` → 28 pacotes (19 isolados, 4 exigem aprovação humana, 5 sem correção publicada), com motivo, impacto medido, candidato recomendado e comando pronto; a **mesma** fila vem do serviço único `triageService` para o CLI, a API (`GET /api/security-intel/triage`) e a UI | SATISFEITO |
| Triagem das 248 achados | Dossiê pronto; **a decisão é humana** e ainda não foi tomada | PENDENTE — DECISÃO |
| Registro do gate no agregado | Não registrado de propósito: hoje bloquearia o release da plataforma por decisão que é do dono | PENDENTE — DECISÃO |
| Índice vetorial (pgvector) | `vector 0.6.0` < 0.8.0 recomendado ⇒ **DEGRADED**; HNSW VÁLIDO, planner **usa** o índice, 8460 chunks com 0 nulos / 0 dimensões erradas. **Baseline pré-upgrade estabelecida** (regressão de ranking híbrido + isolamento multi-tenant: 20 passed / 0 skipped / 0 failed) com critério objetivo de comparação, e **bloqueio medido**: o servidor só oferece 0.6.0 — a 0.8.0 precisa ser instalada no host do banco (`check-pgvector-upgrade-readiness.js`) | PENDENTE — INFRA (fora do repo: instalar o pacote da extensão; sem downgrade, o rollback é backup) |
| Atualização de runtime/extensão | Nenhuma atualização foi aplicada: a validação de uma atualização exige ambiente isolado e regressão (o Patch Engine já emite a missão com pré-condições e comandos de teste) | PENDENTE — TRABALHO |

## 10. Decisão

- **Release Security Gate: `NO_GO`.** Com a base de advisories completa (1125 pacotes
  instalados) há **248 achados com risco** (3 `CRITICAL`, 118 `HIGH`) e **47 bloqueios
  de runtime** no gate. O gate está correto ao reprovar; o trabalho pendente é de
  **correção**, não de ajuste do gate. Nenhuma dependência foi atualizada nem nada foi
  implantado — a decisão de aplicar correções é de produção (Nível C).
- **Capacidade: operacional e comprovada** nas fases 1–10 da missão (inventário, SBOM,
  advisories, Risk/Patch Engine, gate, APIs/UI de engenharia, worker contínuo,
  integridade vetorial, sweep de cobertura completa, resiliência, waivers auditáveis e
  fila de triagem). Restam abertos: **triagem dos achados** (decisão humana), **registro
  do gate no agregado** (decisão do dono) e o **caso pgvector 0.6.0 → 0.8.x** (trabalho
  em ambiente isolado, com regressão de ranking híbrido).
- **Missão integral: `NO-GO`** — os critérios de aceite §21 não estão todos satisfeitos
  (nenhuma correção de produção foi aplicada e a triagem é decisão humana pendente).
  O que existe é verificável, reproduzível e não se declara pronto antes da hora.
