
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The backend lives in this folder but is a separate Node project.
// Keep Metro from crawling or bundling it. The pattern accepts both
// Windows (\) and Unix (/) path separators.
config.resolver.blockList = [].concat(
  config.resolver.blockList ?? [],
  /[\\/]fixit-backend[\\/].*/
);

module.exports = config;
