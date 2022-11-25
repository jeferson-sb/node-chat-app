import dotenv from 'dotenv';

dotenv.config();

export default {
  port: process.env.PORT || 8080,
  mode: process.env.NODE_ENV,
};
