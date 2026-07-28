# Porte Ripabx (r-pbx) -> r-agent2 (migração gradual)

Este documento descreve o **contrato inicial** e a **camada de compatibilidade** implementada no `r-agent2` para portar o legado do Ripabx (`C`/`PHP`/`MariaDB`) sem “big-bang”.

## Objetivos

- **Manter MariaDB/MySQL do PBX** como fonte de dados do legado (sem migração imediata).
- Permitir substituição gradual de:
  - CGIs/binários em C
  - UI Apache/PHP
  - XML como storage intermediário (quando aplicável)

## Configuração (env vars)

### Caminhos do legado

- `PBX_LEGACY_ROOT`: raiz do checkout/montagem do Ripabx (ex.: `/opt/results/telefonia/ripabx`)
- `PBX_LEGACY_XML_DIR` (opcional): override do diretório de XML (default: `${PBX_LEGACY_ROOT}/dados/xml`)
- `PBX_LEGACY_BIN_DIR` (opcional): override do diretório de binários (default: `${PBX_LEGACY_ROOT}/bin`)
- `PBX_LEGACY_CGI_DIR` (opcional): override do diretório CGI (default: `${PBX_LEGACY_ROOT}/cgi-bin`)
- `PBX_LEGACY_AST_DIR` (opcional): override do diretório `etc/asterisk` (default: `${PBX_LEGACY_ROOT}/etc/asterisk`)

### MariaDB do PBX

Você pode usar **uma URL** ou campos separados:

- `PBX_MARIADB_URL` (preferível): `mysql://user:pass@host:3306/results`

Ou:

- `PBX_MARIADB_HOST`
- `PBX_MARIADB_PORT` (default: `3306`)
- `PBX_MARIADB_DATABASE`
- `PBX_MARIADB_USER`
- `PBX_MARIADB_PASSWORD`

## Endpoints implementados no r-agent2 (contrato inicial)

> Todos os endpoints abaixo exigem autenticação e permissão `config:read` (ou `config:update` para operações de escrita).

### Health/Inventário

- `GET /api/pbx/health`
  - Checa se `PBX_LEGACY_ROOT` está configurado + health básico do MariaDB (`SELECT 1`).

- `GET /api/pbx/inventory`
  - Retorna mapa de diretórios/arquivos esperados e um catálogo limitado (`sample`) de:
    - fontes C (`fontes.novo/src/**/*.c|.h`)
    - configs Apache (`docker/web/*.conf`)
    - configs Asterisk (`etc/asterisk/*.conf`)
    - PHP configs (em `conf/*.php`)

### Ramais (primeiro domínio portado do “core C” para Node)

- `GET /api/pbx/ramais`
  - Lista ramais a partir de `ramal.xml` (parser tolerante).

- `POST /api/pbx/ramais`
  - Upsert de um ramal no `ramal.xml` (migração gradual).
  - Observação: isto **não recarrega Asterisk** ainda; é apenas o primeiro passo para substituir os binários CGI.

### Entidades XML de referência (`/api/pbx-legacy/xml-entities`)

CRUD genérico das entidades XML de referência do legado, com schemas fiéis aos
parsers em C (`fontes.novo/src/{entidade}_xml.c`): cada entidade é um arquivo
`${entidade}.xml` em `dados/xml`, com blocos `<itemTag idAttr="...">` e campos
filhos. O parser é tolerante e preserva atributos/campos desconhecidos
(`_attrs`) para migração gradual.

Entidades suportadas (whitelist): `ddr`, `grupo`, `desvio`, `transbordo`,
`bloqueio`, `retorno`, `recusa`, `feriado`, `transferencia`.

- `GET /api/pbx-legacy/xml-entities?entity=<entidade>` (`config:read`)
  - Retorna `{ entity, file, rootTag, itemTag, supported, items }`, com itens
    no shape `{ id, ...campos, _attrs }`.
  - Sem `PBX_LEGACY_ROOT`/`PBX_LEGACY_XML_DIR`: envelope `pbx_xml_dir_not_configured`
    (tratado pelo frontend como estado esperado, não como falha).
- `POST /api/pbx-legacy/xml-entities?entity=<entidade>` (`config:update`)
  - Upsert por `id` (obrigatório); mescla preservando campos não enviados.
- `DELETE /api/pbx-legacy/xml-entities?entity=<entidade>&id=<id>` (`config:update`)
  - Remove o item; `not_found` se ausente.

## Roadmap (próximos domínios)

Após estabilizar `ramais` e as entidades de referência, repetir o padrão para:

- Filas (`fila.xml`)
- Rotas (`rota.xml`, `rota_base.xml`)
- URA etc.

O alvo final é substituir:

- binários/CGI em C por serviços internos Node com validação e auditoria
- PHP/Apache UI pelo frontend do `r-agent2`

