const baseConfig = require("../electron-builder.json");

const config = {
  ...baseConfig,
  directories: {
    ...baseConfig.directories,
    output: "release-local"
  },
  mac: {
    ...baseConfig.mac,
    identity: "-",
    notarize: false,
    forceCodeSigning: false
  }
};

delete config.afterSign;
// Fork build: no upstream GitHub release feed, so packaged builds never emit
// an app-update.yml pointing at musistudio/claude-code-router.
delete config.publish;

module.exports = config;
