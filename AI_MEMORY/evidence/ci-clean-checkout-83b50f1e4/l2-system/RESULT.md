# Clean checkout — l2-system

- commit: `83b50f1e4209522593d554a84a40b1d02abeb6cc`
- branch: `codex/p1-governance-hardening-20261023`
- sourceFingerprint: `ba06659e6e7b7ee5327477f590e9191373514f9ad1140b2588985abcab322626`
- runId: `clean-checkout-20261024194751103-58bc03`
- environmentId: `local-jmachado-Precision-5530-1425074`
- veredito: **PASS**
- node: 22.12.0 · npm: 10.9.0 · postgres: psql (PostgreSQL) 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) · redis: redis-cli 7.0.15 · docker: Docker version 27.3.1, build ce12230
- jest: 29.7.0

| passo | esperado | exit | duracao | ok |
|---|---|---|---|---|
| clone-limpo | 0 | 0 | 0s | PASS |
| bootstrap | 0 | 0 | 102s | PASS |
| l2-test-system | 0 | 0 | 68s | PASS |

## Limitações declaradas

- Postgres/Redis efemeros do run: pg:36771 redis:40401
- imagem r-agent2-rag-service:latest ja existia no host (reaproveitada; use --build-images para reconstruir)
- servico RAG provisionado pelo harness em http://127.0.0.1:39683 (container rap-ci-clean-58bc03-rag; nao usa o 8001 do desenvolvedor)
