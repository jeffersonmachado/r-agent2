'use strict';

function mergeQueueNames({ legacyQueues, storedQueues }) {
  return Array.from(new Set([...(legacyQueues || []), ...(storedQueues || [])])).sort();
}

function parseCreatePayload(body) {
  return {
    name: body && body.name ? String(body.name) : null,
  };
}

function parseDeleteOptions(urlString) {
  const urlObj = new URL(urlString || '/', 'http://localhost');
  return {
    force: urlObj.searchParams.get('force') === 'true',
  };
}

function parseTicketFilters(urlString) {
  const urlObj = new URL(urlString || '/', 'http://localhost');
  return {
    status: urlObj.searchParams.get('status'),
  };
}

function createQueueService({ deps }) {
  return {
    parseCreatePayload,
    parseDeleteOptions,
    parseTicketFilters,

    listQueues(tenantId) {
      const legacyQueues = deps.listQueues(tenantId) || [];
      const storedQueues = deps.queueDefinitionService
        .listQueues({ tenantId })
        .map((queue) => queue.name);

      return mergeQueueNames({ legacyQueues, storedQueues });
    },

    async createQueue(req, queueName) {
      const result = deps.createQueue(queueName);

      if (!result.success) return result;

      // A definição PERSISTIDA precisa existir antes de o request responder.
      //
      // DEFEITO MEDIDO (mesh 2026-10-19T17-34-30, cenário
      // `business-core-biz-queues`): o upsert era fire-and-forget
      // (`.catch(() => {})`). O `DELETE` do mesmo cenário chegava ANTES de o
      // upsert concluir; `deactivateQueue` não encontrava a definição, o upsert
      // pendente gravava `active: true` DEPOIS do delete e a fila
      // "ressuscitava" na listagem — o cenário reprovava com "a fila continua
      // na listagem após DELETE" de forma intermitente (24 ms de execução).
      // Silenciar o erro também violava a política do projeto: falha de
      // persistência nunca pode passar em silêncio.
      const persistencia = await deps.queueDefinitionService.upsertQueue({
        tenantId: req.tenantId,
        name: result.queueName,
        routingStrategy: 'manual',
        priority: 0,
        active: true,
      });

      if (persistencia && persistencia.success === false) {
        // COMPENSAÇÃO ESCOPADA (P0 medido em 2026-10-20).
        //
        // A versão anterior chamava `deleteQueue(queueName, true)` — `force` fecha TODOS os
        // tickets ativos. Em fila PREEXISTENTE (idempotência), uma falha de persistência
        // apagava a fila e FECHAVA atendimentos que já existiam antes da operação. Rollback
        // só pode reverter o que ESTA operação criou, e nunca com exclusão forçada.
        if (result.created === true) {
          try {
            deps.deleteQueue(result.queueName, false);
          } catch (_) {
            /* rollback best-effort; o erro real é reportado abaixo */
          }
        } else {
          deps.logger.error('Persistência falhou em fila preexistente — estado anterior preservado', {
            queueName: result.queueName,
            error: (persistencia && persistencia.error) || null,
          });
        }
        deps.logger.error('Erro ao persistir definição da fila', {
          queueName: result.queueName,
          error: (persistencia && persistencia.error) || null,
        });
        return {
          success: false,
          queueName: result.queueName,
          message: `Fila não persistida: ${(persistencia && persistencia.error) || 'erro desconhecido'}`,
        };
      }

      return result;
    },

    getQueueInfo(queueName, tenantId = null) {
      return deps.getQueueInfo(queueName, tenantId ? { tenantId } : {});
    },

    async deleteQueue(queueName, force, tenantId = null) {
      const result = deps.deleteQueue(queueName, force, tenantId ? { tenantId } : {});

      // A definição PERSISTIDA precisa ser desativada mesmo quando o serviço legado
      // não encontra a fila. O legado trabalha num Map EM MEMÓRIA (volátil: o
      // reinício da API o esvazia, mas as definições do banco permanecem) e a
      // listagem MESCLA memória + banco. Depender de `result.success` deixava a
      // fila `active=true` no banco e ela REAPARECIA na listagem — defeito medido
      // no cenário `business-core-biz-queues` ("Fila não foi removida: a fila
      // continua na listagem após DELETE") e causa das 253 filas de teste
      // acumuladas desde 10/10.
      let definicaoDesativada = false;
      if (tenantId) {
        try {
          if (typeof deps.queueDefinitionService.deactivateQueue === 'function') {
            const desativacao = await deps.queueDefinitionService.deactivateQueue(tenantId, queueName);
            definicaoDesativada = desativacao && desativacao.deactivated === true;
          } else {
            const existing = typeof deps.queueDefinitionService.getQueueByName === 'function'
              ? deps.queueDefinitionService.getQueueByName(tenantId, queueName)
              : null;
            if (existing) {
              await deps.queueDefinitionService.upsertQueue({
                tenantId,
                name: queueName,
                routingStrategy: existing.routingStrategy || 'manual',
                priority: existing.priority ?? 0,
                active: false,
              });
              definicaoDesativada = true;
            }
          }
        } catch (err) {
          deps.logger.error('Erro ao desativar definição persistida da fila', err);
        }
      }

      // O legado não tinha a fila, mas a definição persistida existia e foi
      // desativada: a remoção EFETIVA aconteceu (a fila sai da listagem), então o
      // resultado é sucesso — devolver falha aqui seria mentir sobre o efeito real.
      if (!result.success && definicaoDesativada) {
        return {
          ...result,
          success: true,
          message: 'Fila removida (definição persistida desativada)',
        };
      }

      return result;
    },

    listQueueTickets(queueName, options) {
      return deps.listQueue(queueName, options);
    },
  };
}

module.exports = {
  createQueueService,
};
