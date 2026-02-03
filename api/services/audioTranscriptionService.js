/**
 * Serviço de Transcrição de Áudio.
 *
 * Responsabilidades:
 * - Converter áudios do WhatsApp em texto
 * - Suportar diferentes formatos de áudio
 * - Integrar com serviços de transcrição (OpenAI Whisper, Google Speech-to-Text, etc.)
 */

const { generateAiResponse } = require('./aiProviderService');
const config = require('../utils/config');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

/**
 * Baixa arquivo de áudio de uma URL.
 * @param {string} url - URL do áudio
 * @returns {Promise<Buffer>}
 */
async function downloadAudio(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    
    protocol.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Falha ao baixar áudio: ${response.statusCode}`));
        return;
      }
      
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Salva buffer de áudio temporariamente.
 * @param {Buffer} audioBuffer
 * @param {string} extension
 * @returns {Promise<string>} - Caminho do arquivo
 */
async function saveTempAudio(audioBuffer, extension = 'ogg') {
  const tempDir = path.join(__dirname, '..', '..', 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  const filename = `audio_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${extension}`;
  const filepath = path.join(tempDir, filename);
  
  fs.writeFileSync(filepath, audioBuffer);
  
  // Remove arquivo após 1 hora
  setTimeout(() => {
    try {
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }
    } catch (err) {
      logger.warn('[AudioTranscription] Erro ao remover arquivo temporário:', err);
    }
  }, 60 * 60 * 1000);
  
  return filepath;
}

/**
 * Transcreve áudio usando OpenAI Whisper API.
 * @param {Buffer|string} audioData - Buffer do áudio ou URL
 * @param {string} [tenantId]
 * @returns {Promise<{text: string, language?: string}>}
 */
async function transcribeWithWhisper(audioData, tenantId) {
  try {
    if (!tenantId) {
      throw new Error('TenantId é obrigatório para transcrição (credenciais por tenant)');
    }
    // Resolve API key EXCLUSIVAMENTE por tenant (DB, criptografada)
    const { getDecryptedAPIKey } = require('./tenantAIService');
    const apiKey = await getDecryptedAPIKey(String(tenantId), 'openai');
    if (!apiKey || !String(apiKey).trim()) {
      throw new Error(`OpenAI API key não configurada para o tenant: ${tenantId}`);
    }
    
    let audioBuffer;
    let audioFile;
    
    // Se for URL, baixa o áudio
    if (typeof audioData === 'string' && audioData.startsWith('http')) {
      audioBuffer = await downloadAudio(audioData);
      audioFile = await saveTempAudio(audioBuffer, 'ogg');
    } else if (Buffer.isBuffer(audioData)) {
      audioFile = await saveTempAudio(audioData, 'ogg');
    } else {
      throw new Error('Formato de áudio não suportado');
    }
    
    // Tenta usar SDK OpenAI se disponível
    let OpenAI;
    try {
      OpenAI = require('openai');
      const openai = new OpenAI({ apiKey });
      
      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(audioFile),
        model: 'whisper-1',
        language: 'pt', // Português
      });
      
      // Remove arquivo temporário
      try {
        if (fs.existsSync(audioFile)) {
          fs.unlinkSync(audioFile);
        }
      } catch (err) {
        // Ignora erro ao remover
      }
      
      return {
        text: transcription.text,
        language: transcription.language || 'pt',
      };
    } catch (sdkError) {
      // SDK não disponível ou erro: usa API direta
      logger.debug('[AudioTranscription] SDK não disponível, usando API direta');
      
      const FormData = require('form-data');
      const form = new FormData();
      form.append('file', fs.createReadStream(audioFile));
      form.append('model', 'whisper-1');
      form.append('language', 'pt');
      
      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          ...form.getHeaders(),
        },
        body: form,
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `OpenAI API error: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Remove arquivo temporário
      try {
        if (fs.existsSync(audioFile)) {
          fs.unlinkSync(audioFile);
        }
      } catch (err) {
        // Ignora erro ao remover
      }
      
      return {
        text: data.text,
        language: data.language || 'pt',
      };
    }
  } catch (error) {
    logger.error('[AudioTranscription] Erro ao transcrever com Whisper:', error);
    throw error;
  }
}

/**
 * Transcreve áudio usando método genérico (fallback).
 * @param {Buffer|string} audioData
 * @param {string} [tenantId]
 * @returns {Promise<{text: string}>}
 */
async function transcribeGeneric(audioData, tenantId) {
  // Fallback: retorna mensagem indicando que transcrição não está disponível
  logger.warn('[AudioTranscription] Transcrição genérica não implementada');
  return {
    text: '[Áudio recebido - transcrição não disponível. Configure OpenAI Whisper para ativar esta funcionalidade.]',
  };
}

/**
 * Transcreve áudio (método principal).
 * @param {Object} options
 * @param {Buffer|string} options.audioData - Buffer ou URL do áudio
 * @param {string} [options.provider] - 'whisper', 'generic'
 * @param {string} [options.tenantId]
 * @returns {Promise<{text: string, language?: string, provider?: string}>}
 */
async function transcribeAudio(options) {
  const { audioData, provider = 'whisper', tenantId } = options;
  
  if (!audioData) {
    throw new Error('Dados de áudio são obrigatórios');
  }
  
  try {
    let result;
    
    if (provider === 'whisper') {
      result = await transcribeWithWhisper(audioData, tenantId);
      result.provider = 'whisper';
    } else {
      result = await transcribeGeneric(audioData, tenantId);
      result.provider = 'generic';
    }
    
    return result;
  } catch (error) {
    logger.error('[AudioTranscription] Erro na transcrição:', error);
    
    // Retorna erro amigável
    return {
      text: `[Erro ao transcrever áudio: ${error.message}]`,
      error: error.message,
      provider,
    };
  }
}

/**
 * Processa mensagem de áudio do WhatsApp.
 * @param {Object} audioMessage - Mensagem de áudio do webhook do WhatsApp
 * @param {string} [tenantId]
 * @returns {Promise<{text: string, language?: string}>}
 */
async function processWhatsAppAudio(audioMessage, tenantId) {
  try {
    // Extrai URL do áudio da mensagem do WhatsApp
    const audioUrl = audioMessage.audio?.id 
      ? `https://graph.facebook.com/v18.0/${audioMessage.audio.id}`
      : audioMessage.audio?.url;
    
    if (!audioUrl) {
      throw new Error('URL do áudio não encontrada na mensagem');
    }
    
    // Adiciona token de acesso se necessário
    const accessToken = config.get('whatsapp.accessToken');
    const finalUrl = accessToken 
      ? `${audioUrl}?access_token=${accessToken}`
      : audioUrl;
    
    logger.info('[AudioTranscription] Processando áudio do WhatsApp', {
      audioId: audioMessage.audio?.id,
      hasUrl: !!audioUrl,
    });
    
    return await transcribeAudio({
      audioData: finalUrl,
      provider: 'whisper',
      tenantId,
    });
  } catch (error) {
    logger.error('[AudioTranscription] Erro ao processar áudio do WhatsApp:', error);
    throw error;
  }
}

module.exports = {
  transcribeAudio,
  processWhatsAppAudio,
  transcribeWithWhisper,
};

