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
| 1 | Publicação do AMI amarrada a `127.0.0.1` por padrão (`AMI_PUBLIC_BIND`, fail-closed) | ✅ aplicada (`165a22c3`) |
| 2 | ACL por origem (`deny` final + `permit 127.0.0.1` + `172.30.0.0/16`) | ✅ aplicada e **provada** (`66a05e5c`) |
| 3 | Segredo fora do versionamento | ❌ **ABERTA** — duas tentativas refutadas, ver abaixo |
| 4 | `amiClient.js` sem default silencioso (`ami_secret_required`) | ✅ aplicada (`6e018dbe`) |
| 5 | Critério de aceite que pega ACL inerte no gate `MCP_RESEARCH_DOCKER_E2E` | ✅ aplicado (`77393569`) |

### Por que a #3 continua aberta: dois mecanismos refutados por medição

| Tentativa | Como falha |
|---|---|
| `secret = ${ENV(AMI_SECRET)}` no manager.conf | descarta a **seção inteira** — `There is no manager called ragent2`. O AMI deixa de existir. |
| `#include conf/manager-ami.conf` com a seção completa | carrega usuário e segredo, mas o `#include` **reinicia a seção** e a ACL fica **inerte**. Com `permit` apontando para endereço impossível, **todas** as origens continuaram recebendo resposta. |

Ambas foram commitadas por mim e revertidas depois. A segunda quase passou: a
verificação de caminho felizinho (`o segredo novo funciona`) passou enquanto a
ACL não protegia nada.

### O que ainda não foi validado

Desenho identificado: gerar o `manager.conf` **completo** (segredo + ACL no mesmo
bloco) num `astetcdir` próprio em runtime, com **symlinks** para o resto — assim os
contextos realtime que a API escreve em `/etc/asterisk/conf` continuam visíveis.
Uma tentativa de probe **não produziu medição** (o `umask 077` herdado da sessão
deixou o diretório em `0700`, ilegível para o usuário `asterisk`). O mecanismo
portanto está **não validado** — nem confirmado nem refutado.

### Critério de aceite obrigatório

`npm run`-style: `node scripts/governance/validate-mcp-research-docker-e2e.js`
precisa ficar **verde**, e ele exige que a credencial legada do repositório
**não autentique**. Verificar que o segredo novo funciona não basta: é preciso
provar que o antigo parou de valer.


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

## Resolução da ACL (2026-09-19) — a ACL ESTÁ em vigor; a contradição era minha

Duas medições anteriores pareciam contraditórias. Não eram: eu comparava
ORIGENS diferentes e tratava o resultado como se fosse o mesmo teste.

Discriminador correto — mesma credencial, origens diferentes, mais contra-prova
de senha errada (sem o terceiro teste, "failed" seria indistinguível de "senha
trocada"):

| Origem | Credencial | Resultado |
|---|---|---|
| `172.17.0.1` (fora dos `permit`) | `ragent2` correta | `Authentication failed` |
| `127.0.0.1` (permitida) | `ragent2` correta | `Authentication accepted` |
| `127.0.0.1` (permitida) | senha errada | `Authentication failed` |

A credencial correta passa numa origem permitida e NÃO passa numa origem não
permitida: quem decide é a ACL. A config
(`deny 0.0.0.0/0.0.0.0` + `permit 127.0.0.1` + `permit 172.30.0.0/16`) funciona, e
a semântica é a PRIMEIRA correspondência (o comentário anterior no arquivo
afirmava "a ÚLTIMA correspondência decide (medido)" — está errado e foi corrigido).

### Lição que quase virou falso positivo

O **banner é entregue antes da decisão da ACL**. Medi
`BANNER_ENTREGUE :: "Asterisk Call Manager/7.0.3"` de uma origem que a ACL nega e
quase reportei "exposição mantida". Banner prova que o TCP conecta; **só a
autenticação prova acesso**. O discriminador tem de ser capaz de distinguir os
dois desfechos — contar `Response` sem conferir `Message` não distingue.

### Estado real

- **ACL: em vigor.** Origem fora dos `permit` não autentica. Medições anteriores
  de "banner + `system,all`" foram feitas com a config antiga
  (`permit = 0.0.0.0/0.0.0.0`), que era exatamente o defeito corrigido.
- **`secret = ragent2` continua LITERAL e versionado** em
  `pbx/asterisk/etc/asterisk/manager.conf`. É um segredo fixo, no repositório,
  com `read/write = all`. A ACL limita QUEM pode usá-lo (`127.0.0.1` e
  `172.30.0.0/16`), mas qualquer container na rede da plataforma autentica com
  privilégio total — movimento lateral continua possível. **Item ainda aberto.**
- O mount do config é `ro`
  (`/opt/results/ria/r-agent2/pbx/asterisk/etc/asterisk -> /etc/asterisk (ro)`),
  o que **refuta** a hipótese de a API sobrescrever `/etc/asterisk` em runtime.
- `ACL: yes` em ambos os containers rodando (`ami-rt`, `ragent2-asterisk-local`),
  com a mesma config montada — a contradição não vinha de configs divergentes.
