// Extends app.json. Android push needs Firebase: put google-services.json next to this file
// (from the Firebase console) and it is picked up automatically on the next EAS build.
const fs = require('fs');
const path = require('path');

module.exports = ({ config }) => {
  if (fs.existsSync(path.join(__dirname, 'google-services.json'))) {
    config.android = { ...config.android, googleServicesFile: './google-services.json' };
  }
  return config;
};
