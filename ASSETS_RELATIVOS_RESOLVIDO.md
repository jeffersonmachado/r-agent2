# ✅ Problema de Assets Relativos Resolvido

## Problema Identificado

O usuário reportou que "assets é relativo". Isso significa que quando o navegador carrega o HTML via Apache, as URLs de assets são relativas (`/assets/index.js`), e o navegador tenta carregar `https://results.com.br/assets/index.js` (sem o prefixo `/r-agent2/`), o que não funciona.

## Solução Implementada

### 1. Nginx `sub_filter` Aprimorado

O nginx do frontend agora reescreve **todas** as URLs relativas de assets no HTML:

```nginx
# Reescreve URLs de assets
sub_filter 'src="/assets/' 'src="/r-agent2/assets/';
sub_filter 'href="/assets/' 'href="/r-agent2/assets/';
sub_filter '"/assets/' '"/r-agent2/assets/';
# Também captura aspas simples
sub_filter "src='/assets/" "src='/r-agent2/assets/";
sub_filter "href='/assets/" "href='/r-agent2/assets/";
sub_filter "'/assets/" "'/r-agent2/assets/";
```

### 2. Verificação

Teste realizado:
```bash
curl -s http://127.0.0.1:8086/ | grep assets
```

**Resultado:**
```html
<script type="module" crossorigin src="/r-agent2/assets/index-xxkKJi-g.js"></script>
<link rel="stylesheet" crossorigin href="/r-agent2/assets/index-DrgOCslM.css">
```

✅ **URLs estão sendo reescritas corretamente!**

## Como Funciona

1. **Vite gera HTML** com URLs relativas: `/assets/index.js`
2. **Nginx recebe requisição** e serve o HTML
3. **Nginx aplica `sub_filter`** e reescreve para `/r-agent2/assets/index.js`
4. **Navegador recebe HTML** com URLs corretas: `/r-agent2/assets/index.js`
5. **Navegador faz requisição** para `https://results.com.br/r-agent2/assets/index.js`
6. **Apache faz proxy** de `/r-agent2/assets/` para `http://10.10.2.30:8086/assets/`
7. **Nginx serve o arquivo** estático

## Status

- ✅ Assets JS/CSS sendo reescritos corretamente
- ✅ Nginx `sub_filter` funcionando
- ⚠️ Favicon ainda não está sendo reescrito (não crítico, pode ser ajustado depois)

## Próximos Passos

1. Testar no navegador acessando `https://results.com.br/r-agent2/`
2. Verificar se os assets estão carregando corretamente
3. Se necessário, ajustar o favicon (não crítico)

## Arquivos Modificados

- `/opt/results/ria/r-agent2/frontend/nginx.conf` - Adicionados mais padrões de `sub_filter` para capturar todas as variações de URLs relativas
