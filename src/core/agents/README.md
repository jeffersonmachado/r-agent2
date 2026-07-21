# Agentes — Camada Opcional sobre o Cognitive Core

Agentes são extensões opcionais sobre o Cognitive Core.

Eles não substituem o núcleo cognitivo do RAP.

Devem ser usados apenas para especializações verticais, canais específicos ou papéis operacionais avançados.

O fluxo principal do RAP continua passando pelo Cognitive Core.

---

## Agentes já existentes (Agent OS)

O RAP já possui uma camada de agentes implementada em 2026-06-11 (ver `AI_MEMORY/agent-os.md`):

- Agent Registry — `api/modules/agent-registry/`
- Agent Factory — `api/modules/agent-os/routes/agent-factory.js`
- Agent Marketplace — `api/modules/agent-marketplace/`
- Agent Orchestrator (rotas HTTP) — `api/modules/agent-os/routes/agent-orchestrator.js`
- Knowledge Graph — `api/modules/knowledge-graph/`
- Journey Registry — `api/modules/journey-registry/`
- Vertical Templates — `api/modules/vertical-templates/`

## Integração com o Cognitive Core

- O pipeline obrigatório (`src/core/cognitive/cognitive-orchestrator/`) é o caminho principal: CONTEXT → INTENT → PLAN → EXECUTE → VALIDATE → LEARN.
- Agentes corporativos (`corporate_agents`) podem ser plugados como *especializações* que consomem o mesmo Tool Registry (`src/core/cognitive/tool-registry/`) — nunca executam serviços diretamente.
- A classificação PRODUCTION / SUPPORT / DEVELOPMENT dos agentes (modelo `CorporateAgent`) segue a mesma política de visibilidade do núcleo (`src/core/cognitive/visibility.js` + `api/modules/agent-os/experience-segregation.js`).
- Aprendizado e governança de agentes continuam em RAP Learn (`api/modules/rap-learn/`) e AI Governance (`api/modules/ai-governance/`), os mesmos consumidos pelo Learning Engine do núcleo.

## O que NÃO fazer

- Não criar agentes CRM, Agenda, PBX ou Campanhas como módulos principais — esses domínios são atendidos pelo Cognitive Core via Tool Registry.
- Não expor agentes SUPPORT/DEVELOPMENT (QA, replay, seeds, mesh, RPA) para usuários operacionais.
- Não duplicar o pipeline cognitivo dentro de um agente.
