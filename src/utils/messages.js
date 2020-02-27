const moment = require('moment');
const { v4: uuidv4 } = require('uuid');

const generateMessage = (username, text) => {
  return {
    id: uuidv4(),
    username,
    text,
    createdAt: moment().valueOf()
  };
};

module.exports = { generateMessage };
