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
  Medido 2026-10-08: 83 pacotes (todas as dependências diretas npm+PyPI) → **298
  advisories**, 284 com EPSS, 1 KEV; 1653 componentes varridos → **81 achados com
  risco** + 312 avaliações VEX.
- **Release Security Gate** (`npm run validate:security-release-gate`): decide
  GO/NO_GO com exit code real (NO_GO ⇒ exit 1; `SECURITY_GATE_MODE=advisory` ⇒ exit 0
  mantendo a decisão real no relatório). Estado medido: **NO_GO** com 21 bloqueios de
  runtime — `transformers@4.57.6` (11, inclui 1 CRITICAL), `nodemailer@8.0.7` (3),
  `torch@2.9.1+cpu` (2), `uuid` (2), `ws@8.20.0`, `postcss@8.4.49` (2),
  `@modelcontextprotocol/sdk@1.30.0`. 28 achados dev-only ficam como aviso.
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

1. **Triagem dos 21 achados** (decisão humana): 5 são `NO_PATCH` (controle
   compensatório ou waiver com expiração); 5 são bump MINOR Nível B (podem ir a
   missão isolada já); 11 são MAJOR Nível C. Waiver **ainda não existe** como
   tabela — nada é isentado hoje.
2. Registrar o Release Security Gate em `validate:governance-enforcement` — só
   DEPOIS de triar (hoje o registro bloquearia o release; decisão do dono).
3. APIs REST + UI de engenharia (DEVELOPMENT) com segregação testada.
4. Worker de monitoramento contínuo (`api/runtime/startWorkers.js`).
5. Sweep completo (~1400 pacotes ≈ 6 min) + agendamento; testes de falha/resiliência.
6. pgvector: check de integridade já existe; falta planejar 0.6.0 → 0.8.x com
   regressão de ranking híbrido.
