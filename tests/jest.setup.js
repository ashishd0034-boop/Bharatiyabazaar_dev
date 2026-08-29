const path = require("path");
require("dotenv").config({
  path: path.resolve(__dirname, "../.env.test"),
  override: true,
});

jest.setTimeout(30000);
