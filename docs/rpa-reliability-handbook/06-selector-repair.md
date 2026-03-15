# RPA Reliability Handbook - 06 Selector Repair

## Objetivo
Sugerir e testar seletores alternativos em runtime quando o seletor original quebra.

## Prioridades de Atributo
1. `data-testid` / `data-test`
2. `id`
3. `name`
4. `aria-*` / role
5. texto estavel
6. fallback CSS mais amplo

## Estrategia
- Gerar candidatos.
- Pontuar por estabilidade e especificidade.
- Aplicar candidato mais confiavel dentro do governor.

## Exemplo de Saida
```json
{
  "applied": true,
  "bestCandidate": "[data-testid='submit-order']",
  "candidates": ["#submit", "button:has-text('Salvar')"]
}
```

## Limitacoes
- Texto de UI e fraco em apps com i18n dinamico.
- Seletores de classe utilitaria tendem a ser volateis.

## Boas Praticas
- Preferir atributos de teste no frontend.
- Persistir apenas sugestao de patch, nunca auto-editar seed.
