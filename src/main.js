import { Actor } from 'apify';
import { PlaywrightCrawler, sleep } from 'crawlee';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(StealthPlugin());

await Actor.init();

const input = await Actor.getInput() ?? {};

const {
    searchUrl = 'https://www.hasznaltauto.hu/talalatilista/szemelyauto',
    maxPages = 5,
    minPrice,
    maxPrice,
    maxKm,
    minYear,
} = input;

console.log('🚗 Hasznaltauto.hu Scraper (Stealth Mode) indítása...');
console.log(`URL: ${searchUrl}`);
console.log(`Max oldalak: ${maxPages}`);

let totalResults = 0;

const { proxyGroup = 'RESIDENTIAL' } = input;

const proxyConfiguration = await Actor.createProxyConfiguration({
    useApifyProxy: true,
    apifyProxyGroups: [proxyGroup],
});

const crawler = new PlaywrightCrawler({
    proxyConfiguration,

    // Ha 403-at kapunk, az tipikusan bot-block -> session rotáció + retry
    useSessionPool: true,
    persistCookiesPerSession: true,
    sessionPoolOptions: {
        maxPoolSize: 50,
        sessionOptions: {
            maxUsageCount: 3,
        },
    },
    blockedStatusCodes: [403, 429],

    maxRequestRetries: 6,
    maxConcurrency: 1,
    navigationTimeoutSecs: 90,
    requestHandlerTimeoutSecs: 180,

    launchContext: {
        launcher: chromium,
        launchOptions: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
            ],
        },
    },

    preNavigationHooks: [
        async ({ page }) => {
            const viewports = [
                { width: 1366, height: 768 },
                { width: 1440, height: 900 },
                { width: 1920, height: 1080 },
                { width: 1536, height: 864 },
            ];
            const vp = viewports[Math.floor(Math.random() * viewports.length)];
            await page.setViewportSize(vp);

            await page.setExtraHTTPHeaders({
                'Accept-Language': 'hu-HU,hu;q=0.9,en-US;q=0.8,en;q=0.7',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Cache-Control': 'max-age=0',
                'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
                'Sec-Ch-Ua-Mobile': '?0',
                'Sec-Ch-Ua-Platform': '"Windows"',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Upgrade-Insecure-Requests': '1',
            });

            await page.addInitScript(() => {
                Object.defineProperty(screen, 'width', { get: () => 1920 });
                Object.defineProperty(screen, 'height', { get: () => 1080 });
                Object.defineProperty(navigator, 'plugins', {
                    get: () => {
                        const arr = [
                            { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
                            { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
                            { name: 'Native Client', filename: 'internal-nacl-plugin' },
                        ];
                        arr.item = i => arr[i];
                        arr.namedItem = n => arr.find(p => p.name === n);
                        arr.refresh = () => {};
                        return arr;
                    }
                });
                Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
                Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
                const getParameter = WebGLRenderingContext.prototype.getParameter;
                WebGLRenderingContext.prototype.getParameter = function(parameter) {
                    if (parameter === 37445) return 'Intel Inc.';
                    if (parameter === 37446) return 'Intel Iris OpenGL Engine';
                    return getParameter.call(this, parameter);
                };
                if (!window.chrome) {
                    window.chrome = {
                        app: { isInstalled: false },
                        runtime: {
                            onConnect: { addListener: () => {}, removeListener: () => {} },
                            onMessage: { addListener: () => {}, removeListener: () => {} },
                        },
                        csi: () => {},
                        loadTimes: () => {},
                    };
                }
                if (window.Notification) {
                    Object.defineProperty(Notification, 'permission', { get: () => 'default' });
                }
            });
        },
    ],

    async requestHandler({ page, request, log, session }) {
        log.info(`📄 Betöltés: ${request.url}`);
        if (session) log.info(`🧩 Session: ${session.id} (usage=${session.usageCount})`);

        await sleep(2000 + Math.random() * 3000);

        // Cloudflare / bot-block jelzések kezelése
        for (let attempt = 0; attempt < 3; attempt++) {
            const title = await page.title();
            const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 600) ?? '');

            const looksLikeChallenge =
                title.includes('Just a moment')
                || title.includes('Cloudflare')
                || bodyText.includes('Checking your browser')
                || bodyText.toLowerCase().includes('access denied')
                || bodyText.toLowerCase().includes('forbidden');

            if (looksLikeChallenge) {
                log.info(`⏳ Challenge/block gyanú (${attempt + 1}/3), várakozás 10mp...`);
                await sleep(10000);
            } else {
                break;
            }
        }

        // Cookie banner bezárása ha van
        try {
            const cookieBtn = page.locator('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll, .cookie-accept, [id*="cookie"] button, [class*="cookie"] button').first();
            if (await cookieBtn.isVisible({ timeout: 3000 })) {
                await cookieBtn.click();
                log.info('🍪 Cookie banner bezárva');
                await sleep(1000);
            }
        } catch { /* nincs cookie banner */ }

        // Emberi scroll
        await humanScroll(page);

        // Várjuk a hirdetések megjelenését
        try {
            await page.waitForSelector('.talalati-lista-elem', { timeout: 25000 });
        } catch {
            log.warning('⚠️ .talalati-lista-elem nem jelent meg, próbálunk mással...');
        }

        // DEBUG: HTML snapshot a logba - segít azonosítani a struktúrát
        const debugInfo = await page.evaluate(() => {
            const body = document.body?.innerHTML ?? '';
            // Első 2000 karakter a struktúra megértéséhez
            return {
                title: document.title,
                url: window.location.href,
                htmlSnippet: body.substring(0, 2000),
                // Keresünk minden lehetséges hirdetés elemet
                foundSelectors: [
                    '.talalati-lista-elem',
                    '.listing-item',
                    '[class*="listing"]',
                    '[class*="talalati"]',
                    'article',
                    '.car',
                    '[data-hirdetesid]',
                    '[data-id]',
                ].map(sel => ({ sel, count: document.querySelectorAll(sel).length })),
            };
        });

        log.info(`📊 Debug: title="${debugInfo.title}"`);
        log.info(`📊 Talált szelektorok: ${JSON.stringify(debugInfo.foundSelectors)}`);

        // Adatok kinyerése - hasznaltauto.hu specifikus struktúra
        const listings = await page.evaluate(() => {
            const results = [];

            // hasznaltauto.hu szelektorok prioritás sorrendben
            const containerSelectors = [
                '.talalati-lista-elem',           // Fő lista elem
                '[data-hirdetesid]',              // Hirdetés ID alapján
                '.listing-item',
                '.car-listing',
                'article.listing',
            ];

            let cards = [];
            let usedSelector = '';
            for (const sel of containerSelectors) {
                const found = document.querySelectorAll(sel);
                if (found.length > 0) {
                    cards = Array.from(found);
                    usedSelector = sel;
                    break;
                }
            }

            console.log(`Használt szelektor: "${usedSelector}", ${cards.length} elem`);

            for (const card of cards) {
                try {
                    // ----- HIRDETÉS ID -----
                    const hirdetesId = card.getAttribute('data-hirdetesid')
                        ?? card.getAttribute('data-id')
                        ?? '';

                    // ----- CÍM (márka + modell + felszereltség) -----
                    const titleEl = card.querySelector(
                        '.talalati-bal-oldal h3, h3.title, .car-title, h3 a, h2 a, .listing-title'
                    );
                    const carTitle = titleEl?.textContent?.trim() ?? '';

                    // ----- ÁR -----
                    const priceEl = card.querySelector(
                        '.vetelar, .price, [class*="price"], [class*="vetelar"], [class*="ar"]'
                    );
                    const price = priceEl?.textContent?.trim().replace(/\s+/g, ' ') ?? '';

                    // ----- RÉSZLETEK (évjárat, km, motor) -----
                    // hasznaltauto.hu-n általában egy sorban: "2019 | 45 000 km | 2.0 TDI | Dízel"
                    const detailsEl = card.querySelector(
                        '.talalati-adatok, .listing-details, [class*="adatok"], [class*="details"]'
                    );
                    const detailsText = detailsEl?.textContent?.trim() ?? '';

                    // Egyedi mezők próbálása
                    const yearEl = card.querySelector('[class*="evjarat"], [class*="year"]');
                    let year = yearEl?.textContent?.trim() ?? '';

                    const kmEl = card.querySelector('[class*="km"], [class*="kilomet"]');
                    let km = kmEl?.textContent?.trim() ?? '';

                    const fuelEl = card.querySelector('[class*="uzemanyag"], [class*="fuel"], [class*="hajtas"]');
                    const fuel = fuelEl?.textContent?.trim() ?? '';

                    const engineEl = card.querySelector('[class*="motor"], [class*="engine"], [class*="hengerurtar"]');
                    const engine = engineEl?.textContent?.trim() ?? '';

                    // Ha nem volt külön elem, kinyerjük a details szövegből
                    if (detailsText && !year) {
                        const yearMatch = detailsText.match(/\b(19[5-9]\d|20[0-2]\d)\b/);
                        year = yearMatch?.[0] ?? '';
                    }
                    if (detailsText && !km) {
                        const kmMatch = detailsText.match(/([\d\s]+)\s*km/i);
                        km = kmMatch ? kmMatch[0].trim() : '';
                    }

                    // Teljes szövegből fallback
                    const fullText = card.textContent ?? '';
                    if (!year) {
                        const yearMatch = fullText.match(/\b(19[5-9]\d|20[0-2]\d)\b/);
                        year = yearMatch?.[0] ?? '';
                    }
                    if (!km) {
                        const kmMatch = fullText.match(/([\d\s]{3,7})\s*km/i);
                        km = kmMatch ? kmMatch[0].trim() : '';
                    }

                    // ----- HELYSZÍN -----
                    const locationEl = card.querySelector(
                        '[class*="helyszin"], [class*="location"], [class*="telepules"], [class*="varos"]'
                    );
                    const location = locationEl?.textContent?.trim() ?? '';

                    // ----- ELADÓ (kereskedő / magánszemély) -----
                    const sellerEl = card.querySelector(
                        '[class*="elado"], [class*="seller"], [class*="keresked"]'
                    );
                    const seller = sellerEl?.textContent?.trim() ?? '';

                    // ----- LINK -----
                    const linkEl = card.querySelector('a[href*="/szemelyauto/"], a[href*="/haszn"], a[href]');
                    const href = linkEl?.getAttribute('href') ?? '';
                    const link = href.startsWith('http') ? href : `https://www.hasznaltauto.hu${href}`;

                    // ----- KÉP -----
                    const imgEl = card.querySelector('img');
                    const imageUrl = imgEl?.getAttribute('src')
                        ?? imgEl?.getAttribute('data-src')
                        ?? imgEl?.getAttribute('data-lazy')
                        ?? '';

                    if (carTitle || price || hirdetesId) {
                        results.push({
                            hirdetesId,
                            carTitle,
                            price,
                            year,
                            km,
                            fuel,
                            engine,
                            detailsText,
                            location,
                            seller,
                            link,
                            imageUrl,
                        });
                    }
                } catch (e) {
                    console.log('Kártya parse hiba:', e.message);
                }
            }

            return results;
        });

        log.info(`✅ ${listings.length} hirdetés találva`);

        const now = new Date().toISOString();
        for (const listing of listings) {
            // Ár szűrés
            if (minPrice || maxPrice) {
                const priceNum = parseInt((listing.price ?? '').replace(/\D/g, ''));
                if (minPrice && priceNum < minPrice) continue;
                if (maxPrice && priceNum > maxPrice) continue;
            }
            // Km szűrés
            if (maxKm) {
                const kmNum = parseInt((listing.km ?? '').replace(/\D/g, ''));
                if (kmNum && kmNum > maxKm) continue;
            }
            // Évjárat szűrés
            if (minYear) {
                const yearNum = parseInt(listing.year ?? '');
                if (yearNum && yearNum < minYear) continue;
            }

            await Actor.pushData({ ...listing, scrapedAt: now, sourceUrl: request.url });
            totalResults++;
        }

        // Következő oldal keresése
        const currentPage = request.userData?.pageNum ?? 1;
        if (currentPage < maxPages && listings.length > 0) {
            const nextUrl = await page.evaluate(() => {
                // hasznaltauto.hu pagination szelektorok
                const nextEl = document.querySelector(
                    'a[rel="next"], .next-page a, [class*="next"] a, li.next a, .pagination a[aria-label="Következő"], a.next'
                );
                return nextEl?.href ?? null;
            });

            // Ha nincs "next" link, próbáljuk az oldal URL-be beépíteni
            // hasznaltauto.hu: /page2, /page3 stb. a URL végén
            const targetUrl = nextUrl ?? (() => {
                const url = request.url;
                const pageMatch = url.match(/\/page(\d+)/);
                if (pageMatch) {
                    return url.replace(/\/page\d+/, `/page${currentPage + 1}`);
                } else {
                    return url.replace(/\/?$/, `/page${currentPage + 1}`);
                }
            })();

            if (targetUrl && targetUrl !== request.url) {
                log.info(`➡️ Következő oldal (${currentPage + 1}): ${targetUrl}`);
                await sleep(2000 + Math.random() * 2000);
                await crawler.addRequests([{ url: targetUrl, userData: { pageNum: currentPage + 1 } }]);
            }
        }
    },

    failedRequestHandler({ request, log }) {
        log.error(`❌ Végleg sikertelen: ${request.url}`);
    },
});

// Emberi scroll szimuláció
async function humanScroll(page) {
    await page.evaluate(async () => {
        const totalHeight = document.body.scrollHeight;
        const step = Math.floor(totalHeight / 8);
        for (let pos = 0; pos < totalHeight; pos += step) {
            window.scrollTo(0, pos);
            await new Promise(r => setTimeout(r, 300 + Math.random() * 400));
        }
        window.scrollTo(0, 0);
        await new Promise(r => setTimeout(r, 500));
    });
}

await crawler.run([{ url: searchUrl, userData: { pageNum: 1 } }]);

console.log(`\n🎉 Kész! Összesen ${totalResults} hirdetés mentve.`);

await Actor.exit();
