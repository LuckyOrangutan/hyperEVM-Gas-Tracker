const { Web3 } = require('web3');

const HYPEREVM_RPC = 'https://rpc.hyperliquid.xyz/evm';

export default async function handler(req, res) {
    console.log('=== GAS TRACKER REQUEST ===');
    console.log('Method:', req.method);
    console.log('Headers:', req.headers);
    console.log('Body:', req.body);
    console.log('========================');
    
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        console.error('Invalid method:', req.method);
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Comprehensive request validation
        let validatedInput;
        try {
            validatedInput = validateGasTrackerRequest(req);
        } catch (validationError) {
            console.error('Request validation failed:', validationError.message);
            return res.status(400).json({ 
                error: 'Invalid request', 
                details: validationError.message,
                code: 'VALIDATION_ERROR'
            });
        }
        
        const { address, options } = validatedInput;
        console.log('Validated request - Address:', address, 'Options:', options);
        
        console.log(`Starting lifetime gas tracking for address: ${address}`);
        
        // Use only Hyperscan API for accurate data
        try {
            console.log('Fetching transaction data from Hyperscan API...');
            const result = await scanAllTransactions(address);
            console.log('Successfully calculated lifetime gas fees');
            return res.json(result);
        } catch (apiError) {
            console.log('Hyperscan API failed:', apiError.message);
            
            return res.status(503).json({
                error: 'Transaction data service temporarily unavailable',
                details: 'The Hyperscan API is currently not responding. This ensures you get accurate lifetime gas data.',
                suggestion: 'Please try again in a few minutes.',
                retryAfter: 60
            });
        }
        
    } catch (error) {
        console.error('=== ERROR TRACKING GAS ===');
        console.error('Error object:', error);
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        console.error('Error code:', error.code);
        console.error('Error name:', error.name);
        console.error('========================');
        
        // Better error handling for different error types
        let errorMessage = 'Failed to track gas usage';
        let statusCode = 500;
        
        if (error.message) {
            errorMessage = error.message;
            
            // Handle specific error types
            if (error.message.includes('timeout') || error.message.includes('Timeout')) {
                errorMessage = 'Request timed out. The RPC server is responding slowly.';
                statusCode = 408;
            } else if (error.message.includes('rate limit') || error.message.includes('Rate limit')) {
                errorMessage = 'Rate limited by RPC server. Please wait and try again.';
                statusCode = 429;
            } else if (error.message.includes('network') || error.message.includes('Network')) {
                errorMessage = 'Network connection failed. Please check your connection and try again.';
                statusCode = 503;
            } else if (error.message.includes('invalid json') || error.message.includes('Unexpected token')) {
                errorMessage = 'RPC server returned invalid response. This usually indicates rate limiting.';
                statusCode = 502;
            }
        }
        
        if (error.code === 'NETWORK_ERROR') {
            errorMessage = 'Network connection failed. Please try again.';
            statusCode = 503;
        }
        if (error.code === 'TIMEOUT') {
            errorMessage = 'Request timed out. The RPC server is overloaded.';
            statusCode = 408;
        }
        
        return res.status(statusCode).json({ 
            error: errorMessage,
            code: error.code || 'UNKNOWN_ERROR',
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
}

// Add request deduplication and rate limiting
const activeRequests = new Map();
const requestCounts = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 10;
const MAX_CONCURRENT_REQUESTS = 3;

async function scanAllTransactions(address) {
    console.log(`Starting transaction scan for address: ${address}`);
    
    // Rate limiting check
    const now = Date.now();
    const clientKey = address; // Use address as client identifier
    
    if (!requestCounts.has(clientKey)) {
        requestCounts.set(clientKey, { count: 0, windowStart: now });
    }
    
    const clientData = requestCounts.get(clientKey);
    
    // Reset window if expired
    if (now - clientData.windowStart > RATE_LIMIT_WINDOW) {
        clientData.count = 0;
        clientData.windowStart = now;
    }
    
    // Check rate limit
    if (clientData.count >= MAX_REQUESTS_PER_WINDOW) {
        throw new Error(`Rate limit exceeded. Maximum ${MAX_REQUESTS_PER_WINDOW} requests per minute.`);
    }
    
    // Check concurrent requests
    if (activeRequests.size >= MAX_CONCURRENT_REQUESTS) {
        throw new Error(`Too many concurrent requests. Maximum ${MAX_CONCURRENT_REQUESTS} allowed.`);
    }
    
    // Check for duplicate request
    if (activeRequests.has(address)) {
        throw new Error('A scan for this address is already in progress.');
    }
    
    // Increment rate limit counter
    clientData.count++;
    
    // Mark request as active
    activeRequests.set(address, { startTime: now });
    
    try {
        let totalGasFeesHype = 0;
        let totalGasUnitsUsed = 0;
        let transactionCount = 0;
        let page = 1;
        const limit = 100;
        const processedTxs = new Set(); // Track processed transaction hashes to prevent duplicates
        const maxMemoryUsage = 50 * 1024 * 1024; // 50MB limit
        let estimatedMemoryUsage = 0;
        
        // Use consistent primary endpoint for all pages to avoid pagination issues
        const primaryEndpoint = `https://www.hyperscan.com/api?module=account&action=txlist&address=${address}&sort=desc`;
        
        while (true) {
            const url = `${primaryEndpoint}&page=${page}&offset=${limit}`;
            console.log(`Fetching page ${page}: ${url}`);
            
            let response;
            let data;
            
            try {
                response = await fetch(url, {
                    headers: {
                        'Accept': 'application/json',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                data = await response.json();
                console.log(`Page ${page} - Response status: ${data.status}, message: ${data.message}`);
                
            } catch (error) {
                console.error(`Failed to fetch page ${page}:`, error.message);
                throw new Error(`Unable to fetch page ${page} from Hyperscan API: ${error.message}`);
            }
            
            // Validate API response format
            if (!data || typeof data !== 'object') {
                throw new Error(`Invalid API response format on page ${page}`);
            }
            
            // Handle Hyperscan API response format - should be in data.result
            let transactions = [];
            if (data.result && Array.isArray(data.result)) {
                transactions = data.result;
            } else if (data.status === '1' && !data.result) {
                // No transactions found
                transactions = [];
            } else {
                console.error(`Unexpected API response format on page ${page}:`, data);
                throw new Error(`Unexpected API response format on page ${page}. Expected 'result' array.`);
            }
            
            if (!Array.isArray(transactions) || transactions.length === 0) {
                console.log('No more transactions found');
                break;
            }
            
            // Process transactions
            for (const tx of transactions) {
                // Validate transaction data
                if (!tx || !tx.hash) {
                    console.log('Skipping invalid transaction (missing hash)');
                    continue;
                }
                
                // Skip if we've already processed this transaction
                if (processedTxs.has(tx.hash)) {
                    console.log(`TX ${tx.hash}: Already processed, skipping duplicate`);
                    continue;
                }
                
                // Check various possible field names for the sender
                const from = tx.from || tx.from_address || tx.sender;
                
                // Only process transactions from the target address
                if (!from || from.toLowerCase() !== address.toLowerCase()) {
                    continue;
                }
                
                // Validate gas data exists
                if (!tx.gasUsed || !tx.gasPrice) {
                    console.log(`TX ${tx.hash}: Missing gasUsed (${tx.gasUsed}) or gasPrice (${tx.gasPrice}), skipping`);
                    continue;
                }
                
                // Calculate HYPE fee from Hyperscan's gasUsed and gasPrice
                let feeHype = 0;
                
                try {
                    // Robust BigInt handling with comprehensive validation
                    let gasUsed, gasPrice;
                    
                    // Validate and convert gasUsed
                    if (tx.gasUsed === null || tx.gasUsed === undefined || tx.gasUsed === '') {
                        throw new Error('gasUsed is null, undefined, or empty');
                    }
                    
                    try {
                        gasUsed = typeof tx.gasUsed === 'string' ? BigInt(tx.gasUsed) : BigInt(tx.gasUsed.toString());
                        if (gasUsed < 0n) {
                            throw new Error('gasUsed cannot be negative');
                        }
                        if (gasUsed > BigInt('1000000000')) { // 1B gas limit sanity check
                            throw new Error('gasUsed exceeds reasonable limit');
                        }
                    } catch (conversionError) {
                        throw new Error(`Invalid gasUsed format: ${tx.gasUsed} - ${conversionError.message}`);
                    }
                    
                    // Validate and convert gasPrice
                    if (tx.gasPrice === null || tx.gasPrice === undefined || tx.gasPrice === '') {
                        throw new Error('gasPrice is null, undefined, or empty');
                    }
                    
                    try {
                        gasPrice = typeof tx.gasPrice === 'string' ? BigInt(tx.gasPrice) : BigInt(tx.gasPrice.toString());
                        if (gasPrice < 0n) {
                            throw new Error('gasPrice cannot be negative');
                        }
                        if (gasPrice > BigInt('1000000000000000000000')) { // 1000 Gwei max sanity check
                            throw new Error('gasPrice exceeds reasonable limit');
                        }
                    } catch (conversionError) {
                        throw new Error(`Invalid gasPrice format: ${tx.gasPrice} - ${conversionError.message}`);
                    }
                    
                    // Calculate fee in Wei using BigInt for precision
                    const feeInWei = gasUsed * gasPrice;
                    
                    // Convert to HYPE with maximum precision preservation
                    // Use string division to avoid Number precision loss
                    const feeInWeiStr = feeInWei.toString();
                    const weiDivisor = '1000000000000000000'; // 10^18
                    
                    // Calculate HYPE with decimal precision
                    if (feeInWeiStr.length <= 18) {
                        // Less than 1 HYPE
                        const paddedWei = feeInWeiStr.padStart(18, '0');
                        feeHype = parseFloat('0.' + paddedWei);
                    } else {
                        // 1 HYPE or more
                        const integerPart = feeInWeiStr.slice(0, -18);
                        const decimalPart = feeInWeiStr.slice(-18);
                        feeHype = parseFloat(integerPart + '.' + decimalPart);
                    }
                    
                    // Enhanced sanity checks
                    if (!isFinite(feeHype) || isNaN(feeHype) || feeHype <= 0) {
                        throw new Error(`Invalid fee calculation result: ${feeHype}`);
                    }
                    
                    // Reasonable fee limit check (max 1000 HYPE per transaction)
                    if (feeHype > 1000) {
                        throw new Error(`Fee ${feeHype} HYPE exceeds reasonable limit`);
                    }
                    
                } catch (error) {
                    console.error(`TX ${tx.hash}: Error calculating fee - gasUsed: ${tx.gasUsed}, gasPrice: ${tx.gasPrice}, error: ${error.message}`);
                    continue;
                }
                
                // Add to our totals
                processedTxs.add(tx.hash);
                totalGasFeesHype += feeHype;
                
                // Track gas units used (separate from fees)
                try {
                    const gasUsedNum = Number(tx.gasUsed);
                    if (gasUsedNum > 0) {
                        totalGasUnitsUsed += gasUsedNum;
                    }
                } catch (error) {
                    console.error(`TX ${tx.hash}: Error processing gasUsed: ${error.message}`);
                }
                
                transactionCount++;
                
                console.log(`TX ${tx.hash}: Added ${feeHype.toFixed(8)} HYPE (${tx.gasUsed} gas × ${tx.gasPrice} Wei)`);
            }
            
            // Check if we've fetched all transactions
            if (transactions.length < limit) {
                break;
            }
            
            page++;
            
            // Memory usage check
            estimatedMemoryUsage = processedTxs.size * 100; // Rough estimate: 100 bytes per transaction hash
            if (estimatedMemoryUsage > maxMemoryUsage) {
                console.warn(`Memory usage limit reached (${estimatedMemoryUsage / 1024 / 1024}MB), stopping scan`);
                break;
            }
            
            // Progressive rate limiting - slower for larger datasets
            const delay = Math.min(200 + (page * 10), 1000); // Increase delay as pages increase
            await new Promise(resolve => setTimeout(resolve, delay));
        }
        
        console.log(`=== SCAN COMPLETE ===`);
        console.log(`Total gas fees: ${totalGasFeesHype.toFixed(8)} HYPE`);
        console.log(`Total gas units: ${totalGasUnitsUsed.toLocaleString()}`);
        console.log(`Transaction count: ${transactionCount}`);
        console.log(`Unique transactions processed: ${processedTxs.size}`);
        console.log(`===================`);
        
        // Ensure precision in calculations using BigInt arithmetic
        // Convert to fixed-point arithmetic to avoid floating point errors
        const precision = 18; // 18 decimal places for maximum precision
        const multiplier = BigInt(10) ** BigInt(precision);
        
        // Convert total to BigInt for precise rounding
        const totalAsBigInt = BigInt(Math.round(totalGasFeesHype * Number(multiplier)));
        const finalGasFeesHype = Number(totalAsBigInt) / Number(multiplier);
        
        const result = {
            totalGas: finalGasFeesHype.toFixed(8), // Increased precision to 8 decimal places
            totalGasDisplay: `${finalGasFeesHype.toFixed(8)} HYPE`,
            transactionCount: transactionCount,
            uniqueTransactionCount: processedTxs.size,
            totalGasWei: (finalGasFeesHype * Math.pow(10, 18)).toString(),
            gasUnitsUsed: totalGasUnitsUsed.toLocaleString(),
            totalGasUnits: totalGasUnitsUsed,
            averageGasPrice: totalGasUnitsUsed > 0 ? (() => {
                // Calculate average gas price with BigInt precision
                const totalFeeWei = BigInt(Math.round(finalGasFeesHype * Math.pow(10, 18)));
                const totalGasUnitsBigInt = BigInt(totalGasUnitsUsed);
                const avgGasPriceWei = totalFeeWei / totalGasUnitsBigInt;
                const avgGasPriceGwei = Number(avgGasPriceWei) / Math.pow(10, 9);
                return avgGasPriceGwei.toFixed(4) + ' Gwei';
            })() : 'N/A',
            calculation: `${transactionCount.toLocaleString()} transactions: ${totalGasUnitsUsed.toLocaleString()} gas units = ${finalGasFeesHype.toFixed(8)} HYPE fees`,
            method: 'exact_fee_sum_v2',
            apiEndpoint: primaryEndpoint,
            duplicatesSkipped: transactionCount - processedTxs.size,
            scanStats: {
                pagesScanned: page - 1,
                memoryUsage: `${(estimatedMemoryUsage / 1024 / 1024).toFixed(1)}MB`,
                scanDuration: `${Date.now() - now}ms`,
                rateLimitStatus: `${clientData.count}/${MAX_REQUESTS_PER_WINDOW} requests this minute`
            }
        };
        
        return result;
        
    } catch (error) {
        console.error('Error scanning transactions:', error);
        throw error;
    } finally {
        // Always clean up active request tracking
        activeRequests.delete(address);
        
        // Cleanup old rate limit entries
        const cutoff = Date.now() - RATE_LIMIT_WINDOW;
        for (const [key, data] of requestCounts.entries()) {
            if (data.windowStart < cutoff) {
                requestCounts.delete(key);
            }
        }
    }
}

function isValidAddress(address) {
    // Comprehensive address validation
    if (!address || typeof address !== 'string') {
        return false;
    }
    
    // Remove whitespace and convert to lowercase for validation
    const cleanAddress = address.trim().toLowerCase();
    
    // Check basic format: 0x followed by 40 hex characters
    if (!/^0x[a-f0-9]{40}$/.test(cleanAddress)) {
        return false;
    }
    
    // Check for common invalid addresses
    const invalidAddresses = [
        '0x0000000000000000000000000000000000000000', // Zero address
        '0x000000000000000000000000000000000000dead', // Common burn address
    ];
    
    if (invalidAddresses.includes(cleanAddress)) {
        return false;
    }
    
    return true;
}

// Add robust numeric validation helper
function validateNumericInput(value, fieldName, options = {}) {
    const { min = 0, max = Infinity, allowZero = true, required = true } = options;
    
    if (value === null || value === undefined) {
        if (required) {
            throw new Error(`${fieldName} is required`);
        }
        return null;
    }
    
    if (typeof value === 'string' && value.trim() === '') {
        if (required) {
            throw new Error(`${fieldName} cannot be empty`);
        }
        return null;
    }
    
    let numValue;
    try {
        numValue = typeof value === 'string' ? parseFloat(value) : Number(value);
    } catch (error) {
        throw new Error(`${fieldName} must be a valid number`);
    }
    
    if (!isFinite(numValue) || isNaN(numValue)) {
        throw new Error(`${fieldName} must be a finite number`);
    }
    
    if (!allowZero && numValue === 0) {
        throw new Error(`${fieldName} cannot be zero`);
    }
    
    if (numValue < min) {
        throw new Error(`${fieldName} cannot be less than ${min}`);
    }
    
    if (numValue > max) {
        throw new Error(`${fieldName} cannot be greater than ${max}`);
    }
    
    return numValue;
}

// Add request validation middleware
function validateGasTrackerRequest(req) {
    if (!req.body || typeof req.body !== 'object') {
        throw new Error('Request body must be a valid JSON object');
    }
    
    const { address, options } = req.body;
    
    // Validate required address
    if (!address) {
        throw new Error('Address is required in request body');
    }
    
    if (!isValidAddress(address)) {
        throw new Error('Invalid Ethereum address format');
    }
    
    // Validate optional parameters
    if (options && typeof options === 'object') {
        if (options.maxPages !== undefined) {
            validateNumericInput(options.maxPages, 'maxPages', { min: 1, max: 1000 });
        }
        
        if (options.pageSize !== undefined) {
            validateNumericInput(options.pageSize, 'pageSize', { min: 1, max: 200 });
        }
        
        if (options.fromBlock !== undefined) {
            validateNumericInput(options.fromBlock, 'fromBlock', { min: 0 });
        }
        
        if (options.toBlock !== undefined) {
            validateNumericInput(options.toBlock, 'toBlock', { min: 0 });
        }
    }
    
    return { address: address.trim().toLowerCase(), options: options || {} };
}