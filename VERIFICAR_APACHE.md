# Verificação da Configuração do Apache

## ❌ Problema Identificado

O Apache está tentando servir `/r-agent2` como arquivo físico:
```
AH00128: File does not exist: /var/www/html/results/r-agent2
```

Isso significa que a configuração do `ProxyPass` não está sendo aplicada ou está sendo sobrescrita.

## ✅ Solução

### 1. Verificar se a configuração foi adicionada

Execute no servidor Apache (10.10.2.55):

```bash
# Verificar se a configuração existe
grep -r "r-agent2" /etc/httpd/conf.d/results-le-ssl.conf
# ou
grep -r "r-agent2" /etc/apache2/sites-available/results-le-ssl.conf
```

### 2. Adicionar a configuração

Adicione estas linhas no arquivo `/etc/httpd/conf.d/results-le-ssl.conf` (ou equivalente), 
**dentro do VirtualHost `127.0.0.1:443` do `results.com.br`**, após as outras configurações de ProxyPass:

```apache
# Rota principal para r-agent2 (frontend + API)
ProxyPass        "/r-agent2/"  "http://10.10.2.30:8086/" nocanon
ProxyPassReverse "/r-agent2/"  "http://10.10.2.30:8086/"

# Assets do r-agent2 (arquivos JS, CSS, etc.)
# IMPORTANTE: Apenas assets do r-agent2, não global /assets/ (outros serviços usam /assets/)
ProxyPass        "/r-agent2/assets/"  "http://10.10.2.30:8086/assets/" nocanon
ProxyPassReverse "/r-agent2/assets/"  "http://10.10.2.30:8086/assets/"

# Garante que os cookies e headers sejam preservados
ProxyPassReverseCookiePath "/" "/r-agent2/"
```

### 3. IMPORTANTE: Ordem das diretivas

A configuração do `ProxyPass` para `/r-agent2/` deve vir **ANTES** de qualquer configuração de `DocumentRoot` ou `Directory` que possa capturar essa rota.

Se houver algo como:
```apache
<Directory "/var/www/html/results">
    Require all granted
</Directory>
```

O `ProxyPass` deve vir **ANTES** dessa seção, ou use uma condição mais específica.

### 4. Testar e reiniciar

```bash
# Testar configuração
apachectl configtest

# Se estiver OK, reiniciar
systemctl restart httpd
# ou
systemctl restart apache2
```

### 5. Verificar se está funcionando

```bash
# Verificar logs
tail -f /var/log/httpd/error_log | grep r-agent2

# Testar acesso
curl -I https://results.com.br/r-agent2/
```

## 🔍 Troubleshooting

### Se ainda não funcionar:

1. **Verificar se o módulo proxy está habilitado:**
   ```bash
   apachectl -M | grep proxy
   # Deve mostrar: proxy_module, proxy_http_module
   ```

2. **Verificar ordem das diretivas:**
   - `ProxyPass` deve vir antes de `DocumentRoot` ou `Directory`
   - Use `ProxyPass` com `nocanon` para preservar a URL original

3. **Verificar se há conflito com outras rotas:**
   ```bash
   grep -n "ProxyPass\|DocumentRoot\|Directory" /etc/httpd/conf.d/results-le-ssl.conf
   ```

4. **Testar conectividade:**
   ```bash
   # Do servidor Apache (10.10.2.55)
   curl http://10.10.2.30:8086/
   ```
