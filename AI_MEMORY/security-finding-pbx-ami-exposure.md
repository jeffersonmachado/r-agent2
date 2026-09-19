# Achado de segurança — controle total do PBX a partir do container de pesquisa

**Data:** 2026-09-19 · **Severidade:** crítica · **Estado:** correção 1 aplicada; 2 e 3 pendentes de decisão coordenada

## Cadeia provada

1. `docker-compose.prod.yml` publicava o AMI em `0.0.0.0` do host
   (`"${AMI_PUBLIC_PORT:-5038}:5038"`).
2. O container de pesquisa do MCP alcançava `172.17.0.1:5038` pelo gateway
   `docker0` — **mesmo com a rede `rap-internal` já isolada** (`internal: true`,
   gerenciada pelo compose). O caminho não é a rede interna: é a rede de
   **egress** (`rap-research-egress`), que é um bridge comum e alcança o gateway
   do host.
3. A ACL do AMI era permissiva: `deny = 0.0.0.0/0.0.0.0` seguido de
   `permit = 0.0.0.0/0.0.0.0` (o `permit` vence), então qualquer origem passava.
4. O segredo do usuário `ragent2` é valor fixo versionado no repositório.

## Prova

De dentro do container de pesquisa (`mcp-research-e2e`) — o container que baixa
conteúdo **arbitrário** da internet:

```
$ printf "Action: Login\r\nUsername: ragent2\r\nSecret: ragent2\r\n\r\n" | nc -w 6 172.17.0.1 5038
Asterisk Call Manager/7.0.3
Response: Success
Message: Authentication accepted
Event: FullyBooted
Privilege: system,all
```

Autenticação **aceita** com privilégio `system,all`: originar chamadas, ler CDR,
recarregar o PBX. Não é banner nem informação — é controle.

## Correções

| # | Correção | Estado |
|---|---|---|
| 1 | Publicação do AMI amarrada a `127.0.0.1` por padrão (`AMI_PUBLIC_BIND`, fail-closed) | ✅ aplicada |
| 2 | ACL por origem (permitir só a rede do container da API) | ⏳ precisa do endereço da API |
| 3 | Segredo AMI forte, fora do versionamento | ⏳ coordenada: mudar sozinho quebra a integração da API |

## Lições

- **`internal: true` não basta** quando o serviço precisa de egress: a rede de
  egress é uma rota irrestrita. O experimento com rede única (sem egress)
  mostrou o AMI bloqueado e levou à conclusão errada — medir a topologia
  SIMPLIFICADA e concluir sobre a REAL foi o erro.
- Controle **declarado** não é controle **em vigor**: `rap-internal` estava
  `Internal=false` no runtime enquanto o compose dizia `internal: true`, e nenhum
  gate olhava o runtime.
- Alvo sensível em `0.0.0.0` é exposição para **todo** container do host, não só
  para o que se está investigando.

## Onde isso é vigiado

`npm run validate:mcp-research-docker-e2e` (gate `MCP_RESEARCH_DOCKER_E2E`) —
mede o runtime e reprova quando o container de pesquisa alcança alvo operacional.
Rede não medida conta como violação: "não consegui medir" ≠ "está isolado".
