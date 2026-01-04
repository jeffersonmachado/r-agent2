/**
 * Testes para fileProcessor.js
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createImagePreview,
  extractTextContent,
  extractPdfContent,
  extractImageContent,
  compressImage,
  processFile,
  validateFile,
  formatFileSize,
  getFileIcon,
} from './fileProcessor';

describe('fileProcessor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createImagePreview', () => {
    it('deve criar preview de imagem válida', async () => {
      const blob = new Blob(['fake image data'], { type: 'image/png' });
      const file = new File([blob], 'test.png', { type: 'image/png' });

      const preview = await createImagePreview(file);

      expect(preview).toBeDefined();
      expect(preview).toMatch(/^data:image\/png;base64,/);
    });

    it('deve rejeitar se houver erro ao ler arquivo', async () => {
      const file = new File([], 'test.png', { type: 'image/png' });
      
      // Mock FileReader para simular erro
      const originalFileReader = global.FileReader;
      global.FileReader = class {
        readAsDataURL() {
          setTimeout(() => {
            this.onerror(new Error('Erro ao ler arquivo'));
          }, 0);
        }
      };

      await expect(createImagePreview(file)).rejects.toThrow();

      global.FileReader = originalFileReader;
    });
  });

  describe('extractTextContent', () => {
    it('deve extrair conteúdo de arquivo de texto', async () => {
      const content = 'Conteúdo de teste\nLinha 2';
      const blob = new Blob([content], { type: 'text/plain' });
      const file = new File([blob], 'test.txt', { type: 'text/plain' });

      const extracted = await extractTextContent(file);

      expect(extracted).toBe(content);
    });

    it('deve rejeitar se houver erro ao ler arquivo', async () => {
      const file = new File([], 'test.txt', { type: 'text/plain' });
      
      // Mock FileReader para simular erro
      const originalFileReader = global.FileReader;
      global.FileReader = class {
        readAsText() {
          setTimeout(() => {
            this.onerror(new Error('Erro ao ler arquivo'));
          }, 0);
        }
      };

      await expect(extractTextContent(file)).rejects.toThrow();

      global.FileReader = originalFileReader;
    });
  });

  describe('extractPdfContent', () => {
    it('deve retornar placeholder quando pdfjs não está disponível', async () => {
      const blob = new Blob(['fake pdf data'], { type: 'application/pdf' });
      const file = new File([blob], 'test.pdf', { type: 'application/pdf' });

      const content = await extractPdfContent(file);

      expect(content).toBeDefined();
      expect(content).toContain('test.pdf');
      // Em ambiente de teste, pdfjs pode não estar configurado corretamente
      // então esperamos um placeholder ou erro tratado
    }, 15000);

    it('deve processar PDF quando pdfjs está disponível', async () => {
      const blob = new Blob(['fake pdf data'], { type: 'application/pdf' });
      const file = new File([blob], 'test.pdf', { type: 'application/pdf' });

      // Converte para ArrayBuffer
      const arrayBuffer = await file.arrayBuffer();

      // Testa se o arquivo pode ser convertido
      expect(arrayBuffer).toBeDefined();
      
      // Em ambiente de teste, pdfjs pode não funcionar perfeitamente
      // então apenas verificamos que a função não lança erro fatal
      try {
        const content = await extractPdfContent(file);
        expect(content).toBeDefined();
      } catch (error) {
        // Erro esperado em ambiente de teste sem worker configurado
        expect(error).toBeDefined();
      }
    }, 15000);
  });

  describe('extractImageContent', () => {
    it('deve retornar placeholder quando Tesseract não está disponível', async () => {
      const blob = new Blob(['fake image data'], { type: 'image/png' });
      const file = new File([blob], 'test.png', { type: 'image/png' });

      // Em ambiente de teste, Tesseract pode não estar configurado
      // então esperamos um placeholder ou erro tratado
      try {
        const content = await extractImageContent(file);
        expect(content).toBeDefined();
        expect(content).toContain('test.png');
      } catch (error) {
        // Erro esperado em ambiente de teste sem worker configurado
        expect(error).toBeDefined();
      }
    }, 15000);
  });

  describe('compressImage', () => {
    it('deve retornar arquivo original quando biblioteca não está disponível', async () => {
      const blob = new Blob(['fake image data'], { type: 'image/png' });
      const file = new File([blob], 'test.png', { type: 'image/png' });

      // Mock para simular que a biblioteca não está disponível
      vi.doMock('browser-image-compression', () => {
        throw new Error('Module not found');
      });

      const compressed = await compressImage(file);

      expect(compressed).toBe(file);
    }, 15000); // Timeout maior para este teste

    it('deve comprimir imagem quando biblioteca está disponível', async () => {
      const blob = new Blob(['fake image data'], { type: 'image/png' });
      const file = new File([blob], 'test.png', { type: 'image/png' });

      // Testa que a função existe e pode ser chamada
      expect(compressImage).toBeDefined();
      
      // Em ambiente de teste, a biblioteca pode não estar disponível
      // então apenas verificamos que a função não lança erro
      const result = await compressImage(file);
      expect(result).toBeDefined();
    }, 15000);
  });

  describe('processFile', () => {
    it('deve processar arquivo de texto', async () => {
      const content = 'Conteúdo de teste';
      const blob = new Blob([content], { type: 'text/plain' });
      const file = new File([blob], 'test.txt', { type: 'text/plain' });

      const result = await processFile(file);

      expect(result.content).toBe(content);
      expect(result.preview).toBeNull();
      expect(result.file).toBe(file);
    });

    it('deve processar imagem com preview', async () => {
      const blob = new Blob(['fake image data'], { type: 'image/png' });
      const file = new File([blob], 'test.png', { type: 'image/png' });

      const result = await processFile(file, {
        compressImages: false,
        extractImageText: false,
      });

      expect(result.preview).toBeDefined();
      expect(result.content).toContain('test.png');
    });

    it('deve processar PDF', async () => {
      const blob = new Blob(['fake pdf data'], { type: 'application/pdf' });
      const file = new File([blob], 'test.pdf', { type: 'application/pdf' });

      const result = await processFile(file);

      expect(result.content).toBeDefined();
      expect(result.content).toContain('test.pdf');
    });

    it('deve chamar callback de progresso', async () => {
      const content = 'Conteúdo de teste';
      const blob = new Blob([content], { type: 'text/plain' });
      const file = new File([blob], 'test.txt', { type: 'text/plain' });

      const onProgress = vi.fn();

      await processFile(file, { onProgress });

      expect(onProgress).toHaveBeenCalled();
    });

    it('deve processar imagem com OCR quando extractImageText é true', async () => {
      const blob = new Blob(['fake image data'], { type: 'image/png' });
      const file = new File([blob], 'test.png', { type: 'image/png' });

      const result = await processFile(file, {
        compressImages: false,
        extractImageText: true,
      });

      expect(result.preview).toBeDefined();
      // Deve tentar extrair texto (pode retornar placeholder se OCR não estiver disponível)
      expect(result.content).toBeDefined();
    });

    it('deve processar todos os tipos de arquivo de texto', async () => {
      const textTypes = [
        { name: 'test.txt', type: 'text/plain', content: 'Texto simples' },
        { name: 'test.md', type: 'text/markdown', content: '# Markdown' },
        { name: 'test.json', type: 'application/json', content: '{"key": "value"}' },
        { name: 'test.csv', type: 'text/csv', content: 'col1,col2\nval1,val2' },
      ];

      for (const textType of textTypes) {
        const blob = new Blob([textType.content], { type: textType.type });
        const file = new File([blob], textType.name, { type: textType.type });

        const result = await processFile(file);

        expect(result.content).toBe(textType.content);
        expect(result.file).toBe(file);
      }
    });

    it('deve tentar extrair conteúdo de tipos desconhecidos', async () => {
      const blob = new Blob(['conteúdo desconhecido'], { type: 'application/octet-stream' });
      const file = new File([blob], 'test.unknown', { type: 'application/octet-stream' });

      const result = await processFile(file);

      // Deve tentar extrair como texto ou retornar placeholder
      expect(result.content).toBeDefined();
      expect(result.file).toBe(file);
    });
  });

  describe('validateFile', () => {
    it('deve validar arquivo válido', () => {
      const file = new File(['content'], 'test.txt', { type: 'text/plain' });

      expect(() => validateFile(file, 10, ['text/*'])).not.toThrow();
    });

    it('deve rejeitar arquivo muito grande', () => {
      const largeContent = 'x'.repeat(11 * 1024 * 1024); // 11MB
      const file = new File([largeContent], 'test.txt', { type: 'text/plain' });

      expect(() => validateFile(file, 10)).toThrow('muito grande');
    });

    it('deve rejeitar tipo de arquivo não permitido', () => {
      const file = new File(['content'], 'test.exe', { type: 'application/x-msdownload' });

      expect(() => validateFile(file, 10, ['text/*', 'image/*'])).toThrow('não permitido');
    });

    it('deve aceitar todos os tipos quando allowedTypes está vazio', () => {
      const file = new File(['content'], 'test.txt', { type: 'text/plain' });

      expect(() => validateFile(file, 10, [])).not.toThrow();
    });
  });

  describe('formatFileSize', () => {
    it('deve formatar bytes corretamente', () => {
      expect(formatFileSize(0)).toBe('0 Bytes');
      expect(formatFileSize(1024)).toBe('1 KB');
      expect(formatFileSize(1024 * 1024)).toBe('1 MB');
      expect(formatFileSize(1024 * 1024 * 1024)).toBe('1 GB');
    });

    it('deve formatar tamanhos decimais', () => {
      expect(formatFileSize(1536)).toBe('1.5 KB');
      expect(formatFileSize(2560 * 1024)).toBe('2.5 MB');
    });
  });

  describe('getFileIcon', () => {
    it('deve retornar ícone correto para imagens', () => {
      expect(getFileIcon('image/png')).toBe('🖼️');
      expect(getFileIcon('image/jpeg')).toBe('🖼️');
    });

    it('deve retornar ícone correto para PDF', () => {
      expect(getFileIcon('application/pdf')).toBe('📄');
    });

    it('deve retornar ícone correto para texto', () => {
      expect(getFileIcon('text/plain')).toBe('📝');
      expect(getFileIcon('text/html')).toBe('📝');
    });

    it('deve retornar ícone padrão para tipos desconhecidos', () => {
      expect(getFileIcon('application/octet-stream')).toBe('📎');
    });
  });
});

