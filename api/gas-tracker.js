const { Web3 } = require('web3');

const HYPEREVM_RPC = 'https://rpc.hyperliquid.xyz/evm';

export default async function handler(req, res) {
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
        const { address } = req.body;
        
        if (!address || !isValidAddress(address)) {
            return res.status(400).json({ error: 'Invalid address provided' });
        }
        
        console.log(`Tracking gas for address: ${address}`);
        
        const web3 = new Web3(HYPEREVM_RPC);
        
        // Get the latest block number
        const latestBlock = await web3.eth.getBlockNumber();
        console.log(`Latest block: ${latestBlock}`);
        
        let totalGas = 0;
        let transactionCount = 0;
        
        // Scan recent blocks (last 10000 blocks on mainnet)
        const startBlock = Math.max(0, Number(latestBlock) - 10000);
        const batchSize = 100; // Smaller batches for serverless
        
        for (let i = startBlock; i <= latestBlock; i += batchSize) {
            const endBlock = Math.min(i + batchSize - 1, Number(latestBlock));
            console.log(`Processing blocks ${i} to ${endBlock}`);
            
            const batchPromises = [];
            for (let blockNum = i; blockNum <= endBlock; blockNum++) {
                batchPromises.push(processBlock(web3, blockNum, address));
            }
            
            const batchResults = await Promise.allSettled(batchPromises);
            
            for (const result of batchResults) {
                if (result.status === 'fulfilled') {
                    totalGas += result.value.gas;
                    transactionCount += result.value.count;
                }
            }
        }
        
        console.log(`Total gas found: ${totalGas}, Transaction count: ${transactionCount}`);
        
        res.json({
            totalGas: totalGas.toString(),
            transactionCount,
            blocksScanned: Number(latestBlock) - startBlock + 1
        });
        
    } catch (error) {
        console.error('Error tracking gas:', error);
        res.status(500).json({ error: 'Failed to track gas usage: ' + error.message });
    }
}

async function processBlock(web3, blockNumber, targetAddress) {
    try {
        const block = await web3.eth.getBlock(blockNumber, true);
        
        if (!block || !block.transactions) {
            return { gas: 0, count: 0 };
        }
        
        let totalGas = 0;
        let count = 0;
        
        for (const tx of block.transactions) {
            if (tx.from && tx.from.toLowerCase() === targetAddress.toLowerCase()) {
                // Get transaction receipt to get actual gas used
                try {
                    const receipt = await web3.eth.getTransactionReceipt(tx.hash);
                    if (receipt) {
                        totalGas += Number(receipt.gasUsed);
                        count++;
                    }
                } catch (receiptError) {
                    console.error(`Error getting receipt for tx ${tx.hash}:`, receiptError);
                }
            }
        }
        
        return { gas: totalGas, count };
    } catch (error) {
        console.error(`Error processing block ${blockNumber}:`, error);
        return { gas: 0, count: 0 };
    }
}

function isValidAddress(address) {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
}