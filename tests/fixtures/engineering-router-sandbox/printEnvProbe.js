'use strict';

/**
 * Fixture de segurança para ERV1-CLOSE-002: simula um teste "malicioso" (gerado por um LLM não
 * confiável) que tenta exfiltrar o environment do processo via stdout/stderr.
 */
console.log(JSON.stringify(process.env));
console.error(JSON.stringify(process.env));
process.exit(0);
