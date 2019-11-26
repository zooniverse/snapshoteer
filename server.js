/**
 * Based on the amazing work by https://github.com/GoogleChromeLabs/pptraas.com
 * https://github.com/GoogleChromeLabs/pptraas.com/blob/fa9ba4e9838301bb30648077ccade6df548ce4d5/server.js
 *
 * API server to run puppeteer image generation of the URL
 * */

const express = require("express");
const puppeteer = require("puppeteer");

const fs = require('fs');
const util = require('util');
const { URL } = require('url');

const PORT = process.env.PORT || 8080;
const app = express();

// Don't turn us into a snapshotting service for the world
const isAllowedUrl = (string) => {
    try {
        const url = new URL(string);
        console.log(url);
        return url.hostname !== 'pptraas.com' && !url.hostname.startsWith('puppeteerexamples');
    } catch (err) {
        return false;
    }
};

// Adds cors, records analytics hit, and prevents self-calling loops.
app.use((request, response, next) => {
    const url = request.query.url;
    if (url && !isAllowedUrl(url)) {
        return response.status(500).send({
            error: 'URL is either invalid or not allowed'
        });
    }

    response.set('Access-Control-Allow-Origin', '*');

    next();
});

// Init code that gets run before all request handlers.
// TODO extract this to a setup handler to avoid it on the healthcheck?
// unless its useful to report the browser locals.there
app.all('*', async (request, response, next) => {
    response.locals.browser = await puppeteer.launch({
        dumpio: true,
        // headless: false,
        // executablePath: 'google-chrome',
        args: ['--no-sandbox', '--disable-setuid-sandbox'], // , '--disable-dev-shm-usage']
    });

    next(); // pass control on to routes.
});

app.get('/screenshot', async (request, response) => {
    const url = request.query.url;
    if (!url) {
        return response.status(400).send(
            'Please provide a URL. Example: ?url=https://example.com');
    }

    // Default to a reasonably large viewport for full page screenshots.
    const viewport = {
        width: 1280,
        height: 1024,
        deviceScaleFactor: 2
    };

    let fullPage = true;
    const size = request.query.size;
    if (size) {
        const [width, height] = size.split(',').map(item => Number(item));
        if (!(isFinite(width) && isFinite(height))) {
            return response.status(400).send(
                'Malformed size parameter. Example: ?size=800,600');
        }
        viewport.width = width;
        viewport.height = height;

        fullPage = false;
    }

    const browser = response.locals.browser;

    try {
        const page = await browser.newPage();
        await page.setViewport(viewport);
        await page.goto(url, { waitUntil: 'networkidle0' });

        const opts = {
            fullPage,
            // omitBackground: true
        };

        if (!fullPage) {
            opts.clip = {
                x: 0,
                y: 0,
                width: viewport.width,
                height: viewport.height
            };
        }

        let buffer;

        const element = request.query.element;
        if (element) {
            const elementHandle = await page.$(element);
            if (!elementHandle) {
                return response.status(404).send(
                    `Element ${element} not found`);
            }
            buffer = await elementHandle.screenshot();
        } else {
            buffer = await page.screenshot(opts);
        }
        response.type('image/png').send(buffer);
    } catch (err) {
        response.status(500).send(err.toString());
    }

    await browser.close();
});

app.get('/', async (request, response) => {
    const browser = response.locals.browser;
    const ua = await browser.userAgent();
    const version = await browser.version();

    const readFile = util.promisify(fs.readFile);
    let commitId = 'unknown';
    try {
        commitId = (await readFile('./commit_id.txt', 'utf8')).trim();
    } catch (err) {
        console.log(err);
    }
    response.send({
        "status": "ok",
        "commit_id": commitId,
        "puppeteer": {
            "user-agent": ua,
            "version": version
        }
    });
})

app.get('/download', async (request, response) => {
    const browser = response.locals.browser;
    const page = await browser.newPage();
    const mainUrl = request.query.url;
    let mainUrlStatus;
    await page.setRequestInterception(true);
    page.on("request", request => {
        const url = request.url();
        console.log("download request url:", url);
        request.continue();
    });
    page.on("requestfailed", request => {
        const url = request.url();
        console.log("download request failed url:", url);
    });
    page.on("response", response => {
        const request = response.request();
        const url = request.url();
        const status = response.status();
        const resourceType = response.request().resourceType();

        if (resourceType === 'script' || resourceType === 'stylesheet') {
            const url = new URL(response.request().url());
            if (url.pathname.startsWith('/application')) {
                response.text().then(function (responseText) {
                    console.log('Writing response text to tmp' + url.pathname);
                    fs.writeFileSync("tmp" + url.pathname, responseText);
                });
            }
        }

        console.log("download response url:", url, "status:", status);
        if (url === mainUrl) {
            mainUrlStatus = status;
        }
    });
    await page.goto(mainUrl, { waitUntil: 'networkidle0' });
    console.log("status for main url:", mainUrlStatus);
    const html = await page.content();
    fs.writeFileSync("tmp/index.html", html);
    await browser.close();
});

app.listen(PORT, function () {
    console.log(`Snapshoteer app is listening on port ${PORT}`);
});

// Make sure node server process stops if we get a terminating signal.
function processTerminator(sig) {
    if (typeof sig === 'string') {
        process.exit(1);
    }
    console.log('%s: Node server stopped.', Date(Date.now()));
}

const signals = [
    'SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGILL', 'SIGTRAP', 'SIGABRT', 'SIGBUS',
    'SIGFPE', 'SIGUSR1', 'SIGSEGV', 'SIGUSR2', 'SIGTERM'];
signals.forEach(sig => {
    process.once(sig, () => processTerminator(sig));
});