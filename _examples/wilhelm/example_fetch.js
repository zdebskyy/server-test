const { default: PQueue } = require("p-queue");

const Worker = require("./src/worker");
// const Logger = require("./src/logger");

// const log = new Logger();
const log = console;

const queue = new PQueue({ concurrency: 1 });

const { delay, tf } = require("./src/utils");

const worker = new Worker({
    log,
    isBrowserless: true,
    forceHeadless: true,
    interceptRequests: true,
    staticUserDir: false, // NO EFFECT WHEN isBrowserless=true. SHOULD BE ONLY USED FOR TESTING AND WORKS ONLY WHEN concurrency=1
    useProxy: false,
});

const run = async function ({ page }) {
    let res, err;

    let _no = (page - 1) * 96;

    const url = `https://www.ulta.com/skin-care-cleansers-face-wash?N=27gs&No=${_no}&Nrpp=96`;

    // LOAD HTML FOR PARSERS (FETCH METHOD)
    console.log("🥳 FETCHING", url);
    [res, err] = await worker.fetch(url);
    if (err) {
        log.error(err, { url });
        return [, err];
    }

    // CHECK STATUS CODE
    console.log("🚥 STATUS_CODE", res.status_code);

    // PARSE
    console.log("🤙 PARSING...");
    [res, err] = await worker.parse({ url, parse: "category" });
    if (err) {
        console.log(err);
        log.error(err, { url });
        return [, err];
    }

    console.log("👏 DONE...");
    console.log(res);
};

(async () => {
    // ONLY DELETE TEMPORARY BROWSER FILES. STATIC FOR LOCOAL TESTING (SHOULD NOT BE DELETED)
    await tf(async () => await efs.emptyDir("./tmp/temporary"));

    console.log("#######################");
    console.log("#####    START   ######");
    console.log("#######################");

    await worker.prepare();

    const url = `https://www.ulta.com`;

    let [, err] = await worker.goto(url);
    if (err) {
        log.error(err, { url });
        process.exit();
    }

    const pages = Array.from({ length: 5 }, (_, i) => i + 1);

    console.time("CRAWL_TIME");

    for (const page of pages) queue.add(async () => run({ page }));

    await queue.onIdle();

    console.timeEnd("CRAWL_TIME");

    console.log("SHUTTING DOWN...");
    await delay(2000);
    process.exit();
})();

// Catch any unhandled errors
process.on("exit", async (code) => {
    console.error({ code });
});
process.on("uncaughtException", async (e) => {
    console.error("Unhandled exeption:", e);
    await delay(1000);
    process.exit(0);
});
process.on("unhandledRejection", async (reason, p) => {
    console.error("Unhandled rejection:", reason);
    await delay(1000);
    process.exit(0);
});

// Docker Graceful Shutdown
process.on("SIGTERM", function () {
    console.log("SIGTERM");
    process.exit(0);
});

process.on("SIGINT", function () {
    console.log("SIGINT");
    process.exit(0);
});
