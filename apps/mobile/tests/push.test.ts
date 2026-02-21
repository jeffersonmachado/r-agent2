const setupPushModule = async (args?: {
  os?: 'android' | 'ios';
  isDevice?: boolean;
  permissionStatus?: 'granted' | 'denied';
  isExpoGo?: boolean;
}) => {
  const os = args?.os ?? 'android';
  const isDevice = args?.isDevice ?? true;
  const permissionStatus = args?.permissionStatus ?? 'granted';
  const isExpoGo = args?.isExpoGo ?? false;

  const postJson = jest.fn().mockResolvedValue({});
  const requestPermissionsAsync = jest.fn().mockResolvedValue({ status: permissionStatus });
  const setNotificationChannelAsync = jest.fn().mockResolvedValue(undefined);
  const getDevicePushTokenAsync = jest.fn().mockResolvedValue({ data: 'push-token-abc' });
  const setNotificationHandler = jest.fn();

  jest.resetModules();

  jest.doMock('react-native', () => ({
    Platform: { OS: os },
  }));

  jest.doMock('expo-device', () => ({
    isDevice,
    deviceName: 'Pixel Test',
    osBuildId: 'build-123',
  }));

  jest.doMock('expo-constants', () => ({
    __esModule: true,
    default: {
      appOwnership: isExpoGo ? 'expo' : 'standalone',
      executionEnvironment: isExpoGo ? 'storeClient' : 'standalone',
    },
  }));

  jest.doMock('expo-notifications', () => ({
    AndroidImportance: { MAX: 5 },
    requestPermissionsAsync,
    setNotificationChannelAsync,
    getDevicePushTokenAsync,
    setNotificationHandler,
  }));

  jest.doMock('../src/api', () => ({
    postJson,
  }));

  const pushModule = jest.requireActual('../src/push') as typeof import('../src/push');

  return {
    pushModule,
    mocks: {
      postJson,
      requestPermissionsAsync,
      setNotificationChannelAsync,
      getDevicePushTokenAsync,
      setNotificationHandler,
    },
  };
};

describe('push', () => {
  it('falha quando executa em Expo Go', async () => {
    const { pushModule } = await setupPushModule({ isExpoGo: true });

    await expect(
      pushModule.registerNativePush({
        apiBaseUrl: 'http://api.test',
        authToken: 'jwt',
        appVersion: '1.0.0',
      }),
    ).rejects.toThrow('Push remoto não é suportado no Expo Go. Use um development build.');
  });

  it('falha quando executa fora de dispositivo físico', async () => {
    const { pushModule } = await setupPushModule({ isDevice: false });

    await expect(
      pushModule.registerNativePush({
        apiBaseUrl: 'http://api.test',
        authToken: 'jwt',
        appVersion: '1.0.0',
      }),
    ).rejects.toThrow('Push requer dispositivo físico para teste real');
  });

  it('falha quando permissão de notificação é negada', async () => {
    const { pushModule } = await setupPushModule({ permissionStatus: 'denied' });

    await expect(
      pushModule.registerNativePush({
        apiBaseUrl: 'http://api.test',
        authToken: 'jwt',
        appVersion: '1.0.0',
      }),
    ).rejects.toThrow('Permissão de notificação negada');
  });

  it('registra push no backend com payload esperado no Android', async () => {
    const { pushModule, mocks } = await setupPushModule({ os: 'android' });

    const result = await pushModule.registerNativePush({
      apiBaseUrl: 'http://api.test',
      authToken: 'jwt',
      appVersion: '1.0.0',
    });

    expect(result).toEqual({ platform: 'android', token: 'push-token-abc' });
    expect(mocks.setNotificationHandler).toHaveBeenCalledTimes(1);
    expect(mocks.setNotificationChannelAsync).toHaveBeenCalledWith(
      'default',
      expect.objectContaining({ name: 'default' }),
    );
    expect(mocks.postJson).toHaveBeenCalledWith({
      baseUrl: 'http://api.test',
      path: '/push/register',
      token: 'jwt',
      body: {
        platform: 'android',
        token: 'push-token-abc',
        device_name: 'Pixel Test',
        device_id: 'build-123',
        app_version: '1.0.0',
      },
    });
  });

  it('desregistra push chamando endpoint correto', async () => {
    const { pushModule, mocks } = await setupPushModule({ os: 'ios' });

    await pushModule.unregisterNativePush({
      apiBaseUrl: 'http://api.test',
      authToken: 'jwt',
      platform: 'ios',
      token: 'abc',
    });

    expect(mocks.postJson).toHaveBeenCalledWith({
      baseUrl: 'http://api.test',
      path: '/push/unregister',
      token: 'jwt',
      body: {
        platform: 'ios',
        token: 'abc',
      },
    });
  });
});
