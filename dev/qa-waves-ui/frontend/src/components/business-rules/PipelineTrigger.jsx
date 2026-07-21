import { motion } from 'framer-motion';
import { Loader2, Play } from 'lucide-react';
import { useState } from 'react';

const examplePayload = JSON.stringify({
  sourceLabel: 'MIG24 /dakota11/prg/: 8 entidades, 7 relacoes',
  entities: [
    { name: 'PRODUTO', fields: ['codigo', 'descricao', 'preco_custo'] },
    { name: 'PRECO', fields: ['produto_id', 'valor_venda', 'vigencia'] },
    { name: 'ICMS', fields: ['produto_id', 'aliquota', 'uf'] },
    { name: 'VENDA', fields: ['cliente_id', 'data', 'total'] },
    { name: 'ITEM_VENDA', fields: ['venda_id', 'produto_id', 'quantidade', 'preco'] },
    { name: 'CLIENTE', fields: ['codigo', 'nome', 'cpf'] },
    { name: 'CONVENIO', fields: ['cliente_id', 'plano_id', 'vigencia'] },
    { name: 'GUIA', fields: ['convenio_id', 'procedimento', 'data'] }
  ],
  relationships: [
    { from: 'PRECO', to: 'PRODUTO' },
    { from: 'ICMS', to: 'PRODUTO' },
    { from: 'VENDA', to: 'CLIENTE' },
    { from: 'ITEM_VENDA', to: 'VENDA' },
    { from: 'ITEM_VENDA', to: 'PRODUTO' },
    { from: 'CONVENIO', to: 'CLIENTE' },
    { from: 'GUIA', to: 'CONVENIO' }
  ],
  sourceFiles: {
    PRODUTO: ['prg/produto_cadastro.prg', 'prg/produto_consulta.prg'],
    PRECO: ['prg/preco_atualiza.prg'],
    ICMS: ['prg/icms_calculo.prg'],
    VENDA: ['prg/venda_lancamento.prg', 'prg/venda_consulta.prg'],
    ITEM_VENDA: [],
    CLIENTE: ['prg/cliente_cadastro.prg'],
    CONVENIO: ['prg/convenio_adesao.prg'],
    GUIA: []
  }
}, null, 2);

export default function PipelineTrigger({ onRun, running }) {
  const [jsonInput, setJsonInput] = useState('');
  const [parseError, setParseError] = useState('');

  function handleRun() {
    setParseError('');

    if (!jsonInput.trim()) {
      setParseError('Cole um JSON PipelineInput para executar.');
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonInput);
    } catch (_err) {
      setParseError('JSON invalido. Verifique a sintaxe.');
      return;
    }

    if (!Array.isArray(parsed.entities) || !Array.isArray(parsed.relationships)) {
      setParseError('JSON deve conter "entities" (array) e "relationships" (array).');
      return;
    }

    onRun(parsed);
  }

  function handleUseExample() {
    setJsonInput(examplePayload);
    setParseError('');
  }

  return (
    <motion.div
      className="pipeline-trigger"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="pipeline-header">
        <h3>Executar Pipeline de Inferencia</h3>
        <button className="secondary" onClick={handleUseExample}>
          Exemplo
        </button>
      </div>

      <textarea
        className="pipeline-input"
        rows={10}
        placeholder="Cole o JSON PipelineInput aqui..."
        value={jsonInput}
        onChange={(e) => {
          setJsonInput(e.target.value);
          if (parseError) setParseError('');
        }}
      />

      {parseError && <p className="error-text">{parseError}</p>}

      <button
        className="primary"
        onClick={handleRun}
        disabled={running}
        style={{ marginTop: 8 }}
      >
        {running ? (
          <>
            <Loader2 size={16} className="spin" /> Executando...
          </>
        ) : (
          <>
            <Play size={16} /> Executar Pipeline
          </>
        )}
      </button>
    </motion.div>
  );
}
