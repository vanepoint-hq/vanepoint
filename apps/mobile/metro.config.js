// Metro config: lets the app import the shared TypeScript core from ../../packages/core
// while resolving every dependency from this app's own node_modules.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const coreRoot = path.resolve(projectRoot, '../../packages/core');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [...(config.watchFolders ?? []), coreRoot];
// Prefer this app's node_modules; keep hierarchical lookup for Expo's nested packages.
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  '@vanepoint/core': path.join(coreRoot, 'src'),
};

module.exports = config;
