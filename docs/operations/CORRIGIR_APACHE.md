# 🔧 Como Corrigir o Apache - r-agent2 não está fazendo proxy

## ❌ Problema

O Apache está tentando servir `/r-agent2` como arquivo físico:
```
AH00128: File does not exist: /var/www/html/results/r-agent2
```

Isso significa que o `ProxyPass` não está sendo aplicado.

## ✅ Solução Passo a Passo

### 1. Localizar o arquivo de configuração

No servidor Apache (10.10.2.55):

```bash
# Verificar onde está a configuração SSL
ls -la /etc/httpd/conf.d/results-le-ssl.conf
# ou
ls -la /etc/apache2/sites-available/results-le-ssl.conf
```

### 2. Verificar se já existe configuração do r-agent2

```bash
grep -n "r-agent2" /etc/httpd/conf.d/results-le-ssl.conf
```

Se não retornar nada, a configuração não foi adicionada.

### 3. Localizar o VirtualHost correto

Procure por esta seção no arquivo:
```apache
<VirtualHost 127.0.0.1:443>
    ServerName results.com.br
    ServerAlias www.results.com.br
    ...
```

### 4. Adicionar a configuração ANTES das diretivas Directory

**IMPORTANTE:** A configuração do `ProxyPass` deve vir **ANTES** de qualquer `<Directory>` que possa capturar a rota.

Adicione estas linhas **dentro do VirtualHost**, **antes** de seções como:
```apache
<Directory "/var/www/html/results">
    Require all granted
</Directory>
```

### 5. Configuração completa a adicionar

```apache
# ===== CONFIGURAÇÃO r-agent2 =====
# Rota principal para r-agent2 (frontend + API)
ProxyPass        "/r-agent2/"  "http://10.10.2.30:8086/" nocanon
ProxyPassReverse "/r-agent2/"  "http://10.10.2.30:8086/"

# Assets do r-agent2 (arquivos JS, CSS, etc.)
ProxyPass        "/r-agent2/assets/"  "http://10.10.2.30:8086/assets/" nocanon
ProxyPassReverse "/r-agent2/assets/"  "http://10.10.2.30:8086/assets/"

# Garante que os cookies e headers sejam preservados
ProxyPassReverseCookiePath "/" "/r-agent2/"
# ===== FIM CONFIGURAÇÃO r-agent2 =====
```

### 6. Exemplo de onde adicionar

```apache
<VirtualHost 127.0.0.1:443>
    ServerName results.com.br
    ServerAlias www.results.com.br
    
    # ... outras configurações ...
    
    # ===== ADICIONAR AQUI =====
    # Configuração r-agent2
    ProxyPass        "/r-agent2/"  "http://10.10.2.30:8086/" nocanon
    ProxyPassReverse "/r-agent2/"  "http://10.10.2.30:8086/"
    ProxyPass        "/r-agent2/assets/"  "http://10.10.2.30:8086/assets/" nocanon
    ProxyPassReverse "/r-agent2/assets/"  "http://10.10.2.30:8086/assets/"
    ProxyPassReverseCookiePath "/" "/r-agent2/"
    # ===== FIM =====
    
    # Outras rotas (n8n, suporte, etc.)
    ProxyPass /n8n/ ...
    ProxyPass /suporte ...
    
    # Diretivas Directory (devem vir DEPOIS do ProxyPass)
    <Directory "/var/www/html/results">
        Require all granted
    </Directory>
</VirtualHost>
```

### 7. Testar e reiniciar

```bash
# Testar configuração
apachectl configtest

# Se mostrar "Syntax OK", reiniciar
systemctl restart httpd
# ou
systemctl restart apache2
```

### 8. Verificar se está funcionando

```bash
# Verificar logs em tempo real
tail -f /var/log/httpd/error_log | grep r-agent2

# Testar acesso
curl -I https://results.com.br/r-agent2/
# Deve retornar HTTP 200, não 404
```

## 🔍 Verificações Adicionais

### Se ainda não funcionar:

1. **Verificar se módulos proxy estão habilitados:**
   ```bash
   apachectl -M | grep proxy
   # Deve mostrar: proxy_module, proxy_http_module
   ```

2. **Verificar ordem das diretivas:**
   ```bash
   # Ver todas as diretivas ProxyPass e Directory
   grep -n "ProxyPass\|Directory" /etc/httpd/conf.d/results-le-ssl.conf
   ```

3. **Verificar se há Alias ou Redirect conflitante:**
   ```bash
   grep -n "Alias\|Redirect.*r-agent2" /etc/httpd/conf.d/results-le-ssl.conf
   ```

4. **Testar conectividade do Apache para o Docker:**
   ```bash
   # Do servidor Apache (10.10.2.55)
   curl -v http://10.10.2.30:8086/
   ```

## ⚠️ Erro Comum

Se você adicionar o `ProxyPass` **DEPOIS** de uma diretiva `<Directory>`, o Apache pode tentar servir o arquivo primeiro. Sempre coloque `ProxyPass` **ANTES** de `Directory`.
