# 🔧 Problema: Assets Relativos e Cache

## Problema Identificado

O navegador está tentando carregar `/assets/index-Tr-6zWG8.js` (sem o prefixo `/r-agent2/`), e o Apache está tentando servir como arquivo físico em vez de fazer proxy.

**Logs do Apache:**
```
uri: /assets/index-Tr-6zWG8.js
AH00128: File does not exist: /var/www/html/results/assets/index-Tr-6zWG8.js
```

Isso indica que:
1. O HTML que o navegador recebeu tem URLs relativas (`/assets/...`) em vez de `/r-agent2/assets/...`
2. O `sub_filter` do nginx não está sendo aplicado ou o HTML está sendo servido de cache

## Soluções Aplicadas

### 1. Headers de Cache no Nginx

Adicionados headers para desabilitar cache do HTML:
```nginx
add_header Cache-Control "no-cache, no-store, must-revalidate";
add_header Pragma "no-cache";
add_header Expires "0";
```

### 2. Verificação do `sub_filter`

O nginx está reescrevendo corretamente quando testado diretamente:
```bash
curl -s http://127.0.0.1:8086/ | grep assets
# Resultado: src="/r-agent2/assets/index-xxkKJi-g.js" ✅
```

## Próximos Passos

### 1. Limpar Cache do Navegador

O navegador pode estar usando uma versão antiga do HTML em cache. Faça:
- **Chrome/Edge**: `Ctrl+Shift+Delete` → Limpar cache
- **Firefox**: `Ctrl+Shift+Delete` → Limpar cache
- Ou use **Modo Anônimo/Incógnito** para testar

### 2. Verificar se o Apache está fazendo Cache

Adicione no Apache (se necessário):
```apache
# Desabilita cache para /r-agent2/
<LocationMatch "^/r-agent2/">
    Header set Cache-Control "no-cache, no-store, must-revalidate"
    Header set Pragma "no-cache"
    Header set Expires "0"
</LocationMatch>
```

### 3. Forçar Rebuild do Container

Se o problema persistir, force um rebuild completo:
```bash
cd /opt/results/ria/r-agent2
docker-compose -f docker-compose.prod.yml build --no-cache frontend
docker-compose -f docker-compose.prod.yml up -d frontend
```

### 4. Verificar HTML Servido

Teste diretamente no servidor:
```bash
# Testar HTML servido pelo nginx
curl -s http://10.10.2.30:8086/ | grep -E '(src|href).*assets'

# Deve mostrar: /r-agent2/assets/...
```

### 5. Verificar via Apache

Teste através do Apache:
```bash
# Testar HTML servido via Apache
curl -s -H "Host: results.com.br" https://results.com.br/r-agent2/ | grep -E '(src|href).*assets'

# Deve mostrar: /r-agent2/assets/...
```

## Diagnóstico

Se o HTML servido via Apache ainda tiver URLs relativas (`/assets/...`), o problema pode ser:

1. **Cache do Apache**: O Apache pode estar fazendo cache do HTML antes do `sub_filter` ser aplicado
2. **Ordem das Diretivas**: O `sub_filter` pode não estar sendo aplicado quando há proxy
3. **Múltiplos Containers**: Pode haver múltiplos containers rodando com versões diferentes

## Solução Alternativa: Configurar Vite para Gerar URLs com Prefixo

Se o problema persistir, podemos configurar o Vite para gerar URLs com o prefixo diretamente:

```javascript
// vite.config.mjs
export default defineConfig({
  base: '/r-agent2/',
  // ...
});
```

Mas isso requer rebuild completo e pode afetar o desenvolvimento local.

## Status Atual

- ✅ Nginx `sub_filter` configurado corretamente
- ✅ Headers de cache adicionados no nginx
- ⚠️ Navegador pode estar usando cache antigo
- ⚠️ Apache pode precisar de headers de cache também

## Teste Imediato

1. **Limpe o cache do navegador** (Ctrl+Shift+Delete)
2. **Acesse em modo anônimo**: `https://results.com.br/r-agent2/`
3. **Abra DevTools (F12)** → Network
4. **Verifique se os assets estão sendo carregados de `/r-agent2/assets/...`**

Se ainda estiver carregando de `/assets/...`, o problema é cache ou o `sub_filter` não está funcionando via proxy do Apache.
