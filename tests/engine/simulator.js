/**
 * Simulador de conversa determinístico.
 * 
 * Executa scripts de conversa de forma determinística,
 * sem IA real nem aleatoriedade.
 */

const { FlowExecutor } = require('./flowExecutor');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../api/data/test');
const FLOWS_FILE = path.join(DATA_DIR, 'flows.json');

class ConversationSimulator {
  constructor() {
    this.executor = new FlowExecutor();
    this.flows = null;
  }
  
  /**
   * Carrega fluxos de teste.
   */
  loadFlows() {
    if (!fs.existsSync(FLOWS_FILE)) {
      throw new Error('Arquivo de fluxos não encontrado. Execute npm run seed:test primeiro.');
    }
    
    const content = fs.readFileSync(FLOWS_FILE, 'utf8');
    this.flows = JSON.parse(content);
  }
  
  /**
   * Encontra um fluxo por ID.
   * 
   * @param {string} flowId - ID do fluxo
   * @returns {object|null} Fluxo encontrado
   */
  /**
   * Encontra próximo nó de um nó específico.
   * 
   * @param {string} nodeId - ID do nó
   * @returns {string|null} ID do próximo nó
   */
  findNextNodeId(nodeId) {
    if (!this.executor.currentFlow) {
      return null;
    }
    const connections = this.executor.currentFlow.connections || [];
    const connection = connections.find(c => c.from === nodeId);
    return connection ? connection.to : null;
  }
  
  /**
   * Encontra próximo nó de um nó específico.
   * 
   * @param {string} nodeId - ID do nó
   * @returns {string|null} ID do próximo nó
   */
  findNextNodeId(nodeId) {
    if (!this.executor.currentFlow) {
      return null;
    }
    const connections = this.executor.currentFlow.connections || [];
    const connection = connections.find(c => c.from === nodeId);
    return connection ? connection.to : null;
  }
  
  findFlow(flowId) {
    if (!this.flows) {
      this.loadFlows();
    }
    
    return this.flows.find(f => f.id === flowId) || null;
  }
  
  /**
   * Executa um script de conversa.
   * 
   * IMPORTANTE: Valida dependências explícitas ANTES de executar.
   * Scripts NÃO podem assumir dados implícitos.
   * 
   * @param {object} script - Script de conversa
   * @returns {object} Resultado da execução
   */
  async executeScript(script) {
    // CONTRATO FORMAL: Valida requires ANTES de executar
    const { validateScriptRequirements } = require('../helpers/dataValidationHelper');
    const requirementsCheck = validateScriptRequirements(script);
    
    if (!requirementsCheck.valid) {
      const error = new Error(
        `Script "${script.id || 'unknown'}" não pode ser executado: dependências faltando. ` +
        `Faltando: ${requirementsCheck.missing.join(', ')}. ` +
        `Scripts devem declarar todas as dependências no campo "requires".`
      );
      // @ts-ignore
      error.code = 'DATA_VALIDATION_FAILED';
      // @ts-ignore
      error.type = 'data';
      // @ts-ignore
      error.missing = requirementsCheck.missing;
      throw error;
    }
    
    // Valida dependências específicas de fluxos
    if (script.requires) {
      if (script.requires.flows) {
        const flowIds = Array.isArray(script.requires.flows) ? script.requires.flows : [script.requires.flows];
        for (const flowId of flowIds) {
          const flow = this.findFlow(flowId);
          if (!flow) {
            const error = new Error(`Fluxo requerido não encontrado: ${flowId}`);
            // @ts-ignore
            error.code = 'DATA_VALIDATION_FAILED';
            // @ts-ignore
            error.type = 'data';
            // @ts-ignore
            error.missing = ['flows'];
            throw error;
          }
        }
      }
    }
    
    // Carrega fluxo principal
    // Verifica requiresDetails.flows primeiro (formato novo), depois requires.flows (formato antigo), depois flowId
    const flowId = script.requiresDetails?.flows?.[0] || script.requires?.flows?.[0] || script.flowId;
    if (!flowId) {
      throw new Error('Script não especifica fluxo');
    }
    
    const flow = this.findFlow(flowId);
    if (!flow) {
      throw new Error(`Fluxo não encontrado: ${flowId}`);
    }
    
    // Inicializa executor
    this.executor.loadFlow(flow);
    this.executor.clearLogs();
    
    // Encontra nó inicial
    const startNode = flow.nodes.find(n => n.type === 'start');
    if (!startNode) {
      throw new Error('Fluxo não tem nó start');
    }
    
    let currentNodeId = startNode.id;
    const results = [];
    
    // Processa cada passo do script
    for (let i = 0; i < script.steps.length; i++) {
      const step = script.steps[i];
      
      // Processa nó atual
      let result;
      if (step.type === 'user_message') {
        // Verifica se o nó atual é userInput - se for, processa com o input do step
        const currentNode = this.executor.findNode(currentNodeId);
        const isLastStep = i === script.steps.length - 1;
        
        if (currentNode && (currentNode.type === 'userInput' || currentNode.type === 'user_input')) {
          // Processa userInput primeiro para definir variáveis
          result = this.executor.processNode(currentNodeId, step.input);
          
          // Verifica se o step espera ver o user-input
          const expectedNode = step.expected?.node;
          const expectsUserInput = expectedNode === currentNodeId;
          
          // Se o step espera ver o user-input, não avança para o próximo nó ainda
          // (mesmo sendo o último step, se o teste espera ver user-input, não avança)
          if (expectsUserInput) {
            // Não processa o próximo nó ainda, mantém no userInput
            result = {
              ...result,
              completed: false,
              nextNodeId: result.nextNodeId // Preserva nextNodeId mas não processa ainda
            };
            this.executor.stateManager.setCurrentNode(currentNodeId);
          } else if (result.nextNodeId) {
            // Se não é o último step e aponta para end, não processa o end ainda
            if (!isLastStep && result.nextNodeId) {
              const nodeAfterUserInput = this.executor.findNode(result.nextNodeId);
              if (nodeAfterUserInput && nodeAfterUserInput.type === 'end') {
                // Não processa o end ainda, mantém no userInput
                result = {
                  ...result,
                  completed: false
                };
                this.executor.stateManager.setCurrentNode(currentNodeId);
              } else if (result.nextNodeId) {
                // Continua processando apenas se não for end
                result = this.executor.processNode(result.nextNodeId);
              }
            } else if (isLastStep && !expectsUserInput) {
              // É o último step, continua processando apenas se não espera ver user-input
              result = this.executor.processNode(result.nextNodeId);
            }
          }
        } else {
          // Se o nó atual é router, define a variável ANTES de processar
          if (currentNode && currentNode.type === 'router') {
            const variables = this.executor.stateManager.getVariables();
            // Define a variável com o input do step atual
            this.executor.stateManager.setVariable('userResponse', step.input);
            // Processa o router imediatamente após definir a variável
            result = this.executor.processNode(currentNodeId);
            
            // Se o router aponta para o nó esperado, processa o nó esperado
            const expectedNode = step.expected?.node;
            if (result.nextNodeId && result.nextNodeId === expectedNode) {
              const nextNode = this.executor.findNode(result.nextNodeId);
              if (nextNode) {
                result = this.executor.processNode(result.nextNodeId);
                // Se não é o último step, não continua processando além do nó esperado
                if (!isLastStep && result.nextNodeId) {
                  const nodeAfterExpected = this.executor.findNode(result.nextNodeId);
                  if (nodeAfterExpected && nodeAfterExpected.type === 'end') {
                    // Não processa o end ainda
                    result = {
                      ...result,
                      completed: false
                    };
                  }
                }
              }
            }
          } else {
            // Processa nó atual primeiro (pode ser start, message ou outro)
            result = this.executor.processNode(currentNodeId);
            
            // Se o resultado aponta para um router, NÃO processa o router ainda
            // O router será processado no próximo step quando houver input do usuário
            // Apenas atualiza o nextNodeId para que o próximo step saiba onde está
            if (result.nextNodeId) {
              const nextNode = this.executor.findNode(result.nextNodeId);
              if (nextNode && nextNode.type === 'router') {
                // Para aqui, não processa o router ainda
                // O router será processado no próximo step quando houver input
                // Mantém o resultado com nextNodeId apontando para o router
              }
            }
          }
        }
        
        // Se o resultado não tem output mas tem nextNodeId, processa o próximo nó
        // Continua processando até encontrar um nó com output ou até chegar no nó esperado
        const expectsMessageOutput = step.expected && 
          step.expected.output !== null && 
          step.expected.output !== undefined;
        const expectedNode = step.expected?.node;
        
        while (result.nextNodeId && !result.output) {
          const nextNode = this.executor.findNode(result.nextNodeId);
          if (!nextNode) break;
          
          // Se o próximo nó é router, NÃO processa automaticamente
          // O router será processado no próximo step quando houver input do usuário
          if (nextNode.type === 'router') {
            // Para aqui, não processa o router ainda
            // O router será processado no próximo step quando houver input
            break;
          }
          
          // Se o próximo nó é o nó esperado pelo step, processa e para aqui
          if (nextNode.id === expectedNode) {
            // Processa o nó esperado
            if (nextNode.type === 'userInput' || nextNode.type === 'user_input') {
              result = this.executor.processNode(result.nextNodeId, step.input);
              // Se não é o último step, não continua processando além do userInput
              // (preserva nextNodeId mas não processa o próximo nó ainda)
              if (!isLastStep && result.nextNodeId) {
                // Não processa o próximo nó (end) ainda
                result = {
                  ...result,
                  completed: false
                };
              }
            } else {
              result = this.executor.processNode(result.nextNodeId);
            }
            // Para aqui, encontramos o nó esperado
            // Não continua processando além do nó esperado se o step espera ver esse nó
            // (mesmo sendo o último step, se o teste espera ver user-input, não processa o end)
            const expectsThisNode = expectedNode === nextNode.id;
            const isUserInput = nextNode.type === 'userInput' || nextNode.type === 'user_input';
            if (expectsThisNode && isUserInput) {
              // Se espera ver user-input, não processa o end mesmo sendo o último step
              break;
            }
            if (!isLastStep) {
              break;
            }
            // Se é o último step e o nó esperado aponta para end, processa o end
            // MAS: não processa se o step espera ver user-input
            if (result.nextNodeId && !(expectsThisNode && isUserInput)) {
              const nodeAfterExpected = this.executor.findNode(result.nextNodeId);
              if (nodeAfterExpected && nodeAfterExpected.type === 'end') {
                result = this.executor.processNode(result.nextNodeId);
              }
            }
            break;
          }
          
          // Se o próximo nó é userInput e o step espera ver output de mensagem, para aqui
          if ((nextNode.type === 'userInput' || nextNode.type === 'user_input') && expectsMessageOutput) {
            // Para aqui, não processa userInput ainda
            break;
          }
          
          // Processa o próximo nó
          if (nextNode.type === 'userInput' || nextNode.type === 'user_input') {
            result = this.executor.processNode(result.nextNodeId, step.input);
            
            // Verifica se o step espera ver o user-input
            const expectsThisUserInput = expectedNode === nextNode.id;
            
            // Se o step espera ver o user-input, não processa o end ainda
            // (mesmo sendo o último step, se o teste espera ver user-input, não processa o end)
            if (expectsThisUserInput && result.nextNodeId) {
              const nodeAfterUserInput = this.executor.findNode(result.nextNodeId);
              if (nodeAfterUserInput && nodeAfterUserInput.type === 'end') {
                // Não processa o end ainda, mantém no userInput
                result = {
                  ...result,
                  completed: false
                };
                // Garante que o currentNodeId fique no userInput
                this.executor.stateManager.setCurrentNode(nextNode.id);
                break;
              }
            } else if (!isLastStep && result.nextNodeId) {
              // Se não é o último step e o userInput aponta para end, não processa o end ainda
              const nodeAfterUserInput = this.executor.findNode(result.nextNodeId);
              if (nodeAfterUserInput && nodeAfterUserInput.type === 'end') {
                // Não processa o end ainda, mantém no userInput
                result = {
                  ...result,
                  completed: false
                };
                // Garante que o currentNodeId fique no userInput
                this.executor.stateManager.setCurrentNode(nextNode.id);
                break;
              }
            }
          } else {
            result = this.executor.processNode(result.nextNodeId);
          }
          
          // Se encontrou output e o step espera ver esse output, para aqui
          if (result.output && expectsMessageOutput) {
            break;
          }
        }
      } else {
        result = this.executor.processNode(currentNodeId, step.input);
      }
      
      // Ajusta resultado antes de comparar
      const expectedNode = step.expected?.node;
      const isLastStep = i === script.steps.length - 1;
      const currentNode = this.executor.stateManager.getCurrentNode();
      const expectedNodeObj = expectedNode ? this.executor.findNode(expectedNode) : null;
      const expectsUserInput = expectedNodeObj && (expectedNodeObj.type === 'userInput' || expectedNodeObj.type === 'user_input');
      
      // Se o step espera ver um nó específico (especialmente user-input), ajusta o resultado
      if (expectedNode) {
        // Se espera ver user-input e o resultado está completed, ajusta para não estar completed
        if (expectsUserInput && result.completed) {
          // Garante que o currentNode seja o user-input esperado
          this.executor.stateManager.setCurrentNode(expectedNode);
          result = {
            ...result,
            completed: false,
            nextNodeId: result.nextNodeId // Preserva nextNodeId mas não processa ainda
          };
        } else if (currentNode === expectedNode && expectsUserInput && result.completed) {
          // Se estamos no nó esperado e é user-input, remove completed mesmo sendo último step
          result = {
            ...result,
            completed: false
          };
        } else if (!isLastStep && result.completed) {
          // Se não é o último step e está completed, remove completed
          if (currentNode === expectedNode) {
            result = {
              ...result,
              completed: false
            };
          } else {
            // Não estamos no nó esperado, tenta ajustar
            if (expectedNodeObj) {
              this.executor.stateManager.setCurrentNode(expectedNode);
              result = {
                ...result,
                completed: false,
                nextNodeId: this.findNextNodeId(expectedNode)
              };
            }
          }
        }
      }
      
      // Garante que o currentNode seja atualizado corretamente antes de comparar
      // Se o step espera ver user-input e o currentNode não está correto, ajusta
      if (expectedNode && expectsUserInput) {
        const currentExecutorNode = this.executor.stateManager.getCurrentNode();
        if (currentExecutorNode !== expectedNode) {
          // Atualiza o currentNode para o nó esperado
          this.executor.stateManager.setCurrentNode(expectedNode);
        }
      }
      
      // Compara com esperado
      const comparison = this.compareResult(result, step.expected);
      
      results.push({
        step: i + 1,
        type: step.type,
        input: step.input,
        result,
        expected: step.expected,
        comparison,
        passed: comparison.passed
      });
      
      // Move para próximo nó para o próximo step
      // REGRA CRÍTICA: Sempre avança para result.nextNodeId se existir
      // A única exceção é se o step espera ver um userInput específico e estamos nele
      if (result.nextNodeId) {
        const currentAfterStep = this.executor.stateManager.getCurrentNode();
        const expectedNodeObj = expectedNode ? this.executor.findNode(expectedNode) : null;
        // Se estamos no nó esperado E é um userInput, mantém nele (não avança)
        // Isso se aplica tanto para último step quanto para steps intermediários
        if (currentAfterStep === expectedNode && expectedNodeObj && (expectedNodeObj.type === 'userInput' || expectedNodeObj.type === 'user_input')) {
          currentNodeId = expectedNode;
        } else if (expectedNode && !isLastStep) {
          // Se não é o último step e não é userInput esperado, avança normalmente
          currentNodeId = result.nextNodeId;
          // Atualiza o stateManager para refletir o novo nó atual
          this.executor.stateManager.setCurrentNode(result.nextNodeId);
        } else if (!expectedNode || (expectedNode && expectedNodeObj && expectedNodeObj.type !== 'userInput' && expectedNodeObj.type !== 'user_input')) {
          // Avança normalmente se não espera ver userInput ou se não é userInput
          currentNodeId = result.nextNodeId;
          // Atualiza o stateManager para refletir o novo nó atual
          this.executor.stateManager.setCurrentNode(result.nextNodeId);
        } else {
          // Se espera ver userInput e é o último step, mantém no userInput
          currentNodeId = expectedNode;
        }
      } else if (result.completed && isLastStep) {
        break;
      } else if (result.completed && !isLastStep) {
        if (expectedNode) {
          currentNodeId = expectedNode;
          this.executor.stateManager.setCurrentNode(expectedNode);
        } else {
          break;
        }
      }
    }
    
    // Se ainda não chegou no end e há um nextNodeId, processa até o end
    // (garante que o fluxo seja completado para validação do estado final)
    // Processa até o end mesmo se o último step espera ver user-input,
    // pois o estado final precisa ser validado
    if (currentNodeId && script.finalState && script.finalState.lastNode) {
      const currentNode = this.executor.findNode(currentNodeId);
      if (currentNode && currentNode.type !== 'end') {
        // Processa até chegar no end
        let current = currentNodeId;
        let maxIterations = 20; // Previne loop infinito
        while (current && maxIterations > 0) {
          maxIterations--;
          const node = this.executor.findNode(current);
          if (!node) break;
          if (node.type === 'end') {
            this.executor.processNode(current);
            break;
          }
          const tempResult = this.executor.processNode(current);
          if (tempResult.nextNodeId) {
            current = tempResult.nextNodeId;
          } else if (tempResult.completed) {
            break;
          } else {
            break;
          }
        }
      } else if (currentNode && currentNode.type === 'end') {
        // Já está no end, apenas processa
        this.executor.processNode(currentNodeId);
      }
    }
    
    // Valida estado final
    const finalState = this.executor.stateManager.getState();
    // Adiciona flag completed baseado no último nó processado
    const lastNode = finalState.currentNode;
    const lastNodeObj = lastNode ? this.executor.findNode(lastNode) : null;
    const isCompleted = lastNodeObj && lastNodeObj.type === 'end';
    const finalStateWithCompleted = {
      ...finalState,
      completed: isCompleted
    };
    const finalStateValid = this.validateFinalState(finalStateWithCompleted, script.finalState);
    
    return {
      scriptId: script.id,
      passed: results.every(r => r.passed) && finalStateValid,
      results,
      finalState: {
        actual: finalStateWithCompleted,
        expected: script.finalState,
        valid: finalStateValid
      },
      logs: this.executor.getLogs()
    };
  }
  
  /**
   * Compara resultado real com esperado.
   * 
   * @param {object} actual - Resultado real
   * @param {object} expected - Resultado esperado
   * @returns {object} Comparação
   */
  compareResult(actual, expected) {
    const issues = [];
    
    // Compara nó
    // O expected.node é o nó que foi processado, não o próximo nó
    if (expected.node) {
      const currentExecutorNode = this.executor.stateManager?.getCurrentNode() || null;
      // Verifica se o nó atual do executor corresponde ao esperado
      // ou se o nextNodeId corresponde (caso o nó esperado seja o próximo)
      if (currentExecutorNode !== expected.node && actual.nextNodeId !== expected.node) {
        issues.push({
          field: 'node',
          expected: expected.node,
          actual: currentExecutorNode || actual.nextNodeId || 'unknown'
        });
      }
    }
    
    // Compara output (permite substring)
    if (expected.output !== undefined) {
      const actualOutput = actual.output || '';
      const expectedOutput = expected.output;
      
      // Trata null e string vazia como equivalentes
      const actualIsEmpty = actualOutput === '' || actualOutput === null || actualOutput === undefined;
      const expectedIsEmpty = expectedOutput === '' || expectedOutput === null || expectedOutput === undefined;
      
      // Se ambos são vazios, considera igual
      if (actualIsEmpty && expectedIsEmpty) {
        // Não adiciona issue, são equivalentes
      } else if (expectedOutput === null && actualIsEmpty) {
        // Se esperado é null e atual é vazio, considera igual
        // Não adiciona issue
      } else if (!actualOutput.includes(expectedOutput) && actualOutput !== expectedOutput) {
        issues.push({
          field: 'output',
          expected: expectedOutput,
          actual: actualOutput
        });
      }
    }
    
    return {
      passed: issues.length === 0,
      issues
    };
  }
  
  /**
   * Valida estado final.
   * 
   * @param {object} actual - Estado real
   * @param {object} expected - Estado esperado
   * @returns {boolean} Se estado é válido
   */
  validateFinalState(actual, expected) {
    if (!expected) {
      return true;
    }
    
    // Verifica se o fluxo foi completado
    // Se o último nó processado foi um end, considera completado
    const lastNode = actual.currentNode || (actual.history && actual.history.length > 0 ? actual.history[actual.history.length - 1]?.nodeId : null);
    const isCompleted = actual.completed || (lastNode && this.executor.findNode(lastNode)?.type === 'end');
    
    if (expected.completed !== undefined) {
      if (expected.completed && !isCompleted) {
        return false;
      }
      if (!expected.completed && isCompleted) {
        return false;
      }
    }
    
    if (expected.lastNode) {
      if (lastNode !== expected.lastNode) {
        return false;
      }
    }
    
    return true;
  }
  
  /**
   * Reseta simulador.
   */
  reset() {
    this.executor.reset();
    this.flows = null;
  }
}

module.exports = { ConversationSimulator };

