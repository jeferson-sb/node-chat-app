const moment = require('moment');
const uuidv1 = require('uuid/v1');

const generateMessage = (username, text) => {
  return {
    id: uuidv1(),
    username,
    text,
    createdAt: moment().valueOf()
  };
};

module.exports = { generateMessage };
