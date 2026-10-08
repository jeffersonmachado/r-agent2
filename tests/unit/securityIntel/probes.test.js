'use strict';

/**
 * Testes dos parsers de probe.
 *
 * O que está sendo provado: a extração de versão NÃO inventa valor quando o
 * formato muda — ela devolve `null`. Um parser tolerante demais fabricaria uma
 * versão de PostgreSQL/Redis nunca medida, o que contaminaria toda a análise de
 * vulnerabilidade a jusante.
 */

const {
  parsePostgresVersion,
  parseRedisVersion,
} = require('../../../api/services/securityIntel/probes');

describe('probes — parsers', () => {
  test('extrai a versão do texto real do PostgreSQL', () => {
    expect(parsePostgresVersion('PostgreSQL 16.15 (Ubuntu 16.15-0ubuntu0.24.04.2) on x86_64-pc-linux-gnu, compiled by gcc'))
      .toBe('16.15');
    expect(parsePostgresVersion('PostgreSQL 16.4 on aarch64-apple-darwin')).toBe('16.4');
    expect(parsePostgresVersion('PostgreSQL 18beta1')).toBe('18');
  });

  test('formato desconhecido devolve null (não inventa versão)', () => {
    expect(parsePostgresVersion('MySQL 8.0')).toBeNull();
    expect(parsePostgresVersion('')).toBeNull();
    expect(parsePostgresVersion(null)).toBeNull();
  });

  test('extrai redis_version do INFO server', () => {
    expect(parseRedisVersion('# Server\r\nredis_version:7.0.15\r\nredis_git_sha1:00000000\r\n')).toBe('7.0.15');
    expect(parseRedisVersion('redis_version:6.2.14')).toBe('6.2.14');
  });

  test('INFO sem redis_version devolve null', () => {
    expect(parseRedisVersion('# Server\r\nredis_mode:standalone\r\n')).toBeNull();
    expect(parseRedisVersion(undefined)).toBeNull();
  });
});
