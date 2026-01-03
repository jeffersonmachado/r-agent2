import { fetchJson } from './client';

export async function listTemplates() {
  return fetchJson('/whatsapp/templates');
}

export async function getTemplate(id) {
  return fetchJson(`/whatsapp/templates/${encodeURIComponent(id)}`);
}

export async function createTemplate(template) {
  return fetchJson('/whatsapp/templates', {
    method: 'POST',
    body: JSON.stringify(template),
  });
}

export async function sendTemplateMessage(to, templateName, languageCode = 'pt_BR', parameters = []) {
  return fetchJson('/whatsapp/send-template', {
    method: 'POST',
    body: JSON.stringify({
      to,
      templateName,
      languageCode,
      parameters,
    }),
  });
}

