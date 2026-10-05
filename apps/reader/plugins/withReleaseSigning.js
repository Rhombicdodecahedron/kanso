// Signs Android release builds with the upload key given in the environment, so every release
// is signed by the same key and installs as an update over the previous one. Without the
// variables (local builds), release builds keep Expo's default debug signing.
//
//   KANSO_KEYSTORE_FILE      absolute path to the .jks keystore
//   KANSO_KEYSTORE_PASSWORD  keystore password
//   KANSO_KEY_ALIAS          key alias
//   KANSO_KEY_PASSWORD       key password
const { withAppBuildGradle } = require('expo/config-plugins');

const MARK = '// kanso: release signing';

const SIGNING_CONFIG = `
        release {
            ${MARK}
            if (System.getenv('KANSO_KEYSTORE_FILE')) {
                storeFile file(System.getenv('KANSO_KEYSTORE_FILE'))
                storePassword System.getenv('KANSO_KEYSTORE_PASSWORD')
                keyAlias System.getenv('KANSO_KEY_ALIAS')
                keyPassword System.getenv('KANSO_KEY_PASSWORD')
            }
        }`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (config) => {
    let gradle = config.modResults.contents;
    if (gradle.includes(MARK)) return config;

    // add the release signing config next to the debug one
    gradle = gradle.replace(/signingConfigs\s*\{/, (m) => `${m}${SIGNING_CONFIG}`);

    // use it in the release build type when the key is provided
    gradle = gradle.replace(/(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/, (_m, head) => `${head}signingConfig System.getenv('KANSO_KEYSTORE_FILE') ? signingConfigs.release : signingConfigs.debug`);

    if (!gradle.includes("signingConfigs.release : signingConfigs.debug")) throw new Error('withReleaseSigning: could not find the release build type in app/build.gradle');
    config.modResults.contents = gradle;
    return config;
  });
};
