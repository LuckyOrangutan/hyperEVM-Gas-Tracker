# HyperEVM Gas Tracker

A smart web application to track total HYPE gas burnt for any HyperEVM address with automatic fallback systems.

## Features

- 🚀 **Complete Lifetime Data Only**: Uses Blockscout API for comprehensive transaction history
- ⚡ **Lightning Fast**: 5-15 seconds for complete lifetime gas history
- 💰 **Accurate Gas Costs**: Real HYPE amounts (gas_used × gas_price ÷ 10^18)
- 🔄 **Automatic Retry Logic**: Handles API failures gracefully with exponential backoff
- 🎯 **Single-Click Operation**: One button does everything intelligently
- 📱 **Responsive UI**: Clean interface that works on all devices

## Usage

1. Visit the deployed app
2. Enter a valid HyperEVM address (starts with 0x)
3. Click "Track Lifetime Gas ⚡"
4. Get complete gas usage history automatically

## How It Works

### Lifetime-Only Design:
1. **Complete Data Only**: Uses Blockscout API to scan ALL transactions from genesis
2. **No Partial Results**: Refuses to return incomplete recent-block data
3. **Clear Failure**: If API unavailable, clearly explains why complete data isn't available
4. **Auto-retry**: 3 attempts per API request with exponential backoff

### Gas Calculation:
- Fetches all transactions where address is sender
- Calculates: `gas_used × gas_price` for each transaction
- Converts wei to HYPE: `total_wei ÷ 10^18`
- Returns real HYPE cost, not inflated gas units

## Local Development

```bash
npm install
npm run dev
```

Open http://localhost:3000 to view the app.

## Deployment

Optimized for Vercel serverless deployment:

```bash
vercel
```

## API Endpoints

- `/api/gas-tracker` - Smart gas tracking with automatic fallback
- `/api/efficient-scan` - Direct Blockscout API scanning
- `/api/lifetime-scan` - Legacy chunked block scanning

## Tech Stack

- **Frontend**: Vanilla HTML/CSS/JavaScript
- **Backend**: Vercel serverless functions  
- **Data Source**: Blockscout API (hyperscan.com) for complete transaction history
- **Network**: HyperEVM Mainnet (Chain ID: 999)