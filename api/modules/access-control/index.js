module.exports = {
  devices: require('./devices/deviceService'),
  credentials: require('./credentials/credentialService'),
  policies: require('./policies/policyService'),
  decisions: require('./decisions/decisionService'),
  events: require('./events/eventService'),
  integrations: require('./integrations/accessIntegrationService'),
  visitorAccess: require('./visitor-access/visitorQrService'),
  antiPassback: require('./anti-passback/antiPassbackService'),
};
