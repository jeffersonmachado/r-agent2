# Inventário PBX (Ripabx legado) -> PBX v1 (r-agent2)

Objetivo: mapear **1:1** os recursos atuais do PBX legado (C/CGI + arquivos `conf/*.conf` + XML em `/opt/results/telefonia/ripabx/dados/xml/*.xml` + MariaDB) para módulos do PBX v1 no `r-agent2`, em um porte **big-bang** com:

- **Postgres como fonte de verdade**
- **Asterisk consumindo config via Realtime/ODBC** (shared multi-tenant)
- **Conversor único** (legado -> Postgres) para migração inicial

## Observações do legado (o que encontramos no repo `ripabx`)

- **Dialplan atual é baseado em arquivos** e inclui confs do Ripabx:
  - `etc/asterisk/extensions.conf` inclui vários `conf/*.conf` (ramais, filas, URA, DDR, etc.).
- Há indícios de multi-tenant no legado em `etc/asterisk/pjsip_tenants.conf` (parâmetro `tenant=`), mas não há `extconfig.conf` no checkout atual e o `res_odbc.conf` está com `enabled => no` no sample.
- O código C em `fontes.novo/src/*.c` usa **XML como storage** para vários domínios (paths hardcoded em `/opt/results/telefonia/ripabx/dados/xml/...`).
- As credenciais MariaDB estão hardcoded em `conf/config_db.php` (isso será eliminado no porte).

## Domínios PBX (v1) e fonte no legado

### Identidade / Multi-tenant

- **Tenant PBX**:
  - **Legado**: `pjsip_tenants.conf` (config manual por tenant) + dialplan em arquivos.
  - **Novo**: `tenant_key` do próprio `r-agent2` como fonte de isolamento lógico.
  - **Estratégia shared**:
    - `extensions.context = tenant_key`
    - IDs PJSIP realtime prefixados: `tenantKey__<ramal|trunk|...>`

### Ramais / Usuários (PJSIP)

- **Legado (XML)**: `ramal.xml`
- **Legado (Asterisk)**: `etc/asterisk/pjsip.conf` (exemplos estáticos) e includes no dialplan
- **Novo**:
  - Modelo produto: `pbx_extensions`
  - Materialização realtime: `ps_endpoints`, `ps_auths`, `ps_aors`

### Troncos / Interconexão / Operadoras

- **Legado (XML)**:
  - `interconexao.xml` (interconexões/troncos)
  - `operadora.xml` (operadoras/regras)
- **Novo**:
  - `pbx_trunks`
  - Materialização realtime: `ps_endpoints`/`ps_auths`/`ps_aors` (para trunk PJSIP), e dialplan para roteamento

### Rotas (entrada/saída) e categorias/bloqueios

- **Legado (XML)**:
  - `rota.xml`, `rota_base.xml`
  - `categoria.xml`
  - `bloqueio.xml`, `recusa.xml`
- **Legado (Dialplan)**: inclui `conf/rota.conf`, `conf/categoria.conf`, `conf/recusa_entrada.conf`, `conf/recusa_saida.conf`
- **Novo**:
  - `pbx_routes_in`, `pbx_routes_out`
  - `pbx_route_policies` (bloqueios/recusas/categorias)
  - Materialização realtime: `extensions` (dialplan realtime)

### Filas (Queues) e agentes/members

- **Legado (XML)**: `fila.xml`, `agentes.xml`
- **Legado (Dialplan)**: includes `conf/fila.conf` e `conf/fila_ramal.conf`
- **Novo**:
  - `pbx_queues`, `pbx_queue_members`
  - Materialização: `queues`/`queue_members` (se optar por realtime de queues) **ou** dialplan+AMI (se preferir)

### URA / IVR

- **Legado (Dialplan)**: `conf/ura.conf` (não há `ura.xml` no checkout)
- **Novo**:
  - `pbx_ivr_menus`, `pbx_ivr_actions`
  - Materialização realtime: `extensions`

### DDR / DID (entrada) + Fax

- **Legado**:
  - `ddr.xml` (em C)
  - `conf/ddr.conf` e `conf/fax.conf` (dialplan)
  - `fax.xml` (em C)
- **Novo**:
  - `pbx_inbound_dids`
  - `pbx_fax_routes` (se existir no uso real)
  - Materialização: `extensions` (+ app/fax se necessário)

### Desvio / Transferência / Transbordo / Retorno

- **Legado (XML)**: `desvio.xml`, `transferencia.xml`, `transbordo.xml`, `retorno.xml`
- **Legado (Dialplan)**: `conf/desvio.conf`, `conf/transferencia.conf`, `conf/transbordo.conf`, `conf/retorno.conf`
- **Novo**:
  - `pbx_call_policies` (desvio/transfer/transbordo)
  - Materialização: `extensions`

### Salas / Conferência

- **Legado (XML)**: `sala.xml`
- **Legado (Dialplan)**: `conf/sala.conf`
- **Novo**:
  - `pbx_conference_rooms`
  - Materialização: `extensions` + app de conferência escolhida

### Horários / Feriados / Condições de tempo

- **Legado (XML)**: `feriado.xml`
- **Legado (Dialplan)**: `conf/feriado.conf`
- **Novo**:
  - `pbx_time_conditions`, `pbx_holidays`
  - Materialização: `extensions`

### Gravações

- **Legado**: há menções a `MixMonitor` e paths em conf/dialplan; storage não versionado em repo.
- **Novo**:
  - `pbx_recording_policies`
  - storage em volume (on-prem) ou bucket (cloud) + metadados em Postgres

### CDR / Relatórios

- **Legado**:
  - `conf/cdr_mysql.conf` (credenciais)
  - dialplan usa variáveis e integrações (AGI)
- **Novo**:
  - `pbx_cdr` (ou consumo do schema padrão de CDR do Asterisk via ODBC)
  - API de relatório com filtros por tenant

## Lista de XMLs referenciados no core C (legado)

Os seguintes arquivos aparecem hardcoded em `fontes.novo/src/*.c`:

- `agentes.xml`
- `bloqueio.xml`
- `categoria.xml`
- `ddr.xml`
- `desvio.xml`
- `fax.xml`
- `feriado.xml`
- `fila.xml`
- `grupo.xml`
- `interconexao.xml`
- `motivo.xml`, `motivo1.xml`
- `operadora.xml`
- `ramal.xml`
- `recusa.xml`
- `retorno.xml`
- `rota.xml`, `rota_base.xml`
- `sala.xml`
- `tipo.xml`
- `transbordo.xml`
- `transferencia.xml`

> Nota: o diretório `/opt/results/telefonia/ripabx/dados/` não está versionado no repo; o conversor deve aceitar path configurável e falhar com relatório caso faltem arquivos essenciais.

