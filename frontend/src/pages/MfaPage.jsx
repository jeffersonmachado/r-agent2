import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { Button } from '../styles/Button';
import { mfaSetup, mfaVerify, mfaDisable, mfaRecovery } from '../api/mfa';

export function MfaPage() {
  const { isAuthenticated, loading: authLoading, agent } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();

  const [setupData, setSetupData] = useState(null);
  const [showQrImage, setShowQrImage] = useState(false);
  const [qrImageError, setQrImageError] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [disableToken, setDisableToken] = useState('');
  const [disableRecovery, setDisableRecovery] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [authLoading, isAuthenticated, navigate]);

  const handleSetup = async () => {
    setLoading(true);
    try {
      const result = await mfaSetup({
        issuer: 'ChatPro',
        label: agent?.email || agent?.username || 'Conta',
      });
      setSetupData(result);
      setShowQrImage(false);
      setQrImageError(false);
      showToast('Setup MFA iniciado. Guarde os recovery codes.', 'success');
    } catch (err) {
      const message = err?.response?.data?.error || err?.message || 'Erro ao iniciar MFA';
      showToast(message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (!tokenInput.trim()) {
      showToast('Informe o token do app autenticador', 'warning');
      return;
    }
    setLoading(true);
    try {
      await mfaVerify(tokenInput.trim());
      showToast('MFA habilitado com sucesso', 'success');
      setTokenInput('');
    } catch (err) {
      const message = err?.response?.data?.error || err?.message || 'Erro ao verificar MFA';
      showToast(message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDisable = async () => {
    if (!disableToken.trim() && !disableRecovery.trim()) {
      showToast('Informe token ou recovery code', 'warning');
      return;
    }
    setLoading(true);
    try {
      await mfaDisable({ token: disableToken.trim() || undefined, recoveryCode: disableRecovery.trim() || undefined });
      showToast('MFA desativado', 'success');
      setDisableToken('');
      setDisableRecovery('');
    } catch (err) {
      const message = err?.response?.data?.error || err?.message || 'Erro ao desativar MFA';
      showToast(message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleRecovery = async () => {
    if (!recoveryCode.trim()) {
      showToast('Informe o recovery code', 'warning');
      return;
    }
    setLoading(true);
    try {
      const result = await mfaRecovery(recoveryCode.trim());
      showToast(`Recovery code aceito. Restantes: ${result?.remaining ?? '-'}`, 'success');
      setRecoveryCode('');
    } catch (err) {
      const message = err?.response?.data?.error || err?.message || 'Erro ao validar recovery code';
      showToast(message, 'error');
    } finally {
      setLoading(false);
    }
  };

  if (authLoading) {
    return (
      <div className="support-page">
        <div style={{ padding: '40px', textAlign: 'center' }}>
          <p>Carregando...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) return null;

  const mfaQrImageUrl = setupData?.otpauthUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(setupData.otpauthUrl)}`
    : null;

  return (
    <div className="support-page">
      <div className="support-header">
        <h1>🔐 MFA</h1>
      
        <div className="support-controls">
          <button
            type="button"
            className="btn-default px-4 py-2 text-sm"
            onClick={() => window.location.reload()}
          >
            🔄 Atualizar
          </button>
        </div>
      </div>

      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
          <span>🔍</span>
          <span>Filtros</span>
        </h3>
        <p className="text-sm text-text-secondary">Sem filtros específicos para esta tela.</p>
      </div>

      <div className="support-grid" style={{ gridTemplateColumns: '1fr', gap: '16px' }}>
        <div className="support-details-panel">
          <div className="support-details-title">Setup</div>
          <Button onClick={handleSetup} disabled={loading} className="support-button">Gerar segredo</Button>
          {setupData && (
            <div style={{ marginTop: '12px' }}>
              <div
                style={{
                  marginBottom: '10px',
                  padding: '10px',
                  borderRadius: '8px',
                  background: '#fff7ed',
                  border: '1px solid #fed7aa',
                  color: '#9a3412',
                  fontSize: '12px',
                }}
              >
                O QR visual usa serviço externo de imagem. Se preferir não expor o segredo, use o campo "Secret" manualmente no app autenticador.
              </div>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                {!showQrImage ? (
                  <Button
                    onClick={() => {
                      setShowQrImage(true);
                      setQrImageError(false);
                    }}
                    className="support-button"
                  >
                    Mostrar QR visual
                  </Button>
                ) : (
                  <Button
                    onClick={() => setShowQrImage(false)}
                    className="support-button"
                  >
                    Ocultar QR visual
                  </Button>
                )}
              </div>
              {showQrImage && mfaQrImageUrl && !qrImageError && (
                <div style={{ marginBottom: '10px' }}>
                  <img
                    src={mfaQrImageUrl}
                    alt="QR code MFA"
                    width={220}
                    height={220}
                    onError={() => setQrImageError(true)}
                    style={{ border: '1px solid #e5e7eb', borderRadius: '8px', background: '#fff' }}
                  />
                </div>
              )}
              {showQrImage && qrImageError && (
                <div className="support-details-info" style={{ marginBottom: '10px' }}>
                  Não foi possível carregar o QR visual. Use o secret/manual.
                </div>
              )}
              <div className="support-details-info">
                Secret: <strong>{setupData.secret}</strong>
              </div>
              <div className="support-details-info">
                URL (otpauth): <strong>{setupData.otpauthUrl}</strong>
              </div>
              <div className="support-details-info">Recovery codes:</div>
              <ul style={{ margin: 0, paddingLeft: '18px' }}>
                {Array.isArray(setupData.recoveryCodes) && setupData.recoveryCodes.map((code) => (
                  <li key={code}>{code}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="support-form-group" style={{ marginTop: '12px' }}>
            <label className="support-form-label">Token do app autenticador</label>
            <input
              className="support-form-input"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="123456"
            />
            <Button onClick={handleVerify} className="support-button-full">Confirmar MFA</Button>
          </div>
        </div>

        <div className="support-details-panel">
          <div className="support-details-title">Desativar MFA</div>
          <div className="support-form-group">
            <label className="support-form-label">Token</label>
            <input
              className="support-form-input"
              value={disableToken}
              onChange={(e) => setDisableToken(e.target.value)}
              placeholder="123456"
            />
          </div>
          <div className="support-form-group">
            <label className="support-form-label">Recovery code</label>
            <input
              className="support-form-input"
              value={disableRecovery}
              onChange={(e) => setDisableRecovery(e.target.value)}
              placeholder="ABCDE-12345"
            />
          </div>
          <Button onClick={handleDisable} className="support-button-full">Desativar</Button>
        </div>

        <div className="support-details-panel">
          <div className="support-details-title">Validar recovery code</div>
          <div className="support-form-group">
            <label className="support-form-label">Recovery code</label>
            <input
              className="support-form-input"
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value)}
              placeholder="ABCDE-12345"
            />
          </div>
          <Button onClick={handleRecovery} className="support-button-full">Validar</Button>
        </div>
      </div>
      <ToastContainer />
    </div>
  );
}
