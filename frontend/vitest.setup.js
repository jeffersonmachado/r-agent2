/**
 * Setup de testes Vitest
 * Fornece polyfills para APIs do navegador não disponíveis em Node.js
 */

// Verificar se estamos em um ambiente que não tem DOMParser (Node.js)
if (typeof DOMParser === 'undefined') {
  // Usar xmldom como polyfill
  const { DOMParser: DOMParserImpl, XMLSerializer: XMLSerializerImpl } = require('@xmldom/xmldom');
  
  global.DOMParser = DOMParserImpl;
  global.XMLSerializer = XMLSerializerImpl;
}

// Configurar modo de teste
process.env.NODE_ENV = 'test';

