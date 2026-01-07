# Configuração Apache para r-agent2

## 📋 Informações

- **Servidor Docker**: 10.10.2.30
- **Servidor Apache**: 10.10.2.55
- **Frontend**: Porta 8086 (http://10.10.2.30:8086)
- **Rota no Apache**: `/r-agent2/`
- **Acesso**: https://results.com.br/r-agent2/

## 🔧 Configuração

### 1. Adicionar no arquivo `results-le-ssl.conf`

Adicione as seguintes linhas dentro do VirtualHost `127.0.0.1:443` do `results.com.br`, 
após as outras configurações de ProxyPass (por exemplo, após a linha do `/n8n/`):

```apache
# WebSocket do r-agent2 (tempo real)
# IMPORTANTE: Esta configuração deve vir ANTES do ProxyPass geral /r-agent2/
# O Apache precisa do módulo mod_proxy_wstunnel habilitado
# Verifique: apachectl -M | grep proxy_wstunnel
# Se não estiver, habilite: a2enmod proxy_wstunnel (Debian/Ubuntu)
ProxyPass        "/r-agent2/ws"  "ws://10.10.2.30:8086/api/ws"
ProxyPassReverse "/r-agent2/ws"  "ws://10.10.2.30:8086/api/ws"
ProxyPass        "/r-agent2/api/ws"  "ws://10.10.2.30:8086/api/ws"
ProxyPassReverse "/r-agent2/api/ws"  "ws://10.10.2.30:8086/api/ws"

# Rota principal para r-agent2 (frontend + API)
# IMPORTANTE: Tudo relacionado ao r-agent2 deve ter o prefixo /r-agent2/
ProxyPass        "/r-agent2/"  "http://10.10.2.30:8086/" nocanon
ProxyPassReverse "/r-agent2/"  "http://10.10.2.30:8086/"

# Assets do r-agent2 (arquivos JS, CSS, etc.)
# IMPORTANTE: Apenas assets do r-agent2, não global /assets/ (outros serviços usam /assets/)
ProxyPass        "/r-agent2/assets/"  "http://10.10.2.30:8086/assets/" nocanon
ProxyPassReverse "/r-agent2/assets/"  "http://10.10.2.30:8086/assets/"

# Garante que os cookies e headers sejam preservados
# IMPORTANTE: Isso ajusta o caminho dos cookies para funcionar corretamente com o prefixo /r-agent2/
ProxyPassReverseCookiePath "/" "/r-agent2/"
```

**Importante:** 
- O proxy de `/assets/` foi removido para não conflitar com outros serviços
- Apenas `/r-agent2/assets/` é proxyado
- O nginx do frontend foi configurado para reescrever URLs de assets no HTML de `/assets/` para `/r-agent2/assets/`

**Nota:** Não são necessárias linhas `ProxyPassReverse` específicas para `/login`, `/dashboard`, `/support` porque:
- O frontend é uma SPA React que usa redirecionamentos JavaScript (não HTTP)
- Não há redirecionamentos HTTP do servidor (301/302) para essas rotas
- O script JavaScript injetado no nginx já corrige os redirecionamentos via `pushState`

### 2. Localização exata no arquivo

Adicione após a seção do n8n, por exemplo:

```apache
# WebSocket do n8n (tempo real)
ProxyPass        "/n8n/socket"  "ws://10.10.2.30:5678/socket"
ProxyPassReverse "/n8n/socket"  "ws://10.10.2.30:5678/socket"

# Garante que o cookie do n8n fique restrito ao subpath /n8n/
ProxyPassReverseCookiePath "/" "/n8n/"

# ===== ADICIONAR AQUI =====
# Rota principal para r-agent2 (frontend + API)
# IMPORTANTE: Tudo relacionado ao r-agent2 deve ter o prefixo /r-agent2/
ProxyPass        "/r-agent2/"  "http://10.10.2.30:8086/" nocanon
ProxyPassReverse "/r-agent2/"  "http://10.10.2.30:8086/"

# Assets do r-agent2 (arquivos JS, CSS, etc.)
# IMPORTANTE: Apenas assets do r-agent2, não global /assets/ (outros serviços usam /assets/)
ProxyPass        "/r-agent2/assets/"  "http://10.10.2.30:8086/assets/" nocanon
ProxyPassReverse "/r-agent2/assets/"  "http://10.10.2.30:8086/assets/"

# WebSocket do r-agent2 (tempo real)
# IMPORTANTE: Esta configuração deve vir ANTES do ProxyPass geral /r-agent2/
# O Apache precisa do módulo mod_proxy_wstunnel habilitado para WebSocket
# Verifique se está habilitado: apachectl -M | grep proxy_wstunnel
# Se não estiver, habilite: a2enmod proxy_wstunnel (Debian/Ubuntu) ou equivalente
ProxyPass        "/r-agent2/ws"  "ws://10.10.2.30:8086/api/ws"
ProxyPassReverse "/r-agent2/ws"  "ws://10.10.2.30:8086/api/ws"
ProxyPass        "/r-agent2/api/ws"  "ws://10.10.2.30:8086/api/ws"
ProxyPassReverse "/r-agent2/api/ws"  "ws://10.10.2.30:8086/api/ws"

# Garante que os cookies e headers sejam preservados
# IMPORTANTE: Isso ajusta o caminho dos cookies para funcionar corretamente
ProxyPassReverseCookiePath "/" "/r-agent2/"
# ===== FIM DA ADIÇÃO =====

	ProxyPass /suporte http://10.10.2.7:8001/newcentral
	ProxyPassReverse /suporte http://10.10.2.7:8001/newcentral
```

### 3. Reiniciar Apache

Após adicionar a configuração:

```bash
# Testar configuração
apachectl configtest

# Se estiver OK, reiniciar
systemctl restart httpd
# ou
systemctl restart apache2
```

## ✅ Verificação

Após reiniciar o Apache, teste:

```bash
# Verificar se a rota está funcionando
curl -I https://results.com.br/r-agent2/

# Verificar logs do Apache
tail -f /var/log/httpd/error_log
# ou
tail -f /var/log/apache2/error.log
```

## 🔍 Troubleshooting

### Erro 502 Bad Gateway
- Verifique se o container do frontend está rodando no servidor 10.10.2.30: `ssh 10.10.2.30 'docker ps | grep r-agent2-frontend'`
- Verifique se a porta 8086 está acessível do servidor Apache: `curl http://10.10.2.30:8086`
- Verifique conectividade de rede entre os servidores: `ping 10.10.2.30`
- Verifique firewall: a porta 8086 deve estar acessível do 10.10.2.55 para o 10.10.2.30

### Erro 404 Not Found em assets (JS, CSS)
- **Problema comum**: Os arquivos `/assets/index-*.js` e `/assets/index-*.css` retornam 404
- **Solução**: 
  - O proxy está configurado apenas para `/r-agent2/assets/` (não global `/assets/`)
  - O nginx do frontend reescreve URLs de assets no HTML de `/assets/` para `/r-agent2/assets/`
  - Após rebuild do frontend, os assets devem carregar corretamente
  - Verifique se o nginx está reescrevendo: `curl http://10.10.2.30:8086/ | grep assets`
  - Verifique os logs: `tail -f /var/log/httpd/error_log | grep assets`

### Erro 404 Not Found na rota principal
- Verifique se a rota está configurada corretamente no Apache
- Verifique os logs do Apache para mais detalhes: `tail -f /var/log/httpd/error_log`

### WebSocket não conecta (erro 1006 ou conexão fechada)
- **Problema**: O frontend tenta conectar em `wss://results.com.br/r-agent2/ws` mas falha
- **Solução**: 
  1. Verifique se o módulo `mod_proxy_wstunnel` está habilitado:
     ```bash
     apachectl -M | grep proxy_wstunnel
     ```
  2. Se não estiver habilitado, habilite:
     ```bash
     # Debian/Ubuntu
     a2enmod proxy_wstunnel
     systemctl restart apache2
     
     # CentOS/RHEL
     # Edite /etc/httpd/conf.modules.d/00-proxy.conf e descomente:
     # LoadModule proxy_wstunnel_module modules/mod_proxy_wstunnel.so
     systemctl restart httpd
     ```
  3. Verifique se a configuração do WebSocket está ANTES do ProxyPass geral `/r-agent2/`:
     ```apache
     # WebSocket PRIMEIRO (antes do ProxyPass geral)
     ProxyPass        "/r-agent2/ws"  "ws://10.10.2.30:8086/api/ws"
     ProxyPassReverse "/r-agent2/ws"  "ws://10.10.2.30:8086/api/ws"
     
     # Depois o ProxyPass geral
     ProxyPass        "/r-agent2/"  "http://10.10.2.30:8086/" nocanon
     ```
  4. Teste a conexão WebSocket:
     ```bash
     # No servidor Apache, teste se o nginx do frontend está respondendo
     curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: test" http://10.10.2.30:8086/api/ws
     ```
  5. Verifique os logs do Apache:
     ```bash
     tail -f /var/log/httpd/error_log | grep -i websocket
     ```

### Problemas com cookies/sessão
- O `ProxyPassReverseCookiePath` deve garantir que os cookies funcionem corretamente
- Verifique se o frontend está configurado para aceitar requisições do domínio results.com.br

### Conflito com outros assets
- Se você tiver outros serviços usando `/assets/`, pode ser necessário usar uma condição mais específica
- Alternativa: Configure o frontend para usar um base path diferente (requer rebuild)

### Redirecionamentos sem o prefixo /r-agent2/
- **Problema**: Quando o frontend redireciona para `/login`, ele vai para `results.com.br/login` em vez de `results.com.br/r-agent2/login`
- **Solução aplicada**: O nginx do frontend foi configurado para injetar um script que intercepta `window.history.pushState` e ajusta as rotas automaticamente
- **Requer rebuild**: Após modificar `frontend/nginx.conf`, é necessário reconstruir a imagem Docker do frontend:
  ```bash
  # No servidor Docker (10.10.2.30)
  cd /opt/results/ria/r-agent2
  docker-compose -f docker-compose.prod.yml build frontend
  docker-compose -f docker-compose.prod.yml up -d frontend
  ```
- **Alternativa sem rebuild**: Se não puder fazer rebuild agora, os redirecionamentos JavaScript continuarão sem o prefixo, mas os redirecionamentos HTTP do servidor serão corrigidos pelo ProxyPassReverse

