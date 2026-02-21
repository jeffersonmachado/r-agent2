export function isExpoGoRuntime(): boolean {
  try {
    const constantsModule = require('expo-constants') as {
      default?: { appOwnership?: string; executionEnvironment?: string };
    };
    const constants = constantsModule.default || {};
    const ownership = constants.appOwnership;
    const executionEnvironment = constants.executionEnvironment;
    return ownership === 'expo' || executionEnvironment === 'storeClient';
  } catch {
    return false;
  }
}
