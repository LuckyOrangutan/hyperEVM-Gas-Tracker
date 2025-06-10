# HyperEVM Gas Tracker - Consolidated Change Log

## [Date: 2025-01-10] - Add Gas Units Tracking and RPC Fallback

### Changes Made:
- **Gas Units Tracking:**
  - Added tracking of total gas units used (separate from gas fees)
  - Now displays both gas units (like Hyperscan's "Gas used" field) and gas fees in HYPE
  - Added average gas price calculation based on actual usage
  - Enhanced UI to show gas units used and average gas price per transaction

- **RPC Fallback System:**
  - Added RPC-based transaction scanning as fallback when Hyperscan API is unavailable
  - Scans recent blocks directly via HyperEVM RPC for transaction history
  - Dual-method approach: Hyperscan API first, then RPC scanning

- **Gas Price Tracker Improvements:**
  - Fixed gas prices showing identical values by analyzing last 10 blocks instead of just 1
  - Improved percentile calculations for low/average/high gas prices
  - Added minimum variation logic to ensure meaningful price differences

- **UI Text Updates and Donation Address Change:**
  - Updated donation wallet address to 0xB7b18dCEe32677F673620fa115BC572De3ddB591
  - Changed tagline to "Find your total hype gas usage"
  - Changed loading message to "Searching transactions..."

### Technical Details:
- Gas tracker now provides both metrics: total gas units used (comparable to Hyperscan) and total fees paid
- RPC scanning analyzes last 10,000 blocks in chunks with rate limiting
- Improved error handling with fallback systems for better reliability
- Enhanced response format with gasUnitsUsed, totalGasUnits, and averageGasPrice fields

### Files Modified:
- api/gas-tracker.js (added gas units tracking and RPC fallback)
- api/gas-prices.js (multi-block analysis and better percentile calculations)
- public/script.js (donation address, loading message, and new field display)
- public/index.html (tagline text and new result fields)

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