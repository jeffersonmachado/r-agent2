import * as React from "react";
import { Presets } from "rete-react-plugin";

const { useConnection } = Presets.classic;

const Svg = ({ children, onClick, onPointerDown, ...props }) => (
  <svg
    {...props}
    style={{
      overflow: 'visible !important',
      position: 'absolute',
      pointerEvents: 'none',
      width: '9999px',
      height: '9999px',
      clipPath: 'none',
      clip: 'auto',
      willChange: 'transform',
      isolation: 'isolate',
      ...props.style
    }}
    onPointerDown={onPointerDown}
    onClick={onClick}
  >
    {children}
  </svg>
);

const Path = ({ selected, styles, d, ...props }) => (
  <path
    {...props}
    fill="none"
    strokeWidth={selected ? 10 : 8}
    stroke={selected ? "rgb(255, 217, 44)" : "steelblue"}
    style={{
      pointerEvents: 'auto',
      ...(styles && styles({ selected })),
      ...props.style
    }}
    d={d}
  />
);

// Path invisível maior para facilitar cliques (renderizado primeiro para ficar atrás)
const HoverPath = ({ d, ...props }) => (
  <path
    {...props}
    fill="none"
    strokeWidth={20}
    pointerEvents="auto"
    stroke="transparent"
    d={d}
    style={{ cursor: 'pointer' }}
  />
);

export function SelectableConnection(props) {
  const { path } = useConnection();
  const [isSelectedLocal, setIsSelectedLocal] = React.useState(() => props.data?.selected || false);
  const connectionId = props.data?.id;

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

  if (!path) return null;

  const handleClick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    
    // Atualiza estado local imediatamente para feedback visual
    const newSelected = !isSelectedLocal;
    setIsSelectedLocal(newSelected);
    
    // Chama o handler global se disponível
    if (window.__reteConnectionClickHandler && props.data) {
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

  // Preserva TODAS as props do ReactPlugin (incluindo transform, className, etc.)
  // Apenas sobrescreve onClick e onPointerDown para nossa funcionalidade
  const { onClick: _onClick, onPointerDown: _onPointerDown, style: reactPluginStyle, ...restProps } = props;

  // Extrai transform do style se existir para aplicar no wrapper
  const transform = reactPluginStyle?.transform || '';

  return (
    <div
      style={{
        position: 'absolute',
        overflow: 'visible',
        pointerEvents: 'none',
        width: '100%',
        height: '100%',
        transform: transform,
        ...(reactPluginStyle && { 
          left: reactPluginStyle.left,
          top: reactPluginStyle.top,
        })
      }}
    >
      <Svg
        {...restProps}
        style={{
          overflow: 'visible !important',
          position: 'absolute',
          pointerEvents: 'none',
          width: '9999px',
          height: '9999px',
          clipPath: 'none',
          clip: 'auto',
          willChange: 'transform',
          isolation: 'isolate',
          left: 0,
          top: 0,
        }}
        onPointerDown={handlePointerDown}
        onClick={handleClick}
        data-testid="connection"
      >
        <HoverPath d={path} />
        <Path 
          selected={isSelected} 
          styles={props.styles} 
          d={path} 
        />
      </Svg>
    </div>
  );
}

