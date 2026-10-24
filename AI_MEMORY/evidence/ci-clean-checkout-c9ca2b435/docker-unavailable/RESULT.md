# Clean checkout — docker-unavailable

- commit: `c9ca2b4359a2cbf781586ec3975a56d4c3fbdbc0`
- branch: `codex/p1-governance-hardening-20261023`
- sourceFingerprint: `78b1828696a382c5932cfd98b75cfe61fecb5e56ffddefbab2d2a147fde7c056`
- runId: `clean-checkout-20261024110539938-bcf5cf`
- environmentId: `local-jmachado-Precision-5530-525425`
- veredito: **PASS**
- node: 22.12.0 · npm: 10.9.0 · postgres: psql (PostgreSQL) 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) · redis: redis-cli 7.0.15 · docker: Docker version 27.3.1, build ce12230
- jest: 29.7.0

| passo | esperado | exit | duracao | ok |
|---|---|---|---|---|
| clone-limpo | 0 | 0 | 0s | PASS |
| bootstrap | 0 | 0 | 93s | PASS |
| sandbox-sem-docker | 1 | 1 | 47s | PASS |

## Limitações declaradas

- Postgres/Redis efemeros do run: pg:35163 redis:36749
- imagem r-agent2-rag-service:latest ja existia no host (reaproveitada; use --build-images para reconstruir)
- servico RAG provisionado pelo harness em http://127.0.0.1:39301 (container rap-ci-clean-bcf5cf-rag; nao usa o 8001 do desenvolvedor)
