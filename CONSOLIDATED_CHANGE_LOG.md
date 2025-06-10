# HyperEVM Gas Tracker - Consolidated Change Log

## [Date: 2025-01-10] - UI Text Updates and Donation Address Change

### Changes Made:
- Updated donation wallet address to 0xB7b18dCEe32677F673620fa115BC572De3ddB591
- Changed tagline from "Get your complete lifetime HYPE gas usage across all HyperEVM transactions" to "Find your total hype gas usage"
- Changed loading message from "Fetching lifetime gas total (ultra-fast method)..." to "Searching transactions..."

### Files Modified:
- public/script.js (donation address and loading message)
- public/index.html (tagline text)

---

## [Date: 2025-01-10] - Fix Gwei Tracker BigInt Serialization Error

### Changes Made:
- Fixed "Do not know how to serialize a BigInt" error in gas-prices.js endpoint
- Converted BigInt values to strings/numbers before JSON serialization
- Gwei tracker now properly displays low, average, and high gas prices

### Technical Details:
- Converted gasPrice BigInt values to strings before passing to web3.utils.fromWei()
- Converted latestBlock.number BigInt to Number for JSON response
- Applied String() conversion to tx.gasPrice values in transaction loop

### Files Modified:
- api/gas-prices.js (fixed BigInt handling)

---

## [Date: 2025-01-06] - Live Gas Fee Tracking Enhancement

### Changes Made:
- Added live gas fee tracking displaying low, average, and high gas prices
- Implemented Gwei display for gas prices
- Added USD conversion for gas fees
- Enhanced UI for clean presentation of gas metrics
- Integrated real-time updates for gas prices

### Technical Details:
- Created new api/gas-prices.js endpoint to fetch current gas prices from HyperEVM RPC
- Analyzes recent block transactions to calculate low (10th percentile), average (50th percentile), and high (90th percentile) gas prices
- USD conversion based on standard transaction (21,000 gas units) with $30/HYPE price
- Frontend fetches and displays gas prices on page load and auto-refreshes every 10 seconds
- Responsive design with grid layout for desktop and stacked layout for mobile

### Files Modified:
- api/gas-prices.js (new file)
- public/index.html
- public/script.js
- public/style.css

### UI Features:
- Clean card-based design with color-coded indicators (green/yellow/red)
- Shows both Gwei amount and USD estimate for each tier
- Live refresh indicator with timestamp
- Fully responsive for all device sizes

---

## Previous Updates (from git log):
- 93bbc60: Add donation button with confetti animation
- c7fe308: Make UI fully responsive for all devices
- 45ebb93: Use correct Hyperscan Blockscout API endpoint
- 3d7e311: Remove estimation fallback - require exact gas calculation only
- bafc768: Add RPC fallback when Hyperscan API is unavailable