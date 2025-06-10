// Live HYPE Price Management
let priceUpdateInterval;
let lastPriceUpdate = 0;

// Initialize price widget on page load
document.addEventListener('DOMContentLoaded', function() {
    initializePriceWidget();
    loadGasPrices(); // Load gas prices on startup
});

async function initializePriceWidget() {
    await updateLivePrice();
    
    // Update every 10 seconds
    priceUpdateInterval = setInterval(updateLivePrice, 10000);
    
    // Add click handler for manual refresh
    const priceWidget = document.getElementById('priceWidget');
    if (priceWidget) {
        priceWidget.addEventListener('click', function() {
            updateLivePrice(true); // Force refresh
        });
    }
}

async function updateLivePrice(forceRefresh = false) {
    const priceValue = document.getElementById('livePrice');
    const priceStatus = document.getElementById('priceStatus');
    const priceIndicator = document.getElementById('priceIndicator');
    
    if (!priceValue || !priceStatus || !priceIndicator) return;
    
    // Show loading state
    priceIndicator.className = 'price-indicator loading';
    
    try {
        const cacheBuster = forceRefresh ? `?t=${Date.now()}` : '';
        const response = await fetch(`/api/live-price${cacheBuster}`);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.hype && data.hype.price) {
            priceValue.textContent = data.hype.formatted;
            
            // Update status
            const ageText = data.hype.cached ? 
                (data.hype.age >= 0 ? `${data.hype.age}s ago` : 'cached') : 
                'live';
            priceStatus.textContent = `${data.hype.source} • ${ageText}`;
            
            // Update indicator
            priceIndicator.className = 'price-indicator';
            
            lastPriceUpdate = Date.now();
        } else {
            throw new Error('Invalid price data');
        }
        
    } catch (error) {
        console.error('Price update failed:', error);
        priceStatus.textContent = 'update failed';
        priceIndicator.className = 'price-indicator error';
        
        // Fallback to cached price or default
        if (priceValue.textContent === '$--') {
            priceValue.textContent = '$30.00';
            priceStatus.textContent = 'fallback price';
        }
    }
}

// Stop price updates when page is hidden (saves bandwidth)
document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
        if (priceUpdateInterval) {
            clearInterval(priceUpdateInterval);
        }
    } else {
        // Resume updates when page becomes visible
        if (!priceUpdateInterval) {
            priceUpdateInterval = setInterval(updateLivePrice, 10000);
        }
        // Update immediately if it's been more than 30 seconds
        if (Date.now() - lastPriceUpdate > 30000) {
            updateLivePrice();
        }
    }
});

async function trackGas() {
    const address = document.getElementById('addressInput').value.trim();
    const loadingDiv = document.getElementById('loading');
    const progressDiv = document.getElementById('progress');
    const resultsDiv = document.getElementById('results');
    const errorDiv = document.getElementById('error');
    
    // Hide previous results
    resultsDiv.classList.add('hidden');
    errorDiv.classList.add('hidden');
    progressDiv.classList.add('hidden');
    
    // Validate address
    if (!address) {
        showError('Please enter an address');
        return;
    }
    
    if (!isValidAddress(address)) {
        showError('Please enter a valid HyperEVM address (must start with 0x and be 42 characters long)');
        return;
    }
    
    // Always use the smart gas tracking (API with fallback)
    await performSmartGasTracking(address);
}

async function performSmartGasTracking(address) {
    const loadingDiv = document.getElementById('loading');
    
    const loadingMessage = 'Searching transactions...';
    loadingDiv.textContent = loadingMessage;
    loadingDiv.classList.remove('hidden');
    
    try {
        const response = await fetch('/api/gas-tracker', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ address })
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
        handleError(error);
    } finally {
        loadingDiv.classList.add('hidden');
    }
}

function handleError(error) {
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
}

function isValidAddress(address) {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
}

function displayResults(address, data) {
    // Main gas amount display with higher precision
    const gasAmount = parseFloat(data.totalGas);
    const displayGas = gasAmount >= 0.001 ? gasAmount.toFixed(6) : gasAmount.toFixed(8);
    document.getElementById('totalGasAmount').textContent = `${displayGas} HYPE`;
    
    // Detail rows
    document.getElementById('resultAddress').textContent = address;
    document.getElementById('txCount').textContent = formatNumber(data.transactionCount);
    document.getElementById('gasUnitsUsed').textContent = data.gasUnitsUsed || 'N/A';
    document.getElementById('avgGasPrice').textContent = data.averageGasPrice || 'N/A';
    
    // Calculation explanation
    document.getElementById('calculation').textContent = data.calculation;
    
    // Log detailed info for debugging
    console.log('=== GAS TRACKING RESULT ===');
    console.log('Address:', address);
    console.log('Total Gas:', data.totalGas, 'HYPE');
    console.log('Transaction Count:', data.transactionCount);
    console.log('Unique Transactions:', data.uniqueTransactionCount);
    console.log('Method:', data.method);
    console.log('API Endpoint:', data.apiEndpoint);
    if (data.duplicatesSkipped) {
        console.log('Duplicates Skipped:', data.duplicatesSkipped);
    }
    console.log('==========================');
    
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

// Gas Prices Functionality
async function fetchGasPrices() {
    const refreshIndicator = document.getElementById('refreshIndicator');
    refreshIndicator.classList.add('active');
    
    try {
        const response = await fetch('/api/gas-prices');
        if (!response.ok) {
            throw new Error('Failed to fetch gas prices');
        }
        
        const data = await response.json();
        console.log('Gas prices data:', data);
        
        // Update Gwei values
        document.getElementById('lowGwei').textContent = data.prices.low.gwei;
        document.getElementById('avgGwei').textContent = data.prices.average.gwei;
        document.getElementById('highGwei').textContent = data.prices.high.gwei;
        
        // Update USD values
        document.getElementById('lowUsd').textContent = `$${data.prices.low.usd}`;
        document.getElementById('avgUsd').textContent = `$${data.prices.average.usd}`;
        document.getElementById('highUsd').textContent = `$${data.prices.high.usd}`;
        
        // Update last update time
        const now = new Date();
        const timeString = now.toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit',
            second: '2-digit'
        });
        document.getElementById('lastUpdate').textContent = `Last update: ${timeString}`;
        
    } catch (error) {
        console.error('Error fetching gas prices:', error);
        // Show error state
        document.getElementById('lowGwei').textContent = '--';
        document.getElementById('avgGwei').textContent = '--';
        document.getElementById('highGwei').textContent = '--';
        document.getElementById('lowUsd').textContent = '$--';
        document.getElementById('avgUsd').textContent = '$--';
        document.getElementById('highUsd').textContent = '$--';
    } finally {
        refreshIndicator.classList.remove('active');
    }
}

// Fetch gas prices on page load
fetchGasPrices();

// Auto-refresh gas prices every 10 seconds
setInterval(fetchGasPrices, 10000);

// Donation functionality
const DONATION_ADDRESS = '0xB7b18dCEe32677F673620fa115BC572De3ddB591';

async function copyDonationAddress() {
    try {
        await navigator.clipboard.writeText(DONATION_ADDRESS);
        
        // Change button text temporarily
        const button = document.querySelector('.donation-button');
        const originalHTML = button.innerHTML;
        button.innerHTML = '<span class="donation-icon">✓</span><span class="donation-text">Copied! Thank you!</span>';
        button.classList.add('copied');
        
        // Trigger confetti
        createConfetti();
        
        // Reset button after 3 seconds
        setTimeout(() => {
            button.innerHTML = originalHTML;
            button.classList.remove('copied');
        }, 3000);
    } catch (err) {
        console.error('Failed to copy address:', err);
        alert(`Donation address: ${DONATION_ADDRESS}`);
    }
}

// Confetti animation
function createConfetti() {
    const canvas = document.getElementById('confettiCanvas');
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.display = 'block';
    
    const confettiCount = 150;
    const confetti = [];
    
    // Confetti colors
    const colors = ['#ff0a54', '#ff477e', '#ff7096', '#ff85a1', '#fbb1bd', '#f9bec7', '#7209b7', '#560bad', '#480ca8', '#3a0ca3', '#3f37c9', '#4361ee'];
    
    // Create confetti particles
    for (let i = 0; i < confettiCount; i++) {
        confetti.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height - canvas.height,
            vx: Math.random() * 3 - 1.5,
            vy: Math.random() * 3 + 2,
            size: Math.random() * 8 + 5,
            color: colors[Math.floor(Math.random() * colors.length)],
            angle: Math.random() * 360,
            angularVelocity: Math.random() * 10 - 5
        });
    }
    
    let animationId;
    
    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        let allOffScreen = true;
        
        confetti.forEach(particle => {
            particle.x += particle.vx;
            particle.y += particle.vy;
            particle.vy += 0.1; // Gravity
            particle.angle += particle.angularVelocity;
            
            if (particle.y < canvas.height) {
                allOffScreen = false;
            }
            
            ctx.save();
            ctx.translate(particle.x, particle.y);
            ctx.rotate((particle.angle * Math.PI) / 180);
            ctx.fillStyle = particle.color;
            ctx.fillRect(-particle.size / 2, -particle.size / 2, particle.size, particle.size);
            ctx.restore();
        });
        
        if (!allOffScreen) {
            animationId = requestAnimationFrame(animate);
        } else {
            canvas.style.display = 'none';
            cancelAnimationFrame(animationId);
        }
    }
    
    animate();
}