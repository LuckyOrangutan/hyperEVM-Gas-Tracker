export default async function handler(req, res) {
    console.log('=== EFFICIENT SCAN REQUEST ===');
    console.log('Method:', req.method);
    console.log('Body:', req.body);
    console.log('==============================');
    
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        if (!req.body) {
            return res.status(400).json({ error: 'Request body is required' });
        }
        
        const { address } = req.body;
        console.log('Efficient scan for address:', address);
        
        if (!address || !isValidAddress(address)) {
            return res.status(400).json({ error: 'Invalid address provided' });
        }
        
        console.log(`Starting efficient scan using Blockscout API for address: ${address}`);
        
        let allTransactions = [];
        let totalGas = 0;
        let page = 1;
        const limit = 50; // Blockscout default limit
        
        // Fetch all transactions using pagination
        while (true) {
            console.log(`Fetching page ${page}...`);
            
            const url = `https://www.hyperscan.com/api/v2/addresses/${address}/transactions?page=${page}&limit=${limit}`;
            
            try {
                const response = await fetch(url, {
                    headers: {
                        'Accept': 'application/json',
                        'User-Agent': 'HyperEVM-Gas-Tracker/1.0'
                    },
                    timeout: 10000
                });
                
                if (!response.ok) {
                    throw new Error(`Blockscout API returned ${response.status}: ${response.statusText}`);
                }
                
                const data = await response.json();
                console.log(`Page ${page}: Found ${data.items?.length || 0} transactions`);
                
                if (!data.items || data.items.length === 0) {
                    console.log('No more transactions found, stopping pagination');
                    break;
                }
                
                // Process transactions from this page
                for (const tx of data.items) {
                    // Only count transactions where this address is the sender (from)
                    if (tx.from && tx.from.hash && tx.from.hash.toLowerCase() === address.toLowerCase()) {
                        const gasUsed = parseInt(tx.gas_used || '0');
                        const gasPrice = parseInt(tx.gas_price || '0');
                        
                        // Calculate actual gas cost: gas_used * gas_price (in wei)
                        const gasCostWei = gasUsed * gasPrice;
                        
                        // Convert from wei to HYPE (1 HYPE = 10^18 wei)
                        const gasCostHype = gasCostWei / Math.pow(10, 18);
                        
                        totalGas += gasCostHype;
                        allTransactions.push({
                            hash: tx.hash,
                            gasUsed: gasUsed,
                            gasPrice: gasPrice,
                            gasCostWei: gasCostWei,
                            gasCostHype: gasCostHype,
                            timestamp: tx.timestamp,
                            value: tx.value,
                            to: tx.to?.hash,
                            method: tx.method
                        });
                    }
                }
                
                // Check if we've got all transactions
                if (data.items.length < limit) {
                    console.log('Reached end of transactions (partial page)');
                    break;
                }
                
                page++;
                
                // Add small delay between requests to be respectful
                await new Promise(resolve => setTimeout(resolve, 200));
                
                // Safety limit to prevent infinite loops
                if (page > 1000) {
                    console.log('Reached safety limit of 1000 pages');
                    break;
                }
                
            } catch (fetchError) {
                console.error(`Error fetching page ${page}:`, fetchError.message);
                
                // If it's the first page, this is a critical error
                if (page === 1) {
                    throw new Error(`Failed to fetch transaction data: ${fetchError.message}`);
                }
                
                // For subsequent pages, we can continue with what we have
                console.log(`Stopping pagination due to error on page ${page}`);
                break;
            }
        }
        
        console.log(`Efficient scan complete! Found ${allTransactions.length} transactions with total gas cost: ${totalGas} HYPE`);
        
        res.json({
            totalGas: totalGas.toFixed(6), // Round to 6 decimal places for readability
            transactionCount: allTransactions.length,
            scanType: 'efficient',
            method: 'Blockscout API',
            note: `Scanned all transactions directly via Blockscout API. Gas cost = gas_used × gas_price converted from wei to HYPE.`,
            pagesScanned: page - 1,
            // Include some recent transaction details for verification
            recentTransactions: allTransactions.slice(0, 5).map(tx => ({
                hash: tx.hash,
                gasUsed: tx.gasUsed,
                gasPrice: tx.gasPrice,
                gasCostHype: tx.gasCostHype.toFixed(6),
                timestamp: tx.timestamp,
                method: tx.method
            }))
        });
        
    } catch (error) {
        console.error('=== ERROR IN EFFICIENT SCAN ===');
        console.error('Error:', error);
        console.error('===============================');
        
        let errorMessage = 'Failed to scan transactions efficiently';
        let statusCode = 500;
        
        if (error.message) {
            errorMessage = error.message;
            
            if (error.message.includes('timeout') || error.message.includes('Timeout')) {
                errorMessage = 'Request timed out while fetching transaction data.';
                statusCode = 408;
            } else if (error.message.includes('404') || error.message.includes('Not Found')) {
                errorMessage = 'Address not found or has no transactions.';
                statusCode = 404;
            } else if (error.message.includes('429') || error.message.includes('rate limit')) {
                errorMessage = 'Rate limited by Blockscout API. Please try again later.';
                statusCode = 429;
            }
        }
        
        return res.status(statusCode).json({ 
            error: errorMessage,
            code: error.code || 'UNKNOWN_ERROR'
        });
    }
}

function isValidAddress(address) {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
}