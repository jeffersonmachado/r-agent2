# Configuração de Providers de IA

> ⚠️ **Atualizado (2026-08):** `primary`/`secondary` estão **obsoletos** e não dirigem mais o roteamento. A engine agora decide o provider: roteia por todos os providers registrados com credencial, com circuit breaker + failover. Providers são geridos via `engine/aiProviderRegistry.js` (built-ins) + tabela `ai_providers` (custom) + endpoints `/ai-providers`. Veja `docs/CONFIGURAR_IA_TENANT_SYSTEM.md`.

## Estado atual

O projeto usa providers reais, com credenciais criptografadas no banco por tenant.

- providers suportados (built-in): `openai`, `anthropic`, `deepseek`, `kimi`, `mistral`, `groq` (+ custom via `/ai-providers`)
- seleção de provider: **decisão da engine** (roteamento engine-wide, sem `primary`/`secondary`)
- credenciais: salvas no banco e protegidas por `ENCRYPTION_KEY`

## Hierarquia operacional

1. credenciais do tenant no banco (`tenant_ai_credentials`)
2. providers registrados (`engine/aiProviderRegistry.js` + `ai_providers`)
3. roteamento engine-wide com circuit breaker + failover (não há mais fallback via `config.json`)

Não há provider `fallback` estático como caminho oficial.

## Roteamento da engine

Sem config explícita por tenant, `getAiProviderForTenant` tenta os providers registrados em ordem:

- pula provider sem credencial (`AI_PROVIDER_NOT_CONFIGURED`);
- continua em falha transitória/rate-limit/timeout;
- para imediatamente em bloqueios duros (policy denial, modelo aposentado, budget).

## Configuração recomendada

Use a aba IA (⚙️ Configuração → 🤖 IA) para:

- registrar providers (built-ins + custom);
- salvar/validar a API key de cada provider.
- salvar a API key do provider selecionado

## Dependências

Os SDKs já fazem parte da base operacional atual:

- `openai`
- `@anthropic-ai/sdk`

Se o SDK não estiver disponível em um ambiente específico, o serviço tenta chamada HTTP direta, mantendo erro explícito quando a configuração ou a credencial estiverem ausentes.

## Erros esperados

- tenant sem `primary`: provider indisponível para execução
- credencial ausente: erro explícito por tenant/provider
- `ENCRYPTION_KEY` inválida ou ausente: credenciais não podem ser usadas com segurança

## Segurança

- nunca commite chaves reais
- injete `ENCRYPTION_KEY` por ambiente
- trate `secondary` como exceção governada, não como mascaramento silencioso

## Hardening aplicado (abril/2026)

### Validação estrita de provider

- providers aceitos para persistência: `openai`, `anthropic`
- qualquer valor fora dessa lista é rejeitado com erro explícito
- provider é normalizado (`trim + lowercase`) antes de validar

### Validação de configuração por tenant

- `tenantId` vazio/inválido é rejeitado
- `primary` é obrigatório para configuração efetiva
- `secondary` não pode ser igual ao `primary`
- IDs de tenant/provider são normalizados antes de entrar no runtime

### Comportamento de execução endurecido

- runtime não resolve provider para tenant inválido
- fallback para provider secundário só ocorre com flag explícita e `secondary` válido
- ausência de provider/credencial continua em modo fail-fast observável (sem fallback silencioso)

### Credenciais

- gravação de credenciais só aceita provider suportado
- leitura de credenciais usa provider normalizado
- `ENCRYPTION_KEY` inválida/ausente continua bloqueando descriptografia de forma explícita

