import {
  PbxExtensionsPage,
  PbxModulePage,
  PbxPage,
  PbxRoutesPage,
  PbxTrunksPage,
} from '../lazyRoutes';
import {
  isPbxExtensionsPath,
  isPbxModulePath,
  isPbxRoutesPath,
  isPbxTrunksPath,
  isRoutePath,
} from './matchers';

export const pbxRoutes = [
  { key: 'pbx-extensions', matches: ({ currentPath }) => isPbxExtensionsPath(currentPath), render: () => <PbxExtensionsPage /> },
  { key: 'pbx-trunks', matches: ({ currentPath }) => isPbxTrunksPath(currentPath), render: () => <PbxTrunksPage /> },
  { key: 'pbx-routes', matches: ({ currentPath }) => isPbxRoutesPath(currentPath), render: () => <PbxRoutesPage /> },
  { key: 'pbx-module', matches: ({ currentPath }) => isPbxModulePath(currentPath), render: () => <PbxModulePage /> },
  { key: 'pbx', matches: ({ currentPath }) => isRoutePath(currentPath, '/pbx'), render: () => <PbxPage /> },
];
