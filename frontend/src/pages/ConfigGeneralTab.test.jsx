import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ConfigGeneralTab } from './config/ConfigGeneralTab';

function renderTab(overrides = {}) {
  const props = {
    editedConfig: { nodeEnv: 'test' },
    renderField: () => null,
    updateValue: vi.fn(),
    phoneMaskingEnabled: false,
    loadingPhoneMasking: false,
    savingPhoneMasking: false,
    setPhoneMaskingEnabled: vi.fn(),
    setSavingPhoneMasking: vi.fn(),
    showToast: vi.fn(),
    upsertTenantSetting: vi.fn(),
    capabilities: { inbox: true, caseManagement: true, caseCreationPolicy: 'manual' },
    canManageCapabilities: true,
    savingCapabilities: false,
    onUpdateCapabilities: vi.fn(),
    ...overrides,
  };
  render(<ConfigGeneralTab {...props} />);
  return props;
}

describe('ConfigGeneralTab — capacidades de atendimento', () => {
  it('esconde a seção Atendimento para quem não pode gerenciar capabilities', () => {
    renderTab({ canManageCapabilities: false });

    expect(screen.queryByText('Atendimento com chamados (Case Management)')).toBeNull();
    expect(screen.getByText('Mascaramento de telefone')).toBeTruthy();
  });

  it('toggle chama onUpdateCapabilities com caseManagement invertido', () => {
    const props = renderTab();

    // Seção Atendimento é renderizada antes de Privacidade: primeiro checkbox é o de Case Management
    const toggle = screen.getAllByRole('checkbox')[0];
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    expect(props.onUpdateCapabilities).toHaveBeenCalledWith({ caseManagement: false });
  });

  it('select de política chama onUpdateCapabilities e fica desabilitado com caseManagement off', () => {
    const props = renderTab({ capabilities: { inbox: true, caseManagement: true, caseCreationPolicy: 'manual' } });

    // Dois selects na seção: [0] criação de chamados, [1] autonomia das recomendações
    const select = screen.getAllByRole('combobox')[0];
    expect(select.disabled).toBe(false);
    fireEvent.change(select, { target: { value: 'suggest' } });
    expect(props.onUpdateCapabilities).toHaveBeenCalledWith({ caseCreationPolicy: 'suggest' });
  });

  it('select desabilitado quando Case Management está inativo', () => {
    renderTab({ capabilities: { inbox: true, caseManagement: false, caseCreationPolicy: 'manual' } });

    expect(screen.getAllByRole('combobox')[0].disabled).toBe(true);
  });
});

describe('ConfigGeneralTab — autonomia das recomendações', () => {
  it('renderiza o select de autonomia com o nível atual e as 4 opções', () => {
    renderTab({ capabilities: { inbox: true, caseManagement: true, caseCreationPolicy: 'manual', autonomyLevel: 'approve' } });

    expect(screen.getByText('Autonomia das recomendações')).toBeTruthy();
    const select = screen.getAllByRole('combobox')[1];
    expect(select.value).toBe('approve');
    const values = Array.from(select.options).map((option) => option.value);
    expect(values).toEqual(['suggest', 'approve', 'autonomous', 'exception_only']);
  });

  it('mudança chama onUpdateCapabilities com autonomyLevel', () => {
    const props = renderTab();

    const select = screen.getAllByRole('combobox')[1];
    expect(select.value).toBe('suggest');
    fireEvent.change(select, { target: { value: 'autonomous' } });
    expect(props.onUpdateCapabilities).toHaveBeenCalledWith({ autonomyLevel: 'autonomous' });
  });

  it('sem autonomyLevel persistido cai no default suggest', () => {
    renderTab({ capabilities: { inbox: true, caseManagement: true, caseCreationPolicy: 'manual' } });

    expect(screen.getAllByRole('combobox')[1].value).toBe('suggest');
  });

  it('esconde o select de autonomia para quem não gerencia capabilities', () => {
    renderTab({ canManageCapabilities: false });

    expect(screen.queryByText('Autonomia das recomendações')).toBeNull();
  });
});
