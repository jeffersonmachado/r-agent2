# AI_MEMORY — Security Intelligence (versões e vulnerabilidades)

Módulo canônico: `docs/architecture/SECURITY_INTELLIGENCE.md`. Este arquivo é o resumo
operacional; não duplica o doc.

## O que existe (medido, não aspiracional)

- **Inventário real** de componentes/versões em `security_components` (+ histórico em
  `security_component_versions`), coletado por `npm run security:discover`.
  Classes: `DECLARED` / `RESOLVED` / `BUILT` / `RUNNING` — só `RUNNING` diz o que
  executa. Não existe mais "declarado = instalado": `express` está declarado
  `^4.22.1` e resolvido `5.2.1`.
- **SBOM CycloneDX 1.5** determinístico (`npm run security:sbom`), validado antes de
  ser aceito como snapshot; sha256 do documento identifica o snapshot (idempotente).
- **Vulnerabilidades**: `osvConnector` é o ÚNICO ponto com egress de rede;
  `vulnerabilityScanService` correlaciona OFFLINE contra o banco. Resultados em
  `security_findings` + histórico em `security_finding_events`.
  Medido 2026-10-08 (ESCOPO PARCIAL — só dependências **diretas**): 83 pacotes
  (64 npm + 19 PyPI) → **298 advisories**, 284 com EPSS, 1 KEV; 1653 componentes
  varridos → **81 achados com risco** + 312 avaliações VEX; gate **NO_GO com 21
  bloqueios de runtime**.

  Medido 2026-10-08 (ESCOPO COMPLETO — **1125 pacotes instalados**, incluindo
  transitivos; base de 654 advisories): **248 achados com risco** (3 CRITICAL, 118
  HIGH, 108 MEDIUM, 10 LOW, 9 INFORMATIONAL) + **843 avaliações VEX**; plano de
  correção com **108 candidatos** (39 `DIRECT_BUMP`, 60 `TRANSITIVE_OVERRIDE`, 9
  `NO_PATCH`; 79 Nível B, 29 Nível C); gate **NO_GO com 47 bloqueios de runtime e
  131 avisos** (exit 1). O sweep levou 374 s a 5 req/s, com **0 falhas**.

  **Lição medida (não repetir):** correlação com base só de dependências DIRETAS
  subestimou o risco em ~4x (21 → 47 bloqueios). Cobertura parcial não é
  "menos risco", é **menos conhecimento** — a cobertura precisa ser declarada
  junto do número, nunca omitida.
- **Release Security Gate** (`npm run validate:security-release-gate`): decide
  GO/NO_GO com exit code real (NO_GO ⇒ exit 1; `SECURITY_GATE_MODE=advisory` ⇒ exit 0
  mantendo a decisão real no relatório). Estado medido: **NO_GO** — com a base
  parcial eram 21 bloqueios de runtime (`transformers@4.57.6`, `nodemailer@8.0.7`,
  `torch@2.9.1+cpu`, `uuid`, `ws@8.20.0`, `postcss@8.4.49`,
  `@modelcontextprotocol/sdk@1.30.0`); com a base completa são **47 bloqueios de
  runtime** (`@modelcontextprotocol/sdk`, `brace-expansion`, `braces`,
  `extract-zip` entre os primeiros) e 131 avisos dev-only.
- **Índice vetorial** (`npm run security:vector-index`): veredito DEGRADED por
  `vector 0.6.0` < mínimo recomendado; índice HNSW VÁLIDO e em uso.
- **Worker contínuo** (`securityIntelWorker`, registrado em `api/runtime/startWorkers.js`):
  ciclo de 6h (`SECURITY_INTEL_WORKER_INTERVAL_MS`, desligável com
  `ENABLE_SECURITY_INTEL_WORKER=false`) que mantém correlação e plano frescos
  SEM tocar a rede — o egress de sincronização é opt-in
  (`SECURITY_INTEL_SYNC_ADVISORIES=1`, só quando a base está vencida). Ciclo real
  medido: 723 ms. Cadeia de `setTimeout`, nunca `setInterval`. Saúde
  UP/DEGRADED/DOWN visível; parado nunca parece saudável.
- **Patch Engine** (`npm run security:patches`): planeja a correção (menor versão
  corrigida acima da instalada; semântica PATCH/MINOR/MAJOR; Nível B automático em
  ambiente isolado, Nível C exige `--authorized-by`) e consolida por pacote.
  `patch-mission --candidate <key>` submete a missão ao Roteador Engenheiro —
  NUNCA aplica. Estado medido: dos 21 bloqueios, 16 exigem autorização;
  `transformers` (CRITICAL) e `torch` **NÃO são limpáveis por bump** (4 e 1
  advisories sem versão corrigida) ⇒ controle compensatório ou waiver formal com
  expiração.
- Comandos: `security:discover|sbom|inventory|status|vector-index|patches` e
  `node scripts/security-intel.js advisories|scan|patch-mission`.

## Regras que NÃO podem ser relaxadas

1. Versão/faixa não comparável ⇒ `null` (DESCONHECIDO). Nunca "não afetado".
2. Falha de fonte (OSV/KEV/EPSS) ⇒ `failures` + base `DEGRADED`. Falha nunca é
   silenciada como "sem vulnerabilidades". Base vencida é reportada como vencida.
3. Probe ausente ⇒ `unavailable` explícito, nunca componente inventado.
4. Duas cópias físicas do mesmo pacote NÃO são colapsadas; identidade contraditória
   levanta conflito.
5. Estado é Postgres. Nada de JSON como estado (`audit:json-persistence` verde).
6. `MITIGATED` exige waiver vigente; o motor nunca cria waiver.

## Armadilhas medidas (não repetir)

- **CVSS publicado como VETOR** (`CVSS:3.1/AV:N/...`, padrão do GitHub Advisory
  Database) NÃO pode ser ignorado: sem converter para score, todo achado cai na
  severidade assumida (MEDIUM) e um CRITICAL/HIGH **não bloqueia o gate**. Use
  `engine/securityIntel/cvss.js` (`baseScore`, spec FIRST). Vetor inválido devolve
  `null` — nunca score inventado, porque score inventado é decisão de gate inventada.
- **Ecossistema no OSV é case-sensitive**: `PyPI` (não `pypi`). A tradução vive na
  fronteira do conector; ecossistema não mapeado falha ANTES da rede.
- **Número de achados sem o ESCOPO declarado é enganoso** (medido 2026-10-08):
  consultar advisories só das dependências DIRETAS (83 pacotes) deu 81 achados e 21
  bloqueios; consultar os 1125 pacotes INSTALADOS deu **248 achados e 47 bloqueios**.
  Cobertura parcial não é "menos risco", é menos conhecimento. Sempre rode o sweep
  com `--scope installed` e reporte o escopo junto do número.
- **Priorize por exposição real**: dev-only é aviso, não bloqueio
  (`releaseGate.blockOnDevDependencies`). Sem isso o gate vira ruído e o time aprende a
  ignorá-lo.
- O auditor `governance/json-persistence-audit.js` classifica junção de caminho com
  último segmento `.json` como alvo de **escrita** quando não é argumento direto de um
  leitor. Em módulo LEITOR, passe o nome do arquivo como parâmetro — e não escreva o
  literal dentro de comentário (o scanner lê comentário como código: gerou
  `UNKNOWN_JSON_WRITE_TARGET` com o alvo literalmente `algo.json`).
- `resetMocks: true` no `jest.config.cjs` apaga implementações: reestabeleça mocks no
  `beforeEach`.
- Alterar `package.json` neste worktree exige staging por hunk: há WIP de outro agente
  removendo ~30 scripts no mesmo arquivo.
- `RELEASE_SIGNING_KEY`/probes de serviço: rodar `security:*` carrega `.env` pela CLI;
  sem `.env` os probes de Postgres/Redis retornam indisponibilidade (comportamento
  correto, não bug).

## Pendências (ordem de valor)

1. **Triagem dos achados** (decisão humana). No escopo completo são **248 achados**
   (121 de severidade bloqueante; 47 bloqueios de runtime no gate) e **108 candidatos
   de patch**: 39 `DIRECT_BUMP`, 60 `TRANSITIVE_OVERRIDE`, 9 `NO_PATCH`; 79 Nível B e
   29 Nível C. Waiver **ainda não existe** como tabela — nada é isentado hoje.
2. Registrar o Release Security Gate em `validate:governance-enforcement` — só
   DEPOIS de triar (hoje o registro bloquearia o release; decisão do dono).
3. Testes de falha/resiliência do worker e do conector (sobreposição de ciclos,
   falha persistente, restart, sync parcial).
4. Agendamento do sweep `--scope installed` (hoje é manual; o worker NÃO sincroniza
   base por padrão — egress é opt-in).
5. pgvector: check de integridade já existe; falta planejar 0.6.0 → 0.8.x com
   regressão de ranking híbrido.

**Já entregue:** inventário (Fase 1), SBOM, advisories + correlação (Fase 2), Risk
Engine (Fase 3), Patch Engine + ponte com o Roteador (Fase 4), Release Security Gate
com exit real (Fase 5), worker contínuo (Fase 7), check de índice vetorial (Fase 8),
APIs DEVELOPMENT + UI de engenharia (Fase 6) e sweep de cobertura completa (Fase 9a).
