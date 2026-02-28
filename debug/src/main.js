import { Actor } from 'apify';
import { PlaywrightCrawler, sleep } from 'crawlee';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(StealthPlugin());

await Actor.init();

const input = await Actor.getInput() ?? {};
const { searchUrl = 'https://www.hasznaltauto.hu/talalatilista/szemelyauto' } = input;

console.log('🔍 DEBUG - hasznaltauto.hu HTML dump');

const proxyConfiguration = await Actor.createProxyConfiguration({
    useApifyProxy: true,
    apifyProxyGroups: ['RESIDENTIAL'],
});

const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    maxRequestRetries: 2,
    maxConcurrency: 1,
    navigationTimeoutSecs: 90,
    requestHandlerTimeoutSecs: 180,

    launchContext: {
        launcher: chromium,
        launchOptions: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        },
    },

    preNavigationHooks: [
        async ({ page }) => {
            await page.setViewportSize({ width: 1440, height: 900 });
            await page.setExtraHTTPHeaders({ 'Accept-Language': 'hu-HU,hu;q=0.9' });
            await page.addInitScript(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => false });
                if (!window.chrome) window.chrome = { runtime: {} };
            });
        },
    ],

    async requestHandler({ page, request, log }) {
        log.info(`Betöltés: ${request.url}`);
        await sleep(4000);

        // Cloudflare várakozás
        for (let i = 0; i < 3; i++) {
            const title = await page.title();
            if (title.includes('Just a moment') || title.includes('Cloudflare')) {
                log.info(`Cloudflare... (${i + 1}/3)`);
                await sleep(8000);
            } else break;
        }

        // Cookie banner bezárása
        try {
            await page.click('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll', { timeout: 4000 });
            log.info('🍪 Cookie elfogadva');
            await sleep(1500);
        } catch { /* nincs */ }

        await sleep(2000);

        const selectorCounts = await page.evaluate(() => {
            const selectors = [
                '.talalati-lista-elem',
                '.listing-item',
                '.car-item',
                '[class*="talalati"]',
                '[class*="listing"]',
                '[class*="result"]',
                '[data-hirdetesid]',
                'article',
                '.row.car',
                '.offer-item',
            ];
            const result = {};
            for (const sel of selectors) {
                result[sel] = document.querySelectorAll(sel).length;
            }
            return result;
        });

        log.info(`Szelektor találatok: ${JSON.stringify(selectorCounts)}`);

        const debugData = await page.evaluate(() => {
            const candidates = [
                '.talalati-lista-elem',
                '[data-hirdetesid]',
                '.listing-item',
                '[class*="talalati"]',
            ];

            let cards = [];
            let usedSel = '';
            for (const sel of candidates) {
                const found = document.querySelectorAll(sel);
                if (found.length > 0) {
                    cards = Array.from(found);
                    usedSel = sel;
                    break;
                }
            }

            return {
                usedSelector: usedSel,
                cardCount: cards.length,
                card1: cards[0]?.outerHTML ?? 'NINCS',
                card2: cards[1]?.outerHTML ?? 'NINCS',
            };
        });

        log.info(`Használt szelektor: "${debugData.usedSelector}", ${debugData.cardCount} kártya`);

        await Actor.pushData({
            selectorCounts,
            usedSelector: debugData.usedSelector,
            cardCount: debugData.cardCount,
            card1_HTML: debugData.card1,
            card2_HTML: debugData.card2,
        });

        log.info('✅ Dataset-be mentve!');
    },

    failedRequestHandler({ request, log }) {
        log.error(`❌ Sikertelen: ${request.url}`);
    },
});

await crawler.run([{ url: searchUrl }]);
await Actor.exit();
