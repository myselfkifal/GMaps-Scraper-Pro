chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'download_csv') {
        // We use a data URI here so that chrome.downloads can handle it 
        // with the desired filename from the background context.
        const BOM = '\uFEFF';
        const dataUrl = `data:text/csv;charset=utf-8,${encodeURIComponent(BOM + request.content)}`;
        
        chrome.downloads.download({
            url: dataUrl,
            filename: request.filename,
            saveAs: true
        }, (downloadId) => {
            if (chrome.runtime.lastError) {
                console.error("Download failed from background:", chrome.runtime.lastError);
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
            } else {
                console.log("Download started successfully", downloadId);
                sendResponse({ success: true, downloadId });
            }
        });
        return true; // Keep message channel open for async response
    }
});
