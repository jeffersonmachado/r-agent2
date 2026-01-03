# Auto Teste do Sistema

## Comando Único

```bash
npm run autotest
```

## O Que Ele Faz

O comando `autotest` executa uma sequência completa de validação:

1. **Testes** - Executa todos os testes do projeto (`npm run test:all`)
2. **QA Sistêmico** - Executa QA com aplicação de governança (`qa/runQa.js`)
3. **Veredito Final** - Gera veredito GO/BLOCK (`qa/finalizeQa.js`)

## Quando Usar

- **Antes de fazer commit** - Garantir que tudo está funcionando
- **Antes de fazer merge** - Validar que PR está pronto
- **No CI/CD** - Pipeline executa automaticamente
- **Antes de deploy** - Última verificação antes de produção

## Onde Ver o Resultado

### Arquivos Gerados

- `qa/latest.json` - Resultado completo de QA com governança aplicada
- `qa/final-verdict.json` - Veredito final (GO ou BLOCK)

### Verificação Rápida

```bash
npm run check:green
```

Este comando verifica se o sistema está "verde" (pronto) baseado no último veredito.

## Regra de Ouro

**Se `autotest` falhar (exit code 1), NÃO AVANÇAR.**

- ❌ Não fazer commit
- ❌ Não fazer merge
- ❌ Não fazer deploy

Corrija os problemas antes de continuar.

## Exit Codes

- `0` = GO (sistema pronto, pode avançar)
- `1` = BLOCK (sistema não está pronto, não avançar)

## Integração com CI

O CI deve executar:

```bash
npm run autotest
```

E confiar no exit code para bloquear ou liberar o pipeline.

## Detalhes Técnicos

### Governança Aplicada

O autotest aplica automaticamente:

- **policyEvaluator** - Avalia políticas de QA (WARN vira FAIL em escopos críticos)
- **timeEvaluator** - Verifica SLA de execução (CI não pode exceder 300s)

### Veredito Final

O veredito é determinado por:

- **BLOCK** se houver falhas bloqueantes
- **BLOCK** se status for FAIL
- **GO** se status for PASS ou WARN (sem bloqueantes)

## Troubleshooting

### "latest.json não encontrado"

Execute `npm run autotest` primeiro para gerar o resultado.

### "Testes falharam"

Corrija os testes que falharam antes de continuar.

### "QA falhou"

Verifique `qa/latest.json` para ver quais checks falharam.

### "SLA excedido"

O tempo de execução excedeu o limite. Otimize os testes ou ajuste o SLA em `governance/qa-policy.json`.

