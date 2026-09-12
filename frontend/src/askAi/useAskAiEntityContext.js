/**
 * Publica no widget "Perguntar à IA" a ENTIDADE em uso na tela.
 *
 * Motivo: o widget já enviava `context` (rota/módulo/tipo de página) e o backend
 * já tinha contrato de entidade + checagem de posse, mas NENHUMA tela de
 * produção chamava `setAskAiEntityContext` — o mecanismo existia apenas nos
 * testes. Resultado observado no browser real (2026-09-12): com a ficha do aluno
 * aberta, perguntar "qual a situação financeira deste aluno?" não tinha entidade
 * alguma para resolver, então o copiloto nunca respondia com dado vivo.
 *
 * Contrato: o contexto é uma DICA, nunca autoridade. O backend revalida posse e
 * permissão de `entityId` a cada turno; entidade de outro tenant é negada mesmo
 * que a tela informe o id (ver `api/services/askAi/orchestrator.js`).
 *
 * Uso (tela de detalhe):
 *   useAskAiEntityContext({ entityType: ENTITY_TYPES.FITNESS_STUDENT, entityId: selectedSubjectId });
 *
 * Sem `entityId` o hook apenas LIMPA o contexto — nunca deixa contexto velho de
 * uma tela anterior ativo na tela atual.
 */

import { useEffect } from 'react';
import { clearAskAiEntityContext, setAskAiEntityContext } from './contextProvider';

/**
 * @param {{entityType?: string|null, entityId?: string|null, workspaceEntityId?: string|null, actionContext?: string|null}} params
 */
export function useAskAiEntityContext({ entityType, entityId, workspaceEntityId, actionContext } = {}) {
  useEffect(() => {
    if (!entityType || !entityId) {
      clearAskAiEntityContext();
      return undefined;
    }
    setAskAiEntityContext({
      entityType,
      entityId: String(entityId),
      ...(workspaceEntityId ? { workspaceEntityId: String(workspaceEntityId) } : {}),
      ...(actionContext ? { actionContext: String(actionContext) } : {}),
    });
    // Ao sair da tela (ou trocar de entidade) o contexto é limpo para o widget
    // não responder sobre uma entidade que não está mais em foco.
    return () => clearAskAiEntityContext();
  }, [entityType, entityId, workspaceEntityId, actionContext]);
}

export default useAskAiEntityContext;
