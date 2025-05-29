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
    
    // Show loading
    loadingDiv.classList.remove('hidden');
    
    try {
        const response = await fetch('/api/gas-tracker', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ address })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Failed to fetch gas data');
        }
        
        displayResults(address, data);
    } catch (error) {
        showError('Error fetching gas data: ' + error.message);
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