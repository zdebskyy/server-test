const fs = require("fs");
const path = require("path");
const axios = require("axios");
const Ajv = require("ajv").default;

const puppeteer = require("puppeteer-extra");
const UserAgent = require("user-agents");

const parser = require("./parser");

// add stealth plugin and use defaults (all evasion techniques)
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());

const AdblockerPlugin = require("puppeteer-extra-plugin-adblocker");
puppeteer.use(AdblockerPlugin());

const { tf, md5Rnd, delay, md5, decodeNestedObject } = require("./utils");

const env = require("./env");

class Worker {
    constructor({
        log,
        isBrowserless = false,
        forceHeadless = false,
        interceptRequests = false,
        blockResources = "script|font|image|imageset|stylesheet|media|texttrack|object|beacon|csp_report",
        useProxy = false,
        staticUserDir = false,
        proxy = null,
    }) {
        this.log = log;
        this.chromePath =
            process.platform === "win32"
                ? "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
                : process.platform === "darwin"
                ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
                : process.platform === "linux"
                ? "/usr/bin/google-chrome"
                : null;

        this.trackingId = null;

        this.userDataDir = !staticUserDir ? `./tmp/temporary/${this.trackingId}` : `./tmp/static`;
        this.interceptRequests = interceptRequests;
        this.proxy = proxy ? proxy : env.PROXY;

        this.useProxy = useProxy;

        this.defaultTimeout = 30000;

        this.isBrowserless = isBrowserless;
        this.browserlessURL = env.BROWSERLESS_URL;
        this.headless = this.isBrowserless ? true : false;
        this.headless = forceHeadless ? true : this.headless;

        this.modules = [
            fs.readFileSync(path.join(__dirname, "../libs/browser/cheerio5.min.js"), "utf-8"),
            fs.readFileSync(path.join(__dirname, "../libs/browser/entities.min.js"), "utf-8"),
            // fs.readFileSync(path.join(__dirname, "../libs/browser/ajv.min.js"), "utf-8"),
        ];

        this.externalModulesPaths = [
            //"https://datazeit.fra1.digitaloceanspaces.com/browser/zparser/_allbundled.js",
        ];

        this.blockResources = blockResources;

        this.args = [
            `--user-agent=${this.getUAString()}`,
            "--ignore-certificate-errors",
            "--allow-running-insecure-content", // ALLOW HTTP WITHIN HTTPS PAGE
            "--disable-web-security", // ALLOW CORS
            "-–allow-file-access-from-files",
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-accelerated-2d-canvas",
            "--disable-gpu",
            // "--dump-dom", // THIS WILL CAUSE ERRORS IF IN HEADLESS MODE
            "--window-size=1680x1050",
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
            "--disable-features=site-per-process",
            // "--single-process", // THIS WILL CAUSE ERRORS IF MORE WORKERS ARE RUNNING
            "--no-zygote", // https://github.com/puppeteer/puppeteer/issues/1825#issuecomment-529619628
            "--disable-infobars",
            "--window-position=0,0",
            "--ignore-certifcate-errors",
            "--ignore-certifcate-errors-spki-list",
            "--start-fullscreen",
            "--start-maximized",
        ];

        if (this.useProxy) {
            this.log.debug("USE PROXY", this.proxy);
            this.args.push(`--proxy-server=${this.proxy}`);
        }
    }

    browserWSEndpoint() {
        let url = `ws://${this.browserlessURL}?headless=${
            this.headless
        }&blockAds=true&ignoreDefaultArgs=false&trackingId=${this.trackingId}&${this.args.join("&")}`;
        return url;
    }

    async prepare() {
        let browser, res, err;
        try {
            let launchOptions = {
                headless: this.headless,
                executablePath: this.chromePath,
                userDataDir: this.userDataDir,
                devtools: false,
                slowMo: 50,
                args: this.args,
            };

            this.trackingId = md5Rnd();

            if (this.isBrowserless) {
                this.log.debug("STARTING BROWSERLESS", this.browserWSEndpoint());
                browser = await puppeteer.connect({
                    browserWSEndpoint: this.browserWSEndpoint(),
                    ignoreHTTPSErrors: true,
                });
            } else {
                this.log.debug("STARTING LOCAL CHROME");
                browser = await puppeteer.launch(launchOptions);
            }

            this.browser = browser;

            let [page] = await browser.pages();
            await page.setBypassCSP(true); // need if scripts needs to be inserted in page
            await page.setCacheEnabled(true);

            [, err] = await this.loadModules(page);
            if (err) this.log.error(err);

            this.log.debug("INTERCEPT REQUESTS", this.interceptRequests);
            if (this.interceptRequests) {
                await page.setRequestInterception(this.interceptRequests);
                this.setPageEvents(page);
            }

            await page.setDefaultTimeout(this.defaultTimeout);

            this.page = page;
            return [true];
        } catch (err) {
            return [, err];
        }
    }

    async close() {
        // We don't care if it throws an error. just close/disconnect
        if (this.isBrowserless) await tf(async () => await this.browser.disconnect());
        else await tf(async () => await this.browser.close()); // This will cause errors as all browserless sessions will close

        return [true];
    }

    getUAString() {
        return new UserAgent({ deviceCategory: "desktop" }).random().toString();
    }

    async loadExternalModules() {
        for (const path of this.externalModulesPaths) {
            let [res, err] = await tf(async () => await axios(path));
            if (err) return [, err];
            this.modules.push(res.data);
        }
        return [true];
    }

    async loadModules(page) {
        let err;

        let tmp = md5(`${Math.random() * 1000}`).slice(0, 5);
        try {
            console.time(`MODULES_LOAD_${tmp}`);

            [, err] = await this.loadExternalModules();
            if (err) return [, err];

            for (const m of this.modules) {
                [, err] = await tf(async () => await page.evaluateOnNewDocument(m));
                if (err) return [, err];
            }

            console.timeEnd(`MODULES_LOAD_${tmp}`);
            return [true];
        } catch (err) {
            await this.close();
            return [, err];
        }
    }

    setPageEvents(page) {
        // Emitted when the page emits an error event (for example, the page crashes)
        // We don't log in LogDNA because there are a lot of errors which are not important
        // (Because we intercepts requests and override jquery with cheerio errors occur which we actually forced)
        page.on("error", (err) => console.error(`❌ ${err}`));

        // Emitted when a script within the page has uncaught exception
        page.on("pageerror", (error) => console.error(`❌ ${error}`));

        page.on("request", async (r) => {
            // Block other sources
            const resource = r.resourceType();
            const cond_blocked_rsrc = this.blockResources && this.blockResources.includes(resource);
            const cond_no_fetch = resource !== "fetch";
            if (cond_blocked_rsrc && cond_no_fetch) {
                r.abort();
                return;
            }

            r.continue();
        });
    }

    async setCookies({ cookies }) {
        const cdp = await this.page.target().createCDPSession();

        // * CLEAR COOKIES (JUST TO BE SAFE)
        await tf(async () => await cdp.send("Network.clearBrowserCookies")); // clear old cookies

        // * SET COOKIES
        await tf(async () => await this.page.setCookie(...cookies));

        return [true];
    }

    async isHealthy() {
        // * IF PAGES CRASH IT JUST THROWS AN ERROR
        let [res, err] = await tf(async () => await this.page.evaluate(() => window.document.location.href));
        if (err) return [false];
        return [true];
    }

    async waitForGotoReady() {
        if (this._goto) return [true];
        let seconds = 0;
        while (true) {
            this.log.debug("GOTO BUSY...");
            seconds += 1;
            await delay(100);
            if (this._goto) return [true];
            if (seconds > 10) return [, new Error("GOTO PAGE NOT READY")];
        }
    }

    async waitForInitReady() {
        if (!this._initting) return [true];
        let seconds = 0;
        while (true) {
            this.log.debug("INIT BUSY...");
            seconds += 1;
            await delay(1000);
            if (!this._initting) return [true];
            if (seconds > 10) return [, new Error("COULD NOT INIT")];
        }
    }

    async goto(url, args = { waitUntil: "networkidle2" }) {
        let res, err;

        this._goto = false;

        let tmp = md5(`${Math.random() * 1000}`).slice(0, 5);
        console.time(`GOTO_${tmp}`);

        // * GOTO
        [res, err] = await tf(async () => await this.page.goto(url, args));
        if (err) return [null, err];

        // * STATUS CODE
        let [status_code] = await tf(async () => parseInt(res.headers().status || res.status()));

        // * SET HTML FOR PARSERS
        [, err] = await tf(
            async () =>
                await this.page.evaluate((url) => {
                    if (!window.html) window.html = {}; // only for first call
                    window.html[url] = document.doctype
                        ? new XMLSerializer().serializeToString(document.doctype) + document.documentElement.outerHTML
                        : document.documentElement.outerHTML;
                }, url)
        );
        if (err) return [null, err];

        console.timeEnd(`GOTO_${tmp}`);

        this._goto = true;

        return [{ ok: true, status_code }];
    }

    async fetch(url) {
        try {
            let tmp = md5(`${Math.random() * 1000}`).slice(0, 5);
            console.time(`FETCH_${tmp}`);
            let fetched = await this.page.evaluate(
                async ({ url, timeout }) => {
                    try {
                        if (!window.html) window.html = {}; // only for first call
                        let delay = (ms) => new Promise((r) => setTimeout(r, ms));
                        let fetcher = async function (url) {
                            const fetched = await fetch(url);
                            window.status_code = fetched.status;
                            window.html[url] = await fetched.text();
                        };
                        await Promise.race([fetcher(url), delay(timeout)]);
                        if (!window.html[url]) return { ok: false, message: "FETCH_TIMEOUT" };

                        return { ok: true, status_code: window.status_code };
                    } catch (err) {
                        return { ok: false, message: err.message };
                    }
                },
                { url, timeout: 30000 }
            );

            console.timeEnd(`FETCH_${tmp}`);

            if (!fetched.ok) return [, new Error(`${fetched.message} (${url})`)];
            return [fetched];
        } catch (err) {
            return [, err];
        }
    }

    async parse(args) {
        const { url, parse } = args;
        if (!parser[parse]) return [, new Error(`COULD NOT FOUND PARSER: ${parse}`)];
        if (!url) return [, new Error(`URL NOT DEFINED!`)];

        const pFn = parser[parse].fn;
        const pSchema = parser[parse].schema;

        // * PARSE
        let [res, err] = await tf(
            async () =>
                await this.page.evaluate(
                    async ({ pFnString, args }) => {
                        try {
                            const pFn = new Function(" return (" + pFnString + ").apply(null, arguments)");
                            return await pFn.call(null, args);
                        } catch (err) {
                            return { error_message: err.message };
                        }
                    },
                    { pFnString: pFn.toString(), args }
                )
        );

        // * REMOVE HTML TO SAVE MEMORY
        await tf(async () => await this.page.evaluate((url) => delete window.html[url], url));

        // * CHECK FOR PARSER FUNCTION ERRORS
        if (err) return [, err];
        if (res?.error_message) return [, new Error(`PARSER_FUNC_ERROR[${parse}]: ${res?.error_message} (${url})`)];

        // * CHECK IF PARSER RESULT IS VALID
        const ajv = new Ajv();
        const valid = ajv.validate(pSchema, res);
        if (!valid) {
            return [, new Error(`PARSER_RESULT_ERROR[${parse}]: ${JSON.stringify(ajv.errors)} (${url})`)];
        }

        // * DECODE PARSED RESULTS (Sometimes crawled results include e.g. &amp;....)
        res = decodeNestedObject(res);

        return [res, err];
    }

    async init() {
        let res, err, is_healthy, done;

        this._initting = true;

        let url = env.INIT_URL;

        let iter = 0,
            iter_max = 10;

        while (!done) {
            this.log.debug("TRY RESTARTING BROWSER...", ++iter);

            // * CLOSE IN CASE OLD SESSION IS ACTIVE
            await this.close();

            // * BREAK IF TOO MANY BROWSER RETRIES
            if (iter > iter_max) return [, new Error("BROWSER CRASHED TOO MANY TIMES")];

            // * OPEN BLANK BROWSER PAGE
            [res, err] = await this.prepare();
            if (err) {
                this.log.error(err, { url });
                await delay(1000);
                continue;
            }

            // * LOAD HOME PAGE OF DOMAIN
            [res, err] = await this.goto(url);
            if (err) {
                this.log.error(err, { url });
                await delay(1000);
                continue;
            }

            // * CHECK HEALTH
            [is_healthy] = await this.isHealthy();
            if (is_healthy) break;
        }

        this._initting = false;

        this.log.debug("INITTED");
        return [true];
    }
}

module.exports = Worker;
