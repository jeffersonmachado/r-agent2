# Solução: Assets com Prefixo /r-agent2/

## 🎯 Problema

O Apache atende múltiplos serviços que usam `/assets/`, então não podemos fazer um proxy global de `/assets/` porque conflitaria com outros sistemas.

## ✅ Solução Implementada

### 1. **Apache - Proxy apenas de `/r-agent2/assets/`**

```apache
# Apenas assets do r-agent2, não global /assets/
ProxyPass        "/r-agent2/assets/"  "http://10.10.2.30:8086/assets/" nocanon
ProxyPassReverse "/r-agent2/assets/"  "http://10.10.2.30:8086/assets/"
```

**Importante:** Não há proxy global de `/assets/` para não conflitar com outros serviços.

### 2. **Nginx do Frontend - Reescreve URLs no HTML**

O nginx do frontend foi configurado para reescrever as URLs de assets no HTML:

```nginx
# Reescreve URLs de assets no HTML para incluir o prefixo /r-agent2/
sub_filter 'href="/assets/' 'href="/r-agent2/assets/';
sub_filter 'src="/assets/' 'src="/r-agent2/assets/';
sub_filter '"/assets/' '"/r-agent2/assets/';
sub_filter_once off;  # Permite múltiplas substituições
sub_filter_types text/html;
```

**Como funciona:**
- O Vite gera HTML com URLs como `/assets/index-xxx.js`
- O nginx reescreve para `/r-agent2/assets/index-xxx.js` no HTML
- O Apache faz proxy de `/r-agent2/assets/` para o Docker
- Outros serviços continuam usando `/assets/` normalmente

### 3. **Script JavaScript para Rotas**

O script injetado no HTML também corrige as rotas JavaScript (já estava implementado).

## 📋 Fluxo Completo

```
1. Usuário acessa: https://results.com.br/r-agent2/
   ↓
2. Apache faz proxy para: http://10.10.2.30:8086/
   ↓
3. Nginx do frontend serve index.html
   ↓
4. Nginx reescreve URLs no HTML:
   - /assets/index.js → /r-agent2/assets/index.js
   ↓
5. Browser solicita: /r-agent2/assets/index.js
   ↓
6. Apache faz proxy para: http://10.10.2.30:8086/assets/index.js
   ↓
7. Nginx do frontend serve o arquivo
```

## 🔧 Configuração Final

### Apache (`results-le-ssl.conf`)

```apache
# Rota principal
ProxyPass        "/r-agent2/"  "http://10.10.2.30:8086/" nocanon
ProxyPassReverse "/r-agent2/"  "http://10.10.2.30:8086/"

# Assets apenas do r-agent2
ProxyPass        "/r-agent2/assets/"  "http://10.10.2.30:8086/assets/" nocanon
ProxyPassReverse "/r-agent2/assets/"  "http://10.10.2.30:8086/assets/"

# Cookies
ProxyPassReverseCookiePath "/" "/r-agent2/"
```

### Nginx do Frontend (`frontend/nginx.conf`)

```nginx
location / {
    try_files $uri $uri/ /index.html;
    
    # Reescreve URLs de assets
    sub_filter 'href="/assets/' 'href="/r-agent2/assets/';
    sub_filter 'src="/assets/' 'src="/r-agent2/assets/';
    sub_filter '"/assets/' '"/r-agent2/assets/';
    sub_filter_once off;
    sub_filter_types text/html;
    
    # Injeta script para rotas
    sub_filter '</head>' '<script>...</script></head>';
}
```

## ✅ Vantagens

1. **Isolamento**: Assets do r-agent2 não conflitam com outros serviços
2. **Sem mudanças no código**: Não precisa modificar o Vite ou o código React
3. **Transparente**: Funciona automaticamente após rebuild do frontend
4. **Compatível**: Outros serviços continuam usando `/assets/` normalmente

## 🔄 Próximos Passos

1. **Rebuild do frontend** (necessário para aplicar mudanças no nginx.conf):
   ```bash
   cd /opt/results/ria/r-agent2
   docker-compose -f docker-compose.prod.yml build frontend
   docker-compose -f docker-compose.prod.yml up -d frontend
   ```

2. **Adicionar configuração no Apache** conforme `apache-r-agent2.conf`

3. **Testar**:
   - Acesse: `https://results.com.br/r-agent2/`
   - Verifique no DevTools (F12) se os assets estão sendo carregados de `/r-agent2/assets/`
   - Verifique se outros serviços continuam funcionando normalmente

## 🔍 Verificação

```bash
# Verificar se o nginx está reescrevendo corretamente
curl http://10.10.2.30:8086/ | grep -o 'href="[^"]*assets[^"]*"'

# Deve mostrar: href="/r-agent2/assets/..."
```

## ⚠️ Notas Importantes

- O módulo `ngx_http_sub_module` deve estar habilitado no nginx
- O `sub_filter_once off` permite múltiplas substituições (necessário para vários assets)
- O `sub_filter_types text/html` garante que apenas HTML seja processado (não JS/CSS)


