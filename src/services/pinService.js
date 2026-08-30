// Backwards-compatibility shim: Re-exports member PIN operations from src/modules/pin/pin.service.js
// and adminGeneratePins from src/core/services/system-settings.service.js
const pinService = require("../modules/pin/pin.service");
const { adminGeneratePins } = require("../core/services/system-settings.service");

module.exports = {
  ...pinService,
  adminGeneratePins
};
