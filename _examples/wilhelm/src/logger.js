const LogDNAStream = require("logdna-bunyan");
const bunyan = require("bunyan");

// Internal
const env = require("./env");

class Logger {
    constructor({ tags = [] } = { tags: [] }) {
        this.log_debug = env.LOG_DEBUG;
        this.tags = ["crawler", ...tags];
        this.logDNA = new LogDNAStream({ key: env.LOGDNA_APIKEY });
        this.log = bunyan.createLogger({
            name: "crawler:" + env.CRAWLER_NAME,
            streams: [
                // {
                //     level: env.LOG_LEVEL || "trace",
                //     stream: process.stderr,
                // },
                {
                    level: "warn",
                    stream: this.logDNA,
                    type: "raw",
                },
            ],
            options: { tags: this.tags },
        });

        this.error = function (err, args = {}) {
            // Log locally for debugging
            console.error(`❌`);
            console.error(err);

            // transform error message
            try {
                const m = { message: err.message };
                for (const k of Object.keys(args)) m[k] = args[k];
                err.message = JSON.stringify(m);
            } catch (e) {}

            this.log.error(err);
        };

        this.debug = function (...msg) {
            this.log_debug && console.debug(...msg);
        };

        // FIX: https://github.com/logdna/nodejs/issues/42
    }
}

module.exports = Logger;
