let currentStatus = 'idle';

document.addEventListener('DOMContentLoaded', async () => {
    const toggleBtn = document.getElementById('toggleBtn');
    const downloadBtn = document.getElementById('downloadBtn');
    const clearBtn = document.getElementById('clearBtn');
    const countDisplay = document.getElementById('count');
    const statusDisplay = document.getElementById('status');
    const maxResultsInput = document.getElementById('maxResults');
    const minDelayInput = document.getElementById('minDelay');
    const maxDelayInput = document.getElementById('maxDelay');
    const logsDiv = document.getElementById('logs');
    const resultsList = document.getElementById('resultsList');
    const downloadPdfBtn = document.getElementById('downloadPdfBtn');

    // Listener for live logs from content script
    chrome.runtime.onMessage.addListener((message) => {
        if (message.action === 'log') {
            addLog(message.text, message.type);
            if (message.count !== undefined) countDisplay.textContent = message.count;
            if (message.type === 'success' && message.text.startsWith('Saved:')) {
                const name = message.text.replace('Saved: ', '');
                addResult(name);
            }
        }
    });

    function addResult(name) {
        const row = document.createElement('div');
        row.className = 'result-row';
        row.innerHTML = `<span class="result-name">${name}</span><span class="result-rating">★</span>`;
        resultsList.prepend(row);
    }

    function addLog(text, type = 'info') {
        const item = document.createElement('div');
        item.className = `log-item ${type}`;
        item.textContent = `> ${text}`;
        logsDiv.appendChild(item);
        logsDiv.scrollTop = logsDiv.scrollHeight;
        
        // Keep only last 50 logs
        while (logsDiv.children.length > 50) {
            logsDiv.removeChild(logsDiv.firstChild);
        }
    }

    // Load initial state
    const data = await chrome.storage.local.get(['leads', 'status', 'maxResults', 'minDelay', 'maxDelay']);
    const leads = data.leads || [];
    currentStatus = data.status || 'idle';
    
    // Populate results list
    leads.forEach(lead => addResult(lead.name));
    
    if (data.maxResults) maxResultsInput.value = data.maxResults;
    if (data.minDelay) minDelayInput.value = data.minDelay;
    if (data.maxDelay) maxDelayInput.value = data.maxDelay;

    updateUI(leads.length, currentStatus);

    // Toggle scraping
    toggleBtn.addEventListener('click', async () => {
        if (currentStatus === 'idle') {
            const maxResults = parseInt(maxResultsInput.value);
            const minDelay = parseInt(minDelayInput.value);
            const maxDelay = parseInt(maxDelayInput.value);
            
            await chrome.storage.local.set({ 
                status: 'running', 
                maxResults,
                minDelay,
                maxDelay
            });
            
            // Send start message to content script
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab) {
                chrome.tabs.sendMessage(tab.id, { 
                    action: 'start', 
                    maxResults,
                    minDelay,
                    maxDelay
                });
                window.close();
            }
        } else {
            await chrome.storage.local.set({ status: 'idle' });
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab) {
                chrome.tabs.sendMessage(tab.id, { action: 'stop' });
            }
            updateUI(leads.length, 'idle');
        }
    });

    // Download CSV
    downloadBtn.addEventListener('click', () => {
        chrome.storage.local.get(['leads'], (result) => {
            const leads = result.leads || [];
            if (leads.length === 0) return;

            const csvContent = convertToCSV(leads);
            downloadCSV(csvContent, `gmaps_leads_${new Date().toISOString().split('T')[0]}.csv`);
        });
    });

    // Download PDF
    downloadPdfBtn.addEventListener('click', () => {
        chrome.storage.local.get(['leads'], (result) => {
            const leads = result.leads || [];
            if (leads.length === 0) return;

            downloadPDF(leads, `gmaps_leads_${new Date().toISOString().split('T')[0]}.pdf`);
        });
    });

    // Clear Data
    clearBtn.addEventListener('click', async () => {
        if (confirm('Are you sure you want to clear all scraped data?')) {
            // Clear storage
            await chrome.storage.local.set({ leads: [], status: 'idle' });
            
            // Clear UI elements
            resultsList.innerHTML = '';
            logsDiv.innerHTML = '<div class="log-item info">Data cleared. Ready...</div>';
            
            updateUI(0, 'idle');
        }
    });

    function updateUI(count, status) {
        countDisplay.textContent = count;
        statusDisplay.textContent = status.charAt(0).toUpperCase() + status.slice(1);
        statusDisplay.className = `value ${status}`;
        
        if (status === 'running') {
            toggleBtn.textContent = 'Stop Scraping';
            toggleBtn.classList.add('danger');
            toggleBtn.classList.remove('primary');
        } else {
            toggleBtn.textContent = 'Start Scraping';
            toggleBtn.classList.remove('danger');
            toggleBtn.classList.add('primary');
        }

        const isDataEmpty = (count === 0);
        downloadBtn.disabled = isDataEmpty;
        if (downloadPdfBtn) downloadPdfBtn.disabled = isDataEmpty;
    }

    function convertToCSV(data) {
        const headers = ['Name', 'Phone', 'Website', 'Address', 'Rating', 'Reviews', 'Category', 'Google Maps Link'];
        const rows = data.map(lead => [
            `"${(lead.name || '').replace(/"/g, '""')}"`,
            `"${(lead.phone || '').replace(/"/g, '""')}"`,
            `"${(lead.website || '').replace(/"/g, '""')}"`,
            `"${(lead.address || '').replace(/"/g, '""')}"`,
            `"${(lead.rating || '').replace(/"/g, '""')}"`,
            `"${(lead.reviews || '').replace(/"/g, '""')}"`,
            `"${(lead.category || '').replace(/"/g, '""')}"`,
            `"${(lead.link || '').replace(/"/g, '""')}"`
        ]);
        return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    }

    function downloadCSV(content, filename) {
        chrome.runtime.sendMessage({
            action: 'download_csv',
            content: content,
            filename: filename
        }, (response) => {
            if (response && response.success) {
                addLog(`CSV saved as: ${filename}`, 'success');
            } else {
                console.error("CSV Download failed", response);
                alert('Download failed. Make sure the background script is active and you accepted the prompt.');
            }
        });
    }

    function downloadPDF(data, filename) {
        if (!window.jspdf || !window.jspdf.jsPDF) {
            alert('PDF library not loaded.');
            return;
        }
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        const finishPDF = () => {
            // Helper to strip complex unicode that breaks standard PDF fonts
            const cleanPDFText = (txt) => {
                if (!txt) return 'N/A';
                return txt.replace(/[^\x00-\xFF]/g, '').trim() || 'N/A'; 
            };
            
            const head = [['Name', 'Category', 'Phone', 'Website', 'Rating', 'Reviews']];
            const body = data.map(lead => [
                cleanPDFText(lead.name),
                cleanPDFText(lead.category),
                cleanPDFText(lead.phone),
                cleanPDFText(lead.website),
                cleanPDFText(lead.rating),
                cleanPDFText(lead.reviews)
            ]);
            
            if (doc.autoTable) {
                doc.autoTable({
                    head: head,
                    body: body,
                    startY: 23,
                    styles: { fontSize: 7, cellPadding: 2, overflow: 'linebreak' },
                    headStyles: { fillColor: [66, 133, 244] },
                    columnStyles: {
                        0: { cellWidth: 35 },  // Name
                        1: { cellWidth: 25 },  // Category
                        2: { cellWidth: 30 },  // Phone
                        3: { cellWidth: 50 }   // Website
                    }
                });
            }
            
            doc.save(filename);
            addLog(`PDF saved as: ${filename}`, 'success');
        };

        const img = new Image();
        img.src = 'logo.png';
        img.onload = () => {
            doc.addImage(img, 'PNG', 14, 8, 12, 12);
            doc.setFontSize(14);
            doc.text("Google Maps Extraction Report - By Kifal", 30, 16);
            finishPDF();
        };
        img.onerror = () => {
            doc.setFontSize(14);
            doc.text("Google Maps Extraction Report - By Kifal", 14, 15);
            finishPDF();
        };
    }
});
