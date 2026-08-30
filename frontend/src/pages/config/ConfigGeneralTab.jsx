import React from 'react';
import { upsertTenantSetting } from '../../api/tenantSettings';

export function ConfigGeneralTab({ editedConfig, renderField, updateValue, phoneMaskingEnabled, loadingPhoneMasking, savingPhoneMasking, setPhoneMaskingEnabled, setSavingPhoneMasking, showToast, upsertTenantSetting, capabilities, canManageCapabilities, savingCapabilities, onUpdateCapabilities }) {
  const caseManagementEnabled = !!(capabilities && capabilities.caseManagement);
  const caseCreationPolicy = (capabilities && capabilities.caseCreationPolicy) || 'manual';
  return (
<div className="space-y-6">
  <div className="bg-bg-secondary rounded-lg p-6 border border-border-default">
    <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
      <span>🌐</span>
      <span>Geral</span>
    </h3>
    {renderField(
      'Ambiente',
      'nodeEnv',
      editedConfig.nodeEnv,
      'text',
      [
        { value: 'production', label: 'Production (Produção)' },
        { value: 'development', label: 'Development (Desenvolvimento)' },
        { value: 'test', label: 'Test (Teste)' }
      ]
    )}
  </div>
  {canManageCapabilities && (
    <div className="bg-bg-secondary rounded-lg p-6 border border-border-default">
      <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
        <span>💬</span>
        <span>Atendimento</span>
      </h3>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-text-primary font-medium">Atendimento com chamados (Case Management)</p>
            <p className="text-text-secondary text-sm">
              Quando ativo, conversas do inbox podem ser vinculadas a chamados com fila, prioridade e SLA.
            </p>
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={caseManagementEnabled}
              onChange={(e) => onUpdateCapabilities({ caseManagement: e.target.checked })}
              disabled={savingCapabilities}
              className="w-4 h-4 rounded border-border-default text-accent-primary focus:ring-2 focus:ring-accent-primary cursor-pointer"
            />
            <span className="text-sm text-text-secondary">
              {savingCapabilities ? 'Salvando...' : (caseManagementEnabled ? 'Ativo' : 'Inativo')}
            </span>
          </label>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-text-primary font-medium">Criação de chamados</p>
            <p className="text-text-secondary text-sm">
              Define como novos chamados são criados a partir das conversas.
            </p>
          </div>
          <select
            value={caseCreationPolicy}
            onChange={(e) => onUpdateCapabilities({ caseCreationPolicy: e.target.value })}
            disabled={savingCapabilities || !caseManagementEnabled}
            className="bg-bg-primary border border-border-default rounded-lg px-3 py-2 text-sm text-text-primary focus:ring-2 focus:ring-accent-primary cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="manual">Manual</option>
            <option value="suggest">Sugerido pela IA</option>
            <option value="automatic">Automático</option>
          </select>
        </div>
      </div>
    </div>
  )}
  <div className="bg-bg-secondary rounded-lg p-6 border border-border-default">
    <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
      <span>🔒</span>
      <span>Privacidade</span>
    </h3>
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-text-primary font-medium">Mascaramento de telefone</p>
        <p className="text-text-secondary text-sm">
          Oculta números de telefone no inbox e tickets para este tenant.
        </p>
      </div>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={phoneMaskingEnabled}
          onChange={async (e) => {
            const next = e.target.checked;
            setPhoneMaskingEnabled(next);
            setSavingPhoneMasking(true);
            try {
              await upsertTenantSetting('phone-masking', { enabled: next });
            } catch {
              setPhoneMaskingEnabled(!next);
            } finally {
              setSavingPhoneMasking(false);
            }
          }}
          disabled={loadingPhoneMasking || savingPhoneMasking}
          className="w-4 h-4 rounded border-border-default text-accent-primary focus:ring-2 focus:ring-accent-primary cursor-pointer"
        />
        <span className="text-sm text-text-secondary">
          {savingPhoneMasking ? 'Salvando...' : (phoneMaskingEnabled ? 'Ativo' : 'Inativo')}
        </span>
      </label>
    </div>
  </div>
</div>
);
}
