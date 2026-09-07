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

export function ConfigWebhooksTab({ editedConfig, renderField }) {
  return (
    <div className="space-y-6">
      {/* WhatsApp QR Webhook */}
      <div className="bg-bg-secondary rounded-lg p-6 border border-border-default">
        <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
          <span>📱</span>
          <span>WhatsApp QR Webhook</span>
        </h3>
        <HelpToggle title="Onde obter/configurar o Webhook Secret">
          <p>• Este é um segredo <strong>interno</strong> compartilhado entre o bridge WhatsApp-QR e a API RAP</p>
          <p>• Gere um token aleatório de 64 caracteres hex e cole aqui</p>
          <p>• Configure o <strong>mesmo valor</strong> no bridge WhatsApp-QR</p>
          <p>• O bridge envia este valor no header <code>x-whatsapp-qr-secret</code> em cada requisição</p>
        </HelpToggle>
        <div className="grid grid-cols-1 gap-6 mt-4">
          {renderField(
            'Webhook Secret',
            'webhooks.whatsappQrSecret',
            editedConfig.webhooks?.whatsappQrSecret,
            'password'
          )}
        </div>
        <div className="mt-4 p-4 bg-accent-light rounded-lg border border-accent-primary/20">
          <p className="text-sm text-text-secondary">
            🔐 Secret compartilhado entre o bridge WhatsApp-QR e a API.
            O bridge envia este valor no header <code className="text-accent-primary">x-whatsapp-qr-secret</code>.
            Em produção, sem este secret o webhook é rejeitado (fail-closed).
          </p>
        </div>
      </div>

      {/* Meta (Instagram + Messenger) */}
      <div className="bg-bg-secondary rounded-lg p-6 border border-border-default">
        <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
          <span>🏢</span>
          <span>Meta (Facebook)</span>
        </h3>
        <HelpToggle title="Onde obter o App Secret da Meta">
          <p>• Acesse <a href="https://developers.facebook.com/apps/" target="_blank" rel="noopener noreferrer" className="text-accent-primary hover:underline">developers.facebook.com/apps</a></p>
          <p>• Selecione seu App (Instagram e Messenger usam o mesmo App Meta)</p>
          <p>• Vá em <strong>Configurações &gt; Básico</strong></p>
          <p>• Clique em <strong>Mostrar</strong> ao lado de <strong>App Secret</strong></p>
          <p>• O mesmo App Secret vale para <strong>Instagram</strong> e <strong>Messenger</strong></p>
        </HelpToggle>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
          {renderField(
            'Instagram App Secret',
            'instagram.appSecret',
            editedConfig.instagram?.appSecret,
            'password'
          )}
          {renderField(
            'Messenger App Secret',
            'messenger.appSecret',
            editedConfig.messenger?.appSecret,
            'password'
          )}
        </div>
        <div className="mt-6 p-4 bg-accent-light rounded-lg border border-accent-primary/20">
          <p className="text-sm text-text-secondary">
            🔑 Obtenha o App Secret no{' '}
            <a
              href="https://developers.facebook.com/apps/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-primary hover:underline"
            >
              Meta Developer Dashboard
            </a>
            {' >'} App &gt; Configurações &gt; Básico &gt; App Secret.
            Sem estes secrets, webhooks do Instagram e Messenger são rejeitados em produção (fail-closed).
          </p>
        </div>
      </div>

      {/* Resumo */}
      <div className="bg-bg-secondary rounded-lg p-6 border border-border-default">
        <h3 className="text-xl font-semibold text-text-primary mb-4 flex items-center gap-2">
          <span>📋</span>
          <span>Resumo</span>
        </h3>
        <div className="space-y-3 text-sm text-text-secondary">
          <div className="flex items-start gap-3">
            <span className="text-accent-primary font-bold mt-0.5">1.</span>
            <div>
              <p className="font-medium text-text-primary">WhatsApp QR Webhook Secret</p>
              <p>Segredo interno entre bridge e API. Gere um token aleatório e configure no bridge.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-accent-primary font-bold mt-0.5">2.</span>
            <div>
              <p className="font-medium text-text-primary">Instagram &amp; Messenger App Secret</p>
              <p>Obtido no Meta Developer Dashboard. O mesmo segredo serve para ambos os canais.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-accent-primary font-bold mt-0.5">3.</span>
            <div>
              <p className="font-medium text-text-primary">Billing Webhook Secrets</p>
              <p>Configure na aba <strong>Billing</strong>. Use o botão <strong>Validar Credenciais no Provedor</strong> para testar.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
