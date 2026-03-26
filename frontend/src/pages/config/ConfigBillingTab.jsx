import React from 'react';

export function ConfigBillingTab({ editedConfig, renderField }) {
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

    <div className="mt-6 pt-6 border-t border-border-default">
      <h4 className="text-lg font-medium text-text-primary mb-4">Asaas</h4>
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