/**
 * Plugin de renderização React para Rete.js v1.4.4.
 *
 * Este plugin renderiza componentes React definidos em node.data.component
 * usando ReactDOM para criar a visualização dos nós.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';

function ReactRenderPlugin(options = {}) {
  this.options = options;
}

ReactRenderPlugin.prototype.install = function install(editor) {
  console.log('ReactRenderPlugin.install chamado', { hasEditor: !!editor });
  
  // Função auxiliar para renderizar um nó
  const renderNode = (node) => {
    if (!node.data || !node.data.component) {
      return;
    }
    
    const component = node.data.component;
    
    // Tenta encontrar o elemento DOM do nó
    let nodeElement = null;
    
    // Verifica várias possíveis localizações do elemento
    if (node.el) {
      nodeElement = node.el;
      console.log('Encontrou elemento via node.el', { nodeId: node.id });
    } else if (node.view && node.view.el) {
      nodeElement = node.view.el;
      console.log('Encontrou elemento via node.view.el', { nodeId: node.id });
    } else if (node.view && node.view.container) {
      nodeElement = node.view.container;
      console.log('Encontrou elemento via node.view.container', { nodeId: node.id });
    } else if (editor.view && editor.view.container) {
      // Tenta encontrar o elemento no container do editor usando o ID do nó
      const nodeId = `node-${node.id}`;
      nodeElement = editor.view.container.querySelector(`[data-node-id="${nodeId}"]`);
      
      if (nodeElement) {
        console.log('Encontrou elemento via querySelector', { nodeId: node.id });
      } else {
        // Tenta encontrar por classe ou outros atributos
        const allNodes = editor.view.container.querySelectorAll('.rete-node, [data-node-id]');
        console.log('Procurando elementos no container', { 
          nodeId: node.id,
          totalElements: allNodes.length,
          containerExists: !!editor.view.container
        });
        
        // Se não encontrar, cria o elemento manualmente
        if (!nodeElement && editor.view.container) {
          console.log('Criando elemento DOM manualmente para nó', { nodeId: node.id, position: node.position });
          nodeElement = document.createElement('div');
          nodeElement.setAttribute('data-node-id', nodeId);
          nodeElement.className = 'rete-node';
          nodeElement.style.position = 'absolute';
          nodeElement.style.left = `${node.position[0]}px`;
          nodeElement.style.top = `${node.position[1]}px`;
          nodeElement.style.zIndex = '10';
          nodeElement.style.pointerEvents = 'auto';
          nodeElement.style.width = 'auto';
          nodeElement.style.height = 'auto';
          // Permite que o Rete.js AreaPlugin gerencie o drag do nó
          nodeElement.style.cursor = 'move';
          nodeElement.setAttribute('data-draggable', 'true');
          editor.view.container.appendChild(nodeElement);
          
          // Cria uma view mock para o nó
          if (!node.view) {
            node.view = {
              el: nodeElement,
              container: nodeElement,
              update: () => {},
              on: () => {},
              off: () => {},
              trigger: () => {},
            };
          } else if (!node.view.el) {
            node.view.el = nodeElement;
          }
          
          console.log('Elemento DOM criado manualmente', { 
            nodeId: node.id,
            hasElement: !!nodeElement,
            parent: nodeElement.parentElement?.tagName
          });
        }
      }
    }
    
    if (nodeElement) {
      // Limpa qualquer renderização anterior
      if (node._reactRoot) {
        try {
          node._reactRoot.unmount();
        } catch (err) {
          // Ignora erros de desmontagem
        }
      }
      
      // Cria um container para o React se não existir
      let reactContainer = nodeElement.querySelector('.react-node-content');
      if (!reactContainer) {
        reactContainer = document.createElement('div');
        reactContainer.className = 'react-node-content';
        reactContainer.style.width = '100%';
        reactContainer.style.height = '100%';
        nodeElement.appendChild(reactContainer);
      }
      
      // Cria um root React para renderizar o componente
      try {
        // Função para fazer bind de sockets
        const bindSocket = (el, io) => {
          if (!el || !io) return;
          
          // O Rete.js precisa que o elemento seja associado ao input/output
          // O ConnectionPlugin procura por elementos com data-socket e data-node-id
          const socketName = el.getAttribute('data-socket');
          const nodeId = el.getAttribute('data-node-id');
          const ioKey = el.getAttribute('data-io-key');
          
          if (socketName) {
            // Armazena referência do elemento no input/output
            io.element = el;
            
            // Adiciona atributos necessários para o ConnectionPlugin
            el.setAttribute('data-socket', socketName);
            if (nodeId) {
              el.setAttribute('data-node-id', nodeId);
            }
            if (ioKey) {
              el.setAttribute('data-io-key', ioKey);
            }
            
            // Adiciona classes para identificação
            el.classList.add('socket');
            if (io.input) {
              el.classList.add('input-socket');
            } else if (io.output) {
              el.classList.add('output-socket');
            }
            
            // Verifica se é Input ou Output
            // Não usa instanceof porque editor.constructor.Input pode não estar disponível
            // Em vez disso, verifica propriedades ou métodos específicos
            if (io && typeof io === 'object') {
              // Input geralmente tem uma propriedade 'connections' ou método específico
              // Output geralmente tem uma propriedade diferente
              // Vamos verificar o nome do construtor ou propriedades específicas
              const constructorName = io.constructor?.name || '';
              if (constructorName === 'Input' || io.input !== undefined) {
                el.classList.add('input-socket');
              } else if (constructorName === 'Output' || io.output !== undefined) {
                el.classList.add('output-socket');
              }
            }
            
            // IMPORTANTE: Chama o bindSocket do editor.view para que o ConnectionPlugin funcione
            // O Rete.js precisa que o elemento seja vinculado ao input/output através do view
            if (editor.view && editor.view.bindSocket) {
              try {
                editor.view.bindSocket(el, io, 'io');
                console.log('Socket vinculado via editor.view.bindSocket', {
                  nodeId: node.id,
                  ioKey: io.key,
                  hasElement: !!el,
                  socketName
                });
              } catch (err) {
                console.warn('Erro ao vincular socket via editor.view.bindSocket', {
                  nodeId: node.id,
                  error: err.message
                });
              }
            }
          }
        };
        
        // Função para fazer bind de controls
        const bindControl = (el, control) => {
          if (!el || !control) return;
          if (control.element !== undefined) {
            control.element = el;
          }
        };
        
        const root = createRoot(reactContainer);
        root.render(
          React.createElement(component, {
            node,
            bindSocket: (el, io) => bindSocket(el, io),
            bindControl: (el, control) => bindControl(el, control),
          })
        );
        
        // Armazena a referência do root para cleanup
        node._reactRoot = root;
        node._reactContainer = reactContainer;
        
        console.log('Componente React renderizado no nó', {
          nodeId: node.id,
          hasElement: !!nodeElement,
          hasComponent: !!component
        });
      } catch (err) {
        console.error('Erro ao renderizar componente React no nó', err, {
          nodeId: node.id,
          hasElement: !!nodeElement,
          hasComponent: !!component
        });
      }
    } else {
      console.warn('Elemento DOM do nó não encontrado para renderização React', {
        nodeId: node.id,
        hasEl: !!node.el,
        hasView: !!node.view,
        hasViewEl: !!(node.view && node.view.el),
        hasEditorView: !!(editor.view && editor.view.container)
      });
    }
  };
  
  // Intercepta a criação de nós para renderizar componentes React
  console.log('Registrando listener para evento nodecreated');
  editor.on('nodecreated', (node) => {
    console.log('Evento nodecreated disparado no ReactRenderPlugin', {
      nodeId: node.id,
      hasComponent: !!node.data?.component,
      hasView: !!node.view,
      hasViewEl: !!(node.view && node.view.el),
      hasEl: !!node.el,
      position: node.position
    });
    
    // Tenta renderizar imediatamente
    renderNode(node);
    
    // Também tenta após um delay para garantir que o DOM está pronto
    setTimeout(() => {
      if (!node._reactRoot) {
        console.log('Tentando renderizar nó novamente após 100ms', { nodeId: node.id });
        renderNode(node);
      }
    }, 100);
    
    // Tenta novamente após mais tempo se ainda não renderizou
    setTimeout(() => {
      if (!node._reactRoot) {
        console.log('Tentando renderizar nó novamente após 500ms', { nodeId: node.id });
        renderNode(node);
      }
    }, 500);
    
    // Última tentativa após 1 segundo
    setTimeout(() => {
      if (!node._reactRoot) {
        console.warn('Nó ainda não renderizado após 1s, tentando criar elemento manualmente', { 
          nodeId: node.id,
          hasView: !!node.view,
          hasViewEl: !!(node.view && node.view.el),
          hasEditorView: !!(editor.view && editor.view.container)
        });
        // Cria elemento manualmente se necessário
        if (editor.view && editor.view.container && !node._reactRoot) {
          const nodeElement = document.createElement('div');
          nodeElement.setAttribute('data-node-id', `node-${node.id}`);
          nodeElement.className = 'rete-node';
          nodeElement.style.position = 'absolute';
          nodeElement.style.left = `${node.position[0]}px`;
          nodeElement.style.top = `${node.position[1]}px`;
          nodeElement.style.zIndex = '10';
          nodeElement.style.pointerEvents = 'auto';
          editor.view.container.appendChild(nodeElement);
          
          // Atualiza a view do nó se não existir
          if (!node.view) {
            node.view = {
              el: nodeElement,
              container: nodeElement,
              update: () => {},
              on: () => {},
              off: () => {},
              trigger: () => {},
            };
          } else if (!node.view.el) {
            node.view.el = nodeElement;
          }
          
          renderNode(node);
        }
      }
    }, 1000);
  });
  
  // Também escuta quando a view do nó é criada/atualizada
  editor.on('rendernode', (data) => {
    if (data && data.node) {
      const node = data.node;
      if (node.data && node.data.component && !node._reactRoot) {
        console.log('Evento rendernode disparado, tentando renderizar', { nodeId: node.id });
        renderNode(node);
      }
    }
  });

  // Limpa o root React quando o nó é removido
  editor.on('noderemoved', (node) => {
    if (node._reactRoot) {
      try {
        node._reactRoot.unmount();
        node._reactRoot = null;
      } catch (err) {
        console.error('Erro ao desmontar componente React do nó', err);
      }
    }
  });
};

export default ReactRenderPlugin;


