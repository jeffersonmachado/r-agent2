import React from 'react';

export function ConfigEmailTab({ editedConfig, renderField, updateValue }) {
  const enabled = editedConfig?.notifications?.email?.enabled === true;

  return (
    <div className="bg-bg-secondary rounded-lg p-6 border border-border-default">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <h3 className="text-xl font-semibold text-text-primary flex items-center gap-2">
            <span>📧</span>
            <span>Email SMTP</span>
          </h3>
          <p className="text-sm text-text-secondary mt-2 max-w-3xl">
            Configure aqui o provider SMTP usado pelo canal de Email operacional. Esta mesma configuração também aparece no onboarding obrigatório de integrações.
          </p>
        </div>
      </div>

      <div className="mb-6 p-4 bg-bg-tertiary rounded-lg border border-border-default">
        <label className="inline-flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => updateValue('notifications.email.enabled', event.target.checked ? 'true' : 'false')}
          />
          <span className="text-sm font-medium text-text-primary">Habilitar Email transacional</span>
        </label>
        <p className="text-xs text-text-secondary mt-2">
          Quando habilitado, host SMTP, porta e email remetente passam a ser obrigatórios para o readiness de integrações.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {renderField('Host SMTP', 'notifications.email.smtp.host', editedConfig?.notifications?.email?.smtp?.host)}
        {renderField('Porta SMTP', 'notifications.email.smtp.port', editedConfig?.notifications?.email?.smtp?.port, 'number')}
        {renderField('Usuário SMTP', 'notifications.email.smtp.username', editedConfig?.notifications?.email?.smtp?.username)}
        {renderField('Senha SMTP', 'notifications.email.smtp.password', editedConfig?.notifications?.email?.smtp?.password, 'password')}
        {renderField('Email remetente', 'notifications.email.fromAddress', editedConfig?.notifications?.email?.fromAddress, 'email')}
        {renderField('Nome do remetente', 'notifications.email.fromName', editedConfig?.notifications?.email?.fromName)}
      </div>

      <div className="mt-6 p-4 bg-accent-light rounded-lg border border-accent-primary/20 space-y-3">
        <label className="inline-flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={editedConfig?.notifications?.email?.smtp?.secure === true}
            onChange={(event) => updateValue('notifications.email.smtp.secure', event.target.checked ? 'true' : 'false')}
          />
          <span className="text-sm font-medium text-text-primary">Usar conexão segura (SMTPS/TLS)</span>
        </label>
        <p className="text-sm text-text-secondary">
          Use porta 465 quando o provider exigir SMTPS direto. Para STARTTLS, normalmente use porta 587 com esta opção desligada.
        </p>
      </div>
    </div>
  );
}
