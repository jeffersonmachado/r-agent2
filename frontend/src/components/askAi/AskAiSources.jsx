import React from 'react';
import { sanitizeSourceLinks } from '../../utils/urlSafety';

/**
 * Lista de fontes do Ask AI — TODA fonte exibida é um LINK.
 *
 * Antes (AskAiWidget.jsx:188-189) as fontes eram texto puro num `<li>`, com
 * fallback `title || label || id || chunkId || documentId` — imprimia o
 * identificador interno do documento quando o título vinha vazio, e o usuário não
 * tinha como abrir nada ("Fontes: Chunk 15"). A missão (TAREFA 21/31/33) exige:
 * fonte visível é clicável, com rótulo humano e segurança de URL.
 *
 * Regras aplicadas aqui:
 *  - `sanitizeSourceLinks` descarta fonte sem URL segura (nada de `javascript:`,
 *    `data:`, `file:`, caminho de filesystem) e deduplica;
 *  - link externo recebe `target="_blank"` + `rel="noopener noreferrer"`;
 *  - link interno navega na própria aplicação (sem nova aba);
 *  - nenhum identificador técnico é renderizado.
 */
export default function AskAiSources({ sources = [] }) {
  const links = sanitizeSourceLinks(sources);
  if (links.length === 0) return null;

  return (
    <div className="mt-2 border-t border-border-default pt-2" data-testid="ask-ai-sources">
      <p className="text-xs font-medium text-text-secondary mb-1">Fontes:</p>
      <ul className="text-xs text-text-tertiary space-y-1">
        {links.map((link) => {
          const external = /^https?:\/\//i.test(link.url);
          return (
            <li key={link.url} className="truncate">
              <a
                href={link.url}
                className="underline hover:text-text-secondary"
                data-testid="ask-ai-source-link"
                data-source-type={link.sourceType}
                {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              >
                {link.label}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
