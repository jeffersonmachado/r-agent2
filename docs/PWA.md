# Progressive Web App

O R-Agent2 funciona como PWA.

## Recursos
- instalação no dispositivo
- funcionamento offline
- atualização automática
- notificações push

## Instalação

Android:
Chrome detecta automaticamente e mostra botão:
Instalar aplicativo

iOS:
Compartilhar → Adicionar à Tela de Início

## Service Worker
Gerado pelo plugin:
vite-plugin-pwa

Arquivos importantes:
sw.js  
manifest.webmanifest  

## Atualização
Quando nova versão é publicada aparece:

Nova versão disponível

Usuário pode clicar:
Atualizar agora

## Push Notifications
Fluxo:

browser → service worker → push event → notification

Arquivo responsável:
pwa-webpush-sw.js