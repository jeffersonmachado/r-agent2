import { describe, it, expect } from 'vitest';
import {
  collapseFindingsByPackage,
  describeGroup,
  packageGroupKey,
  severityRank,
  summarizeCollapse,
} from './findingsGroups.js';

const achado = (extra = {}) => ({
  finding_key: `F-${Math.random().toString(36).slice(2, 8)}`,
  package_name: 'pacote',
  installed_version: '1.0.0',
  service: 'api',
  advisory_id: 'GHSA-0000-0000-0000',
  severity: 'HIGH',
  status: 'FIX_AVAILABLE',
  fixed_versions: ['1.0.1'],
  ...extra,
});

describe('packageGroupKey', () => {
  it('separa serviço, pacote e versão (exposições diferentes não se misturam)', () => {
    const api = packageGroupKey(achado({ service: 'api' }));
    const front = packageGroupKey(achado({ service: 'frontend' }));
    expect(api).not.toBe(front);
    expect(packageGroupKey(achado({ installed_version: '2.0.0' }))).not.toBe(
      packageGroupKey(achado({ installed_version: '1.0.0' })),
    );
  });
});

describe('collapseFindingsByPackage — o defeito medido (130 achados -> 39 pacotes)', () => {
  it('colapsa advisor repetido numa linha, preservando TODOS os membros no grupo', () => {
    const repetido = 'brace-expansion';
    const items = [
      achado({ package_name: repetido, advisory_id: 'GHSA-1', severity: 'HIGH' }),
      achado({ package_name: repetido, advisory_id: 'GHSA-2', severity: 'MEDIUM' }),
      achado({ package_name: repetido, advisory_id: 'GHSA-3', severity: 'LOW' }),
      achado({ package_name: 'outro', advisory_id: 'GHSA-4', severity: 'HIGH' }),
    ];
    const { rows, groups } = collapseFindingsByPackage(items);
    expect(rows).toHaveLength(2); // 4 achados -> 2 pacotes
    const grupo = groups.get(packageGroupKey(items[0]));
    expect(grupo.count).toBe(3);
    expect(grupo.advisories).toEqual(['GHSA-1', 'GHSA-2', 'GHSA-3']);
  });

  it('o representante é o achado MAIS GRAVE do pacote (não o primeiro da lista)', () => {
    const items = [
      achado({ advisory_id: 'GHSA-baixo', severity: 'LOW' }),
      achado({ advisory_id: 'GHSA-critico', severity: 'CRITICAL' }),
      achado({ advisory_id: 'GHSA-medio', severity: 'MEDIUM' }),
    ];
    const { rows, groups } = collapseFindingsByPackage(items);
    expect(rows).toHaveLength(1);
    expect(rows[0].advisory_id).toBe('GHSA-critico');
    expect(groups.get(packageGroupKey(items[0])).maxSeverity).toBe('CRITICAL');
  });

  it('expandir um grupo devolve os membros logo abaixo do representante', () => {
    const items = [
      achado({ advisory_id: 'GHSA-a', severity: 'HIGH' }),
      achado({ advisory_id: 'GHSA-b', severity: 'LOW' }),
      achado({ package_name: 'outro', advisory_id: 'GHSA-c', severity: 'HIGH' }),
    ];
    const chave = packageGroupKey(items[0]);
    const { rows } = collapseFindingsByPackage(items, { expandedKeys: new Set([chave]) });
    expect(rows.map((r) => r.advisory_id)).toEqual(['GHSA-a', 'GHSA-b', 'GHSA-c']);
  });

  it('não afirma "sem correção publicada" para o pacote se UM advisory tem fix', () => {
    const items = [
      achado({ advisory_id: 'GHSA-sem-fix', status: 'NO_FIX_AVAILABLE', fixed_versions: [] }),
      achado({ advisory_id: 'GHSA-com-fix', status: 'FIX_AVAILABLE', fixed_versions: ['2.0.0'] }),
    ];
    const { groups } = collapseFindingsByPackage(items);
    const grupo = groups.get(packageGroupKey(items[0]));
    expect(grupo.semCorrecaoPublicada).toBe(false);
    expect(grupo.hasFix).toBe(true);
  });

  it('o grupo só é dev-only se TODOS os membros forem (um de runtime contamina)', () => {
    const chave = packageGroupKey(achado());
    const soDev = collapseFindingsByPackage([
      achado({ dev_only: true }), achado({ dev_only: true }),
    ]).groups.get(chave);
    expect(soDev.devOnly).toBe(true);

    const misto = collapseFindingsByPackage([
      achado({ dev_only: true }), achado({ dev_only: false }),
    ]).groups.get(chave);
    expect(misto.devOnly).toBe(false);
  });

  it('é não-vacuo: com dado no formato real o colapso corta de fato a lista', () => {
    // Reproduz o formato medido em 2026-10-11: 39 pacotes, com um deles (o
    // `brace-expansion@2.0.2`) concentrando 14 advisories.
    const items = [];
    for (let p = 0; p < 39; p += 1) {
      const advisoryCount = p === 0 ? 14 : 4;
      for (let a = 0; a < advisoryCount; a += 1) {
        items.push(achado({ package_name: `pacote-${p}`, advisory_id: `GHSA-${p}-${a}` }));
      }
    }
    expect(items.length).toBeGreaterThanOrEqual(130);
    const { rows, groups } = collapseFindingsByPackage(items);
    expect(groups.size).toBe(39);
    expect(rows.length).toBe(39); // colapsado: uma linha por pacote
    expect(rows.length).toBeLessThan(items.length / 3);
  });

  it('tolera entrada vazia/ausente sem inventar linha', () => {
    expect(collapseFindingsByPackage().rows).toEqual([]);
    expect(collapseFindingsByPackage([]).groups.size).toBe(0);
  });
});

describe('summarizeCollapse', () => {
  it('declara quantos pacotes repetem (efeito do agrupamento)', () => {
    const items = [
      achado({ package_name: 'a', advisory_id: 'GHSA-1' }),
      achado({ package_name: 'a', advisory_id: 'GHSA-2' }),
      achado({ package_name: 'b', advisory_id: 'GHSA-3' }),
    ];
    const { groups } = collapseFindingsByPackage(items);
    expect(summarizeCollapse({ items, groups })).toEqual({
      loaded: 3, pacotes: 2, achados: 3, repetidos: 1,
    });
  });
});

describe('severityRank', () => {
  it('ordena do mais grave para o menos e trata desconhecido', () => {
    expect(severityRank('CRITICAL')).toBeLessThan(severityRank('LOW'));
    expect(severityRank('INFORMATIONAL')).toBeGreaterThan(severityRank('HIGH'));
    expect(severityRank(null)).toBe(9);
    expect(severityRank('SEI-LA')).toBe(9);
  });
});

// ── Fase 4.3: o resumo do grupo precisa representar TODOS os advisories ──────────
//
// DEFEITO: o grupo calculava `kev`/`devOnly`/`semCorrecaoPublicada` sobre os membros,
// mas os SELOS exibidos na linha vinham do REPRESENTANTE. Um pacote com um crítico
// dev-only e um médio de runtime podia aparecer descrito pelo representante errado,
// e o operador não tinha como saber quais pacotes realmente bloqueiam o release.
describe('resumo agregado do grupo (Fase 4.3)', () => {
  it('separa runtime de dev-only e conta KEV — nada é inferido do representante', () => {
    const items = [
      achado({ package_name: 'misto', advisory_id: 'GHSA-crit-dev', severity: 'CRITICAL', dev_only: true, kev: true }),
      achado({ package_name: 'misto', advisory_id: 'GHSA-medio-runtime', severity: 'MEDIUM' }),
      achado({ package_name: 'misto', advisory_id: 'GHSA-baixo-runtime', severity: 'LOW' }),
    ];
    const { groups } = collapseFindingsByPackage(items);
    const grupo = groups.get(packageGroupKey(items[0]));
    expect(grupo.count).toBe(3);
    expect(grupo.devOnlyCount).toBe(1);
    expect(grupo.runtimeCount).toBe(2);
    expect(grupo.kevCount).toBe(1);
    // O grupo NÃO é dev-only: há risco de runtime dentro dele.
    expect(grupo.devOnly).toBe(false);
    // E o crítico dev-only NÃO bloqueia o release (não vai a produção); os de
    // runtime são MEDIUM/LOW, que também não são bloqueantes por severidade.
    expect(grupo.bloqueantes).toBe(0);
  });

  it('conta como bloqueante só o que é grave, de runtime e SEM isenção vigente', () => {
    const alto = achado({ package_name: 'p', advisory_id: 'GHSA-alto', severity: 'HIGH' });
    const criticoIsento = achado({ package_name: 'p', advisory_id: 'GHSA-crit-isento', severity: 'CRITICAL' });
    const devOnly = achado({ package_name: 'p', advisory_id: 'GHSA-dev', severity: 'CRITICAL', dev_only: true });
    const items = [alto, criticoIsento, devOnly];
    const waiversByFinding = new Map([[criticoIsento.finding_key, { active: true }]]);

    const semIsencao = collapseFindingsByPackage(items).groups.get(packageGroupKey(alto));
    expect(semIsencao.bloqueantes).toBe(2); // alto + crítico (o dev-only não conta)

    const comIsencao = collapseFindingsByPackage(items, { waiversByFinding }).groups.get(packageGroupKey(alto));
    expect(comIsencao.bloqueantes).toBe(1); // só o alto
    expect(comIsencao.isentosCount).toBe(1);
  });

  it('severidade do grupo é a mais grave entre TODOS os membros', () => {
    const items = [
      achado({ package_name: 'q', advisory_id: 'GHSA-a', severity: 'LOW' }),
      achado({ package_name: 'q', advisory_id: 'GHSA-b', severity: 'CRITICAL' }),
    ];
    const { groups } = collapseFindingsByPackage(items);
    expect(groups.get(packageGroupKey(items[0])).maxSeverity).toBe('CRITICAL');
  });

  it('conta quantos membros têm correção publicada e só diz "sem correção" se TODOS estiverem sem', () => {
    const items = [
      achado({ package_name: 'r', advisory_id: 'GHSA-1', status: 'NO_FIX_AVAILABLE', fixed_versions: [] }),
      achado({ package_name: 'r', advisory_id: 'GHSA-2', status: 'FIX_AVAILABLE', fixed_versions: ['2.0.0'] }),
    ];
    const { groups } = collapseFindingsByPackage(items);
    const grupo = groups.get(packageGroupKey(items[0]));
    expect(grupo.semCorrecaoCount).toBe(1);
    expect(grupo.semCorrecaoPublicada).toBe(false);
    expect(grupo.hasFix).toBe(true);
  });

  it('a frase do resumo declara o agregado (e não promete bloqueio quando não há)', () => {
    const devOnly = achado({ package_name: 's', advisory_id: 'GHSA-d', severity: 'CRITICAL', dev_only: true, kev: true });
    const runtime = achado({ package_name: 's', advisory_id: 'GHSA-r', severity: 'LOW' });
    const grupo = collapseFindingsByPackage([devOnly, runtime]).groups.get(packageGroupKey(devOnly));
    const texto = describeGroup(grupo);
    expect(texto).toContain('2 advisory(s)');
    expect(texto).toContain('1 de runtime');
    expect(texto).toContain('1 dev-only');
    expect(texto).toContain('1 KEV');
    expect(texto).toContain('nenhum bloqueia o release');

    const bloqueante = achado({ package_name: 't', advisory_id: 'GHSA-x', severity: 'HIGH' });
    const grupoBloqueante = collapseFindingsByPackage([bloqueante]).groups.get(packageGroupKey(bloqueante));
    expect(describeGroup(grupoBloqueante)).toContain('1 bloqueia(m) o release');
  });
});
