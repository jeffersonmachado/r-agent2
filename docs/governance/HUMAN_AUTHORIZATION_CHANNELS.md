# Autorização humana por canal (Bug Closure First)

**Status:** vinculante · 2026-10-31 · decisão do dono da plataforma
**Código que implementa:** `governance/bug-closure/closure-proof.js` → `validarAutorizacaoHumana`
**Testes:** `tests/unit/governance/closureHumanAuthorizationChannel.test.js`

---

## 1. Decisão

A autorização humana **explícita e interativa é obrigatória quando o fluxo nasce na UI**. Quando o
humano autoriza **dentro de uma sessão do VS Code**, o agente registra essa autorização em nome dele
— com proveniência — e o gate a considera **adequada**.

O canal muda a **proveniência** da autorização, nunca a exigência de **autoria humana**. Em todos os
canais continua sendo obrigatório identificar:

| Campo | Obrigatório | Papel |
|---|---|---|
| `by` | sempre | identidade **humana** (identidade de agente é recusada) |
| `at` | sempre | instante ISO-8601 da autorização |
| `ref` | sempre | referência da evidência (ex.: `session:<id>`, URL, ticket) |
| `channel` | opcional (padrão `UI`) | `UI` ou `VSCODE_AGENT` |
| `agentSession` | obrigatório em `VSCODE_AGENT` | id da sessão do agente que registrou |

A autorização inteira entra no **payload assinado** da prova (`CAMPOS_ASSINADOS` inclui
`humanAuthorization`), portanto trocar o canal, o autor ou a referência **quebra a assinatura**.

## 2. Canais aceitos

### `UI` (padrão)
Fluxo originado na interface do produto: a aprovação é um ato interativo do humano na tela. Quando o
campo `channel` está ausente, a autorização é tratada como `UI` — decisão de **retrocompatibilidade**
com provas já emitidas.

### `VSCODE_AGENT`
O humano autoriza explicitamente na conversa da sessão do VS Code e o agente materializa o registro.
Exige `agentSession`, para que qualquer auditor distinga "clique na tela" de "ordem explícita ao
agente" sem precisar confiar na narrativa do registro.

Recusa nomeada: `SESSAO_DO_AGENTE_AUSENTE`.

## 3. Recusas nomeadas

| Motivo | Quando |
|---|---|
| `AUTORIZACAO_AUSENTE` | `humanAuthorization` nulo/ausente em item P0 |
| `CANAL_DESCONHECIDO` | `channel` fora de `UI`/`VSCODE_AGENT` — não existe canal livre |
| `AUTOR_HUMANO_AUSENTE` | `by` vazio ou com padrão de identidade de agente |
| `INSTANTE_AUSENTE` | `at` vazio |
| `REFERENCIA_AUSENTE` | `ref` vazio |
| `SESSAO_DO_AGENTE_AUSENTE` | `channel = VSCODE_AGENT` sem `agentSession` |

Todos aparecem no veredito como `APROVACAO_HUMANA_AUSENTE` (código público do gate), com o motivo
específico preservado para diagnóstico.

## 4. O que NÃO muda

- **P0 continua exigindo evidência negativa real** (`EVIDENCIA_NEGATIVA_AUSENTE`): provar que o teste
  falha no código defeituoso. Autorização por canal **não** substitui essa prova — são requisitos
  independentes.
- **Assinatura Ed25519 ancorada** continua obrigatória: pin em código + âncora externa
  (`RAP_CLOSURE_TRUST_ANCHOR_SHA256`) coerentes. Autorização registrada em JSON editável não vale
  sozinha.
- **Item sem teste de regressão citado** continua em decisão humana (escrever suíte, reabrir ou
  aceitar risco declarado). Canal de autorização não cria teste.

## 5. Como declarar

```json
"humanAuthorization": {
  "channel": "VSCODE_AGENT",
  "by": "platform-owner:jeffersonmachado",
  "at": "2026-10-31T14:30:00.000Z",
  "ref": "session:e92510ac-0f54-41c6-bb85-90f42042999c",
  "agentSession": "e92510ac-0f54-41c6-bb85-90f42042999c"
}
```

## 6. Histórico

- **2026-10-31** — política criada. Antes dela o gate exigia `by`/`at`/`ref` sem noção de canal: toda
  autorização parecia ter a mesma origem, e o fluxo por agente tinha de imitar um clique de UI que
  nunca existiu.
