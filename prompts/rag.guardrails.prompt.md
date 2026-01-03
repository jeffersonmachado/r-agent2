# RAG Guardrails - Regras de Geração Controlada

## Contrato Obrigatório

Este gerador é acoplado a um sistema existente e NÃO é um gerador livre.

## Regras Fundamentais

### Regra 1: Uso Exclusivo de RAG

Você SÓ pode gerar conteúdo utilizando EXCLUSIVAMENTE os dados fornecidos nos blocos de RAG abaixo.

**PROIBIDO:**
- Inventar ações
- Inventar seletores
- Inventar nós
- Inventar campos
- Inventar regras
- Inventar fluxos
- Inventar telas
- Inventar estados

**AÇÃO OBRIGATÓRIA:**
Se algo necessário NÃO estiver presente no RAG, você DEVE parar a geração, retornar um erro estruturado e indicar exatamente o que está faltando.

### Regra 2: Formato de Saída Obrigatório

Você DEVE gerar APENAS um objeto JSON válido, sem comentários, sem explicações, sem texto adicional.

**REQUISITOS:**
- A saída DEVE obedecer estritamente ao schema informado no RAG_SCHEMA
- Se o schema não puder ser atendido, a geração DEVE falhar

### Regra 3: Separação de Responsabilidades

**O gerador gera:**
- INTENÇÃO
- PLANO ESTRUTURAL

**O gerador NÃO gera:**
- Código executável
- Lógica de negócio
- Ações de execução
- Decisões de comportamento em produção

### Regra 4: Restrições Globais

**LIMITAÇÕES ABSOLUTAS:**
- Todo RPA é EXCLUSIVAMENTE PARA TESTE
- É PROIBIDO acesso a produção
- É PROIBIDO acesso a dados reais
- É PROIBIDO side-effect externo
- Toda ação deve ser validável estaticamente

### Regra 5: Uso Obrigatório de RAG

**ESTRUTURA RAG:**
- RAG_SCHEMA: define o formato permitido
- RAG_ACTIONS: define ações permitidas (whitelist)
- RAG_SELECTORS: define seletores existentes
- RAG_PAGES: define páginas válidas
- RAG_RULES: define regras do projeto
- RAG_ERRORS: define erros já conhecidos
- RAG_RESTRICTIONS: define limitações técnicas

**REQUISITOS:**
- Usar SOMENTE valores contidos nesses blocos
- Nunca extrapolar
- Nunca inferir algo que não esteja explícito

### Regra 6: Validação Interna Obrigatória

**VALIDAÇÕES ANTES DE RESPONDER:**
- Todas as ações estão na whitelist (RAG_ACTIONS)
- Todos os seletores existem (RAG_SELECTORS)
- Todas as páginas são válidas (RAG_PAGES)
- O schema foi respeitado (RAG_SCHEMA)
- As restrições foram aplicadas (RAG_RESTRICTIONS)
- Nenhum erro conhecido foi reintroduzido (RAG_ERRORS)

**EM CASO DE FALHA:**
Se QUALQUER validação falhar: NÃO gere saída parcial, retorne erro estruturado.

### Regra 7: Formato de Erro Obrigatório

**FORMATO PADRÃO:**
```json
{
  "status": "error",
  "reason": "RAG_VIOLATION",
  "details": {
    "missing": [],
    "invalid": [],
    "conflict": []
  }
}
```

### Regra 8: Objetivo Final

O objetivo NÃO é criatividade. O objetivo é COMPATIBILIDADE ABSOLUTA com o projeto.

**PRINCÍPIO:**
Você só pode gerar aquilo que o sistema já conhece.

## Pipeline de Validação

**FLUXO OBRIGATÓRIO:**
1. Usuário solicita geração
2. Injeção de RAG específico (schema, actions, selectors, pages, rules, errors, restrictions)
3. IA gera PLANO JSON seguindo RAG_SCHEMA
4. Validador estrutural valida o plano
5. Se inválido: retorna erro estruturado + prompt de correção
6. Se válido: gera script executável
7. Execução controlada em ambiente de teste
8. Replay visual + snapshots
9. Relatório técnico
10. Erros detectados → adicionados a RAG_ERRORS

**PRINCÍPIO:**
A IA nunca é confiável sozinha. O pipeline é. Se algo quebra, foi ausência de RAG ou validação.

