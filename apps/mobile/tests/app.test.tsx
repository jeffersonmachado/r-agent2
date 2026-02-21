import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';

jest.mock('../src/push', () => ({
  registerNativePush: jest.fn(),
  unregisterNativePush: jest.fn(),
}));

jest.mock('expo-notifications', () => ({
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));

import App from '../App';
import { registerNativePush } from '../src/push';

describe('App', () => {
  it('exibe aviso quando tenta registrar sem JWT', () => {
    const screen = render(<App />);

    fireEvent.press(screen.getByText('Registrar Push'));

    expect(screen.getByText('Informe um JWT válido antes de registrar push.')).toBeTruthy();
  });

  it('registra push com token trimado e mostra sucesso', async () => {
    const previous = process.env.EXPO_PUBLIC_API_BASE_URL;
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://api.test';
    try {
      (registerNativePush as jest.Mock).mockResolvedValue({
        platform: 'android',
        token: 'device-token',
      });

      const screen = render(<App />);

      fireEvent.changeText(screen.getByPlaceholderText('Cole o token JWT'), '  jwt-123  ');
      fireEvent.press(screen.getByText('Registrar Push'));

      await waitFor(() => {
        expect(registerNativePush).toHaveBeenCalledWith({
          apiBaseUrl: 'http://api.test',
          authToken: 'jwt-123',
          appVersion: '1.0.0',
        });
        expect(screen.getByText('Push registrado com sucesso (android).')).toBeTruthy();
      });
    } finally {
      if (typeof previous === 'string') {
        process.env.EXPO_PUBLIC_API_BASE_URL = previous;
      } else {
        delete process.env.EXPO_PUBLIC_API_BASE_URL;
      }
    }
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
