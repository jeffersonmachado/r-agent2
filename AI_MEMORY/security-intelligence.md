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
- Comandos: `security:discover|sbom|inventory|status` e
  `node scripts/security-intel.js advisories|scan`.

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

1. Caso pgvector — **medido em 2026-10-08: NÃO há corrupção neste banco**.
   `vector 0.6.0`, índice `rag_chunks_embedding_hnsw_idx` (HNSW,
   `vector_cosine_ops`, 15 MB) com `indisvalid/indisready/indislive = true`, o
   planner USA o índice, e 8460 chunks com 0 nulos / 0 dimensões erradas (384).
   Não existe check de integridade de índice vetorial em nenhum gate. Próximo
   passo: (a) transformar a medição em check permanente; (b) planejar 0.6.0 →
   0.8.x em ambiente isolado com regressão de ranking híbrido. NÃO declarar
   "corrupção corrigida" sem reprodução.
2. Patch Engine (candidatos → missão no Roteador Engenheiro; nada automático em prod).
3. Release Security Gate bloqueante (política já declarada em
   `config/security-intel-policy.json > releaseGate`).
4. Waivers auditáveis com expiração; APIs REST + UI DEVELOPMENT; worker contínuo.
5. Sweep completo de advisories (~1400 pacotes a 4 rps ≈ 6 min) e agendamento.
