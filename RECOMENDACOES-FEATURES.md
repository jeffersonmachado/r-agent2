# Recomendações de Features do Projeto de Referência

Este documento recomenda quais features do projeto de referência devem ser implementadas no nosso editor de fluxo de chatbot, priorizadas por utilidade e facilidade de implementação.

## 🎯 Contexto do Nosso Projeto

**Tipo:** Editor visual de fluxo de chatbot
**Uso:** Criar e editar fluxos conversacionais
**Usuários:** Desenvolvedores/Designers de chatbots
**Características:**
- ✅ Já temos: Toolbar, Sidebar de propriedades, NodePalette, Import/Export JSON
- ✅ Já temos: Seleção de nós, conexões, customização de componentes
- ✅ Já temos: Sistema de simulação, validação, salvamento

## 📊 Priorização de Features

### 🔴 ALTA PRIORIDADE (Implementar Primeiro)

#### 1. **Context Menu Plugin** ⭐⭐⭐⭐⭐
**Por quê:**
- **Muito útil** para criar nós rapidamente via clique direito
- **Melhora UX** - alternativa rápida à NodePalette
- **Fácil implementação** - plugin pronto, só configurar
- **Compatível** com nosso sistema de nós existente

**Como usar:**
```typescript
const contextMenu = new ContextMenuPlugin<Schemes>({
  items: ContextMenuPresets.classic.setup([
    ['Start', () => createFlowNode({ type: 'start' })],
    ['Message', () => createFlowNode({ type: 'message' })],
    ['Router', () => createFlowNode({ type: 'router' })],
    // ... outros tipos de nós
  ]),
});

area.use(contextMenu);
reactRender.addPreset(ReactPresets.contextMenu.setup());
```

**Benefícios:**
- Criar nós diretamente no canvas (sem precisar arrastar da paleta)
- Workflow mais rápido para usuários experientes
- Menos cliques para criar nós

**Esforço:** ⭐⭐ (Baixo - plugin pronto)

---

#### 2. **Auto Arrange Plugin** ⭐⭐⭐⭐⭐
**Por quê:**
- **Essencial** para organizar grafos grandes
- **Melhora legibilidade** - fluxos ficam organizados automaticamente
- **Economiza tempo** - não precisa arrastar nós manualmente
- **Muito útil** para fluxos complexos de chatbot

**Como usar:**
```typescript
const arrange = new AutoArrangePlugin<Schemes>();
arrange.addPreset(ArrangePresets.classic.setup());
area.use(arrange);

// Botão na toolbar para organizar
const handleArrange = async () => {
  await arrange.layout();
  AreaExtensions.zoomAt(area, editor.getNodes());
};
```

**Benefícios:**
- Organização automática de nós
- Layout hierárquico claro
- Zoom automático após organizar
- Botão na toolbar para reorganizar quando necessário

**Esforço:** ⭐⭐⭐ (Médio - precisa adicionar botão na UI)

---

#### 3. **Minimap Plugin** ⭐⭐⭐⭐
**Por quê:**
- **Muito útil** para navegação em fluxos grandes
- **Melhora orientação** - usuário sempre sabe onde está
- **Navegação rápida** - clicar no minimapa para navegar
- **Visual profissional** - dá polimento ao editor

**Como usar:**
```typescript
const minimap = new MinimapPlugin<Schemes>();
area.use(minimap);
reactRender.addPreset(ReactPresets.minimap.setup());
```

**Benefícios:**
- Visão geral do fluxo completo
- Navegação rápida clicando no minimapa
- Sempre visível (canto da tela)
- Melhora UX em grafos grandes

**Esforço:** ⭐⭐ (Baixo - plugin pronto)

---

### 🟡 MÉDIA PRIORIDADE (Implementar Depois)

#### 4. **Reroute Points Plugin** ⭐⭐⭐
**Por quê:**
- **Útil** para organizar conexões complexas
- **Melhora visualização** - conexões não ficam sobrepostas
- **Flexibilidade** - usuário pode ajustar caminho das conexões
- **Não essencial** - mas melhora muito a experiência

**Como usar:**
```typescript
const reroutePlugin = new ReroutePlugin<Schemes>();
reactRender.use(reroutePlugin);
reactRender.addPreset(
  ReactPresets.reroute.setup({
    contextMenu(id) {
      reroutePlugin.remove(id);
    },
    translate(id, dx, dy) {
      reroutePlugin.translate(id, dx, dy);
    },
    pointerdown(id) {
      reroutePlugin.unselect(id);
      reroutePlugin.select(id);
    },
  })
);
```

**Benefícios:**
- Pontos intermediários nas conexões
- Melhor organização visual
- Context menu para remover reroutes
- Seleção e movimentação de reroutes

**Esforço:** ⭐⭐⭐ (Médio - precisa configurar handlers)

---

#### 5. **Melhorias no AreaExtensions** ⭐⭐⭐
**Por quê:**
- **Já temos parcialmente** - seleção de nós
- **Pode melhorar** - zoom, ordenação, etc.
- **Fácil de adicionar** - já estamos usando

**O que adicionar:**
```typescript
// Zoom automático (já temos, mas pode melhorar)
AreaExtensions.zoomAt(area, editor.getNodes());

// Ordenação simples (já temos)
AreaExtensions.simpleNodesOrder(area);

// Seleção múltipla (já temos)
AreaExtensions.selectableNodes(area, selector, { accumulating });
```

**Benefícios:**
- Melhorias incrementais
- Código mais limpo
- Funcionalidades já testadas

**Esforço:** ⭐ (Muito baixo - já temos a base)

---

### 🟢 BAIXA PRIORIDADE (Opcional/Futuro)

#### 6. **Dataflow Engine** ⭐⭐
**Por quê:**
- **Não essencial** - já temos sistema de simulação próprio
- **Pode ser útil** - para validação em tempo real
- **Complexo** - requer refatoração dos nós

**Quando usar:**
- Se quisermos validação em tempo real durante edição
- Se quisermos preview de valores durante edição
- Se quisermos depuração visual do fluxo

**Esforço:** ⭐⭐⭐⭐⭐ (Alto - requer refatoração)

---

#### 7. **Scopes Plugin (Hierarquia)** ⭐
**Por quê:**
- **Não necessário** - fluxos de chatbot são lineares/hierárquicos simples
- **Complexo** - adiciona complexidade desnecessária
- **Pouco uso** - raramente precisamos de hierarquia profunda

**Quando usar:**
- Se quisermos criar "sub-fluxos" dentro de nós
- Se quisermos agrupar nós visualmente
- Se quisermos criar módulos reutilizáveis

**Esforço:** ⭐⭐⭐⭐ (Alto - requer mudanças na estrutura)

---

#### 8. **Renderização 3D** ⭐
**Por quê:**
- **Não necessário** - editor 2D é suficiente
- **Complexo** - adiciona dependência Three.js
- **Pouco benefício** - não melhora UX para nosso caso de uso

**Quando usar:**
- Se quisermos visualização 3D para demonstrações
- Se quisermos diferenciar nosso produto
- Se quisermos explorar novas formas de visualização

**Esforço:** ⭐⭐⭐⭐⭐ (Muito alto - requer Three.js e refatoração)

---

## 📋 Plano de Implementação Recomendado

### Fase 1: Essenciais (1-2 semanas)
1. ✅ **Context Menu Plugin** - Criar nós via clique direito
2. ✅ **Auto Arrange Plugin** - Organização automática
3. ✅ **Minimap Plugin** - Navegação em grafos grandes

### Fase 2: Melhorias (1 semana)
4. ✅ **Reroute Points Plugin** - Melhor organização de conexões
5. ✅ **Melhorias no AreaExtensions** - Zoom, ordenação, etc.

### Fase 3: Opcionais (Futuro)
6. ⏳ **Dataflow Engine** - Se necessário para validação em tempo real
7. ⏳ **Scopes Plugin** - Se necessário para hierarquia complexa
8. ⏳ **Renderização 3D** - Se necessário para diferenciação

## 🛠️ Dependências Necessárias

### Para Fase 1:
```json
{
  "rete-context-menu-plugin": "^2.0.6",
  "rete-auto-arrange-plugin": "^2.0.2",
  "rete-minimap-plugin": "^2.0.3"
}
```

### Para Fase 2:
```json
{
  "rete-connection-reroute-plugin": "^2.0.3"
}
```

### Para Fase 3 (Opcional):
```json
{
  "rete-engine": "^2.1.1",
  "rete-scopes-plugin": "^2.1.1",
  "rete-area-3d-plugin": "^2.0.5",
  "three": "^0.156.1"
}
```

## 💡 Recomendações Finais

### Implementar Agora:
1. **Context Menu** - Impacto alto, esforço baixo
2. **Auto Arrange** - Impacto alto, esforço médio
3. **Minimap** - Impacto médio, esforço baixo

### Implementar Depois:
4. **Reroute Points** - Impacto médio, esforço médio

### Não Implementar (por enquanto):
- Dataflow Engine (já temos simulação)
- Scopes (complexidade desnecessária)
- 3D (não agrega valor)

## 🎯 ROI (Return on Investment)

| Feature | Impacto UX | Esforço | ROI | Prioridade |
|---------|-----------|---------|-----|------------|
| Context Menu | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ | 🔴 Alta |
| Auto Arrange | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | 🔴 Alta |
| Minimap | ⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ | 🔴 Alta |
| Reroute Points | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | 🟡 Média |
| Dataflow Engine | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐ | 🟢 Baixa |
| Scopes | ⭐ | ⭐⭐⭐⭐ | ⭐ | 🟢 Baixa |
| 3D | ⭐ | ⭐⭐⭐⭐⭐ | ⭐ | 🟢 Baixa |

## 📝 Notas de Implementação

### Context Menu
- Integrar com nosso sistema de criação de nós existente
- Usar os mesmos tipos de nós da NodePalette
- Posicionar menu próximo ao cursor

### Auto Arrange
- Adicionar botão na Toolbar
- Mostrar loading durante organização
- Manter posições dos nós quando possível

### Minimap
- Posicionar no canto inferior direito
- Tamanho configurável (pequeno por padrão)
- Mostrar área visível atual

### Reroute Points
- Permitir criar via duplo clique na conexão
- Context menu para remover
- Visual discreto mas claro

