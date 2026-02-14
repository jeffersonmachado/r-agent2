# Provisionamento PBX v1 (Grandstream + Avaya) via cadastro de ramal

Este documento descreve o **auto-provisionamento** implementado no PBX v1 (`r-agent2`) para **Grandstream** e **Avaya**, acoplado ao **cadastro/atualização do ramal** (`POST /api/pbx/extensions`).

## Como funciona (visão geral)

- O provisionamento é configurado **no mesmo payload do ramal**.
- Os dados são persistidos em `pbx_extensions.endpoint_options.provisioning`.
- O telefone busca a configuração em um endpoint público:
  - **Sem token**: `GET /provision/<tenantKey>/<vendor>/<mac>`
  - **Com token** (recomendado em on-prem): `GET /provision/<tenantKey>/<token>/<vendor>/<mac>`

> O `mac` deve ter **12 hex** (ex.: `001122AABBCC`). Separadores (`:` `-`) são aceitos na entrada e normalizados.

## Configurar no cadastro de ramal

Ao criar/atualizar o ramal em `POST /api/pbx/extensions`, envie:

```json
{
  "extension": "1001",
  "displayName": "Recepção",
  "authUsername": "1001",
  "authPassword": "SenhaForte",
  "provisioning": {
    "enabled": true,
    "vendor": "grandstream",
    "mac": "00:11:22:AA:BB:CC",
    "model": "GXP2160"
  }
}
```

- `vendor`: `grandstream` ou `avaya`
- `mac`: obrigatório quando `enabled=true`
- `model`: opcional (útil para expandir templates no futuro)

## Variáveis de ambiente (segurança)

- `PROVISIONING_PUBLIC_TOKEN` (opcional, recomendado): se definido, o endpoint público exige token na URL.
- `PROVISIONING_SIP_HOST` (opcional): override do host/domínio usado dentro dos arquivos gerados (registrar/SIPDOMAIN). Útil quando a URL do provisioning não é o mesmo host do SIP.

Exemplo:

```bash
export PROVISIONING_PUBLIC_TOKEN="token-alto-risco-evitar-sem"
```

## O que é gerado (MVP)

### Grandstream
- Retorna um XML com parâmetros SIP mínimos (registrar/usuário/senha).
- Endpoint: `GET /provision/<tenantKey>/<token?>/grandstream/<mac>`

### Avaya (96x1 e J-Series)
- Retorna `46xxsettings.txt` com parâmetros SIP mínimos (controller/domain + auth).
- Endpoint: `GET /provision/<tenantKey>/<token?>/avaya/<mac>`

> Em Avaya, parâmetros variam por firmware/série. O arquivo gerado é um **mínimo viável** e pode ser estendido conforme o parque instalado.

## DHCP (evitar conflito com outros provisioners)

Recomendação: fazer match por **Vendor Class Identifier** e apontar URLs diferentes por fabricante.

- Grandstream: normalmente usa opção 66/URL de provisioning conforme modelo/firmware.
- Avaya: frequentemente usa `option 242` (string de parâmetros) ou mecanismo equivalente por série.

Quando o cliente já tem outro PBX/provisioning, evite “roubar” todos os telefones:
- Preferir **VLAN/escopo DHCP separado** para telefones.
- Ou condicionar regras DHCP por vendor.

