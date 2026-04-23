import test from 'node:test';
import assert from 'node:assert/strict';
import { listReplays, listWavesPaged, resetStateForTests } from '../src/repositories/stateRepository.js';

test('filtra replays por intervalo composto de data e hora', () => {
  resetStateForTests();

  const result = listReplays({
    startDate: '2026-04-20',
    startTime: '08:00',
    endDate: '2026-04-21',
    endTime: '18:30',
    page: 1,
    pageSize: 20
  });

  assert.ok(result.items.length > 0, 'deve retornar ao menos um replay no intervalo');
  for (const replay of result.items) {
    const dt = new Date(replay.startedAt).getTime();
    assert.ok(dt >= new Date('2026-04-20T08:00:00.000Z').getTime(), 'inicio fora do intervalo');
    assert.ok(dt <= new Date('2026-04-21T18:30:00.000Z').getTime(), 'fim fora do intervalo');
  }
});

test('retorna metadados de paginação consistentes', () => {
  resetStateForTests();

  const page1 = listReplays({ page: 1, pageSize: 1 });
  const page2 = listReplays({ page: 2, pageSize: 1 });

  assert.equal(page1.page, 1);
  assert.equal(page1.pageSize, 1);
  assert.ok(page1.total >= 1);
  assert.ok(page1.totalPages >= 1);

  if (page1.total > 1) {
    assert.equal(page2.page, 2);
  } else {
    assert.equal(page2.page, 1);
  }
});

test('ordena replays por duracao em ordem ascendente', () => {
  resetStateForTests();

  const result = listReplays({ page: 1, pageSize: 50, sortBy: 'durationMs', sortDir: 'asc' });
  assert.ok(result.items.length >= 1);

  for (let i = 1; i < result.items.length; i += 1) {
    assert.ok(result.items[i - 1].durationMs <= result.items[i].durationMs);
  }
});

test('pagina ondas com metadados corretos', () => {
  resetStateForTests();
  const result = listWavesPaged({ page: 1, pageSize: 2 });

  assert.equal(result.page, 1);
  assert.equal(result.pageSize, 2);
  assert.ok(result.total >= result.items.length);
  assert.ok(result.totalPages >= 1);
});
