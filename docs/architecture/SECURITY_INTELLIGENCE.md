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

node scripts/security-intel.js advisories --limit 40 --rate 4   # OSV + KEV + EPSS
node scripts/security-intel.js scan --scope direct|running      # correlação offline
```

Relatórios: `reports/security-intel-discovery-report.json`,
`reports/security-intel-report.json`, `reports/security-intel-advisories-report.json`,
`reports/security-intel-scan-report.json`; artefato:
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
- SBOM: 1653 componentes, 816 arestas, **válido**, persistido (`sha256  b00f482c…`).
- Vulnerabilidades (40 pacotes diretos consultados no OSV): **62 advisories**, catálogo
  KEV com 1739 CVEs, 55 advisories com EPSS; correlação de 96 componentes →
  **35 achados MEDIUM com correção disponível** + 66 avaliações `NOT_AFFECTED` (VEX).
  Reexecução não duplica eventos (idempotente).
- Testes: **110 asserções em 7 suítes** (`tests/unit/securityIntel/`).

## 7. Limites conhecidos (declarados, não escondidos)

- Inventário cobre: lockfiles npm (raiz e frontend), `requirements.txt` do RAG,
  4 arquivos compose, runtime do host e probes de Postgres/Redis/RAG/Docker.
- **Fora do inventário:** firmware/hardware, hosts remotos, pacotes de sistema DENTRO
  das imagens (só conhecidos quando a imagem está local), SaaS de terceiros.
- O RAG `/health` não publica versão da aplicação Python: só o modelo de embedding.
  A versão do Python em execução no serviço não é medida (lacuna registrada).
- Docker local pode não conter as imagens de produção: nesse caso a lacuna é
  registrada em vez de assumir que o local representa o deploy.
- A base de advisories cobre apenas os pacotes já consultados (`advisories --limit`).
  Scan sobre pacote não consultado resulta em "sem achados", que NÃO é "sem
  vulnerabilidade" — a idade/escopo da base precisa ser lida junto do resultado.

## 8. Pendências (não implementadas nesta fase)

1. **Patch Engine** (§8 da missão): candidatos de atualização → missão/task no
   Roteador Engenheiro; nada é aplicado automaticamente.
2. **Release Security Gate** bloqueante: existe a política
   (`config/security-intel-policy.json > releaseGate`), falta o gate executável
   integrado ao agregado `validate:governance-enforcement`.
3. **Waivers auditáveis** (tabela + expiração + aprovação humana).
4. **APIs REST + UI de engenharia** (DEVELOPMENT) e segregação testada.
5. **Worker de monitoramento contínuo** (`startSecurityIntelWorker` em
   `api/runtime/startWorkers.js`) + métricas e alertas.
6. **Caso PostgreSQL/pgvector**: `pgvector 0.6.0` está instalado (2 minors atrás das
   correções de HNSW/concorrência de 0.7+/0.8.x). Investigação de causa raiz da
   "corrupção de índice" **não concluída** — é o próximo item de maior valor.
7. Testes de falha/resiliência da capacidade (concorrência, reinício, fonte fora do ar
   durante scan) e regressão de ranking híbrido pós-atualização de extensão.

## 9. Decisão

Capacidade **operacional e comprovada** nas fases 1–2 (inventário, SBOM, inteligência
de vulnerabilidades, risco). As fases 3–8 permanecem **abertas**, portanto o critério
de "GO definitivo" da missão **não** está satisfeito: o veredito honesto é
**NO-GO para a missão completa**, com trabalho verificado e reproduzível já entregue.
