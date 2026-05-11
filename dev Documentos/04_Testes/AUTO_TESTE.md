# Auto Teste do Sistema

## Fluxo Recomendado

Nao existe mais um script unico `npm run autotest` no package raiz. O equivalente atual e executar a sequencia abaixo:

```bash
npm run test
npm run qa
npm run qa:final-report
npm run check:green
```

## O Que Cada Etapa Faz

1. **`npm run test`** - Executa a bateria principal exposta pelo projeto (`test:unit`, `test:flow` e `test:rpa`)
2. **`npm run qa`** - Executa o runner de QA sistêmico atual
3. **`npm run qa:final-report`** - Consolida o relatório final de QA
4. **`npm run check:green`** - Lê o veredito final e retorna `0` para GO ou `1` para BLOCK

## Quando Usar

- **Antes de fazer commit** - Garantir que o baseline principal está funcional
- **Antes de fazer merge** - Validar o estado final de QA
- **No CI/CD** - Usar a sequência acima ou encapsular esses passos no pipeline
- **Antes de deploy** - Rodar a validação final e conferir o veredito

## Onde Ver o Resultado

- `qa/final-verdict.json` - Veredito consumido por `npm run check:green`
- Artefatos adicionais em `qa/` e `qa-mesh/`, conforme o fluxo executado

## Regra de Ouro

**Se qualquer etapa da sequência falhar (exit code 1), nao avançar.**

- Nao fazer commit
- Nao fazer merge
- Nao fazer deploy

## Integração com CI

O CI deve executar a sequência real de scripts existentes:

```bash
npm run test
npm run qa
npm run qa:final-report
npm run check:green
```

## Troubleshooting

### "final-verdict.json não encontrado"

Execute `npm run qa` e `npm run qa:final-report` antes de `npm run check:green`.

### "Testes falharam"

Corrija a etapa que falhou antes de seguir para QA.

### "QA falhou"

Inspecione os artefatos gerados em `qa/` e o veredito final em `qa/final-verdict.json`.

### "SLA excedido"

Otimize a bateria executada ou ajuste o SLA em `governance/qa-policy.json`.

