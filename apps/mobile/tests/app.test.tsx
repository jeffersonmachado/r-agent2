import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
}));

jest.mock('../src/push', () => ({
  registerNativePush: jest.fn(),
  unregisterNativePush: jest.fn(),
}));

jest.mock('../src/auth', () => ({
  loginWithPassword: jest.fn(),
}));

jest.mock('../src/api', () => ({
  getJson: jest.fn().mockResolvedValue({ tickets: [], messages: [] }),
  postJson: jest.fn().mockResolvedValue({}),
}));

jest.mock('../src/config', () => ({
  getApiBaseUrlResolution: () => ({
    baseUrl: 'http://api.test',
    source: 'env',
    port: '3001',
  }),
  getApiSourceLabel: () => 'Configuração manual por variável de ambiente',
}));

jest.mock('../src/session', () => ({
  loadStoredSession: jest.fn().mockResolvedValue(null),
  saveStoredSession: jest.fn().mockResolvedValue(undefined),
  clearStoredSession: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-notifications', () => ({
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  dismissAllNotificationsAsync: jest.fn().mockResolvedValue(undefined),
  setBadgeCountAsync: jest.fn().mockResolvedValue(undefined),
}));

import App from '../App';
import { loginWithPassword } from '../src/auth';
import { registerNativePush } from '../src/push';

describe('App', () => {
  it('renderiza a tela de login', async () => {
    const screen = render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Login de Agente')).toBeTruthy();
      expect(screen.getByPlaceholderText('Digite seu username')).toBeTruthy();
      expect(screen.getByPlaceholderText('Digite sua senha')).toBeTruthy();
    });
  });

  it('valida campos obrigatórios no login', async () => {
    const screen = render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Entrar')).toBeTruthy();
    });

    fireEvent.changeText(screen.getByPlaceholderText('Digite seu username'), 'admin');
    fireEvent.changeText(screen.getByPlaceholderText('Digite sua senha'), '123456');

    expect(screen.queryByText('Digite username e senha.')).toBeFalsy();
  });

  it('realiza login e registra push com sucesso', async () => {
    (loginWithPassword as jest.Mock).mockResolvedValue({
      token: 'jwt-from-login',
      agent: {
        id: 'agent-1',
        username: 'systemadmin',
        tenantId: 'system',
      },
    });
    (registerNativePush as jest.Mock).mockResolvedValue({
      platform: 'android',
      token: 'push-123',
    });

    const screen = render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Entrar')).toBeTruthy();
    });

    fireEvent.changeText(screen.getByPlaceholderText('Digite seu username'), 'systemadmin');
    fireEvent.changeText(screen.getByPlaceholderText('Digite sua senha'), 'Admin123!');
    fireEvent.changeText(screen.getByPlaceholderText('system'), 'system');
    fireEvent.press(screen.getByText('Entrar'));

    await waitFor(() => {
      expect(loginWithPassword).toHaveBeenCalledWith({
        apiBaseUrl: 'http://api.test',
        username: 'systemadmin',
        password: 'Admin123!',
        tenantId: 'system',
        requestId: expect.any(String),
      });

      expect(registerNativePush).toHaveBeenCalledWith({
        apiBaseUrl: 'http://api.test',
        authToken: 'jwt-from-login',
        tenantId: 'system',
        appVersion: '1.0.0',
        requestId: expect.any(String),
      });

      expect(screen.getByText('App iniciado. Push registrado com sucesso (android).')).toBeTruthy();
    });
  });

  it('atualiza preview de rota quando recebe clique em notificação com ticketId', async () => {
    const screen = render(<App />);
    const callback = (Notifications.addNotificationResponseReceivedListener as jest.Mock).mock.calls[0][0];

    await act(async () => {
      callback({
        notification: {
          request: {
            content: {
              data: { ticketId: 'TICKET-42' },
            },
          },
        },
      });
    });

    expect(screen.getByText('/support/ticket/TICKET-42')).toBeTruthy();
  });
});
