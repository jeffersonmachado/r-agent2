/**
 * Plugin Vite customizado para processar CommonJS do backend.
 * 
 * Este plugin intercepta requisições para arquivos CommonJS do backend
 * e os processa usando esbuild antes de servir ao browser.
 */

import { readFileSync, existsSync } from 'fs';
import { transform } from 'esbuild';

export function vitePluginCommonJS() {
  return {
    name: 'vite-plugin-commonjs-backend',
    enforce: 'pre',
    async load(id) {
      // Verifica se é um arquivo CommonJS do backend
      // O id pode ser um caminho absoluto ou relativo
      if (!id.includes('engine/utils/') || !id.endsWith('.js')) {
        return null;
      }

      try {
        // Normaliza o caminho (remove query strings e hashes do Vite)
        let filePath = id.split('?')[0].split('#')[0];
        
        // Se o caminho começa com /@fs/, remove esse prefixo (Vite adiciona isso para arquivos fora do projeto)
        if (filePath.startsWith('/@fs/')) {
          filePath = filePath.slice(5);
        }
        
        // Verifica se o arquivo existe antes de tentar ler
        if (!existsSync(filePath)) {
          return null;
        }
        
        const code = readFileSync(filePath, 'utf-8');
        
        // Verifica se contém module.exports (CommonJS)
        if (!code.includes('module.exports')) {
          return null;
        }
        
        // Transforma CommonJS para ES module usando esbuild
        const result = await transform(code, {
          loader: 'js',
          format: 'esm',
          target: 'es2020',
          sourcefile: filePath,
        });
        
        // Garante que o código transformado é válido
        if (!result || !result.code || typeof result.code !== 'string') {
          console.warn(`[vite-plugin-commonjs] Resultado inválido para ${id}`);
          return null;
        }
        
        return {
          code: result.code,
          map: result.map || null,
        };
      } catch (err) {
        // Não loga erro se o arquivo não existir (pode ser um caminho virtual)
        if (err.code === 'ENOENT') {
          return null;
        }
        // Loga outros erros mas não quebra o build
        console.warn(`[vite-plugin-commonjs] Erro ao processar ${id}:`, err.message);
        return null;
      }
    },
  };
}
