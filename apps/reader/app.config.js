// Release builds take their version from the environment (set by the Android release workflow):
// KANSO_VERSION is the user-facing version, KANSO_VERSION_CODE (Android versionCode, iOS build
// number) must grow with every release so it installs as an update.
module.exports = ({ config }) => ({
  ...config,
  version: process.env.KANSO_VERSION || config.version,
  ios: {
    ...config.ios,
    buildNumber: process.env.KANSO_VERSION_CODE || config.ios?.buildNumber,
  },
  android: {
    ...config.android,
    versionCode: process.env.KANSO_VERSION_CODE ? Number(process.env.KANSO_VERSION_CODE) : config.android?.versionCode,
  },
});
