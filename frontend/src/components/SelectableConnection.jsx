import * as React from "react";
import { Presets } from "rete-react-plugin";
import logger from "../utils/logger";

const { useConnection } = Presets.classic;

const Svg = ({ children, onClick, onPointerDown, data, ...props }) => {
  // ✅ Remove 'data' das props antes de passar para o SVG (SVG não aceita atributo 'data')
  // ✅ Seguindo o padrão do exemplo de referência: estilos via CSS, não inline
  // O ReactPlugin gerencia o posicionamento via wrapper/container
  return (
    <svg
      {...props}
      className="rete-connection-svg"
      onPointerDown={onPointerDown}
      onClick={onClick}
    >
      {children}
    </svg>
  );
};

const Path = ({ selected, d, category, visualMode, ...props }) => (
  (() => {
    const classes = [selected ? "rete-connection-path-selected" : "rete-connection-path"];
    if (!selected && visualMode && category) {
      classes.push(`rete-connection-path--${category}`);
    }
    return (
  <path
    {...props}
    fill="none"
    strokeWidth={selected ? 10 : 8}
    stroke={selected ? "rgb(255, 217, 44)" : "steelblue"}
    className={classes.join(' ')}
    d={d}
  />
    );
  })()
);

// Path invisível maior para facilitar cliques (renderizado primeiro para ficar atrás)
const HoverPath = ({ d, ...props }) => (
  <path
    {...props}
    fill="none"
    strokeWidth={20}
    stroke="transparent"
    className="rete-connection-hover-path"
    d={d}
  />
);

export function SelectableConnection(props) {
  const { path } = useConnection();
  const [isSelectedLocal, setIsSelectedLocal] = React.useState(() => props.data?.selected || false);
  const connectionId = props.data?.id;

  React.useEffect(() => {
    logger.debug('SelectableConnection renderizado', {
      hasProps: !!props,
      hasData: !!props.data,
      propsKeys: props ? Object.keys(props) : [],
      connectionId,
      allProps: props,
    });
  }, [props, connectionId]);

  // Atualiza o estado local quando props.data.selected mudar
  React.useEffect(() => {
    setIsSelectedLocal(props.data?.selected || false);
  }, [props.data?.selected]);

  // Escuta eventos de mudança de seleção do editor
  React.useEffect(() => {
    if (!connectionId) return;

    const handleSelectionChange = (event) => {
      const { selectedConnection, allConnections } = event.detail || {};
      if (selectedConnection && selectedConnection.id === connectionId) {
        setIsSelectedLocal(true);
      } else {
        // Verifica se esta conexão está selecionada
        const isThisSelected = allConnections?.some(conn => 
          conn.id === connectionId && conn.selected
        ) || false;
        setIsSelectedLocal(isThisSelected);
      }
    };

    // Escuta evento customizado do editor
    window.addEventListener('connectionselectionchanged', handleSelectionChange);
    
    return () => {
      window.removeEventListener('connectionselectionchanged', handleSelectionChange);
    };
  }, [connectionId]);

  // Log do path para debug do deslocamento (ANTES do return early)
  React.useEffect(() => {
    if (path) {
      // Extrai coordenadas do path para debug
      const pathMatch = path.match(/M\s*([\d.]+)\s*([\d.]+)/);
      logger.debug('SelectableConnection path calculado', {
        connectionId,
        path,
        pathLength: path.length,
        startX: pathMatch ? pathMatch[1] : null,
        startY: pathMatch ? pathMatch[2] : null,
      });
    }
  }, [path, connectionId]);

  if (!path) return null;

  const handleClick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    
    // Atualiza estado local imediatamente para feedback visual
    const newSelected = !isSelectedLocal;
    setIsSelectedLocal(newSelected);
    
    // Chama o handler global se disponível
    if (window.__reteConnectionClickHandler && props.data) {
      logger.debug('SelectableConnection handleClick', {
        dataId: props.data?.id,
        newSelected,
      });
      // Atualiza a propriedade selected no objeto de conexão
      if (props.data) {
        props.data.selected = newSelected;
      }
      window.__reteConnectionClickHandler(props.data);
    }
    
    // Também chama o handler passado via props se existir
    if (props.click) {
      props.click();
    }
  };

  const handlePointerDown = (e) => {
    e.stopPropagation();
    // Não previne default aqui para permitir drag de conexões se necessário
  };

  const isSelected = isSelectedLocal || props.data?.selected || false;
  const bpmnCategory = props.data?.bpmnVisualCategory || null;
  const isBpmnVisualMode = !!props.data?.bpmnVisualMode;

  // ✅ Extrai 'data' das props para não passar para o SVG (SVG não aceita atributo 'data')
  // ✅ Preserva TODAS as outras props do ReactPlugin (incluindo style se existir)
  const { onClick: _onClick, onPointerDown: _onPointerDown, data, ...restProps } = props;

  return (
    <Svg
      {...restProps}
      // ✅ NÃO passa 'data' - apenas passa outras props do ReactPlugin (incluindo style)
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      data-testid="connection"
    >
      <HoverPath d={path} />
      <Path 
        selected={isSelected} 
        d={path} 
        category={bpmnCategory}
        visualMode={isBpmnVisualMode}
      />
    </Svg>
  );
}

