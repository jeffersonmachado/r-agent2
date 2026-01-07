# 🎬 Endpoints `/rpa/record/` - Gravação Manual de Seeds

## Propósito

Os endpoints `/rpa/record/` permitem **gravar seeds RPA manualmente via interface web**, sem precisar usar a linha de comando. Eles foram criados para integrar a funcionalidade de gravação manual na interface `/rpa-seeds`.

## Endpoints Disponíveis

### 1. `POST /rpa/record/start` - Iniciar Gravação Manual

**Propósito**: Inicia uma gravação manual de seed RPA.

**Request Body**:
```json
{
  "seedName": "meu-login",
  "initialUrl": "http://localhost:5173"  // Opcional
}
```

**Response**:
```json
{
  "success": true,
  "recordingId": "meu-login",
  "message": "Gravação \"meu-login\" iniciada. Interaja com o navegador e chame /rpa/record/stop quando terminar."
}
```

**O que acontece**:
1. Abre um navegador automaticamente
2. Navega para a URL inicial (ou padrão)
3. Inicia gravação de todas as ações do usuário
4. Armazena o recorder em memória (`activeRecordings`)

**Uso na Interface**:
- Botão "🎬 Novo Seed" na página `/rpa-seeds`
- Dialog para inserir nome do seed e URL inicial
- Ao clicar "Iniciar Gravação", chama este endpoint

### 2. `POST /rpa/record/stop/:recordingId` - Parar Gravação

**Propósito**: Para a gravação manual e salva o seed.

**URL**: `/rpa/record/stop/meu-login`

**Response**:
```json
{
  "success": true,
  "seedPath": "/opt/results/ria/r-agent2/tests/rpa/seeds/meu-login.json",
  "replayPath": "/opt/results/ria/r-agent2/tests/rpa/replay/replay-record-meu-login-1234567890.json",
  "seedId": "meu-login",
  "message": "Gravação \"meu-login\" salva com sucesso"
}
```

**O que acontece**:
1. Para a gravação
2. Fecha o navegador
3. Salva o seed em `/tests/rpa/seeds/` com flag `source: "manual"`
4. Gera replay automaticamente em `/tests/rpa/replay/`
5. Remove da lista de gravações ativas

**Uso na Interface**:
- Botão "⏹️ Parar" no indicador flutuante durante gravação
- Chama este endpoint quando o usuário termina de interagir

### 3. `GET /rpa/record/status/:recordingId` - Status da Gravação

**Propósito**: Obtém o status de uma gravação manual em andamento.

**URL**: `/rpa/record/status/meu-login`

**Response**:
```json
{
  "success": true,
  "status": "recording",
  "seedName": "meu-login",
  "startTime": "2026-01-05T12:00:00.000Z"
}
```

**O que acontece**:
- Verifica se a gravação ainda está ativa
- Retorna informações sobre a gravação

**Uso na Interface**:
- Polling automático a cada 2 segundos durante gravação
- Atualiza o indicador flutuante com status

## Fluxo Completo

### Via Interface Web (`/rpa-seeds`)

1. **Usuário clica em "🎬 Novo Seed"**
   - Abre dialog
   - Insere nome do seed (ex: `meu-login`)
   - (Opcional) Insere URL inicial

2. **Usuário clica em "Iniciar Gravação"**
   - Frontend chama `POST /rpa/record/start`
   - Backend abre navegador automaticamente
   - Gravação inicia

3. **Usuário interage com o navegador**
   - Clica, digita, navega normalmente
   - Sistema grava todas as ações automaticamente

4. **Usuário clica em "⏹️ Parar"**
   - Frontend chama `POST /rpa/record/stop/meu-login`
   - Backend salva seed em `/tests/rpa/seeds/meu-login.json`
   - Backend gera replay em `/tests/rpa/replay/`
   - Interface atualiza lista de seeds

### Via API Direta

```bash
# 1. Iniciar gravação
curl -X POST http://localhost:3000/rpa/record/start \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "seedName": "meu-login",
    "initialUrl": "http://localhost:5173"
  }'

# 2. Verificar status (opcional)
curl http://localhost:3000/rpa/record/status/meu-login \
  -H "Authorization: Bearer <token>"

# 3. Parar gravação
curl -X POST http://localhost:3000/rpa/record/stop/meu-login \
  -H "Authorization: Bearer <token>"
```

## Armazenamento em Memória

As gravações ativas são armazenadas em `activeRecordings` (Map):

```javascript
activeRecordings.set(seedName, {
  recorder,        // Instância do RpaRecorder
  seedName,        // Nome do seed
  startTime,       // Timestamp de início
  status: 'recording'
});
```

**Importante**:
- Gravações são armazenadas apenas em memória
- Se o servidor reiniciar, gravações ativas serão perdidas
- Recomenda-se parar gravações antes de reiniciar

## Diferença entre `/rpa/record/` e `/rpa/recordings/`

| Endpoint | Propósito | Uso |
|----------|-----------|-----|
| **`/rpa/record/start`** | Iniciar gravação manual | Criar novo seed via interface |
| **`/rpa/record/stop/:id`** | Parar gravação manual | Finalizar seed via interface |
| **`/rpa/record/status/:id`** | Status da gravação | Monitorar gravação em andamento |
| **`/rpa/recordings`** | Listar seeds existentes | Ver todos os seeds disponíveis |
| **`/rpa/execute/:id`** | Executar seed | Reproduzir seed existente |

## Exemplo de Uso Completo

### 1. Iniciar Gravação

```javascript
// Frontend
const result = await startManualRecording('meu-login', 'http://localhost:5173');
// Navegador abre automaticamente
// Usuário interage normalmente
```

### 2. Durante Gravação

```javascript
// Frontend faz polling
const status = await getRecordingStatus('meu-login');
// { status: 'recording', seedName: 'meu-login', startTime: '...' }
```

### 3. Parar Gravação

```javascript
// Frontend
const result = await stopManualRecording('meu-login');
// {
//   success: true,
//   seedPath: '/tests/rpa/seeds/meu-login.json',
//   replayPath: '/tests/rpa/replay/replay-record-meu-login-1234567890.json',
//   seedId: 'meu-login'
// }
```

## Seed Gerado

O seed salvo terá:

```json
{
  "id": "meu-login",
  "name": "meu-login",
  "version": "1.0.0",
  "source": "manual",  // ✅ Flag identificando origem manual
  "createdAt": "2026-01-05T12:00:00.000Z",
  "steps": [
    {
      "type": "navigate",
      "url": "http://localhost:5173"
    },
    {
      "type": "fill",
      "selector": "input[name='email']",
      "value": "admin@example.com"
    },
    // ... mais ações
  ]
}
```

## Vantagens

1. **Interface Visual**: Não precisa usar linha de comando
2. **Integração**: Funciona diretamente na interface `/rpa-seeds`
3. **Feedback em Tempo Real**: Status atualizado automaticamente
4. **Fácil de Usar**: Apenas clicar botões na interface

## Limitações

1. **Memória**: Gravações ativas apenas em memória
2. **Servidor**: Se servidor reiniciar, gravações ativas são perdidas
3. **Navegador**: Abre navegador no servidor (não no cliente)

## Resumo

Os endpoints `/rpa/record/` são usados para:
- ✅ **Criar seeds manualmente via interface web**
- ✅ **Gravar interações do usuário em tempo real**
- ✅ **Salvar seeds automaticamente em `/tests/rpa/seeds/`**
- ✅ **Gerar replays automaticamente**

**Não é um diretório**, são **endpoints da API** para gravação manual de seeds via interface.

