async function trackGas() {
    const address = document.getElementById('addressInput').value.trim();
    const loadingDiv = document.getElementById('loading');
    const resultsDiv = document.getElementById('results');
    const errorDiv = document.getElementById('error');
    
    // Hide previous results
    resultsDiv.classList.add('hidden');
    errorDiv.classList.add('hidden');
    
    // Validate address
    if (!address) {
        showError('Please enter an address');
        return;
    }
    
    if (!isValidAddress(address)) {
        showError('Please enter a valid HyperEVM address (must start with 0x and be 42 characters long)');
        return;
    }
    
    // Get scan type
    const scanType = document.querySelector('input[name="scanType"]:checked').value;
    const fullHistory = scanType === 'full';
    
    // Show loading with appropriate message
    const loadingMessage = 'Scanning recent 1,000 blocks... This should take 10-30 seconds.';
    loadingDiv.textContent = loadingMessage;
    loadingDiv.classList.remove('hidden');
    
    try {
        const response = await fetch('/api/gas-tracker', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ address, fullHistory })
        });
        
        if (!response.ok) {
            let errorData;
            try {
                errorData = await response.json();
            } catch (parseError) {
                console.error('Failed to parse error response:', parseError);
                throw new Error(`Server returned ${response.status}: ${response.statusText}`);
            }
            
            console.error('Server error response:', errorData);
            throw new Error(errorData.error || `Server error ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('Received data:', data);
        displayResults(address, data);
    } catch (error) {
        console.error('Frontend error:', error);
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        
        let errorMessage = error.message;
        if (error.message.includes('timeout') || error.message.includes('Timeout')) {
            errorMessage = 'Request timed out. The server is taking too long to respond.';
        } else if (error.message.includes('NetworkError') || error.message.includes('Failed to fetch')) {
            errorMessage = 'Network error. Please check your connection and try again.';
        }
        showError('Error fetching gas data: ' + errorMessage);
    } finally {
        loadingDiv.classList.add('hidden');
    }
}

function isValidAddress(address) {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
}

function displayResults(address, data) {
    document.getElementById('resultAddress').textContent = address;
    document.getElementById('totalGas').textContent = formatNumber(data.totalGas) + ' HYPE';
    document.getElementById('txCount').textContent = formatNumber(data.transactionCount);
    document.getElementById('blocksScanned').textContent = formatNumber(data.blocksScanned);
    document.getElementById('scanType').textContent = data.scanType === 'full' ? 'Full History' : 'Recent Blocks';
    
    document.getElementById('results').classList.remove('hidden');
}

function showError(message) {
    document.getElementById('error').textContent = message;
    document.getElementById('error').classList.remove('hidden');
}

function formatNumber(num) {
    return new Intl.NumberFormat().format(num);
}

// Allow Enter key to trigger search
document.getElementById('addressInput').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        trackGas();
    }
});