// expo-widgets always adds the push notifications entitlement (for Live Activity updates), even
// when push is disabled. Kanso does not use push, and personal (free) Apple teams cannot sign an
// app that has it, so it is removed again here.
const { withEntitlementsPlist } = require('expo/config-plugins');

module.exports = function withoutPushEntitlement(config) {
  return withEntitlementsPlist(config, (config) => {
    delete config.modResults['aps-environment'];
    return config;
  });
};
