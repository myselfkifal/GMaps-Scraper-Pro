let isScraping = false;
let scrapedData = [];
let maxResults = 100;
let minDelay = 2;
let maxDelay = 5;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'start') {
        if (isScraping) {
            console.log('Scraper already running.');
            return;
        }
        isScraping = true;
        maxResults = request.maxResults || 100;
        minDelay = request.minDelay || 2;
        maxDelay = request.maxDelay || 5;
        startScraping();
    } else if (request.action === 'stop') {
        isScraping = false;
        console.log('Scraper stop signal received.');
    }
});

function sendLog(text, type = 'info', count = undefined) {
    chrome.runtime.sendMessage({ action: 'log', text, type, count });
}

async function startScraping() {
    sendLog('--- Scraping Session Started ---', 'info');
    const seenLinks = new Set();
    
    const stored = await chrome.storage.local.get(['leads']);
    scrapedData = stored.leads || [];
    scrapedData.forEach(item => seenLinks.add(item.link));

    sendLog(`Initial data: ${scrapedData.length} leads. Limit: ${maxResults}`, 'info', scrapedData.length);

    if (scrapedData.length >= maxResults) {
        sendLog('Limit reached. Stopping.', 'warn');
        alert(`Limit reached! You already have ${scrapedData.length} leads.`);
        isScraping = false;
        chrome.storage.local.set({ status: 'idle' });
        return;
    }

    const getScrollContainer = () => {
        return document.querySelector('div[role="feed"]') || 
               document.querySelector('div[aria-label^="Results for"]') ||
               document.querySelector('div.m6QErb.ecceSd.QjC7t');
    };

    const scrollContainer = getScrollContainer();
    if (!scrollContainer) {
        sendLog('Results sidebar not found. Please ensure you are on a search result page.', 'error');
    }

    let retryCount = 0;
    while (isScraping && scrapedData.length < maxResults) {
        const results = Array.from(document.querySelectorAll('a.hfpxzc, a[href*="/maps/place/"]'))
            .filter(el => el.getAttribute('href')?.includes('/maps/place/'));

        sendLog(`Found ${results.length} results in current view.`, 'info');
        
        let newItemsFound = false;

        if (results.length > 0) {
            retryCount = 0;
            for (const res of results) {
                if (!isScraping || scrapedData.length >= maxResults) break;

                const link = res.href;
                if (seenLinks.has(link)) continue;

                newItemsFound = true;
                const businessName = res.getAttribute('aria-label') || 'Business';
                sendLog(`Clicking ${businessName}...`, 'info');
                res.click();
                
                const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1) + minDelay);
                sendLog(`Waiting ${delay}s for details...`, 'info');
                await sleep(delay * 1000);

                const lead = extractLeadData(link);
                if (lead.name) {
                    scrapedData.push(lead);
                    seenLinks.add(link);
                    await chrome.storage.local.set({ leads: scrapedData });
                    sendLog(`Saved: ${lead.name}`, 'success', scrapedData.length);
                } else {
                    sendLog(`Could not extract details for ${businessName}`, 'warn');
                }
            }
        }

        if (isScraping) {
            if (scrollContainer) {
                sendLog('Scrolling sidebar for more...', 'info');
                scrollContainer.scrollBy(0, 1000);
                await sleep(3000);
            } else {
                window.scrollBy(0, 1000);
                await sleep(3000);
            }
        }

        if (!newItemsFound && isScraping) {
            retryCount++;
            sendLog(`No new results (Retry ${retryCount}/3)...`, 'warn');
            if (scrollContainer) scrollContainer.scrollBy(0, 2000);
            await sleep(5000);
            
            if (retryCount >= 3) {
                sendLog('Search reached end or results exhausted.', 'info');
                break;
            }
        }
    }

    sendLog(`Finished! Total scraped: ${scrapedData.length}`, 'success', scrapedData.length);
    isScraping = false;
    chrome.storage.local.set({ status: 'idle' });
}

function extractLeadData(link) {
    // Detail panel selectors
    const name = document.querySelector('h1.DUwDvf')?.textContent || '';
    const address = document.querySelector('button[data-item-id="address"]')?.textContent || '';
    let phone = document.querySelector('button[data-item-id^="phone:tel:"]')?.textContent || '';
    const website = document.querySelector('a[data-item-id="authority"]')?.href || '';
    
    // Improved Rating & Reviews selectors (Aggressive Strategy)
    let rating = '';
    let reviews = '';
    
    // Attempt 1: The primary rating container Google Maps uses currently
    const ratingContainer = document.querySelector('div.F7nice') || document.querySelector('div.LBgpqf'); 
    
    if (ratingContainer) {
        // Find Rating
        rating = ratingContainer.querySelector('span[aria-hidden="true"]')?.textContent || '';
        if (!rating) { 
             const match = ratingContainer.textContent.match(/(\d[\.,]\d)/);
             if (match) rating = match[1];
        }
        
        // Find Reviews (Strictly look for numbers inside parentheses to avoid grabbing the star rating by mistake)
        const match = ratingContainer.textContent.match(/\(([\d,kK\+]+)\)/);
        if (match) {
            reviews = match[1];
        } else {
            // Fallback to checking aria-labels that specifically say 'review'
            let reviewNodes = ratingContainer.querySelectorAll('span[aria-label]');
            for (let node of reviewNodes) {
                let label = node.getAttribute('aria-label').toLowerCase();
                if (label.includes('review') && !label.includes('stars')) {
                    reviews = node.textContent || label;
                    break;
                }
            }
        }
    }

    // Attempt 2: Direct older class names if the container was completely missed
    if (!rating) rating = document.querySelector('span.MW4o7e')?.textContent || document.querySelector('.fontDisplayLarge')?.textContent || '';
    if (!reviews) {
        reviews = document.querySelector('span.F7k7Vb')?.textContent || '';
    }
    
    // Clean up reviews (extract just the numbers, k, or + signs)
    if (reviews) {
        reviews = reviews.replace(/[^\d,kK\+]/g, '').trim();
    }
    
    // Aggressive Category Extractor
    let category = document.querySelector('button.D0S1Xc')?.textContent || 
                   document.querySelector('button[jsaction*="category"]')?.textContent || '';

    if (!category && ratingContainer && ratingContainer.parentElement) {
        // Usually the category is the first button inside the immediate parent block of the rating container
        const btns = ratingContainer.parentElement.querySelectorAll('button');
        for (let btn of btns) {
            const txt = btn.textContent.trim();
            if (txt && !['share', 'save', 'nearby', 'send to your phone'].includes(txt.toLowerCase())) {
                category = txt;
                break;
            }
        }
    }
    // Clean Phone Number: Remove invisible icons and weird bytes (like \uE0B0 -> à°)
    // Keep only digits, plus, spaces, and hyphens/parentheses
    phone = phone.replace(/[^\d+\s\-\(\)]/g, '').trim();

    return { name, address, phone, website, rating, reviews, category, link };
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
