# RPA Reliability Handbook - 10 Patch Suggestions

## Objetivo
Fornecer recomendacoes de correcao permanente sem alteracao automatica de codigo.

## Regra de Ouro
`Patch suggestion` nunca e aplicado automaticamente no repositrio.

## Tipos de Sugestao
- troca de seletor fragil por atributo estavel,
- ajuste de assert (exact vs contains),
- ajuste de timeout/espera,
- simplificacao de sequencia de passos.

## Exemplo
```json
{
  "type": "selector_update",
  "current": ".btn.primary:nth-child(3)",
  "suggested": "[data-testid='confirm-order']",
  "reason": "higher stability score"
}
```

## Limitacoes
- Sugestao pode ficar desatualizada apos mudanca posterior de UI.

## Boas Praticas
- Tratar sugestao como pull request candidate.
- Exigir revisao humana antes de merge.
