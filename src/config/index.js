require('dotenv').config();

module.exports = {
  port: process.env.PORT,
  mode: process.env.NODE_ENV,
};
