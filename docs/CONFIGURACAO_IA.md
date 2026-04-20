# Configuração de Providers de IA

## Estado atual

O projeto usa providers reais, com configuração por tenant e credenciais criptografadas no banco.

- providers suportados: `openai`, `anthropic`
- configuração por tenant: `primary` obrigatório, `secondary` opcional
- credenciais: salvas no banco e protegidas por `ENCRYPTION_KEY`

## Hierarquia operacional

1. credenciais do tenant no banco
2. configuração do tenant no banco (`primary` / `secondary`)
3. fallback temporário via `config.json` apenas para migração controlada

Não há provider `fallback` estático como caminho oficial.

## Fallback do provider secundário

O provider secundário não entra automaticamente só por existir.

Ele só pode ser usado se:

- o tenant tiver `secondary` configurado
- `fallbacks.aiProviderSecondary=true` estiver definido explicitamente em `api/data/config.json`

Sem essa flag, o runtime usa apenas o provider primário e falha de forma observável.

## Configuração recomendada

Use a UI de configuração do tenant para:

- definir `primary`
- opcionalmente definir `secondary`
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

