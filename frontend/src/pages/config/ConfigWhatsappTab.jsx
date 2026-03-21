import React from 'react';

export function ConfigWhatsappTab({ editedConfig, renderField }) {
  return (
<div className="bg-bg-secondary rounded-lg p-6 border border-border-default">
  <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
    <span>💬</span>
    <span>WhatsApp</span>
  </h3>
  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
    {renderField('URL da API', 'whatsapp.apiUrl', editedConfig.whatsapp?.apiUrl)}
    {renderField('Phone Number ID', 'whatsapp.phoneNumberId', editedConfig.whatsapp?.phoneNumberId)}
    {renderField('Access Token', 'whatsapp.accessToken', editedConfig.whatsapp?.accessToken, 'password')}
    {renderField('Verify Token', 'whatsapp.verifyToken', editedConfig.whatsapp?.verifyToken)}
  </div>
  <div className="mt-6 p-4 bg-accent-light rounded-lg border border-accent-primary/20">
    <p className="text-sm text-text-secondary">
      💡 Configure seu WhatsApp Business no painel da Meta:{' '}
      <a 
        href="https://business.facebook.com/" 
        target="_blank" 
        rel="noopener noreferrer"
        className="text-accent-primary hover:underline"
      >
        business.facebook.com
      </a>
      {' '}ou acesse o{' '}
      <a 
        href="https://developers.facebook.com/apps/" 
        target="_blank" 
        rel="noopener noreferrer"
        className="text-accent-primary hover:underline"
      >
        painel de desenvolvedores
      </a>
    </p>
  </div>
</div>
);
}
