import React, { useState } from 'react';

function HelpToggle({ title, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="text-xs text-accent-primary hover:underline flex items-center gap-1"
      >
        <span>{open ? '🔽' : 'ℹ️'}</span>
        <span>{title}</span>
      </button>
      {open && (
        <div className="mt-2 p-3 bg-accent-light/50 rounded-lg border border-accent-primary/20 text-xs text-text-secondary space-y-1">
          {children}
        </div>
      )}
    </div>
  );
}

export function ConfigBillingTab({ editedConfig, renderField, billingValidation, validatingBilling, onValidateBilling }) {
  const provider = editedConfig?.billing?.provider || 'asaas';
  const validation = billingValidation[provider] || {};
  const apiKeyOk = validation.apiKey?.valid;
  const apiKeyErr = validation.apiKey?.error;
  const webhookOk = validation.webhookSecret?.valid;
  const webhookErr = validation.webhookSecret?.error;

  return (
<div className="space-y-6">
  <div className="bg-bg-secondary rounded-lg p-6 border border-border-default">
    <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
      <span>💳</span>
      <span>Billing</span>
    </h3>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {renderField('Provider', 'billing.provider', editedConfig.billing?.provider, 'text', [
        { value: 'asaas', label: 'Asaas' },
        { value: 'mercado_pago', label: 'Mercado Pago' },
      ])}
    </div>

    {/* Botão Validar Credenciais */}
    <div className="mt-4 mb-6">
      <button
        type="button"
        onClick={onValidateBilling}
        disabled={validatingBilling}
        className="px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 font-medium"
      >
        {validatingBilling ? (
          <>
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
            <span>Validando...</span>
          </>
        ) : (
          <>
            <span>🔍</span>
            <span>Validar Credenciais no Provedor</span>
          </>
        )}
      </button>
      {(apiKeyOk !== undefined || webhookOk !== undefined) && (
        <div className="mt-3 space-y-1">
          {apiKeyOk === true && (
            <p className="text-xs text-status-success flex items-center gap-1">
              <span>✅</span>
              <span>API Key válida no provedor {provider === 'asaas' ? 'Asaas' : 'MercadoPago'}</span>
            </p>
          )}
          {apiKeyOk === false && (
            <p className="text-xs text-status-error flex items-center gap-1">
              <span>❌</span>
              <span>API Key: {apiKeyErr || 'inválida'}</span>
            </p>
          )}
          {webhookOk === true && (
            <p className="text-xs text-status-success flex items-center gap-1">
              <span>✅</span>
              <span>Webhook Secret: formato válido</span>
            </p>
          )}
          {webhookOk === false && (
            <p className="text-xs text-status-error flex items-center gap-1">
              <span>❌</span>
              <span>Webhook Secret: {webhookErr || 'inválido'}</span>
            </p>
          )}
        </div>
      )}
    </div>

    <div className="mt-6 pt-6 border-t border-border-default">
      <h4 className="text-lg font-medium text-text-primary mb-4">Asaas</h4>
      <HelpToggle title="Onde obter as credenciais do Asaas">
        <p>• Acesse <a href="https://www.asaas.com/" target="_blank" rel="noopener noreferrer" className="text-accent-primary hover:underline">asaas.com</a> e faça login</p>
        <p>• Vá em <strong>Configurações &gt; Integrações &gt; API</strong></p>
        <p>• Copie o <strong>Token de Acesso</strong> (API Key)</p>
        <p>• Em <strong>Webhooks</strong>, gere um token aleatório e cole aqui como Webhook Secret</p>
        <p>• No painel Asaas, configure a URL do webhook: <code>https://seu-dominio.com/webhooks/asaas</code></p>
      </HelpToggle>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {renderField('Base URL', 'billing.providers.asaas.baseUrl', editedConfig.billing?.providers?.asaas?.baseUrl)}
        {renderField('Billing Type', 'billing.providers.asaas.billingType', editedConfig.billing?.providers?.asaas?.billingType, 'text', [
          { value: 'PIX', label: 'PIX' },
          { value: 'BOLETO', label: 'Boleto' },
          { value: 'CREDIT_CARD', label: 'Cartão de Crédito' },
        ])}
        {renderField('API Key', 'billing.providers.asaas.apiKey', editedConfig.billing?.providers?.asaas?.apiKey, 'password')}
        {renderField('Webhook Secret', 'billing.providers.asaas.webhookSecret', editedConfig.billing?.providers?.asaas?.webhookSecret, 'password')}
      </div>
    </div>

    <div className="mt-6 pt-6 border-t border-border-default">
      <h4 className="text-lg font-medium text-text-primary mb-4">Mercado Pago</h4>
      <HelpToggle title="Onde obter as credenciais do Mercado Pago">
        <p>• Acesse <a href="https://www.mercadopago.com.br/developers" target="_blank" rel="noopener noreferrer" className="text-accent-primary hover:underline">mercadopago.com.br/developers</a></p>
        <p>• Vá em <strong>Suas integrações &gt; Detalhes &gt; Credenciais</strong></p>
        <p>• Copie o <strong>Access Token</strong> (produção)</p>
        <p>• Em <strong>Webhooks</strong>, gere um token e cole aqui como Webhook Secret</p>
        <p>• Configure a URL no Mercado Pago: <code>https://seu-dominio.com/webhooks/mercadopago</code></p>
      </HelpToggle>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {renderField('Base URL', 'billing.providers.mercadoPago.baseUrl', editedConfig.billing?.providers?.mercadoPago?.baseUrl)}
        {renderField('Access Token', 'billing.providers.mercadoPago.accessToken', editedConfig.billing?.providers?.mercadoPago?.accessToken, 'password')}
        {renderField('Webhook Secret', 'billing.providers.mercadoPago.webhookSecret', editedConfig.billing?.providers?.mercadoPago?.webhookSecret, 'password')}
      </div>
    </div>
  </div>
</div>
);
}