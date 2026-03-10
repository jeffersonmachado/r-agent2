export function isRoutePath(currentPath, basePath) {
  return (
    currentPath === basePath ||
    currentPath.startsWith(`${basePath}/`) ||
    currentPath.startsWith(`${basePath}?`)
  );
}

export function isStorefrontOrderPath(currentPath) {
  return currentPath === '/storefront/order' || currentPath.startsWith('/storefront/order?');
}

export function isStorefrontOrderStatusPath(currentPath) {
  return currentPath.startsWith('/storefront/order/');
}

export function isCrmPath(currentPath) {
  return currentPath.startsWith('/crm') || currentPath.startsWith('/r-agent2/crm');
}

export function isPbxExtensionsPath(currentPath) {
  return isRoutePath(currentPath, '/pbx/extensions');
}

export function isPbxTrunksPath(currentPath) {
  return isRoutePath(currentPath, '/pbx/trunks');
}

export function isPbxRoutesPath(currentPath) {
  return isRoutePath(currentPath, '/pbx/routes');
}

export function isPbxBulkProvisioningPath(currentPath) {
  return isRoutePath(currentPath, '/pbx/provisioning-lote');
}

export function isPbxModulePath(currentPath) {
  return (
    currentPath.startsWith('/pbx/') &&
    !isPbxExtensionsPath(currentPath) &&
    !isPbxTrunksPath(currentPath) &&
    !isPbxRoutesPath(currentPath) &&
    !isPbxBulkProvisioningPath(currentPath)
  );
}
