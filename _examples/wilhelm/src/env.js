const env = {};

env.PROXY = process.env.PROXY;

env.BROWSERLESS_URL = process.env.BROWSERLESS_URL;

env.LOGDNA_APIKEY = process.env.LOGDNA_APIKEY;

env.CRAWLER_NAME = process.env.CRAWLER_NAME;
env.INIT_URL = process.env.INIT_URL;

env.LOG_DEBUG = process.env.LOG_DEBUG && process.env.LOG_DEBUG.toUpperCase() === "TRUE" ? true : false;

module.exports = env;
