# Mapa do menu legado (Ripabx-Web) → endpoints → storage

Este documento foi gerado por parsing de `menu.php` + UI (`html/app/*.html` + `html/app/*.js`).

- **Fonte do menu**: `remote-dumps/ripabx-web-all-php/html/menu.php` (diretório removido do repositório em 2026-08-14 — documento histórico)
- **Fonte da UI**: `remote-dumps2/extracted/ripabx-web-html-app/app` (idem)

## Endpoints/Storages principais do legado

- **PBX via XML/CGI**: `app/xml.php` (read) + `app/server.php` (write) → `/cgi/ripabx/*_xml.cgi` → `dados/xml/*.xml` + `dados/xsl/*.xsl`
- **Contact Center/Relatórios via MariaDB**: `app/server2.php` (write) + `app/mysql*.php` (read)
- **URA builder**: `app/ura_load.php` + `app/ura_save.php` (grava `conf/ura.conf` e `dados/json/ura.json`)

## Itens encontrados no menu

Total de links no menu: **82** (deduplicado por href+label).

### Painel

- **href**: `app/painel.html`
- **permissão (legado)**: `R`
- **arquivo resolvido**: `painel.html`
- **JS**: `painel.js`
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Sistema

- **href**: `/dash/app/index.html`
- **permissão (legado)**: `R`
- **arquivo resolvido**: `temp/index.html`
- **JS**: —
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Sistema

- **href**: `app/cockpit.html`
- **permissão (legado)**: `R`
- **arquivo resolvido**: `cockpit.html`
- **JS**: —
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Resumo

- **href**: `app/dashboard.html`
- **permissão (legado)**: `R`
- **arquivo resolvido**: `dashboard.html`
- **JS**: —
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Filas

- **href**: `app/dash_filas.html`
- **permissão (legado)**: `R`
- **arquivo resolvido**: —
- **JS**: —
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Agentes

- **href**: `app/dash_agentes.html`
- **permissão (legado)**: `R`
- **arquivo resolvido**: —
- **JS**: —
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### DDR

- **href**: `app/ddr.html`
- **permissão (legado)**: `C`
- **arquivo resolvido**: `ddr.html`
- **JS**: `ddr.js`, `ddr.js`
- **xml.php (views)**: `operadora.xml`+`operadora2.xsl`, `ddr.xml`+`ddr.xsl`
- **server.php (writes)**: `ddr`
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Grupos

- **href**: `app/grupo.html`
- **permissão (legado)**: `C`
- **arquivo resolvido**: `grupo.html`
- **JS**: `grupo.js`, `grupo.js`
- **xml.php (views)**: `grupo.xml`+`grupo.xsl`
- **server.php (writes)**: `grupo`
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Ramais

- **href**: `app/ramais.html`
- **permissão (legado)**: `C`
- **arquivo resolvido**: `ramais.html`
- **JS**: `ramais.js`
- **xml.php (views)**: `grupo.xml`+`grupo2.xsl`, `categoria.xml`+`categoria2.xsl`, `ramal.xml`+`ramal.xsl`
- **server.php (writes)**: `ramal`
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Desvio

- **href**: `app/desvio.html`
- **permissão (legado)**: `C`
- **arquivo resolvido**: `desvio.html`
- **JS**: `desvio.js`, `desvio.js`
- **xml.php (views)**: `desvio.xml`+`desvio.xsl`
- **server.php (writes)**: `desvio`
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Transbordo

- **href**: `app/transbordo.html`
- **permissão (legado)**: `C`
- **arquivo resolvido**: `transbordo.html`
- **JS**: `transbordo.js`, `transbordo.js`
- **xml.php (views)**: `transbordo.xml`+`transbordo.xsl`
- **server.php (writes)**: `transbordo`
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Bloqueio

- **href**: `app/bloqueio.html`
- **permissão (legado)**: `C`
- **arquivo resolvido**: `bloqueio.html`
- **JS**: `bloqueio.js`, `bloqueio.js`
- **xml.php (views)**: `bloqueio.xml`+`bloqueio.xsl`
- **server.php (writes)**: `bloqueio`
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Retorno

- **href**: `app/retorno.html`
- **permissão (legado)**: `C`
- **arquivo resolvido**: `retorno.html`
- **JS**: `retorno.js`, `retorno.js`
- **xml.php (views)**: `retorno.xml`+`retorno.xsl`
- **server.php (writes)**: `retorno`
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Recusa

- **href**: `app/recusa.html`
- **permissão (legado)**: `C`
- **arquivo resolvido**: `recusa.html`
- **JS**: `recusa.js`, `recusa.js`
- **xml.php (views)**: `recusa.xml`+`recusa.xsl`
- **server.php (writes)**: `recusa`
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Feriado

- **href**: `app/feriado.html`
- **permissão (legado)**: `C`
- **arquivo resolvido**: `feriado.html`
- **JS**: `feriado.js`, `feriado.js`
- **xml.php (views)**: `feriado.xml`+`feriado.xsl`
- **server.php (writes)**: `feriado`
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Transferencia

- **href**: `app/transferencia.html`
- **permissão (legado)**: `C`
- **arquivo resolvido**: `transferencia.html`
- **JS**: `transferencia.js`, `transferencia.js`
- **xml.php (views)**: `transferencia.xml`+`transferencia.xsl`
- **server.php (writes)**: `transferencia`
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Espera

- **href**: `app/upload.html?dir=espera`
- **permissão (legado)**: `R`
- **arquivo resolvido**: —
- **JS**: —
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Sons

- **href**: `app/upload.html?dir=sons`
- **permissão (legado)**: `R`
- **arquivo resolvido**: —
- **JS**: —
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Ligações

- **href**: `app/cdr.html`
- **permissão (legado)**: `R`
- **arquivo resolvido**: `cdr.html`
- **JS**: `cdr.js`, `exportagrid.js`, `cdr.js`, `exportagrid.js`
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Fax

- **href**: `app/fax_rel.html`
- **permissão (legado)**: `R`
- **arquivo resolvido**: `fax_rel.html`
- **JS**: `fax_rel.js`, `fax_rel.js`
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Gravações

- **href**: `app/sac.html`
- **permissão (legado)**: `R`
- **arquivo resolvido**: `sac.html`
- **JS**: `sac.js`, `sac.js`
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Resumo

- **href**: `app/resumo.html`
- **permissão (legado)**: `R`
- **arquivo resolvido**: `resumo.html`
- **JS**: `resumo.js`, `resumo.js`
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Hora

- **href**: `app/hora.html`
- **permissão (legado)**: `R`
- **arquivo resolvido**: `hora.html`
- **JS**: `hora.js`, `hora.js`
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Origem

- **href**: `app/origem.html`
- **permissão (legado)**: `R`
- **arquivo resolvido**: `origem.html`
- **JS**: `origem.js`, `origem.js`
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Destino

- **href**: `app/destino.html`
- **permissão (legado)**: `R`
- **arquivo resolvido**: `destino.html`
- **JS**: `destino.js`, `destino.js`
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Configuraçoes

- **href**: `app/configuracoes.html`
- **permissão (legado)**: `C`
- **arquivo resolvido**: `configuracoes.html`
- **JS**: `configuracoes.js`, `configuracoes.js`
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Operadoras

- **href**: `app/operadoras.html`
- **permissão (legado)**: `C`
- **arquivo resolvido**: `operadoras.html`
- **JS**: `operadoras.js`, `operadoras.js`
- **xml.php (views)**: `operadora.xml`+`operadora.xsl`
- **server.php (writes)**: `operadora`
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Rotas

- **href**: `app/rotas.html`
- **permissão (legado)**: `C`
- **arquivo resolvido**: `rotas.html`
- **JS**: `rotas.js`, `rotas.js`
- **xml.php (views)**: `operadora.xml`+`operadora2.xsl`, `rota_base.xml`+`rota_base.xsl`, `rota.xml`+`rota.xsl`
- **server.php (writes)**: `rota_base`, `rota`
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Categoria

- **href**: `app/categoria.html`
- **permissão (legado)**: `C`
- **arquivo resolvido**: `categoria.html`
- **JS**: `categoria.js`, `categoria.js`
- **xml.php (views)**: `tipo.xml`+`tipo2.xsl`, `rota_base.xml`+`rota2.xsl`, `categoria.xml`+`categoria.xsl`
- **server.php (writes)**: `categoria`
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Fax

- **href**: `app/fax.html`
- **permissão (legado)**: `C`
- **arquivo resolvido**: `fax.html`
- **JS**: `fax.js`, `fax.js`
- **xml.php (views)**: `fax.xml`+`fax.xsl`
- **server.php (writes)**: `fax`
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Facilidades

- **href**: `app/facilidades.html`
- **permissão (legado)**: `C`
- **arquivo resolvido**: `facilidades.html`
- **JS**: `facilidades.js`, `facilidades.js`
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### URA

- **href**: `app/ura.html`
- **permissão (legado)**: `C`
- **arquivo resolvido**: `ura.html`
- **JS**: `ura.js`, `ura.js`
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: load=true save=true

### Sala

- **href**: `app/sala.html`
- **permissão (legado)**: `C`
- **arquivo resolvido**: `sala.html`
- **JS**: `sala.js`, `sala.js`
- **xml.php (views)**: `sala.xml`+`sala.xsl`
- **server.php (writes)**: `sala`
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Interconexão

- **href**: `app/interconexao.html`
- **permissão (legado)**: `C`
- **arquivo resolvido**: `interconexao.html`
- **JS**: `interconexao.js`, `interconexao.js`
- **xml.php (views)**: `interconexao.xml`+`interconexao.xsl`
- **server.php (writes)**: `interconexao`
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Usuários

- **href**: `app/usuarios.html`
- **permissão (legado)**: `C`
- **arquivo resolvido**: `usuarios.html`
- **JS**: `usuarios.js`, `usuarios.js`
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: `usuarios`
- **mysql*.php (reads)**: `mysql6.php?prog=usuarios`
- **URA**: —

### Rede

- **href**: `config/net`
- **permissão (legado)**: `C`
- **arquivo resolvido**: —
- **JS**: —
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### DHCP

- **href**: `config/dhcpd`
- **permissão (legado)**: `C`
- **arquivo resolvido**: —
- **JS**: —
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Firewall

- **href**: `config/firewalld`
- **permissão (legado)**: `C`
- **arquivo resolvido**: —
- **JS**: —
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### VPN

- **href**: `config/ipsec`
- **permissão (legado)**: `C`
- **arquivo resolvido**: —
- **JS**: —
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Licença

- **href**: `app/licenca.php`
- **permissão (legado)**: `C`
- **arquivo resolvido**: `licenca.php`
- **JS**: —
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Atualização

- **href**: `app/update.php`
- **permissão (legado)**: `C`
- **arquivo resolvido**: `update.php`
- **JS**: —
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Assistência

- **href**: `/cgi/ripabx/assistencia.cgi`
- **permissão (legado)**: `C`
- **arquivo resolvido**: —
- **JS**: —
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Recarga

- **href**: `app/recarga.php`
- **permissão (legado)**: `C`
- **arquivo resolvido**: `recarga.php`
- **JS**: —
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Serviços

- **href**: `app/servicos.html`
- **permissão (legado)**: `C`
- **arquivo resolvido**: `servicos.html`
- **JS**: `servicos.js`, `servicos.js`
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Fila

- **href**: `app/fila.html`
- **permissão (legado)**: `C`
- **arquivo resolvido**: `fila.html`
- **JS**: `fila.js`, `fila.js`
- **xml.php (views)**: `fila.xml`+`fila.xsl`
- **server.php (writes)**: `fila`
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Motivo Pausa

- **href**: `app/motivo.html`
- **permissão (legado)**: `C`
- **arquivo resolvido**: `motivo.html`
- **JS**: `motivo.js`, `motivo.js`
- **xml.php (views)**: `motivo.xml`+`motivo.xsl`
- **server.php (writes)**: `motivo`
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Motivo Contato

- **href**: `app/motivo1.html`
- **permissão (legado)**: `C`
- **arquivo resolvido**: `motivo1.html`
- **JS**: `motivo1.js`, `motivo1.js`
- **xml.php (views)**: `motivo1.xml`+`motivo1.xsl`
- **server.php (writes)**: `motivo1`
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Campanhas

- **href**: `app/campanha.html`
- **permissão (legado)**: `C`
- **arquivo resolvido**: `campanha.html`
- **JS**: `campanha.js`, `campanha.js`
- **xml.php (views)**: `fila.xml`+`fila2.xsl`, `fila.xml`+`fila3.xsl`
- **server.php (writes)**: —
- **server2.php (writes)**: `campanha`
- **mysql*.php (reads)**: `mysql2.php?prog=campanha`, `mysql3.php?prog=campanha`
- **URA**: —

### CallBack Agendado

- **href**: `app/agendado.html`
- **permissão (legado)**: `C`
- **arquivo resolvido**: `agendado.html`
- **JS**: `agendado.js`, `agendado.js`
- **xml.php (views)**: `fila.xml`+`fila2.xsl`, `fila.xml`+`fila3.xsl`
- **server.php (writes)**: —
- **server2.php (writes)**: `agendado`
- **mysql*.php (reads)**: `mysql3.php?prog=agendado`, `mysql3.php?prog=agendado_detalhes`
- **URA**: —

### atendidas

- **href**: `app/fila_atendidas.html`
- **permissão (legado)**: `R`
- **arquivo resolvido**: `fila_atendidas.html`
- **JS**: `fila_atendidas.js`, `fila_atendidas.js`
- **xml.php (views)**: `fila.xml`+`fila.xsl`
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### abandonadas

- **href**: `app/fila_abandonadas.html`
- **permissão (legado)**: `R`
- **arquivo resolvido**: `fila_abandonadas.html`
- **JS**: `fila_abandonadas.js`, `fila_abandonadas.js`
- **xml.php (views)**: `fila.xml`+`fila.xsl`
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### agentes

- **href**: `app/fila_agentes.html`
- **permissão (legado)**: `R`
- **arquivo resolvido**: `fila_agentes.html`
- **JS**: `fila_agentes.js`, `fila_agentes.js`
- **xml.php (views)**: `fila.xml`+`fila.xsl`
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### por hora

- **href**: `app/fila_hora.html`
- **permissão (legado)**: `R`
- **arquivo resolvido**: `fila_hora.html`
- **JS**: `fila_hora.js`, `fila_hora.js`
- **xml.php (views)**: `fila.xml`+`fila.xsl`
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Resumo por campanha

- **href**: `app/filas_resumo.html`
- **permissão (legado)**: `R`
- **arquivo resolvido**: `filas_resumo.html`
- **JS**: `filas_resumo.js`, `filas_resumo.js`, `filas_resumo.js`, `filas_resumo.js`
- **xml.php (views)**: `fila.xml`+`fila2.xsl`, `fila.xml`+`fila3.xsl`
- **server.php (writes)**: —
- **server2.php (writes)**: `campanha`
- **mysql*.php (reads)**: `mysql2.php?prog=campanha`, `mysql3.php?prog=campanha_resumo`
- **URA**: —

### Pesquisa

- **href**: `app/pesquisa.html`
- **permissão (legado)**: `R`
- **arquivo resolvido**: `pesquisa.html`
- **JS**: `pesquisa.js`, `pesquisa.js`
- **xml.php (views)**: `fila.xml`+`fila.xsl`
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Click2Call

- **href**: `app/click2call.php`
- **permissão (legado)**: `R`
- **arquivo resolvido**: `click2call.php`
- **JS**: —
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Clientes

- **href**: `app/tron_clientes.html`
- **permissão (legado)**: `C`
- **arquivo resolvido**: `tron_clientes.html`
- **JS**: `tron_clientes.js`
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Objetivos

- **href**: `app/objetivos.html`
- **permissão (legado)**: `C`
- **arquivo resolvido**: `objetivos.html`
- **JS**: `objetivos.js`
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Regras

- **href**: `app/regras.html`
- **permissão (legado)**: `C`
- **arquivo resolvido**: `regras.html`
- **JS**: `regras.js`
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Memórias

- **href**: `app/memorias.html`
- **permissão (legado)**: `C`
- **arquivo resolvido**: `memorias.html`
- **JS**: `memorias.js`
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Dicionário

- **href**: `app/tron_dicionario.html`
- **permissão (legado)**: `C`
- **arquivo resolvido**: `tron_dicionario.html`
- **JS**: `tron_dicionario.js`
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Substitutos

- **href**: `app/tron_substitutos.html`
- **permissão (legado)**: `C`
- **arquivo resolvido**: `tron_substitutos.html`
- **JS**: `tron_substitutos.js`
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Palavras Base

- **href**: `app/tron_palavras_base.html`
- **permissão (legado)**: `C`
- **arquivo resolvido**: `tron_palavras_base.html`
- **JS**: `tron_palavras_base.js`
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Substituidos

- **href**: `app/tron_substituidos.html`
- **permissão (legado)**: `C`
- **arquivo resolvido**: `tron_substituidos.html`
- **JS**: `tron_substituidos.js`
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Palavras Sinonimos

- **href**: `app/tron_palavras_sinonimos.html`
- **permissão (legado)**: `C`
- **arquivo resolvido**: `tron_palavras_sinonimos.html`
- **JS**: `tron_palavras_sinonimos.js`
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Configurações Tron

- **href**: `app/tron_config.html`
- **permissão (legado)**: `C`
- **arquivo resolvido**: `tron_config.html`
- **JS**: `tron_config.js`
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Configurações SIP

- **href**: `app/sip_config.html`
- **permissão (legado)**: `C`
- **arquivo resolvido**: `sip_config.html`
- **JS**: `sip_config.js`
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### R-ChatBot

- **href**: `app/rchatbot_man.html`
- **permissão (legado)**: —
- **arquivo resolvido**: `rchatbot_man.html`
- **JS**: `rchatbot_man.js`, `rchatbot_man.js`
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: `campanha`, `rchatbot`, `rchatbot_patterns`, `rchatbot_responses`, `rchatbot_actions`
- **mysql*.php (reads)**: `mysql7.php?prog=tags`, `mysql7.php?prog=tags_select`, `mysql7.php?prog=rchatbot`, `mysql7.php?prog=rchatbot_patterns`, `mysql7.php?prog=rchatbot_responses`, `mysql7.php?prog=rchatbot_actions`
- **URA**: —

### R-ChatBot

- **href**: `app/rchatbot_chats.html`
- **permissão (legado)**: —
- **arquivo resolvido**: `rchatbot_chats.html`
- **JS**: `rchatbot_chats.js`, `rchatbot_chats.js`
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: `mysql7.php?prog=rchatbot_chats`
- **URA**: —

### Bot

- **href**: `app/voicebot.php`
- **permissão (legado)**: —
- **arquivo resolvido**: `voicebot.php`
- **JS**: —
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Hosts

- **href**: `app/mon_hosts.html`
- **permissão (legado)**: —
- **arquivo resolvido**: `mon_hosts.html`
- **JS**: `mon_hosts.js`, `mon_hosts.js`
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: `mon_hosts`
- **mysql*.php (reads)**: `mysql7.php?prog=mon_os_select`, `mysql7.php?prog=mon_app_select`, `mysql7.php?prog=mon_hosts`
- **URA**: —

### Grupos de Hosts

- **href**: `app/mon_hostgroups.html`
- **permissão (legado)**: —
- **arquivo resolvido**: `mon_hostgroups.html`
- **JS**: `mon_hostgroups.js`, `mon_hostgroups.js`
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Serviços

- **href**: `app/mon_services.html`
- **permissão (legado)**: —
- **arquivo resolvido**: `mon_services.html`
- **JS**: `mon_services.js`, `mon_services.js`
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: `mon_services`
- **mysql*.php (reads)**: `mysql7.php?prog=mon_os_select`, `mysql7.php?prog=mon_app_select`, `mysql7.php?prog=mon_hosts_select`, `mysql7.php?prog=mon_services`, `mysql9.php?prog=mon_services`
- **URA**: —

### Grupos de Serviços

- **href**: `app/mon_servicegroups.html`
- **permissão (legado)**: —
- **arquivo resolvido**: `mon_servicegroups.html`
- **JS**: `mon_servicegroups.js`, `mon_servicegroups.js`
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Dependências

- **href**: `app/mon_dependencies.html`
- **permissão (legado)**: —
- **arquivo resolvido**: `mon_dependencies.html`
- **JS**: `mon_dependencies.js`, `mon_dependencies.js`
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Usuários

- **href**: `app/mon_users.html`
- **permissão (legado)**: —
- **arquivo resolvido**: `mon_users.html`
- **JS**: `mon_users.js`, `mon_users.js`
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Grupos de Usuários

- **href**: `app/mon_usergroups.html`
- **permissão (legado)**: —
- **arquivo resolvido**: `mon_usergroups.html`
- **JS**: `mon_usergroups.js`, `mon_usergroups.js`
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Períodos de tempo

- **href**: `app/mon_timeperiods.html`
- **permissão (legado)**: —
- **arquivo resolvido**: `mon_timeperiods.html`
- **JS**: `mon_timeperiods.js`, `mon_timeperiods.js`
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### Zonas

- **href**: `app/mon_zones.html`
- **permissão (legado)**: —
- **arquivo resolvido**: `mon_zones.html`
- **JS**: `mon_zones.js`, `mon_zones.js`
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: —
- **mysql*.php (reads)**: —
- **URA**: —

### OS

- **href**: `app/mon_os.html`
- **permissão (legado)**: —
- **arquivo resolvido**: `mon_os.html`
- **JS**: `mon_os.js`, `mon_os.js`
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: `mon_os`
- **mysql*.php (reads)**: `mysql7.php?prog=mon_os`
- **URA**: —

### App

- **href**: `app/mon_app.html`
- **permissão (legado)**: —
- **arquivo resolvido**: `mon_app.html`
- **JS**: `mon_app.js`, `mon_app.js`
- **xml.php (views)**: —
- **server.php (writes)**: —
- **server2.php (writes)**: `mon_app`
- **mysql*.php (reads)**: `mysql7.php?prog=mon_app`
- **URA**: —

## Observações importantes (para migração)

- Muitos módulos PBX do legado são **CRUD sobre XML** (não “regra de dialplan” em si). No novo, isso vira **tabelas Postgres** + materialização para Asterisk Realtime.
- Relatórios (`cdr`, `queue_log`, etc.) no legado são SQL direto (alta superfície de SQLi). No novo, precisa virar query parametrizada + RBAC/tenant isolation.
- Alguns endpoints legados executam comandos no SO (ex.: conversão de áudio). No novo, substituir por serviço controlado (ffmpeg) e fila/worker.
