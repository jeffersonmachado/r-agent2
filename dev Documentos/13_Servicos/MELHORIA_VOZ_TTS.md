# 🔊 Melhoria da Qualidade da Voz (TTS)

## Problema Identificado

A voz estava com som "metalizado" devido ao uso padrão da Web Speech API sem otimizações.

## Solução Implementada

Foi criado um utilitário de Text-to-Speech (`textToSpeech.js`) com configurações otimizadas para melhorar a qualidade da voz.

### Melhorias Aplicadas

1. **Seleção Inteligente de Voz**
   - Prioriza vozes de alta qualidade em português do Brasil
   - Lista de vozes preferidas:
     - Microsoft Maria - Portuguese (Brazil)
     - Microsoft Heloisa - Portuguese (Brazil)
     - Google português do Brasil
     - Microsoft Daniel - Portuguese (Brazil)

2. **Configurações de Qualidade Otimizadas**
   - **Rate**: 0.95 (ligeiramente mais lento para melhor clareza)
   - **Pitch**: 0.98 (tom ligeiramente mais baixo, mais natural)
   - **Volume**: 0.9 (volume ligeiramente reduzido para evitar distorção)

3. **Aguardo de Carregamento de Vozes**
   - Garante que as vozes estejam carregadas antes de falar
   - Suporta navegadores que carregam vozes de forma assíncrona

4. **Gerenciamento de Fala**
   - Para automaticamente fala anterior quando nova mensagem chega
   - Limpa recursos quando componente é desmontado

## Integração no Chat

O TTS foi integrado no componente `FlowTestChat`:

- ✅ Toggle no cabeçalho para ativar/desativar
- ✅ Fala automaticamente mensagens do bot quando habilitado
- ✅ Remove formatação e opções antes de falar
- ✅ Para fala quando desabilitado ou componente fecha

## Como Usar

1. **No Chat de Teste**:
   - Abra o chat de teste de um fluxo
   - Clique no toggle "🔊 Voz" no cabeçalho
   - As mensagens do bot serão faladas automaticamente

2. **Programaticamente**:
```javascript
import { speak, stopSpeaking, isAvailable } from '../utils/textToSpeech';

// Verifica se TTS está disponível
if (isAvailable()) {
  // Fala com configurações de qualidade
  await speak('Olá, como posso ajudar?', {
    useQualitySettings: true, // Usa configurações otimizadas
  });
  
  // Para qualquer fala em andamento
  stopSpeaking();
}
```

## Configurações Disponíveis

```javascript
await speak(texto, {
  useQualitySettings: true,  // Usa configurações de qualidade (padrão: true)
  rate: 0.95,                // Velocidade (0.1 a 10)
  pitch: 0.98,               // Tom (0 a 2)
  volume: 0.9,               // Volume (0 a 1)
  lang: 'pt-BR',             // Idioma
  onStart: () => {},         // Callback quando começar
  onEnd: () => {},           // Callback quando terminar
  onError: (error) => {},    // Callback em caso de erro
});
```

## Vozes Disponíveis

Para ver todas as vozes disponíveis no sistema:

```javascript
import { getAvailableVoices } from '../utils/textToSpeech';

const voices = getAvailableVoices();
console.log(voices.map(v => ({ name: v.name, lang: v.lang })));
```

## Compatibilidade

- ✅ Chrome/Edge (melhor suporte)
- ✅ Firefox
- ✅ Safari (suporte limitado)
- ✅ Opera

**Nota**: A qualidade pode variar dependendo do navegador e do sistema operacional. Navegadores baseados em Chromium geralmente oferecem melhor qualidade.

## Melhorias Futuras

- [ ] Suporte para múltiplas vozes (masculina/feminina)
- [ ] Ajuste de velocidade em tempo real
- [ ] Cache de vozes para melhor performance
- [ ] Integração com APIs de TTS externas (Google Cloud TTS, Amazon Polly)
- [ ] Suporte para SSML (Speech Synthesis Markup Language)

## Arquivos Modificados

- ✅ `frontend/src/utils/textToSpeech.js` - Novo utilitário de TTS
- ✅ `frontend/src/components/FlowTestChat.jsx` - Integração do TTS no chat

## Testes

Para testar a melhoria:

1. Abra o chat de teste de um fluxo
2. Ative o toggle "🔊 Voz"
3. Envie uma mensagem e observe a qualidade da voz
4. Compare com a voz anterior (se disponível)

A voz deve soar mais natural e menos "metalizada" com as novas configurações.

---

**Data**: 02/01/2026  
**Status**: ✅ Implementado e testado

