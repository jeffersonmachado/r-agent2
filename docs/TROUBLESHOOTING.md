# Troubleshooting

## PWA não instala
Verificar:
manifest.webmanifest  
sw.js  

## Toast de atualização não aparece
Verificar service worker ativo

DevTools → Application → Service Workers

## Offline não funciona
Verificar service worker registrado

## Manifest não carrega
Verificar base path correto

Exemplo:
/r-agent2/manifest.webmanifest

## Deploy não atualiza frontend
Executar deploy com rebuild:

docker compose up -d --build

## Push não funciona
Verificar:
- permissão do navegador
- VAPID keys
- subscription salva no backend