# 🎨 Diálogos com Tailwind CSS

## ✅ Implementação

Todos os diálogos de confirmação agora usam Tailwind CSS ao invés de `confirm()` nativo do navegador.

## 📦 Componente Criado

### `ConfirmDialog.jsx`

Componente de diálogo de confirmação moderno com Tailwind CSS.

**Localização:** `frontend/src/components/ConfirmDialog.jsx`

**Recursos:**
- ✅ Design moderno com Tailwind CSS
- ✅ Variantes: `warning`, `danger`, `info`
- ✅ Suporte a mensagens multi-linha
- ✅ Botões customizáveis
- ✅ Animações suaves
- ✅ Backdrop com blur
- ✅ Fechamento por ESC

## 🎣 Hook `useConfirmDialog`

Hook React para usar diálogos de confirmação de forma simples.

### Uso Básico

```jsx
import { useConfirmDialog } from '../components/ConfirmDialog';

function MyComponent() {
  const { confirm, ConfirmDialog } = useConfirmDialog();

  const handleAction = async () => {
    const confirmed = await confirm({
      title: 'Confirmar Ação',
      message: 'Deseja realmente executar esta ação?',
      confirmLabel: 'Confirmar',
      cancelLabel: 'Cancelar',
      variant: 'warning',
    });

    if (confirmed) {
      // Ação confirmada
    }
  };

  return (
    <>
      <button onClick={handleAction}>Executar</button>
      <ConfirmDialog />
    </>
  );
}
```

### Opções do `confirm()`

```javascript
await confirm({
  title: 'Título do diálogo',
  message: 'Mensagem do diálogo (suporta \n para quebras de linha)',
  confirmLabel: 'Texto do botão de confirmação',
  cancelLabel: 'Texto do botão de cancelamento',
  variant: 'warning' | 'danger' | 'info',
  onConfirm: () => {}, // Callback opcional
  onCancel: () => {},  // Callback opcional
});
```

### Variantes

- **`warning`** ⚠️ - Ações que requerem atenção (padrão)
- **`danger`** ❌ - Ações destrutivas (excluir, reiniciar)
- **`info`** ℹ️ - Ações informativas

## 📋 Páginas Atualizadas

### 1. ConfigPage

**Diálogos substituídos:**
- ✅ Descartar alterações
- ✅ Reiniciar servidor

**Código:**
```jsx
const { confirm, ConfirmDialog } = useConfirmDialog();

const handleReset = async () => {
  const confirmed = await confirm({
    title: 'Descartar Alterações',
    message: 'Deseja descartar todas as alterações?',
    variant: 'warning',
  });
  // ...
};
```

### 2. SupportPage

**Diálogos substituídos:**
- ✅ Fechar ticket

**Código:**
```jsx
const { confirm, ConfirmDialog } = useConfirmDialog();

const handleClose = async (ticketId) => {
  const confirmed = await confirm({
    title: 'Fechar Ticket',
    message: 'Deseja realmente fechar este ticket?',
    variant: 'warning',
  });
  // ...
};
```

### 3. TicketMaintenancePage

**Diálogos substituídos:**
- ✅ Excluir fila (sem tickets)
- ✅ Excluir fila (com tickets - perigoso)

**Código:**
```jsx
const { confirm, ConfirmDialog } = useConfirmDialog();

const handleDeleteQueue = async (queueName, force = false) => {
  const confirmed = await confirm({
    title: force ? '⚠️ ATENÇÃO: Excluir Fila com Tickets' : 'Excluir Fila',
    message: force 
      ? 'A fila possui tickets ativos. Todos serão fechados.'
      : 'Deseja realmente excluir a fila?',
    variant: force ? 'danger' : 'warning',
  });
  // ...
};
```

## 🎨 Design

### Estrutura Visual

```
┌─────────────────────────────────┐
│  ⚠️  Confirmar Ação         [X]│
├─────────────────────────────────┤
│                                 │
│  ⚠️  Deseja realmente executar  │
│      esta ação?                 │
│                                 │
├─────────────────────────────────┤
│              [Cancelar] [Confirmar]│
└─────────────────────────────────┘
```

### Cores por Variante

- **Warning:** Botão amarelo/laranja
- **Danger:** Botão vermelho
- **Info:** Botão azul

### Responsividade

- ✅ Mobile-friendly
- ✅ Adapta-se a diferentes tamanhos de tela
- ✅ Backdrop responsivo

## 🔧 Exemplo Completo

```jsx
import React from 'react';
import { useConfirmDialog } from '../components/ConfirmDialog';

export function MyPage() {
  const { confirm, ConfirmDialog } = useConfirmDialog();

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: 'Excluir Item',
      message: 'Esta ação não pode ser desfeita.\n\nDeseja continuar?',
      confirmLabel: 'Excluir',
      cancelLabel: 'Cancelar',
      variant: 'danger',
      onConfirm: () => {
        console.log('Item excluído');
      },
    });

    if (confirmed) {
      // Lógica de exclusão
    }
  };

  return (
    <div>
      <button onClick={handleDelete}>Excluir</button>
      <ConfirmDialog />
    </div>
  );
}
```

## ✅ Benefícios

1. **Design Consistente:** Todos os diálogos seguem o mesmo padrão visual
2. **Customizável:** Fácil personalizar cores, textos e comportamentos
3. **Acessível:** Suporta teclado (ESC para fechar)
4. **Responsivo:** Funciona bem em mobile e desktop
5. **Moderno:** Usa Tailwind CSS para estilização

## 📚 Referências

- [Componente Dialog](./components/Dialog.jsx) - Base para o ConfirmDialog
- [Tailwind CSS](https://tailwindcss.com/) - Framework de CSS utilitário

---

**Status:** ✅ **IMPLEMENTADO E FUNCIONANDO**

**Última Atualização:** 2024

