export const DEFAULT_API_PORT = '3001';
export const DEFAULT_API_BASE_URL = 'https://www.results.com.br/r-agent2';

export type ApiBaseUrlSource =
  | 'env'
  | 'metro-host'
  | 'android-emulator'
  | 'ios-simulator'
  | 'android-fallback'
  | 'ios-fallback';

export type ApiBaseUrlResolution = {
  baseUrl: string;
  source: ApiBaseUrlSource;
  port: string;
  detectedHost?: string;
};

const API_SOURCE_LABELS: Record<ApiBaseUrlSource, string> = {
  env: 'Configuração manual por variável de ambiente',
  'metro-host': 'Dispositivo físico via IP detectado do Metro',
  'android-emulator': 'Emulador Android (host 10.0.2.2)',
  'ios-simulator': 'Simulador iOS (localhost)',
  'android-fallback': 'Fallback para URL padrão de produção',
  'ios-fallback': 'Fallback para URL padrão de produção',
};

export function getApiSourceLabel(source: ApiBaseUrlSource): string {
  return API_SOURCE_LABELS[source];
}

type ResolveApiBaseUrlArgs = {
  envBaseUrl?: string;
  configBaseUrl?: string;
  envPort?: string;
  platform?: 'ios' | 'android' | string;
  isPhysicalDevice?: boolean;
  packagerHost?: string;
};

function sanitizeBaseUrl(value?: string): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim().replace(/\/$/, '');
  return trimmed.length > 0 ? trimmed : undefined;
}

function sanitizePort(value?: string): string {
  if (typeof value !== 'string') {
    return DEFAULT_API_PORT;
  }
  const trimmed = value.trim();
  return /^\d{2,5}$/.test(trimmed) ? trimmed : DEFAULT_API_PORT;
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function extractHost(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const candidate = trimmed.includes('://') ? trimmed : `http://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    return parsed.hostname || undefined;
  } catch {
    return undefined;
  }
}

function getPackagerHost(): string | undefined {
  let constants: {
    expoConfig?: { hostUri?: string; extra?: { apiBaseUrl?: string } };
    manifest2?: { extra?: { expoClient?: { hostUri?: string } } };
    manifest?: { debuggerHost?: string };
  } = {};

  let sourceCode: { scriptURL?: string } | undefined;
  try {
    constants = require('expo-constants').default ?? {};
  } catch {
    constants = {};
  }

  try {
    sourceCode = require('react-native').NativeModules?.SourceCode as { scriptURL?: string } | undefined;
  } catch {
    sourceCode = undefined;
  }

  const candidates = [
    constants.expoConfig?.hostUri,
    constants.manifest2?.extra?.expoClient?.hostUri,
    constants.manifest?.debuggerHost,
    constants.expoConfig?.extra?.apiBaseUrl,
    sourceCode?.scriptURL,
  ];

  for (const candidate of candidates) {
    const host = extractHost(candidate);
    if (host && !isLoopbackHost(host)) {
      return host;
    }
  }

  return undefined;
}

export function resolveApiBaseUrl(args: ResolveApiBaseUrlArgs = {}): string {
  return resolveApiBaseUrlWithMeta(args).baseUrl;
}

export function resolveApiBaseUrlWithMeta(args: ResolveApiBaseUrlArgs = {}): ApiBaseUrlResolution {
  const envBaseUrl = sanitizeBaseUrl(args.envBaseUrl);
  if (envBaseUrl) {
    return {
      baseUrl: envBaseUrl,
      source: 'env',
      port: sanitizePort(args.envPort),
    };
  }

  const configBaseUrl = sanitizeBaseUrl(args.configBaseUrl);
  if (configBaseUrl) {
    return {
      baseUrl: configBaseUrl,
      source: 'env',
      port: sanitizePort(args.envPort),
    };
  }

  const apiPort = sanitizePort(args.envPort);
  const packagerHost = extractHost(args.packagerHost);
  if (packagerHost && !isLoopbackHost(packagerHost)) {
    return {
      baseUrl: `http://${packagerHost}:${apiPort}`,
      source: 'metro-host',
      port: apiPort,
      detectedHost: packagerHost,
    };
  }

  const platform = args.platform;
  const isPhysicalDevice = args.isPhysicalDevice;

  if (platform === 'android' && isPhysicalDevice === false) {
    return {
      baseUrl: `http://10.0.2.2:${apiPort}`,
      source: 'android-emulator',
      port: apiPort,
    };
  }

  if (platform === 'ios' && isPhysicalDevice === false) {
    return {
      baseUrl: `http://127.0.0.1:${apiPort}`,
      source: 'ios-simulator',
      port: apiPort,
    };
  }

  if (platform === 'android') {
    return {
      baseUrl: DEFAULT_API_BASE_URL,
      source: 'android-fallback',
      port: apiPort,
    };
  }

  return {
    baseUrl: DEFAULT_API_BASE_URL,
    source: 'ios-fallback',
    port: apiPort,
  };
}

function getRuntimeInputs(): Pick<ResolveApiBaseUrlArgs, 'platform' | 'isPhysicalDevice' | 'packagerHost'> {
  let platform: string | undefined;
  let isPhysicalDevice: boolean | undefined;

  try {
    platform = require('react-native').Platform?.OS;
  } catch {
    platform = undefined;
  }

  try {
    isPhysicalDevice = require('expo-device').isDevice;
  } catch {
    isPhysicalDevice = undefined;
  }

  return {
    platform,
    isPhysicalDevice,
    packagerHost: getPackagerHost(),
  };
}

export function getApiBaseUrl(): string {
  return getApiBaseUrlResolution().baseUrl;
}

export function getApiBaseUrlResolution(): ApiBaseUrlResolution {
  const runtime = getRuntimeInputs();
  let configBaseUrl: string | undefined;
  try {
    const constants = require('expo-constants').default as { expoConfig?: { extra?: { apiBaseUrl?: string } } };
    configBaseUrl = constants?.expoConfig?.extra?.apiBaseUrl;
  } catch {
    configBaseUrl = undefined;
  }

  return resolveApiBaseUrlWithMeta({
    envBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL,
    configBaseUrl,
    envPort: process.env.EXPO_PUBLIC_API_PORT,
    platform: runtime.platform,
    isPhysicalDevice: runtime.isPhysicalDevice,
    packagerHost: runtime.packagerHost,
  });
}
