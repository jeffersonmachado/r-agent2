# Sistema de Testes Determinístico com Dependência de Dados

## Frase-Guia

**"Sem dados, testamos estrutura. Com dados, testamos comportamento."**

## Visão Geral

Este sistema de testes é organizado em camadas obrigatórias que garantem que problemas fundamentais sejam detectados antes de testes mais complexos. O pipeline executa em ordem imutável e bloqueia etapas seguintes em caso de falha.

## Estrutura

```
/tests
  /unit              # Testes unitários isolados
  /flow              # Validação estrutural de fluxos
  /data              # Validadores de dados do sistema
  /scripts           # Scripts de conversa determinísticos
  /seeds             # Seeds de dados versionados
  /helpers           # Utilitários compartilhados
  /engine            # Engine de simulação determinística
  /reports           # Geradores de relatórios
```

## Pipeline de Execução

Quando você executa `npm test`, o sistema executa as seguintes etapas em ordem:

1. **Testes Unitários** (`/tests/unit`)
   - Testes isolados de funções e módulos
   - Sem dependências externas
   - Se falhar: pipeline interrompido

2. **Validação Estrutural de Fluxos** (`/tests/flow`)
   - Valida sintaxe, tipos e referências de fluxos
   - Não executa fluxos, apenas valida estrutura
   - Se falhar: pipeline interrompido

3. **Validação de Dados do Sistema** (`/tests/data`)
   - Verifica existência de dados obrigatórios
   - Valida integridade referencial
   - Requer seeds populados (`npm run seed:test`)
   - Se falhar: pipeline interrompido, scripts bloqueados

4. **Scripts de Conversa** (`/tests/scripts`)
   - Executa scripts de conversa determinísticos
   - Só executa se todas as etapas anteriores passarem
   - Se falhar: pipeline interrompido

## Comandos Disponíveis

### Executar Pipeline Completo
```bash
npm test
```

### Executar Etapas Individuais
```bash
npm run test:unit      # Apenas testes unitários
npm run test:flow      # Apenas validação estrutural
npm run test:data     # Apenas validação de dados
npm run test:scripts   # Apenas scripts de conversa
```

### Popular Dados de Teste
```bash
npm run seed:test
```

Este comando:
- Limpa dados de teste existentes
- Carrega seeds de `/tests/seeds/`
- Valida estrutura de cada seed
- Popula dados em `/api/data/test/`
- Valida integridade após população

## Seeds de Dados

Seeds são arquivos JSON versionados em `/tests/seeds/` que contêm dados determinísticos para testes:

- `agents.json` - Agentes de teste (admin, supervisor, agent)
- `flows.json` - Fluxos de teste
- `queues.json` - Filas de teste
- `departments.json` - Departamentos de teste
- `config.json` - Configuração de teste
- `quickReplies.json` - Respostas rápidas de teste

**Importante:** Seeds usam `tenantId: "tenant-test"` para isolamento total de produção.

## Scripts de Conversa

Scripts são arquivos JSON em `/tests/scripts/` que definem conversas de teste:

```json
{
  "id": "script-welcome-flow",
  "name": "Teste de Fluxo de Boas-Vindas",
  "version": "1.0.0",
  "requires": {
    "flows": ["test-flow-welcome"],
    "agents": ["test-agent-admin"],
    "queues": ["test-queue-support"]
  },
  "steps": [
    {
      "type": "user_message",
      "input": "Olá",
      "expected": {
        "node": "message-1",
        "output": "Bem-vindo! Como posso ajudar?"
      }
    }
  ],
  "finalState": {
    "completed": true,
    "lastNode": "end-1"
  }
}
```

## Engine de Simulação

A engine de simulação (`/tests/engine/`) executa fluxos de forma determinística:

- **Sem IA real:** Usa providers mockados
- **Sem aleatoriedade:** Resultados sempre previsíveis
- **Sem APIs externas:** Tudo é mockado
- **Estado previsível:** Estado sempre o mesmo para mesmos inputs

## Regras Absolutas

1. ✅ Scripts de conversa **NUNCA** criam dados
2. ✅ Scripts de conversa **SÓ EXECUTAM** após validação de dados
3. ✅ Falha em uma camada **BLOQUEIA** as próximas
4. ✅ Seeds são determinísticos e versionados
5. ✅ Testes não usam IA, LLM, RAG nem APIs externas
6. ✅ Fluxos são validados antes de qualquer simulação

## Adicionando Novos Testes

### Teste Unitário
Crie arquivo em `/tests/unit/`:
```javascript
describe('MeuMódulo', () => {
  test('deve fazer X', () => {
    expect(funcao()).toBe(esperado);
  });
});
```

### Script de Conversa
Crie arquivo JSON em `/tests/scripts/`:
```json
{
  "id": "script-meu-teste",
  "name": "Meu Teste",
  "version": "1.0.0",
  "requires": { ... },
  "steps": [ ... ],
  "finalState": { ... }
}
```

## Troubleshooting

### "Dados de teste não encontrados"
Execute: `npm run seed:test`

### "Fluxo não encontrado"
Verifique se o fluxo existe em seeds e foi populado

### "Validação de dados falhou"
Verifique os erros reportados e corrija os dados em `/tests/seeds/`

## Critérios de Aceitação

O sistema está corretamente implementado quando:

- ✅ Pipeline executa em ordem correta
- ✅ Falhas bloqueiam etapas seguintes
- ✅ Seeds são determinísticos
- ✅ Validadores funcionam corretamente
- ✅ Scripts não executam sem dados
- ✅ Engine é determinística
- ✅ Relatórios são úteis
- ✅ Sistema é reproduzível

---

**Última atualização:** 2024-01-01


















