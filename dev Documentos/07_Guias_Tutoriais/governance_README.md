# Governança Organizacional

## Princípios de Governança

Este diretório contém as **políticas oficiais de governança** do projeto. Estas políticas são **obrigatórias**, **versionadas** e **auditáveis**.

### Regra de Ouro

> **JSON governa, código executa.**

As políticas definidas neste diretório são a **fonte única da verdade** para:
- Regras de QA e bloqueios
- Aprovações e permissões
- Rollout de IA
- Escalonamento de incidentes
- Papéis e responsabilidades

O código do sistema **deve** consultar e respeitar estas políticas. Decisões não dependem de pessoas, mas sim das regras explícitas definidas aqui.

## Estrutura

```
governance/
├── qa-policy.json                    # Política de QA (SLA e bloqueios)
├── warn-approval-policy.json         # Política de aprovação de WARN
├── runtime-escalation-policy.json    # Escalonamento de QA runtime
├── ia-rollout-policy.json            # Política de rollout de IA
├── roles-raci.json                   # Papéis organizacionais (RACI)
├── incident-playbook.json            # Playbook de incidentes de IA
└── README.md                         # Este arquivo
```

## Políticas

### 1. Política de QA (`qa-policy.json`)

Define:
- Regras de bloqueio para FAIL e WARN
- SLA de correção por tipo de falha
- Regra de escalonamento automático (WARN → FAIL)
- Escopos que sempre bloqueiam
- Escopos que nunca podem ser ignorados

**Princípios:**
- FAIL em escopos críticos (contracts, gate) sempre bloqueia
- WARN >= 3 em escopos críticos vira FAIL automaticamente
- Runtime nunca é ignorável

### 2. Política de Aprovação de WARN (`warn-approval-policy.json`)

Define:
- Quem pode aprovar WARN (tech_lead, qa_lead, senior_engineer)
- Obrigatoriedade de justificativa (mínimo 50 caracteres)
- Regra: WARN sem aprovação após 24h vira FAIL
- Regra: WARN aprovado mas não corrigido após 7 dias perde aprovação

**Princípios:**
- Aprovação requer justificativa técnica obrigatória
- Aprovações são auditáveis e versionadas
- WARN recorrente não pode mais ser aprovado

### 3. Escalonamento de QA Runtime (`runtime-escalation-policy.json`)

Define:
- Quantidade de ocorrências e janela de tempo
- Ações obrigatórias (block deploy, incidente)
- Regra: runtime nunca é ignorável

**Níveis de Escalonamento:**
- **Level 1 (Detecção)**: 1 ocorrência em 1h → log warning
- **Level 2 (Atenção)**: 3 ocorrências em 1h → notificar tech_lead
- **Level 3 (Crítico)**: 5 ocorrências em 1h → bloquear deploy, criar incidente
- **Level 4 (Emergência)**: 10 ocorrências em 1h → bloquear produção, rollback

### 4. Política de Rollout de IA (`ia-rollout-policy.json`)

Define:
- Estágios: OFF → INTERNAL → LIMITED → GENERAL
- Critérios objetivos para avançar entre estágios
- Regra de rollback imediato

**Estágios:**
- **OFF**: IA desabilitada
- **INTERNAL**: Uso interno apenas (mínimo 7 dias)
- **LIMITED**: Rollout limitado a 10% do tráfego (mínimo 14 dias)
- **GENERAL**: Disponibilidade geral

**Critérios de Avanço:**
- Todos os critérios devem ser atendidos
- Não é possível pular estágios
- Rollback automático se métricas degradarem

### 5. Papéis Organizacionais (`roles-raci.json`)

Define:
- Papéis formais (tech_lead, qa_lead, senior_engineer, engineer, product_owner, cto)
- Quem pode ignorar WARN
- Quem pode bloquear deploy
- Quem pode aprovar rollout

**RACI:**
- **R** (Responsible): Executa a tarefa
- **A** (Accountable): Responsável final, aprova
- **C** (Consulted): Consultado, fornece input
- **I** (Informed): Informado sobre progresso
- **N** (Not involved): Não envolvido

### 6. Playbook de Incidentes (`incident-playbook.json`)

Define:
- Tipos de incidente (qa_failure, runtime_failure, contract_violation, security_breach, rollout_failure)
- Passos obrigatórios por tipo
- Responsável por tipo e passo
- SLA de resposta e resolução

**Tipos de Incidente:**
- **QA Failure**: Falha em checks de QA
- **Runtime Failure**: Falha em execução runtime
- **Contract Violation**: Violação de contrato público
- **Security Breach**: Violação de segurança
- **Rollout Failure**: Falha durante rollout

## Versionamento

Todas as políticas são versionadas usando o campo `version` no formato semântico (MAJOR.MINOR.PATCH).

**Regras de Versionamento:**
- **MAJOR**: Mudança incompatível (ex: remover permissão)
- **MINOR**: Adicionar funcionalidade compatível (ex: novo papel)
- **PATCH**: Correção de bug ou clarificação

Mudanças em políticas devem ser:
1. Propostas via PR
2. Revisadas por tech_lead e qa_lead
3. Aprovadas antes de merge
4. Documentadas no changelog

## Auditoria

Todas as decisões baseadas nestas políticas são auditáveis:
- Aprovações de WARN são registradas com timestamp e justificativa
- Bloqueios de deploy são registrados com motivo
- Rollouts são registrados com estágio e critérios atendidos
- Incidentes seguem o playbook e geram relatórios

## Conformidade

O código do sistema **deve**:
- Consultar estas políticas antes de tomar decisões
- Respeitar permissões e papéis definidos
- Executar ações automáticas conforme regras
- Registrar todas as decisões para auditoria

**Não é permitido:**
- Ignorar políticas via código
- Criar exceções não documentadas
- Bypass de aprovações obrigatórias
- Modificar políticas sem versionamento

## Contato

Para questões sobre governança:
- **Tech Lead**: Responsável por decisões técnicas
- **QA Lead**: Responsável por políticas de QA
- **Product Owner**: Responsável por rollout e produto

---

**Última atualização**: 2024-01-01  
**Versão das políticas**: 1.0.0

