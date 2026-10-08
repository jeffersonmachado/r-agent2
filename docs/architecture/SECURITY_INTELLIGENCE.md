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

### Cadências (recomendadas, ainda não agendadas)

| Cadência | Ação |
|---|---|
| por release | `discover` + `sbom` + `scan` + gate de release |
| diária | `advisories` (sincronizar base) + `scan` |
| semanal | inventário completo + drift + fim de suporte |
| sob nova CVE crítica | `advisories --scope all` + `scan` (sem esperar o ciclo) |

## 6. Evidência medida (2026-10-08)

- Inventário: **1653 componentes** (96 diretos, 1529 transitivos), **816 arestas** de
  dependência, 13 fontes lidas / 0 ausentes, cobertura 100% com 4 limites declarados.
- Drift confirmado: `express` (`^4.22.1` → 5.2.1), `nodemailer` (`^8.0.7` → 9.0.3),
  `pdfjs-dist` (`^4.10.38` → 5.4.624).
- Runtime medido: Node 22.12.0, PostgreSQL 16.15, **pgvector 0.6.0**, Redis 7.0.15,
  Ubuntu 24.04, OpenSSL 3.0.15.
- SBOM: 1653 componentes, 816 arestas, **válido**, persistido (`sha256 b00f482c…`).
- Vulnerabilidades (83 pacotes distintos = todas as dependências diretas npm + PyPI):
  **298 advisories**, catálogo KEV com 1739 CVEs, 284 advisories com EPSS, 1 KEV casado.
  Correlação de 1653 componentes → **81 achados com risco** + **312 avaliações VEX**.
- **Release Security Gate: `NO_GO` (exit 1)** com **21 bloqueios de runtime** e 28
  avisos dev-only:

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
- Testes: **160 asserções em 10 suítes** (`tests/unit/securityIntel/`).

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

1. **Patch Engine** (§8 da missão): candidatos de atualização → missão/task no
   Roteador Engenheiro; nada é aplicado automaticamente.
2. **Registrar o Release Security Gate no agregado**: o gate já existe, decide e sai 1 em
   `NO_GO` (`npm run validate:security-release-gate`), mas **não** foi incluído em
   `validate:governance-enforcement`. Motivo declarado: o estado atual é `NO_GO` por 21
   achados de runtime ainda não tratados — registrá-lo agora bloquearia o release da
   plataforma por decisão que é do dono, não de uma correção isolada (mesmo precedente
   de `validate:layer-conventions`). Ordem correta: triar/mitigar os 21 achados,
   sincronizar a base com sweep completo e SÓ ENTÃO registrar o gate.
3. **Waivers auditáveis** (tabela + expiração + aprovação humana).
4. **APIs REST + UI de engenharia** (DEVELOPMENT) e segregação testada.
5. **Worker de monitoramento contínuo** (`startSecurityIntelWorker` em
   `api/runtime/startWorkers.js`) + métricas e alertas.
6. **Caso PostgreSQL/pgvector** — evidência coletada em 2026-10-08:
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
7. Testes de falha/resiliência da capacidade (concorrência, reinício, fonte fora do ar
   durante scan) e regressão de ranking híbrido pós-atualização de extensão.

## 9. Decisão

- **Release Security Gate: `NO_GO`.** Há 21 achados de runtime com severidade
  `CRITICAL`/`HIGH` abertos (2 CRITICAL). O gate está correto ao reprovar; o trabalho
  pendente é de **correção**, não de ajuste do gate. Nenhuma dependência foi atualizada
  nem nada foi implantado — a decisão de aplicar correções é de produção (Nível C).
- **Capacidade: operacional e comprovada** nas fases 1–2 e nos itens 5 (gate) e 8
  (integridade vetorial) da missão. Restam abertos: Patch Engine, APIs/UI, worker
  contínuo, waivers, sweep completo e os testes de falha/resiliência.
- **Missão integral: `NO-GO`** — os critérios de aceite §21 não estão todos satisfeitos.
  O que existe é verificável, reproduzível e não se declara pronto antes da hora.
