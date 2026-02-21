import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getApiBaseUrl } from './src/config';
import { registerNativePush, unregisterNativePush, type RegisteredPush } from './src/push';
import { isExpoGoRuntime } from './src/runtime';

const APP_VERSION = '1.0.0';

export default function App() {
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);
  const [authToken, setAuthToken] = useState('');
  const [status, setStatus] = useState('Aguardando login/token para registrar push');
  const [routePreview, setRoutePreview] = useState<string | null>(null);
  const [registeredPush, setRegisteredPush] = useState<RegisteredPush | null>(null);
  const responseListener = useRef<{ remove: () => void } | null>(null);

  useEffect(() => {
    if (isExpoGoRuntime()) {
      setStatus('Expo Go detectado: push remoto requer development build.');
      return;
    }

    const Notifications = require('expo-notifications') as typeof import('expo-notifications');
    responseListener.current = Notifications.addNotificationResponseReceivedListener((event) => {
      const data = event.notification.request.content.data || {};
      const ticketId = typeof data.ticketId === 'string' ? data.ticketId : null;
      if (ticketId) {
        setRoutePreview(`/support/ticket/${ticketId}`);
      }
    });

    return () => {
      if (responseListener.current) {
        responseListener.current.remove();
      }
    };
  }, []);

  async function onRegister() {
    try {
      if (!authToken.trim()) {
        setStatus('Informe um JWT válido antes de registrar push.');
        return;
      }

      setStatus('Registrando token de push...');
      const reg = await registerNativePush({
        apiBaseUrl,
        authToken: authToken.trim(),
        appVersion: APP_VERSION,
      });
      setRegisteredPush(reg);
      setStatus(`Push registrado com sucesso (${reg.platform}).`);
    } catch (err) {
      setStatus(`Falha ao registrar push: ${(err as Error).message}`);
    }
  }

  async function onUnregister() {
    try {
      if (!authToken.trim() || !registeredPush) {
        setStatus('Nada para remover: registre push primeiro.');
        return;
      }

      setStatus('Removendo token de push...');
      await unregisterNativePush({
        apiBaseUrl,
        authToken: authToken.trim(),
        platform: registeredPush.platform,
        token: registeredPush.token,
      });
      setRegisteredPush(null);
      setStatus('Push removido com sucesso.');
    } catch (err) {
      setStatus(`Falha ao remover push: ${(err as Error).message}`);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>R-Agent2 Mobile (Expo)</Text>
        <Text style={styles.subtitle}>Integração de push nativo FCM/APNs via backend</Text>

        <View style={styles.card}>
          <Text style={styles.label}>API base URL</Text>
          <Text style={styles.value}>{apiBaseUrl}</Text>

          <Text style={styles.label}>JWT (Bearer)</Text>
          <TextInput
            style={styles.input}
            placeholder="Cole o token JWT"
            value={authToken}
            onChangeText={setAuthToken}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <TouchableOpacity style={styles.button} onPress={onRegister}>
            <Text style={styles.buttonText}>Registrar Push</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.button, styles.buttonSecondary]} onPress={onUnregister}>
            <Text style={styles.buttonText}>Remover Push</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Status</Text>
          <Text style={styles.value}>{status}</Text>

          <Text style={styles.label}>Rota ao tocar notificação</Text>
          <Text style={styles.value}>{routePreview || 'Nenhuma notificação clicada ainda'}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0B1320',
  },
  container: {
    padding: 20,
    gap: 16,
  },
  title: {
    color: '#F9FAFB',
    fontSize: 24,
    fontWeight: '700',
  },
  subtitle: {
    color: '#9CA3AF',
    fontSize: 14,
  },
  card: {
    backgroundColor: '#111827',
    borderColor: '#1F2937',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  label: {
    color: '#93C5FD',
    fontSize: 12,
    fontWeight: '700',
  },
  value: {
    color: '#E5E7EB',
    fontSize: 13,
  },
  input: {
    backgroundColor: '#0F172A',
    borderColor: '#374151',
    borderWidth: 1,
    borderRadius: 8,
    color: '#F9FAFB',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  button: {
    backgroundColor: '#0369A1',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonSecondary: {
    backgroundColor: '#374151',
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
});
