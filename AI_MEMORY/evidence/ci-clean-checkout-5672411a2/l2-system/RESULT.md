# Clean checkout — l2-system

- commit: `5672411a2fbd99ff3d1e668418847af81b62cb4b`
- branch: `codex/p1-governance-hardening-20261023`
- sourceFingerprint: `b0246630b665d3dfb96d736cab2ad6a2d549b0c06a49bc8401c96bfea45dd8b2`
- runId: `clean-checkout-20261024141342203-7061cb`
- environmentId: `local-jmachado-Precision-5530-751917`
- veredito: **PASS**
- node: 22.12.0 · npm: 10.9.0 · postgres: psql (PostgreSQL) 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) · redis: redis-cli 7.0.15 · docker: Docker version 27.3.1, build ce12230
- jest: 29.7.0

| passo | esperado | exit | duracao | ok |
|---|---|---|---|---|
| clone-limpo | 0 | 0 | 0s | PASS |
| bootstrap | 0 | 0 | 107s | PASS |
| l2-test-system | 0 | 0 | 68s | PASS |

## Limitações declaradas

- Postgres/Redis efemeros do run: pg:36789 redis:36679
- imagem r-agent2-rag-service:latest ja existia no host (reaproveitada; use --build-images para reconstruir)
- servico RAG provisionado pelo harness em http://127.0.0.1:36043 (container rap-ci-clean-7061cb-rag; nao usa o 8001 do desenvolvedor)
