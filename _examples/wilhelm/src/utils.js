const crypto = require("crypto");
const Promise = require("bluebird");
const entities = require("entities");

const utils = {};

utils.delay = async (timeout) => {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve();
        }, timeout);
    });
};

utils.tf = async (action, code) => {
    try {
        const res = await action();
        return [res];
    } catch (err) {
        if (code) err.code = code;
        return [, err];
    }
};

utils.exit = (code) => {
    console.debug("WILL CLOSE ALL PROCESSES IN 5s");
    const t = setTimeout(function () {
        process.exit(code);
    }, 5000);
    // allow process to exist naturally before the timer if it is ready to
    t.unref();
};

utils.md5 = (s) => crypto.createHash("md5").update(s).digest("hex");

utils.md5Rnd = () =>
    crypto
        .createHash("md5")
        .update(`${Math.ceil(Math.random() * 1000) * Math.ceil(Math.random() * 1000) * new Date().getTime()}`)
        .digest("hex");

utils.strToBigIntAsStr = (s) => `${BigInt.asIntN(64, BigInt(`0x${utils.md5(s).substring(0, 16)}`))}`.replace("n", "");

// https://gist.github.com/getify/3667624
utils.escapeDoubleQuotes = (str) => {
    try {
        return str.replace(/\\([\s\S])|(")/g, "\\$1$2");
    } catch (e) {
        return null;
    }
};

utils.decodeNestedObject = (obj) => {
    let _tmp = JSON.parse(JSON.stringify(obj));
    try {
        function recurse(obj, current) {
            for (const key in obj) {
                let value = obj[key];
                if (value != undefined) {
                    if (value && typeof value === "object") recurse(value, key);
                    else {
                        if (typeof value === "string") obj[key] = entities.decodeHTML(value).trim();
                        else obj[key] = value;
                    }
                }
            }
        }
        recurse(obj);
        return obj;
    } catch (err) {
        return _tmp;
    }
};

utils.addDateHashToUrl = (url) => {
    let u = new URL(url);
    u.hash = `##d:${new Date().toISOString().split("T").shift().split("-").join("")}`;
    return u.href;
};

utils.promiseAllProps = (arrayOfObjects) => Promise.map(arrayOfObjects, (obj) => Promise.props(obj));

module.exports = utils;
