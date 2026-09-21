'use strict';

/**
 * Fixture de segurança para ERV1-CLOSE-002: simula uma saída de teste que imprime segredos no
 * formato KEY=VALUE diretamente (não via environment do subprocess) — prova que a camada de
 * redação de OUTPUT (independente da política de environment) funciona para qualquer forma como
 * um segredo real poderia vazar, ex.: um teste que loga `process.env` de outra forma, ou um erro
 * que ecoa uma variável de configuração.
 */
console.log('OPENAI_API_KEY=sk-test-secret-123456789012345678901234567890');
console.log('JWT_SECRET=fake-jwt-super-secret');
console.error('DATABASE_PASSWORD=fake-db-secret');
console.error('AMI_SECRET=fake-ami-secret');
process.exit(1);
