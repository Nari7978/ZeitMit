// ZeitMit's video dates on Android (modules/zeitmit-calls): the call's floating window (picture-in-picture) needs the
// main activity to allow it. Its configChanges already keep the activity (and the call) through the resize.
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withZeitmitCalls(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    const main = app?.activity?.find((a) => a.$['android:name'] === '.MainActivity');
    if (main) {
      main.$['android:supportsPictureInPicture'] = 'true';
      main.$['android:resizeableActivity'] = 'true';
    }
    return cfg;
  });
};
