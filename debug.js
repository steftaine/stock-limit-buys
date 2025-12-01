// State
let currentStock = {
    symbol: '',
    price: 0,
    data: [],
    meta: {}
};

const WATCHLIST = ['NVDA', 'MSFT', 'BTC-USD', 'SMCI', 'META', 'GOOG'];

let chartInstance = null;

// DOM Elements
const elements = {
    // Views
    dashboardView: document.getElementById('dashboardView'),
    detailView: document.getElementById('detailView'),
    dashboardList: document.getElementById('dashboardList'),
    backBtn: document.getElementById('backBtn'),
    logoBtn: document.getElementById('logoBtn'),

    // Search
    search: document.getElementById('stockSearch'),
    searchBtn: document.getElementById('searchBtn'),
    refreshBtn: document.getElementById('refreshBtn'),
    lastUpdated: document.getElementById('lastUpdated'),

    // Detail View Elements
    ticker: document.getElementById('currentTicker'),
    price: document.getElementById('currentPrice'),
    change: document.getElementById('priceChange'),
    levelsList: document.getElementById('levelsList'),
    chartCanvas: document.getElementById('stockChart'),
    rsi: document.getElementById('rsiValue'),
    topSignalValue: document.getElementById('topSignalValue'),
    topSignalStatus: document.getElementById('topSignalStatus'),
    buyQualityValue: document.getElementById('buyQualityValue'),
    buyQualityStatus: document.getElementById('buyQualityStatus'),
    maExtension: document.getElementById('maExtension'),
    volume: document.getElementById('volume')
};

// Technical Indicators
const calculateRSI = (prices, period = 14) => {
    if (!prices || prices.length < period + 1) return null;

    let gains = 0;
    let losses = 0;
    const rsiSeries = [];

    // First RSI
    for (let i = 1; i <= period; i++) {
        const change = prices[i] - prices[i - 1];
        if (change > 0) gains += change;
        else losses -= change;
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    // Push initial nulls for alignment
    for (let i = 0; i < period; i++) rsiSeries.push(null);

    let rs = avgGain / avgLoss;
    rsiSeries.push(avgLoss === 0 ? 100 : 100 - (100 / (1 + rs)));

    // Calculate for the rest
    for (let i = period + 1; i < prices.length; i++) {
        const change = prices[i] - prices[i - 1];
        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? -change : 0;

        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;

        rs = avgGain / avgLoss;
        rsiSeries.push(avgLoss === 0 ? 100 : 100 - (100 / (1 + rs)));
    }

    return rsiSeries;
};

const calculateSMA = (prices, period = 200) => {
    if (!prices || prices.length < period) return null;
    // Return last value for stats
    const slice = prices.slice(-period);
    const sum = slice.reduce((a, b) => a + b, 0);
    return sum / period;
};

const calculateSMASeries = (prices, period = 200) => {
    if (!prices || prices.length < period) return [];
    const smaSeries = [];
    // Push nulls
    for (let i = 0; i < period - 1; i++) smaSeries.push(null);

    for (let i = period - 1; i < prices.length; i++) {
        const slice = prices.slice(i - period + 1, i + 1);
        const sum = slice.reduce((a, b) => a + b, 0);
        smaSeries.push(sum / period);
    }
    return smaSeries;
};

// RSI Divergence Detection
const detectRSIDivergence = (prices, rsiSeries) => {
    if (!prices || !rsiSeries || prices.length < 30) return false;

    // Find last 2 local maxima in price and RSI
    const priceMaxima = [];
    const rsiMaxima = [];

    // Start from end, go backwards
    for (let i = prices.length - 2; i > 5; i--) {
        // Price maximum: higher than neighbors
        if (prices[i] > prices[i - 1] && prices[i] > prices[i + 1] &&
            prices[i] > prices[i - 2] && prices[i] > prices[i + 2]) {
            priceMaxima.push({ index: i, value: prices[i] });
            if (priceMaxima.length >= 2) break;
        }
    }

    for (let i = rsiSeries.length - 2; i > 5; i--) {
        if (!rsiSeries[i]) continue;
        // RSI maximum: higher than neighbors
        if (rsiSeries[i] > rsiSeries[i - 1] && rsiSeries[i] > rsiSeries[i + 1] &&
            rsiSeries[i] > rsiSeries[i - 2] && rsiSeries[i] > rsiSeries[i + 2]) {
            rsiMaxima.push({ index: i, value: rsiSeries[i] });
            if (rsiMaxima.length >= 2) break;
        }
    }

    // Check for bearish divergence
    if (priceMaxima.length >= 2 && rsiMaxima.length >= 2) {
        const latestPricePeak = priceMaxima[0].value;
        const prevPricePeak = priceMaxima[1].value;
        const latestRSIPeak = rsiMaxima[0].value;
        const prevRSIPeak = rsiMaxima[1].value;

        // Bearish divergence: price makes new high, RSI doesn't
        if (latestPricePeak > prevPricePeak && latestRSIPeak < prevRSIPeak) {
            return true;
        }
    }

    return false;
};

// Volume Distribution Analysis
const detectDistributionVolume = (prices, volumes) => {
    if (!prices || !volumes || prices.length < 20) return false;

    // Calculate average volume over last 20 periods
    const recentVolumes = volumes.slice(-20);
    const avgVolume = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;

    // Check last 5 days for distribution pattern
    let distributionDays = 0;
    for (let i = prices.length - 5; i < prices.length - 1; i++) {
        const isDownDay = prices[i] < prices[i - 1];
        const isHighVolume = volumes[i] > (avgVolume * 1.5);

        if (isDownDay && isHighVolume) {
            distributionDays++;
        }
    }

    // If 2+ out of last 5 days show distribution, flag it
    return distributionDays >= 2;
};

// Bullish RSI Divergence Detection (inverse of bearish)
const detectBullishRSIDivergence = (prices, rsiSeries) => {
    if (!prices || !rsiSeries || prices.length < 30) return false;

    // Find last 2 local minima in price and RSI
    const priceMinima = [];
    const rsiMinima = [];

    // Start from end, go backwards
    for (let i = prices.length - 2; i > 5; i--) {
        // Price minimum: lower than neighbors
        if (prices[i] < prices[i - 1] && prices[i] < prices[i + 1] &&
            prices[i] < prices[i - 2] && prices[i] < prices[i + 2]) {
            priceMinima.push({ index: i, value: prices[i] });
            if (priceMinima.length >= 2) break;
        }
    }

    for (let i = rsiSeries.length - 2; i > 5; i--) {
        if (!rsiSeries[i]) continue;
        // RSI minimum: lower than neighbors
        if (rsiSeries[i] < rsiSeries[i - 1] && rsiSeries[i] < rsiSeries[i + 1] &&
            rsiSeries[i] < rsiSeries[i - 2] && rsiSeries[i] < rsiSeries[i + 2]) {
            rsiMinima.push({ index: i, value: rsiSeries[i] });
            if (rsiMinima.length >= 2) break;
        }
    }

    // Check for bullish divergence
    if (priceMinima.length >= 2 && rsiMinima.length >= 2) {
        const latestPriceLow = priceMinima[0].value;
        const prevPriceLow = priceMinima[1].value;
        const latestRSILow = rsiMinima[0].value;
        const prevRSILow = rsiMinima[1].value;

        // Bullish divergence: price makes new low, RSI doesn't
        if (latestPriceLow < prevPriceLow && latestRSILow > prevRSILow) {
            return true;
        }
    }

    return false;
};

// Accumulation Volume Analysis (inverse of distribution)
const detectAccumulationVolume = (prices, volumes) => {
    if (!prices || !volumes || prices.length < 20) return false;

    // Calculate average volume over last 20 periods
    const recentVolumes = volumes.slice(-20);
    const avgVolume = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;

    // Check last 5 days for accumulation pattern
    let accumulationDays = 0;
    for (let i = prices.length - 5; i < prices.length - 1; i++) {
        const isUpDay = prices[i] > prices[i - 1];
        const isHighVolume = volumes[i] > (avgVolume * 1.5);

        if (isUpDay && isHighVolume) {
            accumulationDays++;
        }
    }

    // If 2+ out of last 5 days show accumulation, flag it
    return accumulationDays >= 2;
};

// Calculate Rate of Change (Momentum)
const calculateMomentum = (prices, period = 10) => {
    if (!prices || prices.length < period) return 0;
    const current = prices[prices.length - 1];
    const past = prices[prices.length - period];
    return ((current - past) / past) * 100;
};

// Calculate Acceleration (2nd derivative of price)
const calculateAcceleration = (prices) => {
    if (!prices || prices.length < 20) return 0;

    // Recent momentum (last 10 days)
    const recentMomentum = calculateMomentum(prices, 10);
    // Prior momentum (10-20 days ago)
    const priorPrices = prices.slice(-20, -10);
    const priorMomentum = calculateMomentum(priorPrices, 10);

    // Acceleration = change in momentum
    return recentMomentum - priorMomentum;
};

// Detect Recent Volatility Expansion
const detectVolatilityExpansion = (prices) => {
    if (!prices || prices.length < 30) return false;

    // Calculate average true range for recent vs historical
    const recentPrices = prices.slice(-10);
    const historicalPrices = prices.slice(-30, -10);

    const calcATR = (priceArray) => {
        let sum = 0;
        for (let i = 1; i < priceArray.length; i++) {
            sum += Math.abs(priceArray[i] - priceArray[i - 1]);
        }
        return sum / (priceArray.length - 1);
    };

    const recentATR = calcATR(recentPrices);
    const historicalATR = calcATR(historicalPrices);

    // Volatility expansion if recent ATR > 1.5x historical
    return recentATR > (historicalATR * 1.5);
};

// Detect Market Phase
const detectMarketPhase = (prices, rsi, extension, topSignalScore, buyQualityScore, volumes) => {
    if (!prices || prices.length < 30) return 'INSUFFICIENT DATA';

    const momentum = calculateMomentum(prices, 10);
    const acceleration = calculateAcceleration(prices);
    const volatilityExpanding = detectVolatilityExpansion(prices);

    // 1. EUPHORIC VERTICAL (Parabolic top)
    if (topSignalScore >= 7 && acceleration > 5 && volatilityExpanding) {
        return 'EUPHORIC VERTICAL';
    }

    // 2. CRASH/CAPITULATION (Panic selling)
    if (buyQualityScore >= 8 && rsi < 25 && volatilityExpanding && momentum < -15) {
        return 'CRASH/CAPITULATION';
    }

    // 3. MELT-UP MODE (Late-stage parabolic, not yet peaked)
    if (topSignalScore >= 4 && topSignalScore < 7 && momentum > 10 && rsi > 65 && acceleration > 2) {
        return 'MELT-UP MODE';
    }

    // 4. ACCUMULATION (Bottoming process)
    if (buyQualityScore >= 5 && rsi < 45 && Math.abs(momentum) < 5) {
        return 'ACCUMULATION';
    }

    // 5. DOWNWARD TREND (Bear market)
    if (rsi < 50 && momentum < -5 && extension < 0) {
        return 'DOWNWARD TREND';
    }

    // 6. UPWARD TREND (Healthy bull)
    if (rsi >= 50 && rsi <= 70 && momentum > 2 && topSignalScore < 4) {
        return 'UPWARD TREND';
    }

    // Default: Neutral/Sideways
    return 'NEUTRAL';
};

// ===== MELTUP EXIT ENGINE LOGIC =====

// Global State for "Soft" Metrics
const marketState = {
    mediaTone: 'Strong', // Default
    fearGreedIndex: 75, // Default
    btcFundingRates: 'Normal', // Default
    btcSocialVolume: 'Normal',
    analystCommentary: 'Bullish',
    isRealTime: {
        mediaTone: false,
        fearGreed: false,
        funding: false
    }
};

// Real-Time Data Fetchers
const fetchRealTimeData = async (symbol) => {
    console.log("Fetching real-time soft metrics...");

    // 1. Fear & Greed Index
    try {
        const fgRes = await fetch('https://api.allorigins.win/raw?url=https://api.alternative.me/fng/');
        const fgData = await fgRes.json();
        if (fgData.data && fgData.data.length > 0) {
            marketState.fearGreedIndex = parseInt(fgData.data[0].value);
            marketState.isRealTime.fearGreed = true;
            updateSimulationUI('fearGreed');
        }
    } catch (e) {
        console.error("Error fetching Fear & Greed:", e);
    }

    // 2. BTC Funding Rates (BitMEX)
    try {
        const fundRes = await fetch('https://api.allorigins.win/raw?url=' + encodeURIComponent('https://www.bitmex.com/api/v1/instrument?symbol=XBTUSD&count=1&reverse=true&columns=fundingRate'));
        const fundData = await fundRes.json();
        if (fundData && fundData.length > 0) {
            const rate = fundData[0].fundingRate;
            // Threshold: > 0.05% (0.0005) is high/spike for 8h rate
            marketState.btcFundingRates = rate > 0.0005 ? 'Spike' : 'Normal';
            marketState.isRealTime.funding = true;
            updateSimulationUI('funding');
        }
    } catch (e) {
        console.error("Error fetching Funding Rate:", e);
    }

    // 3. Media Tone (Finnhub News)
    if (symbol) {
        try {
            const apiKey = 'd4j86r1r01queualuh3gd4j86r1r01queualuh40';
            // Get news for last 3 days
            const today = new Date();
            const threeDaysAgo = new Date();
            threeDaysAgo.setDate(today.getDate() - 3);
            const fromDate = threeDaysAgo.toISOString().split('T')[0];
            const toDate = today.toISOString().split('T')[0];

            const newsUrl = `https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${fromDate}&to=${toDate}&token=${apiKey}`;
            const newsRes = await fetch(newsUrl);
            const newsData = await newsRes.json();

            if (newsData && newsData.length > 0) {
                let score = 0;
                const headlines = newsData.slice(0, 15).map(n => n.headline.toLowerCase() + " " + n.summary.toLowerCase());

                const keywords = {
                    transformative: ['revolution', 'transform', 'paradigm', 'unstoppable', 'forever', 'era', 'ai', 'dominant', 'redefining'],
                    strong: ['beat', 'surge', 'record', 'high', 'growth', 'jump', 'rally', 'soar'],
                    uncertain: ['warning', 'risk', 'bubble', 'caution', 'volatility', 'sold', 'uncertain', 'doubt'],
                    overextended: ['crash', 'collapse', 'plummet', 'bear', 'sell', 'correction', 'overbought']
                };

                headlines.forEach(text => {
                    keywords.transformative.forEach(w => { if (text.includes(w)) score += 2; });
                    keywords.strong.forEach(w => { if (text.includes(w)) score += 1; });
                    keywords.uncertain.forEach(w => { if (text.includes(w)) score -= 1.5; });
                    keywords.overextended.forEach(w => { if (text.includes(w)) score -= 3; });
                });

                // Normalize Score
                if (score >= 10) marketState.mediaTone = 'Transformative';
                else if (score >= 5) marketState.mediaTone = 'Strong';
                else if (score <= -5) marketState.mediaTone = 'Overextended';
                else if (score <= -2) marketState.mediaTone = 'Uncertain';
                else marketState.mediaTone = 'Strong'; // Default fallback if neutral but generally bullish market

                marketState.isRealTime.mediaTone = true;
                updateSimulationUI('mediaTone');
            }
        } catch (e) {
            console.error("Error fetching Media Tone:", e);
        }
    }
};

// Helper to update UI inputs when real-time data arrives
const updateSimulationUI = (type) => {
    const mediaSelect = document.getElementById('simMediaTone');
    const fearRange = document.getElementById('simFearGreed');
    const fearValue = document.getElementById('simFearGreedValue');
    const fundingSelect = document.getElementById('simFunding');

    if (type === 'mediaTone' && mediaSelect) {
        mediaSelect.value = marketState.mediaTone;
        addLiveIndicator(mediaSelect);
    }
    if (type === 'fearGreed' && fearRange) {
        fearRange.value = marketState.fearGreedIndex;
        if (fearValue) fearValue.textContent = marketState.fearGreedIndex;
        addLiveIndicator(fearRange.parentElement); // Add to container
    }
    if (type === 'funding' && fundingSelect) {
        fundingSelect.value = marketState.btcFundingRates;
        addLiveIndicator(fundingSelect);
    }
};

const addLiveIndicator = (element) => {
    // Check if already has indicator
    if (element.parentNode.querySelector('.live-indicator')) return;

    const span = document.createElement('span');
    span.className = 'live-indicator';
    span.innerHTML = '● LIVE';
    span.style.color = 'var(--success)';
    span.style.fontSize = '10px';
    span.style.fontWeight = 'bold';
    span.style.marginLeft = '8px';
    span.style.animation = 'pulse 2s infinite';

    // Insert after label if possible, or append
    const label = element.parentNode.querySelector('label');
    if (label) {
        label.appendChild(span);
    }
};

// 1. System Activation Condition
const checkSystemActivation = (prices, rsi, acceleration) => {
    if (!prices || prices.length < 130) return false; // Need ~6 months

    // Price +40% from 6 month low
    const sixMonthPrices = prices.slice(-126); // ~6 months (21 * 6)
    const sixMonthLow = Math.min(...sixMonthPrices);
    const currentPrice = prices[prices.length - 1];
    const priceCondition = currentPrice >= (sixMonthLow * 1.40);

    // RSI above 70
    const rsiCondition = rsi > 70;

    // Acceleration visible (positive)
    const accelerationCondition = acceleration > 0;

    // Media tone shifts from strong to transformative
    const mediaCondition = marketState.mediaTone === 'Transformative';

    return {
        active: priceCondition && rsiCondition && accelerationCondition && mediaCondition,
        details: {
            priceFromLow: ((currentPrice - sixMonthLow) / sixMonthLow * 100).toFixed(1) + '%',
            rsi: rsi.toFixed(1),
            acceleration: acceleration.toFixed(2),
            mediaTone: marketState.mediaTone
        }
    };
};

// 2. Asset Specific Rules

const checkNVDASMCIRules = (prices, rsi, volumes) => {
    const signals = { trim1: false, trim2: false, finalExit: false, reasons: [] };
    const currentPrice = prices[prices.length - 1];

    // TRIM 1: Sell 30%
    let t1Count = 0;
    if (rsi >= 82) { t1Count++; signals.reasons.push('RSI ≥ 82'); }

    // +35% in < 15 trading days
    const price15DaysAgo = prices[prices.length - 16];
    if (price15DaysAgo && (currentPrice - price15DaysAgo) / price15DaysAgo >= 0.35) {
        t1Count++;
        signals.reasons.push('+35% in < 15 days');
    }

    // Large parabolic candle (simplified as > 5% daily gain) or gap fade (hard to detect without OHLC, assuming close < open not avail in simple array)
    // We'll use > 8% daily move as proxy for "Large parabolic candle"
    const dailyChange = (currentPrice - prices[prices.length - 2]) / prices[prices.length - 2];
    if (dailyChange > 0.08) {
        t1Count++;
        signals.reasons.push('Parabolic move (>8%)');
    }

    if (t1Count >= 2) signals.trim1 = true;

    // TRIM 2: Sell 30%
    let t2Count = 0;
    // Failed breakout (Lower high after high? Simplified: Price < 5 day high)
    const fiveDayHigh = Math.max(...prices.slice(-5));
    if (currentPrice < fiveDayHigh * 0.98) { // 2% below recent high
        t2Count++;
        signals.reasons.push('Failed breakout / Pullback');
    }

    // Large volume spike but weak net gain (High vol, low change)
    // Needs volume data. Assuming we have it.
    const recentVol = volumes[volumes.length - 1];
    const avgVol = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    if (recentVol > avgVol * 2 && dailyChange < 0.01) {
        t2Count++;
        signals.reasons.push('Churn (High Vol, Low Gain)');
    }

    if (t2Count >= 2) signals.trim2 = true;

    // FINAL EXIT: Sell 40%
    let feCount = 0;
    // Close below 10 day MA
    const sma10 = calculateSMA(prices, 10);
    if (currentPrice < sma10) {
        feCount++;
        signals.reasons.push('Below 10d MA');
    }

    // Momentum stall > 3 sessions (Price flat/down for 3 days)
    const p3 = prices[prices.length - 1];
    const p2 = prices[prices.length - 2];
    const p1 = prices[prices.length - 3];
    if (p3 <= p2 && p2 <= p1) {
        feCount++;
        signals.reasons.push('Momentum Stall (3 days)');
    }

    if (feCount >= 2) signals.finalExit = true;

    return signals;
};

const checkBTCRules = (prices, rsi) => {
    const signals = { trim1: false, trim2: false, finalExit: false, reasons: [] };
    const currentPrice = prices[prices.length - 1];

    // TRIM 1
    let t1Count = 0;
    if (rsi >= 80) { t1Count++; signals.reasons.push('RSI ≥ 80'); }
    if (marketState.fearGreedIndex > 90) { t1Count++; signals.reasons.push('Fear/Greed > 90'); }
    // Mainstream coverage hyper bullish (Proxy: Media Tone)
    if (marketState.mediaTone === 'Transformative' || marketState.mediaTone === 'Strong') {
        t1Count++;
        signals.reasons.push('Hyper Bullish Media');
    }
    if (t1Count >= 2) signals.trim1 = true;

    // TRIM 2
    let t2Count = 0;
    // Rejection wick > 4% (Hard with just close, using daily drop > 4%)
    const dailyDrop = (prices[prices.length - 2] - currentPrice) / prices[prices.length - 2];
    if (dailyDrop > 0.04) { t2Count++; signals.reasons.push('Large Drop (>4%)'); }
    if (marketState.btcFundingRates === 'Spike') { t2Count++; signals.reasons.push('Funding Rate Spike'); }
    if (marketState.btcSocialVolume === 'Explodes') { t2Count++; signals.reasons.push('Social Vol Explosion'); }
    if (t2Count >= 2) signals.trim2 = true;

    // FINAL EXIT
    let feCount = 0;
    // Close below 21 day MA
    const sma21 = calculateSMA(prices, 21);
    if (currentPrice < sma21) { feCount++; signals.reasons.push('Below 21d MA'); }
    // Narrative shift (Proxy: Media Tone)
    if (marketState.mediaTone === 'Uncertain') { feCount++; signals.reasons.push('Narrative Doubt'); }

    if (feCount >= 2) signals.finalExit = true;

    return signals;
};

const checkMETARules = (prices, rsi) => {
    const signals = { trim1: false, trim2: false, finalExit: false, reasons: [] };
    const currentPrice = prices[prices.length - 1];

    // TRIM 1
    let t1Count = 0;
    if (rsi >= 78) { t1Count++; signals.reasons.push('RSI ≥ 78'); }
    // +25% in < 20 days
    const price20DaysAgo = prices[prices.length - 21];
    if (price20DaysAgo && (currentPrice - price20DaysAgo) / price20DaysAgo >= 0.25) {
        t1Count++;
        signals.reasons.push('+25% in < 20 days');
    }
    // Headlines dominant (Proxy: Media Tone)
    if (marketState.mediaTone === 'Transformative') { t1Count++; signals.reasons.push('Dominant Headlines'); }
    if (t1Count >= 2) signals.trim1 = true;

    // TRIM 2
    let t2Count = 0;
    // RSI Divergence
    const rsiSeries = calculateRSI(prices); // Re-calc full series
    if (detectRSIDivergence(prices, rsiSeries)) { t2Count++; signals.reasons.push('RSI Divergence'); }
    // Failed breakout (Price < 5 day high)
    const fiveDayHigh = Math.max(...prices.slice(-5));
    if (currentPrice < fiveDayHigh * 0.98) { t2Count++; signals.reasons.push('Failed Breakout'); }
    if (t2Count >= 2) signals.trim2 = true;

    // FINAL EXIT
    let feCount = 0;
    // Close below 20 day MA
    const sma20 = calculateSMA(prices, 20);
    if (currentPrice < sma20) { feCount++; signals.reasons.push('Below 20d MA'); }
    // Media overextended
    if (marketState.mediaTone === 'Overextended') { feCount++; signals.reasons.push('Media Overextended'); }
    if (feCount >= 2) signals.finalExit = true;

    return signals;
};

const checkMSFTGOOGRules = (prices, rsi) => {
    const signals = { trim1: false, trim2: false, finalExit: false, reasons: [] };
    const currentPrice = prices[prices.length - 1];

    // TRIM 1
    let t1Count = 0;
    if (rsi >= 75) { t1Count++; signals.reasons.push('RSI ≥ 75'); }
    // +18% in 30 days
    const price30DaysAgo = prices[prices.length - 31];
    if (price30DaysAgo && (currentPrice - price30DaysAgo) / price30DaysAgo >= 0.18) {
        t1Count++;
        signals.reasons.push('+18% in 30 days');
    }
    if (t1Count >= 2) signals.trim1 = true;

    // TRIM 2
    let t2Count = 0;
    // Momentum Divergence (RSI Divergence proxy)
    const rsiSeries = calculateRSI(prices);
    if (detectRSIDivergence(prices, rsiSeries)) { t2Count++; signals.reasons.push('Momentum Divergence'); }
    // Sideways churn (Low volatility for 5 days after run? Simplified: ATR drop)
    // Using simple price range check
    const last5 = prices.slice(-5);
    const range = (Math.max(...last5) - Math.min(...last5)) / Math.min(...last5);
    if (range < 0.02) { t2Count++; signals.reasons.push('Sideways Churn'); }
    if (t2Count >= 2) signals.trim2 = true;

    // FINAL EXIT
    let feCount = 0;
    // Break of 50 day MA
    const sma50 = calculateSMA(prices, 50);
    if (currentPrice < sma50) { feCount++; signals.reasons.push('Below 50d MA'); }
    // Analyst concerns
    if (marketState.analystCommentary === 'Valuation Concerns') { feCount++; signals.reasons.push('Analyst Concerns'); }
    if (feCount >= 2) signals.finalExit = true;

    return signals;
};

const getMeltupSignal = (symbol, prices, volumes) => {
    if (!prices || prices.length < 130) return { signal: 'INSUFFICIENT DATA', reasons: [] };

    const currentPrice = prices[prices.length - 1];
    const rsiSeries = calculateRSI(prices);
    const rsi = rsiSeries[rsiSeries.length - 1];
    const acceleration = calculateAcceleration(prices);

    // 1. Check System Activation
    const activation = checkSystemActivation(prices, rsi, acceleration);

    if (!activation.active) {
        return {
            signal: 'MONITORING',
            reasons: ['System not active'],
            details: activation.details
        };
    }

    // 2. Apply Asset Specific Rules
    let result = { trim1: false, trim2: false, finalExit: false, reasons: [] };

    if (symbol === 'NVDA' || symbol === 'SMCI') {
        result = checkNVDASMCIRules(prices, rsi, volumes);
    } else if (symbol === 'BTC-USD') {
        result = checkBTCRules(prices, rsi);
    } else if (symbol === 'META') {
        result = checkMETARules(prices, rsi);
    } else if (symbol === 'MSFT' || symbol === 'GOOG') {
        result = checkMSFTGOOGRules(prices, rsi);
    }

    // Determine highest priority signal
    if (result.finalExit) return { signal: 'FINAL EXIT', reasons: result.reasons, details: activation.details };
    if (result.trim2) return { signal: 'TRIM 2', reasons: result.reasons, details: activation.details };
    if (result.trim1) return { signal: 'TRIM 1', reasons: result.reasons, details: activation.details };

    return { signal: 'HOLD (EUPHORIA)', reasons: ['System Active', 'No Exit Triggers'], details: activation.details };
};

// Calculate Pivot Points (S1, S2, S3)
const calculatePivotPoints = (high, low, close) => {
    const pivot = (high + low + close) / 3;
    const s1 = (2 * pivot) - high;
    const s2 = pivot - (high - low);
    const s3 = low - 2 * (high - pivot);
    const r1 = (2 * pivot) - low;
    const r2 = pivot + (high - low);
    const r3 = high + 2 * (pivot - low);

    return { pivot, s1, s2, s3, r1, r2, r3 };
};

// Find Swing Lows (Local Minima)
const findSwingLows = (prices, volumes = [], period = 20) => {
    if (!prices || prices.length < period) return [];

    const swingLows = [];

    // Look for local minima (lookback of 5 days on each side)
    for (let i = 5; i < prices.length - 5; i++) {
        let isLow = true;
        const currentPrice = prices[i];

        // Check if it's lower than neighbors
        for (let j = 1; j <= 5; j++) {
            if (prices[i - j] <= currentPrice || prices[i + j] <= currentPrice) {
                isLow = false;
                break;
            }
        }

        if (isLow) {
            swingLows.push({
                price: currentPrice,
                index: i,
                volume: volumes[i] || 0,
                type: 'swing_low'
            });
        }
    }

    // Return most recent swing lows
    return swingLows.slice(-period);
};

// Calculate Volume-Weighted Price Levels
const calculateVolumeWeightedLevels = (prices, volumes, bins = 20) => {
    if (!prices || !volumes || prices.length < 50) return [];

    // Create price histogram weighted by volume
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const binSize = (max - min) / bins;

    const histogram = new Array(bins).fill(0).map(() => ({
        priceLevel: 0,
        volume: 0,
        count: 0
    }));

    // Fill histogram
    for (let i = 0; i < prices.length; i++) {
        const binIndex = Math.min(Math.floor((prices[i] - min) / binSize), bins - 1);
        histogram[binIndex].volume += volumes[i] || 0;
        histogram[binIndex].priceLevel += prices[i];
        histogram[binIndex].count++;
    }

    // Calculate average price for each bin
    histogram.forEach(bin => {
        if (bin.count > 0) {
            bin.priceLevel = bin.priceLevel / bin.count;
        }
    });

    // Sort by volume and return top levels
    const sorted = histogram
        .filter(bin => bin.count > 0)
        .sort((a, b) => b.volume - a.volume);

    return sorted.slice(0, 5).map(bin => ({
        price: bin.priceLevel,
        volume: bin.volume,
        type: 'volume_profile'
    }));
};

// Calculate Fibonacci Retracement Levels
const calculateFibonacciLevels = (prices) => {
    if (!prices || prices.length < 60) return [];

    // Use last 6 months of data to find swing high/low
    const recentPrices = prices.slice(-120); // ~6 months
    const high = Math.max(...recentPrices);
    const low = Math.min(...recentPrices);
    const range = high - low;

    const fibRatios = [0.236, 0.382, 0.5, 0.618, 0.786];

    return fibRatios.map(ratio => ({
        price: high - (range * ratio),
        ratio: ratio,
        type: 'fibonacci'
    }));
};

// Get Key Moving Average Levels
const calculateKeyMovingAverages = (prices) => {
    if (!prices || prices.length < 200) return [];

    const levels = [];

    // 50-day MA
    if (prices.length >= 50) {
        const sma50 = calculateSMA(prices, 50);
        if (sma50) {
            levels.push({ price: sma50, period: 50, type: 'moving_average' });
        }
    }

    // 100-day MA
    if (prices.length >= 100) {
        const sma100 = calculateSMA(prices, 100);
        if (sma100) {
            levels.push({ price: sma100, period: 100, type: 'moving_average' });
        }
    }

    // 200-day MA
    const sma200 = calculateSMA(prices, 200);
    if (sma200) {
        levels.push({ price: sma200, period: 200, type: 'moving_average' });
    }

    return levels;
};

// MASTER FUNCTION: Detect Support/Resistance Levels
const detectSupportResistanceLevels = (prices, volumes, currentPrice) => {
    if (!prices || prices.length < 60) return [];

    const allLevels = [];

    // 1. Pivot Points (using last 20 days)
    const recentPrices = prices.slice(-20);
    const high = Math.max(...recentPrices);
    const low = Math.min(...recentPrices);
    const close = prices[prices.length - 1];
    const pivots = calculatePivotPoints(high, low, close);

    if (pivots.s1 < currentPrice) {
        allLevels.push({ price: pivots.s1, type: 'pivot_s1', strength: 0, touches: 0, description: 'Pivot Support S1' });
    }
    if (pivots.s2 < currentPrice) {
        allLevels.push({ price: pivots.s2, type: 'pivot_s2', strength: 0, touches: 0, description: 'Pivot Support S2' });
    }
    if (pivots.s3 < currentPrice) {
        allLevels.push({ price: pivots.s3, type: 'pivot_s3', strength: 0, touches: 0, description: 'Pivot Support S3' });
    }

    // 2. Swing Lows
    const swingLows = findSwingLows(prices, volumes);
    swingLows.forEach((swing, idx) => {
        if (swing.price < currentPrice) {
            allLevels.push({
                price: swing.price,
                type: 'swing_low',
                strength: 0,
                touches: 0,
                description: `Previous swing low (#${swingLows.length - idx})`
            });
        }
    });

    // 3. Volume-Weighted Levels
    const volumeLevels = calculateVolumeWeightedLevels(prices, volumes);
    volumeLevels.forEach(level => {
        if (level.price < currentPrice) {
            allLevels.push({
                price: level.price,
                type: 'volume_profile',
                strength: 0,
                touches: 0,
                description: 'High volume zone'
            });
        }
    });

    // 4. Fibonacci Retracements
    const fibLevels = calculateFibonacciLevels(prices);
    fibLevels.forEach(fib => {
        if (fib.price < currentPrice) {
            allLevels.push({
                price: fib.price,
                type: 'fibonacci',
                strength: 0,
                touches: 0,
                description: `Fib ${(fib.ratio * 100).toFixed(1)}% retracement`
            });
        }
    });

    // 5. Moving Averages
    const maLevels = calculateKeyMovingAverages(prices);
    maLevels.forEach(ma => {
        if (ma.price < currentPrice) {
            allLevels.push({
                price: ma.price,
                type: 'moving_average',
                strength: 0,
                touches: 0,
                description: `${ma.period}-day MA support`
            });
        }
    });

    // Merge similar price levels (within 1% of each other)
    const mergedLevels = [];
    const tolerance = currentPrice * 0.01; // 1% tolerance

    allLevels.forEach(level => {
        const existing = mergedLevels.find(m => Math.abs(m.price - level.price) < tolerance);
        if (existing) {
            // Increase strength for confluent levels
            existing.strength += 2;
            existing.touches += 1;
            existing.description += ` + ${level.description}`;
            // Use average price
            existing.price = (existing.price + level.price) / 2;
        } else {
            mergedLevels.push({ ...level, strength: 2, touches: 1 });
        }
    });

    // Calculate allocation percentage based on distance and strength
    mergedLevels.forEach((level, idx) => {
        const dropPercent = ((currentPrice - level.price) / currentPrice) * 100;
        const strengthBonus = Math.min(level.strength, 10);

        // Base allocation on depth of drop
        let baseAlloc = 0;
        if (dropPercent >= 25) baseAlloc = 30;
        else if (dropPercent >= 20) baseAlloc = 25;
        else if (dropPercent >= 15) baseAlloc = 20;
        else if (dropPercent >= 10) baseAlloc = 15;
        else if (dropPercent >= 5) baseAlloc = 10;
        else baseAlloc = 5;

        // Adjust for strength
        level.allocation = Math.min(baseAlloc + strengthBonus, 40);
        level.dropPercent = dropPercent;
    });

    // Sort by price (highest first, since we're showing support below current price)
    mergedLevels.sort((a, b) => b.price - a.price);

    // Return top 7 levels only
    return mergedLevels.slice(0, 7);
};

// ===== DATA MANAGER & PERFORMANCE =====

// Ignition Detector Logic (Standardized)
class IgnitionDetector {
    constructor() {
        this.basket = ['NVDA', 'META', 'MSFT', 'GOOG', 'BTC-USD', 'SMCI']; // Full basket
        this.state = 'COMPRESSION'; // COMPRESSION, PRE-IGNITION, IGNITION ACTIVE
        this.metrics = {
            price: false,
            volume: false,
            breadth: false
        };
    }

    async analyze(dataMap) {
        console.log("Running Ignition Detector analysis...");

        let breakoutCount = 0;
        let validDataCount = 0;
        let highVolCount = 0;
        let greenCount = 0;

        for (const symbol of this.basket) {
            const data = dataMap[symbol];
            if (!data || !data.indicators.quote[0].close) continue;

            validDataCount++;
            const closes = data.indicators.quote[0].close.filter(c => c !== null);
            const volumes = data.indicators.quote[0].volume.filter(v => v !== null);
            const currentPrice = closes[closes.length - 1];
            const currentVol = volumes[volumes.length - 1];
            const avgVol = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;

            // 1. Price Breakout Check (Above 20d High)
            const high20 = Math.max(...closes.slice(-21, -1));
            if (currentPrice > high20) breakoutCount++;

            // 2. Volume Surge Check (> 1.2x Average)
            if (currentVol > avgVol * 1.2) highVolCount++;

            // 3. Green Day Check
            if (currentPrice > closes[closes.length - 2]) greenCount++;
        }

        // Thresholds (Regime-Based)
        // Price: > 50% of basket breaking out
        this.metrics.price = (breakoutCount >= Math.ceil(validDataCount / 2));

        // Volume: Significant participation (> 30% of basket surging)
        this.metrics.volume = (highVolCount >= Math.ceil(validDataCount / 3));

        // Breadth: Majority green
        this.metrics.breadth = (greenCount >= Math.ceil(validDataCount / 2));

        // Determine State
        if (this.metrics.price && this.metrics.volume && this.metrics.breadth) {
            this.state = 'IGNITION ACTIVE';
        } else if (this.metrics.price || (this.metrics.volume && this.metrics.breadth)) {
            this.state = 'PRE-IGNITION';
        } else {
            this.state = 'COMPRESSION';
        }

        this.updateUI();
    }

    updateUI() {
        const container = document.getElementById('ignitionStatus');
        const stateHeader = document.getElementById('ignitionState');
        const indicator = document.getElementById('ignitionIndicator');
        const actionBox = document.getElementById('ignitionAction');
        const pVal = document.getElementById('ignPrice');
        const vVal = document.getElementById('ignVol');
        const bVal = document.getElementById('ignBreadth');

        if (!container) return;

        container.classList.remove('hidden', 'active', 'pre-ignition');
        actionBox.classList.add('hidden');

        stateHeader.textContent = `STOCKS IGNITION: ${this.state}`;

        pVal.textContent = this.metrics.price ? 'BREAKOUT' : 'Neutral';
        pVal.className = `value ${this.metrics.price ? 'positive' : ''}`;

        vVal.textContent = this.metrics.volume ? 'SURGE' : 'Normal';
        vVal.className = `value ${this.metrics.volume ? 'positive' : ''}`;

        bVal.textContent = this.metrics.breadth ? 'STRONG' : 'Mixed';
        bVal.className = `value ${this.metrics.breadth ? 'positive' : ''}`;

        if (this.state === 'IGNITION ACTIVE') {
            container.classList.add('active');
            indicator.style.backgroundColor = 'var(--success)'; // Green for Action
            indicator.style.boxShadow = '0 0 15px var(--success)';
            actionBox.classList.remove('hidden');
        } else if (this.state === 'PRE-IGNITION') {
            container.classList.add('pre-ignition');
            indicator.style.backgroundColor = 'var(--warning)';
            indicator.style.boxShadow = '0 0 15px var(--warning)';
        } else {
            // COMPRESSION = RED (Hold/Wait)
            indicator.style.backgroundColor = 'var(--danger)';
            indicator.style.boxShadow = 'none';
        }
    }
}

const ignitionDetector = new IgnitionDetector();

// BTC Ignition System
class BTCIgnitionDetector {
    constructor() {
        this.state = 'COMPRESSION'; // Default
        this.action = 'Wait for signal';
        this.values = {};
    }

    async analyze(dataMap) {
        try {
            console.log("Running BTC Ignition Analysis v2.0...");
            const btc = dataMap['BTC-USD'];
            if (!btc || !btc.indicators.quote[0].close) {
                console.warn("BTC data missing");
                return;
            }

            const closes = btc.indicators.quote[0].close.filter(c => c !== null);
            const highs = btc.indicators.quote[0].high.filter(h => h !== null);
            const lows = btc.indicators.quote[0].low.filter(l => l !== null);
            const opens = btc.indicators.quote[0].open.filter(o => o !== null);
            const volumes = btc.indicators.quote[0].volume.filter(v => v !== null);

            if (closes.length === 0) return;

            const currentPrice = closes[closes.length - 1];
            const currentVol = volumes[volumes.length - 1];

            // Metrics Calculation
            const rsiSeries = calculateRSI(closes);
            const rsi = rsiSeries[rsiSeries.length - 1];
            const avgVol20 = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
            const volRatio = currentVol / avgVol20;

            // 5-day Price Change
            const price5dAgo = closes[closes.length - 6];
            const change5d = ((currentPrice - price5dAgo) / price5dAgo) * 100;

            // Compression (Range < 5% over last 5 days) - Restored for metrics
            const high5d = Math.max(...highs.slice(-5));
            const low5d = Math.min(...lows.slice(-5));
            const range5d = ((high5d - low5d) / low5d) * 100;

            // 90-day Low Calculation (Regime Base)
            // Ensure we have enough data, otherwise use max available
            const lookback90 = Math.min(closes.length, 90);
            const low90d = Math.min(...lows.slice(-lookback90));
            const priceVsLow90d = ((currentPrice - low90d) / low90d) * 100;

            // --- LOGIC ENGINE v3.0 (Regime-Based) ---

            // DISTRIBUTION CRITERIA (All must be true)
            // 1. RSI > 72 (Overbought)
            // 2. Price > +35% from 90-day Low (Extended)
            // 3. Vol Ratio > 1.6x (Euphoric Volume)
            const isDistribution = (rsi > 72) && (priceVsLow90d > 35) && (volRatio > 1.6);

            if (isDistribution) {
                this.state = 'DISTRIBUTION ACTIVE';
                this.action = 'Prepare trimming sequence.';
            } else {
                // Default State: ACCUMULATION
                this.state = 'ACCUMULATION';
                this.action = 'No trimming. Maintain exposure.';
            }

            // --- RESTORED METRICS FOR DISPLAY PRECISION ---
            // C. RISK REGIME (Calculated for display context)
            let techTrend = 'Mixed';
            const nvda = dataMap['NVDA'];
            const meta = dataMap['META'];
            if (nvda && meta) {
                const nvdaCloses = nvda.indicators.quote[0].close.filter(c => c !== null);
                const metaCloses = meta.indicators.quote[0].close.filter(c => c !== null);
                const nvdaRising = nvdaCloses[nvdaCloses.length - 1] > calculateSMA(nvdaCloses, 20);
                const metaRising = metaCloses[metaCloses.length - 1] > calculateSMA(metaCloses, 20);
                if (nvdaRising && metaRising) techTrend = 'Bullish';
                else if (!nvdaRising && !metaRising) techTrend = 'Bearish';
            }

            let dxyVal = 0;
            const dxy = dataMap['DX-Y.NYB'];
            if (dxy) {
                const dxyCloses = dxy.indicators.quote[0].close.filter(c => c !== null);
                dxyVal = dxyCloses[dxyCloses.length - 1];
            }

            let tnxVal = 0;
            const tnx = dataMap['^TNX'];
            if (tnx) {
                const tnxCloses = tnx.indicators.quote[0].close.filter(c => c !== null);
                tnxVal = tnxCloses[tnxCloses.length - 1];
            }

            // D. OVERHEATED METRICS (Calculated for display)
            // 2. Price > 3 std devs above 30d mean
            const mean30 = closes.slice(-30).reduce((a, b) => a + b, 0) / 30;
            const stdDev30 = Math.sqrt(closes.slice(-30).map(x => Math.pow(x - mean30, 2)).reduce((a, b) => a + b, 0) / 30);
            const stdDevsAbove = (currentPrice - mean30) / stdDev30;

            // 3. Extension > 50% above 20d MA
            const sma20 = calculateSMA(closes, 20);
            const distFromMA = ((currentPrice - sma20) / sma20) * 100;


            // Store values for UI
            this.values = {
                price: currentPrice,
                rsi: rsi,
                volRatio: volRatio,
                change5d: change5d,
                range5d: range5d,
                techTrend: techTrend,
                dxy: dxyVal,
                tnx: tnxVal,
                stdDevsAbove: stdDevsAbove,
                distFromMA: distFromMA,
                priceVsLow90d: priceVsLow90d // Store for debugging/display if needed
            };

            // Call updateUI immediately
            this.updateUI();

            // Also call after a short delay to ensure all async ops complete
            setTimeout(() => this.updateUI(), 100);
        } catch (e) {
            console.error("BTC Analysis Error:", e);
            const comm = document.getElementById('commentaryText');
            if (comm) comm.textContent = `Error: ${e.message}`;
        }
    }

    updateUI() {
        // Update Ignition Card
        const ignContainer = document.getElementById('btcIgnition');
        const ignState = document.getElementById('btcIgnitionState');
        const ignIndicator = document.getElementById('btcIgnitionIndicator');
        const ignAction = document.getElementById('btcIgnitionAction');

        if (!ignContainer || !ignState || !ignIndicator || !ignAction) return;

        ignContainer.classList.remove('hidden', 'active', 'pre-ignition');
        ignAction.classList.add('hidden');

        // Update Header Label
        const ignHeader = ignContainer.querySelector('h2');
        if (ignHeader) ignHeader.textContent = 'BTC STATE';

        ignState.textContent = `STATUS: ${this.state}`;

        // Live Values (Mapped to new logic) - with null checks
        const el60d = document.getElementById('val-60d');
        const elLows = document.getElementById('val-lows');
        const elRange = document.getElementById('val-range');
        const elEth = document.getElementById('val-eth');
        const elTech = document.getElementById('val-tech');
        const elDxy = document.getElementById('val-dxy');
        const elTnx = document.getElementById('val-tnx');

        if (this.values.price !== undefined) {
            if (el60d) el60d.textContent = `$${this.values.price.toFixed(0)}`;
            if (elLows) elLows.textContent = this.values.rsi.toFixed(1);
            if (elRange) elRange.textContent = `${this.values.volRatio.toFixed(1)}x`;
            if (elEth) elEth.textContent = `${this.values.change5d.toFixed(1)}%`;

            // Regime Values
            if (elTech) elTech.textContent = this.values.techTrend;
            if (elDxy) elDxy.textContent = this.values.dxy.toFixed(2);
            if (elTnx) elTnx.textContent = `${this.values.tnx.toFixed(2)}%`;
        }

        // Color Logic: 
        // ACCUMULATION = Red/Neutral (Hold)
        // DISTRIBUTION = Green/Warning (Action)

        // Reset styles first
        ignIndicator.style.backgroundColor = '';
        ignIndicator.style.boxShadow = '';

        if (this.state === 'DISTRIBUTION ACTIVE') {
            ignContainer.classList.add('active'); // Green border
            ignIndicator.style.backgroundColor = 'var(--success)';
            ignIndicator.style.boxShadow = '0 0 15px var(--success)';
            ignAction.textContent = `⚠️ DISTRIBUTION: ${this.action}`;
            ignAction.classList.remove('hidden');
        } else {
            // ACCUMULATION
            ignIndicator.style.backgroundColor = 'var(--danger)'; // Red for Hold/Wait
            ignIndicator.style.boxShadow = 'none';
            ignAction.textContent = `🔒 ${this.state}: ${this.action}`;
            ignAction.classList.remove('hidden');
            ignAction.style.color = 'var(--text-muted)';
        }

        // Update Exit Card (BTC MELTUP EXIT)
        const exitContainer = document.getElementById('btcExit');
        const exitStateHeader = document.getElementById('btcExitState');
        const exitIndicator = document.getElementById('btcExitIndicator');
        const exitAction = document.getElementById('btcExitAction');

        if (!exitContainer || !exitStateHeader || !exitIndicator || !exitAction) return;

        exitContainer.classList.remove('hidden');
        exitAction.classList.add('hidden');

        const isExit = (this.state === 'DISTRIBUTION ACTIVE');
        const displayState = isExit ? 'EXIT MONITOR ARMED' : 'DORMANT';

        exitStateHeader.textContent = `EXIT SYSTEM: ${displayState}`;

        // Live Values (Reuse calculated ones)
        const rsiEl = document.getElementById('val-rsi');
        const stdEl = document.getElementById('val-std');
        const maEl = document.getElementById('val-ma');

        if (rsiEl && this.values && this.values.rsi !== undefined) {
            rsiEl.textContent = this.values.rsi.toFixed(1);
        }
        if (stdEl && this.values && this.values.stdDevsAbove !== undefined) {
            stdEl.textContent = `${this.values.stdDevsAbove.toFixed(1)}σ`;
        }
        if (maEl && this.values && this.values.distFromMA !== undefined) {
            maEl.textContent = `+${this.values.distFromMA.toFixed(1)}%`;
        }

        if (isExit) {
            exitIndicator.style.backgroundColor = 'var(--success)'; // Green for Action (Trim)
            exitIndicator.style.boxShadow = '0 0 15px var(--success)';
            exitAction.textContent = `⚠️ TRIM ALERT: ${this.action}`;
            exitAction.classList.remove('hidden');
            exitContainer.style.borderColor = 'var(--success)';
        } else {
            exitIndicator.style.backgroundColor = 'var(--danger)'; // Red for Dormant
            exitIndicator.style.boxShadow = 'none';
            exitContainer.style.borderColor = 'rgba(255, 255, 255, 0.1)';
            exitAction.textContent = 'System Dormant. No Action.';
            exitAction.classList.remove('hidden');
            exitAction.style.color = 'var(--text-muted)';
        }
    }
}

const btcDetector = new BTCIgnitionDetector();

// Stock Meltup Exit System (Standardized)
class StockMeltupExit {
    constructor() {
        this.signals = {};
    }

    analyze(symbol, data, spyData, ignitionActive) {
        if (!data || !data.indicators.quote[0].close) return null;

        let signal = { status: 'SAFE', action: '', reason: '' };

        // 0. IGNITION CHECK
        if (!ignitionActive) {
            this.signals[symbol] = signal;
            this.updateUI(symbol, signal);
            return signal;
        }

        const closes = data.indicators.quote[0].close.filter(c => c !== null);
        const highs = data.indicators.quote[0].high.filter(h => h !== null);
        const lows = data.indicators.quote[0].low.filter(l => l !== null);
        const opens = data.indicators.quote[0].open.filter(o => o !== null);
        const volumes = data.indicators.quote[0].volume.filter(v => v !== null);

        // Universal Confirmation Filter: SPY Divergence
        let spyDivergence = false;
        if (spyData && spyData.indicators.quote[0].close) {
            const spyCloses = spyData.indicators.quote[0].close.filter(c => c !== null);
            const spyHigh20 = Math.max(...spyCloses.slice(-20));
            const spyCurrent = spyCloses[spyCloses.length - 1];
            const stockHigh20 = Math.max(...closes.slice(-20));
            const stockCurrent = closes[closes.length - 1];

            if (spyCurrent < spyHigh20 * 0.98 && stockCurrent > stockHigh20 * 0.98) {
                spyDivergence = true;
            }
        }

        // Standardized Regime-Based Logic
        signal = this.getRegimeExitSignal(closes, highs, lows, volumes, spyDivergence);

        this.signals[symbol] = signal;
        this.updateUI(symbol, signal);
        return signal;
    }

    getRegimeExitSignal(closes, highs, lows, volumes, spyDivergence) {
        const currentPrice = closes[closes.length - 1];
        const rsi = calculateRSI(closes).pop();
        const sma20 = calculateSMA(closes, 20);
        const sma200 = calculateSMA(closes, 200);

        // 1. REGIME SETUP (Are we extended?)
        const isOverheated = (rsi > 75);
        // Check if we were extended recently (last 5 days) to catch sharp drops
        // that might take us below the threshold but still represent a trend break
        const recentHigh = Math.max(...closes.slice(-5));
        const isExtended = (sma200 && recentHigh > sma200 * 1.3); // >30% above 200d MA

        // 2. TRIGGER EVENTS (Did something break?)
        // Dynamic Stop: If extended, use tighter SMA10. Otherwise SMA20.
        const sma10 = calculateSMA(closes, 10);
        const stopPrice = isExtended ? sma10 : sma20;
        const trendBreak = (currentPrice < stopPrice);

        // Blow-off Top: High Vol Reversal
        const avgVol = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
        const currentVol = volumes[volumes.length - 1];
        const isReversal = (currentPrice < closes[closes.length - 2]); // Red day
        const blowOff = (currentVol > avgVol * 2.5 && isReversal && isExtended);

        // 3. DECISION MATRIX
        if (blowOff) {
            return { status: 'EXIT EXECUTION', action: 'SELL 100%', reason: 'Blow-off Top' };
        }

        if (trendBreak && isExtended) {
            return { status: 'EXIT EXECUTION', action: 'TRIM 50%', reason: 'Trend Break (20d)' };
        }

        if (isOverheated || spyDivergence) {
            return { status: 'DISTRIBUTION', action: 'WATCH', reason: 'Overheated/Div' };
        }

        return { status: 'SAFE', action: 'HOLD', reason: 'Trend Intact' };
    }

    updateUI(symbol, signal) {
        const el = document.getElementById(`exit-${symbol}`);
        if (!el) return;

        const statusSpan = el.querySelector('.status');
        statusSpan.textContent = signal.status;

        el.classList.remove('safe', 'warning', 'exit');

        if (signal.status === 'ACTIVE MELTUP' || signal.status === 'SAFE') {
            el.classList.add('safe'); // Red for HOLD
            statusSpan.textContent = 'HOLD';
        } else if (signal.status === 'DISTRIBUTION' || signal.status === 'WARNING') {
            el.classList.add('warning'); // Orange for WARNING
            statusSpan.textContent = 'WARNING';
        } else if (signal.status.includes('EXIT') || signal.status.includes('EXECUTION')) {
            el.classList.add('exit'); // Green for EXIT
            statusSpan.textContent = signal.action;
        }
    }
}

const stockMeltupExit = new StockMeltupExit();

// --- RAW ARC ALLOCATOR ENGINE v7.5 ---
/**
 * ANTIGRAVITY v9.2 ALLOCATOR
 * Complete rewrite with 5-phase detection, probability-weighted ladders,
 * proactive RESET trimming, and automatic dip generation
 */

class AntigravityAllocatorV92 {
    constructor() {
        this.assets = ['META', 'MSFT', 'NVDA', 'SMCI', 'BTC-USD'];
        this.monitorOnly = ['GOOG']; // Monitor but never buy
        this.banned = ['ETH']; // Completely banned

        this.userState = {
            holdings: {}, // { ticker: shares }
            limits: {}, // { ticker: [{ price, size }] }
            blacklist: {}, // { ticker: [{price, reason}] }
            rejectedRungs: {} // Permanent rejection memory
        };

        this.cashAvailable = 0;
        this.BOOTSTRAP_LIMIT = 0.40; // 40% max initial deployment
        this.lastPlan = null;

        // SMCI-specific tracking
        this.smciBannedZones = []; // Array of {min, max, reason, addedAt}
    }

    // ============================================================
    // ASSET TYPE DETECTION
    // ============================================================

    /**
     * Detect asset type for type-specific allocation logic
     * Crypto assets need different phase thresholds and action rules
     */
    getAssetType(ticker) {
        const cryptoTickers = ['BTC-USD', 'ETH-USD', 'BTC', 'ETH'];
        if (cryptoTickers.includes(ticker)) return 'CRYPTO';
        if (ticker === 'SMCI') return 'SMCI';
        return 'STOCK';
    }


    // ============================================================
    // PHASE DETECTION ENGINE
    // ============================================================

    /**
     * Analyze global market regime using SPY
     * This gates individual stock RESET detections to prevent false signals
     */
    analyzeGlobalRegime(spyAsset) {
        if (!spyAsset || !spyAsset.indicators) {
            // Default to NORMAL if SPY data unavailable
            return {
                regime: 'NORMAL',
                reason: 'SPY data unavailable',
                allowReset: false
            };
        }

        const { price, indicators } = spyAsset;
        const { rsi, sma200 } = indicators;

        const priceTosma200Pct = ((price - sma200) / sma200) * 100;

        let stressSignals = 0;
        const reasons = [];

        // SPY Stress Signals
        if (priceTosma200Pct < -3) {
            stressSignals++;
            reasons.push(`SPY ${priceTosma200Pct.toFixed(1)}% below SMA200`);
        }
        if (rsi < 50) {
            stressSignals++;
            reasons.push(`SPY RSI ${rsi.toFixed(0)}`);
        }
        // Note: VIX check would go here if we have the data
        // if (vix > 20) { stressSignals++; reasons.push(`VIX ${vix}`); }

        // Determine global regime
        if (stressSignals >= 2 || priceTosma200Pct < -5) {
            return {
                regime: 'RESET',
                reason: reasons.join(', '),
                allowReset: true
            };
        }

        if (stressSignals >= 1) {
            return {
                regime: 'STRESS',
                reason: reasons.join(', '),
                allowReset: true  // Allow individual stock RESETs during market stress
            };
        }

        return {
            regime: 'NORMAL',
            reason: `SPY ${priceTosma200Pct >= 0 ? '+' : ''}${priceTosma200Pct.toFixed(1)}% vs SMA200, RSI ${rsi.toFixed(0)}`,
            allowReset: false  // Block individual stock RESETs when market is healthy
        };
    }

    /**
     * Calculate drawdown from 60-day high
     */
    calculateDrawdown(priceHistory, currentPrice) {
        if (!priceHistory || priceHistory.length < 10) {
            return 0;  // Not enough data
        }

        // Get last 60 days (or available data)
        const last60Days = priceHistory.slice(-60);
        const high60d = Math.max(...last60Days);

        const drawdown = ((high60d - currentPrice) / high60d) * 100;
        return Math.max(0, drawdown);  // Never negative
    }

    detectPhase(asset, globalRegime) {
        const { ticker, price, indicators } = asset;
        const { rsi, sma200, ema20, volume, volumeAvg20, drawdown60d } = indicators;

        // Detect asset type for type-specific rules
        const assetType = this.getAssetType(ticker);

        // Calculate metrics
        const priceTosma200Pct = ((price - sma200) / sma200) * 100;
        const priceToEma20Pct = ((price - ema20) / ema20) * 100;
        const volumeRatio = volume / volumeAvg20;

        // Count stress signals for RESET detection (v9.3 thresholds)
        let stressSignals = 0;
        const stressReasons = [];

        // Signal 1: RSI weakness (v9.3: < 38, was 40)
        if (rsi < 38) {
            stressSignals++;
            stressReasons.push(`RSI ${rsi.toFixed(0)}`);
        }

        // Signal 2: Price breakdown (v9.3: < EMA20 by 4%+, was 3%)
        if (price < ema20 * 0.96) {  // 4% below EMA20
            stressSignals++;
            stressReasons.push(`Price <EMA20 -${Math.abs(priceToEma20Pct).toFixed(1)}%`);
        }

        // Signal 3: Drawdown (v9.3: NEW - > 20% from 60-day high)
        if (drawdown60d > 20) {
            stressSignals++;
            stressReasons.push(`Drawdown ${drawdown60d.toFixed(1)}%`);
        }

        // Signal 4: Volume collapse (v9.3: < 45%, was 50%)
        if (volumeRatio < 0.45) {
            stressSignals++;
            stressReasons.push(`Vol collapse ${(volumeRatio * 100).toFixed(0)}%`);
        }

        // === CRYPTO-SPECIFIC PHASE DETECTION ===
        if (assetType === 'CRYPTO') {
            // PARABOLIC: Blowoff top territory (RSI > 80, volume spike, extreme extension)
            if (rsi > 80 && volumeRatio > 2.0 && price > ema20 * 1.30) {
                return {
                    phase: 'PARABOLIC',
                    reason: `BLOWOFF: RSI ${rsi.toFixed(0)}, Vol ${(volumeRatio * 100).toFixed(0)}%, Price +${priceToEma20Pct.toFixed(1)}% vs EMA20`,
                    score: 10
                };
            }

            // MELTUP: Higher threshold for crypto (1.5x vs 1.12x for stocks)
            if (price > sma200 * 1.50 && rsi > 70 && volumeRatio > 1.5) {
                return {
                    phase: 'MELTUP',
                    reason: `Price +${priceTosma200Pct.toFixed(1)}% vs SMA200, RSI ${rsi.toFixed(0)}, Vol ${(volumeRatio * 100).toFixed(0)}%`,
                    score: 8
                };
            }

            // CATASTROPHIC: Crypto-specific threshold (price < SMA200*0.40)
            if (price < sma200 * 0.40 && rsi < 32 && volumeRatio < 0.40) {
                return {
                    phase: 'CATASTROPHIC',
                    reason: `CRYPTO COLLAPSE: Price ${priceTosma200Pct.toFixed(1)}% below SMA200, RSI ${rsi.toFixed(0)}`,
                    score: 0
                };
            }

            // RESET: Crypto ignores global SPY regime, uses deeper threshold (0.70 vs 0.90)
            if (stressSignals >= 2 && price < sma200 * 0.70) {
                return {
                    phase: 'RESET',
                    reason: `CRYPTO RESET: ${stressReasons.join(', ')}`,
                    score: 2
                };
            }

            // NORMAL: Default for crypto
            return {
                phase: 'NORMAL',
                reason: `Price ${priceTosma200Pct >= 0 ? '+' : ''}${priceTosma200Pct.toFixed(1)}% vs SMA200, RSI ${rsi.toFixed(0)}`,
                score: 4
            };
        }

        // === SMCI-SPECIFIC PHASE DETECTION ===
        if (assetType === 'SMCI') {
            // Need priceChange24h for SMCI logic (calculate from historical data if available)
            const priceChange24h = 0; // Placeholder - would need to calculate from data

            // CATASTROPHIC: Fail fast (trigger on ANY condition)
            const catastrophicCond1 = (priceTosma200Pct < -10 && rsi < 40 && volumeRatio >= 1.5);
            const catastrophicCond2 = (priceChange24h < -15 && volumeRatio >= 2.0);

            if (catastrophicCond1 || catastrophicCond2) {
                return {
                    phase: 'CATASTROPHIC',
                    reason: `SMCI CATASTROPHIC: ${catastrophicCond1 ? 'Structure breakdown' : 'Violent selloff'}`,
                    score: 0
                };
            }

            // RESET: Blowoff/overstretched (ANY TWO of four triggers)
            let resetSignals = 0;
            const resetReasons = [];

            if (rsi > 72) {
                resetSignals++;
                resetReasons.push(`RSI ${rsi.toFixed(0)}`);
            }
            if (priceToEma20Pct > 15) {
                resetSignals++;
                resetReasons.push(`+${priceToEma20Pct.toFixed(1)}% vs EMA20`);
            }
            if (priceChange24h > 12) {
                resetSignals++;
                resetReasons.push(`+${priceChange24h.toFixed(1)}% day`);
            }
            if (priceTosma200Pct > 20) {
                resetSignals++;
                resetReasons.push(`+${priceTosma200Pct.toFixed(1)}% vs SMA200`);
            }

            if (resetSignals >= 2) {
                return {
                    phase: 'RESET',
                    reason: `SMCI RESET: ${resetReasons.join(', ')}`,
                    score: 2
                };
            }

            // NORMAL: Validate normal conditions
            if (rsi >= 40 && rsi <= 70 && Math.abs(priceToEma20Pct) <= 15 && volumeRatio <= 1.5) {
                return {
                    phase: 'NORMAL',
                    reason: `SMCI NORMAL: RSI ${rsi.toFixed(0)}, ${priceTosma200Pct >= 0 ? '+' : ''}${priceTosma200Pct.toFixed(1)}% vs SMA200`,
                    score: 4
                };
            }

            // Default to NORMAL (cautious)
            return {
                phase: 'NORMAL',
                reason: `SMCI watching: RSI ${rsi.toFixed(0)}`,
                score: 4
            };
        }

        // === STOCK PHASE DETECTION (Existing Logic) ===

        // PHASE 5: CATASTROPHIC (v9.3: price < SMA200*0.85 AND RSI < 32 AND volume < 40% AND global regime allows)
        if (price < sma200 * 0.85 && rsi < 32 && volumeRatio < 0.40) {
            // CATASTROPHIC can override global regime for extreme individual stock breakdowns
            return {
                phase: 'CATASTROPHIC',
                reason: `Price ${priceTosma200Pct.toFixed(1)}% below SMA200, RSI ${rsi.toFixed(0)}, Vol ${(volumeRatio * 100).toFixed(0)}%`,
                score: 0
            };
        }

        // PHASE 4: RESET (v9.3: requires 2+ signals AND global regime allows OR individual extreme case)
        if (stressSignals >= 2) {
            // Check global regime gating
            if (globalRegime && !globalRegime.allowReset) {
                // Market is healthy - only allow RESET for extreme individual cases
                // Extreme case: > 22% drawdown + price well below SMA200
                if (drawdown60d > 22 && price < sma200 * 0.80) {
                    return {
                        phase: 'RESET',
                        reason: `${stressReasons.join(', ')} [Individual extreme, market ${globalRegime.regime}]`,
                        score: 2
                    };
                }

                // Otherwise, classify as NORMAL despite stress signals
                return {
                    phase: 'NORMAL',
                    reason: `Price ${priceTosma200Pct >= 0 ? '+' : ''}${priceTosma200Pct.toFixed(1)}% vs SMA200, RSI ${rsi.toFixed(0)} [Market healthy, ${globalRegime.reason}]`,
                    score: 4
                };
            }

            // Global regime allows RESET
            return {
                phase: 'RESET',
                reason: stressReasons.join(', '),
                score: 2
            };
        }

        // PHASE 3: MELTUP (all conditions must be met)
        if (price > sma200 * 1.12 && rsi > 70 && volumeRatio > 1.5) {
            return {
                phase: 'MELTUP',
                reason: `Price +${priceTosma200Pct.toFixed(1)}% vs SMA200, RSI ${rsi.toFixed(0)}, Vol ${(volumeRatio * 100).toFixed(0)}%`,
                score: 8
            };
        }

        // PHASE 2: IGNITION (all conditions must be met)
        if (price > sma200 * 1.05 && rsi >= 60 && rsi <= 72 && volumeRatio > 1.3) {
            return {
                phase: 'IGNITION',
                reason: `Price +${priceTosma200Pct.toFixed(1)}% vs SMA200, RSI ${rsi.toFixed(0)}, Vol ${(volumeRatio * 100).toFixed(0)}%`,
                score: 6
            };
        }

        // PHASE 1: NORMAL (default)
        return {
            phase: 'NORMAL',
            reason: `Price ${priceTosma200Pct >= 0 ? '+' : ''}${priceTosma200Pct.toFixed(1)}% vs SMA200, RSI ${rsi.toFixed(0)}, Vol ${(volumeRatio * 100).toFixed(0)}%`,
            score: 4
        };
    }

    // ============================================================
    // PROBABILITY LADDER LOGIC
    // ============================================================

    /**
     * Determine if a rung at a given price is allowed based on probability rules
     */
    isRungAllowed(asset, targetPrice, probability) {
        const { price, indicators } = asset;
        const { sma200 } = indicators;

        const distFromSma200Pct = ((price - targetPrice) / sma200) * 100;

        // Probability rules
        if (probability === 80) {
            // Only if targetPrice < SMA200 - 8%
            return targetPrice < sma200 * 0.92;
        }
        if (probability === 60) {
            // Only if targetPrice < SMA200 - 5%
            return targetPrice < sma200 * 0.95;
        }
        // 30% and 5% are always allowed
        return true;
    }

    // ============================================================
    // SMCI-SPECIFIC HELPERS
    // ============================================================

    /**
     * Validate SMCI rung against position sizing caps
     */
    validateSMCIRung(rungCost, totalSMCIExposure, totalSMCILadderCapital, totalPortfolioValue) {
        // MAX_SMCI_EXPOSURE_PORTFOLIO = 5%
        if ((totalSMCIExposure + rungCost) > totalPortfolioValue * 0.05) {
            return { allowed: false, reason: 'SMCI cap hit – risk cage (5% exposure)' };
        }

        // MAX_SMCI_LADDERS_PORTFOLIO = 3%
        if ((totalSMCILadderCapital + rungCost) > totalPortfolioValue * 0.03) {
            return { allowed: false, reason: 'SMCI cap hit – risk cage (3% ladder)' };
        }

        // MAX_SMCI_RUNG_PORTFOLIO = 0.75%
        if (rungCost > totalPortfolioValue * 0.0075) {
            return { allowed: false, reason: 'SMCI cap hit – risk cage (0.75% per rung)' };
        }

        // MAX_RUNG_SHARE_OF_SMCI = 20%
        const futureExposure = totalSMCIExposure + rungCost;
        if (futureExposure > 0 && rungCost > futureExposure * 0.20) {
            return { allowed: false, reason: 'SMCI cap hit – risk cage (20% of SMCI)' };
        }

        return { allowed: true };
    }

    /**
     * Determine SMCI buy zone based on price distance from SMA200
     */
    getSMCIBuyZone(price, sma200) {
        const pctVsSMA200 = ((price - sma200) / sma200) * 100;

        if (pctVsSMA200 < -25) {
            return { zone: 'REJECT_BROKEN', allowed: false, reason: 'SMCI broken below structure – no knife catching' };
        }
        if (pctVsSMA200 > 20) {
            return { zone: 'REJECT_PARABOLIC', allowed: false, reason: 'SMCI parabolic – no chase' };
        }
        if (pctVsSMA200 >= -15 && pctVsSMA200 <= 5) {
            return { zone: 'STRUCTURAL', allowed: true, maxRungPct: 0.0075 }; // 0.75%
        }
        if (pctVsSMA200 >= -25 && pctVsSMA200 < -15) {
            return { zone: 'SNIPER', allowed: true, maxRungPct: 0.0025 }; // 0.25%
        }

        return { zone: 'NEUTRAL', allowed: false, reason: 'SMCI outside buy zones' };
    }

    /**
     * Check if a price falls within any banned zone
     */
    isSMCIPriceBanned(price) {
        return this.smciBannedZones.some(range =>
            price >= range.min && price <= range.max
        );
    }

    /**
     * Add a price to the banned zones list
     */
    addSMCIBannedZone(price, reason) {
        const range = {
            min: price * 0.97,
            max: price * 1.03,
            reason: reason,
            addedAt: new Date().toISOString()
        };
        this.smciBannedZones.push(range);
    }

    /**
     * Generate automatic dip rungs based on price distance from SMA200
     */
    generateAutoDipRungs(asset, dryPowder) {
        const { ticker, price, indicators } = asset;
        const { sma200 } = indicators;

        const newRungs = [];
        const priceTosma200Pct = ((price - sma200) / sma200) * 100;
        const assetType = this.getAssetType(ticker);

        // === CRASH PROTECTION (Asset-Specific) ===
        if (assetType === 'CRYPTO') {
            // CRYPTO CRASH BRAKES: More severe thresholds
            // 50% drawdown brake (vs 35% for stocks)
            if (indicators.drawdown60d > 50) {
                return newRungs;
            }

            // Super crash brake: price < 40% of SMA200 (vs 60% for stocks)
            if (price < sma200 * 0.40) {
                return newRungs;
            }
        } else {
            // STOCK CRASH BRAKES: Original thresholds
            // 35% drawdown brake
            if (indicators.drawdown60d > 35) {
                return newRungs;
            }

            // Super crash brake: price < 60% of SMA200
            if (price < sma200 * 0.60) {
                return newRungs;
            }
        }

        // Only generate if price is ACTUALLY below SMA200
        if (priceTosma200Pct >= -10) {
            // Not deep enough below SMA200 to auto-generate
            return newRungs;
        }

        // === DIP RUNGS (Asset-Specific) ===
        if (assetType === 'CRYPTO') {
            // CRYPTO DIP RUNGS: Much deeper (-40%, -60%, -80%)
            // First rung: -40% below SMA200
            if (priceTosma200Pct >= -50 && priceTosma200Pct < -30) {
                const targetPrice = sma200 * 0.60; // 40% below SMA200
                const allocation = dryPowder * 0.08; // 8% of dry powder

                if (allocation > targetPrice) {
                    newRungs.push({
                        price: targetPrice,
                        shares: Math.floor(allocation / targetPrice),
                        dollarValue: allocation,
                        probability: 30,
                        status: 'NEW',
                        reason: 'CRYPTO dip buy (40% below SMA200)'
                    });
                }
            }

            // Second rung: -60% below SMA200
            if (priceTosma200Pct < -50) {
                const targetPrice = sma200 * 0.40; // 60% below SMA200
                const allocation = dryPowder * 0.08; // 8% of dry powder

                if (allocation > targetPrice) {
                    newRungs.push({
                        price: targetPrice,
                        shares: Math.floor(allocation / targetPrice),
                        dollarValue: allocation,
                        probability: 10,
                        status: 'NEW',
                        reason: 'CRYPTO deep value (60% below SMA200)'
                    });
                }
            }

            // Third rung: -80% below SMA200 (ultimate crash buy)
            if (priceTosma200Pct < -70) {
                const targetPrice = sma200 * 0.20; // 80% below SMA200
                const allocation = dryPowder * 0.05; // 5% of dry powder

                if (allocation > targetPrice) {
                    newRungs.push({
                        price: targetPrice,
                        shares: Math.floor(allocation / targetPrice),
                        dollarValue: allocation,
                        probability: 5,
                        status: 'NEW',
                        reason: 'CRYPTO ultimate crash buy (80% below SMA200)'
                    });
                }
            }

        } else {
            // STOCK DIP RUNGS: Original logic (-20%, -30%)
            // First rung: -20% below SMA200
            if (priceTosma200Pct >= -25 && priceTosma200Pct < -15) {
                const targetPrice = sma200 * 0.80; // 20% below SMA200
                const allocation = dryPowder * 0.10; // 10% of dry powder

                if (allocation > targetPrice) {
                    newRungs.push({
                        price: targetPrice,
                        shares: Math.floor(allocation / targetPrice),
                        dollarValue: allocation,
                        probability: 30,
                        status: 'NEW',
                        reason: 'Auto-generated dip buy (20% below SMA200)'
                    });
                }
            }

            // Second rung: -30% below SMA200
            if (priceTosma200Pct < -25) {
                const targetPrice = sma200 * 0.70; // 30% below SMA200
                const allocation = dryPowder * 0.10; // 10% of dry powder

                if (allocation > targetPrice) {
                    newRungs.push({
                        price: targetPrice,
                        shares: Math.floor(allocation / targetPrice),
                        dollarValue: allocation,
                        probability: 5,
                        status: 'NEW',
                        reason: 'Auto-generated deep value (30% below SMA200)'
                    });
                }
            }
        }

        return newRungs;
    }

    /**
     * Generate SMCI-specific rungs based on structural and sniper zones
     */
    generateSMCIRungs(asset, dryPowder, totalPool) {
        const { price, indicators } = asset;
        const { sma200 } = indicators;

        const rungs = [];
        const zoneInfo = this.getSMCIBuyZone(price, sma200);

        if (!zoneInfo.allowed) {
            return rungs; // Rejected zone
        }

        // Calculate current SMCI exposure (position + pending)
        const totalSMCIExposure = asset.position_value;
        const totalSMCILadderCapital = asset.pending_orders.reduce((sum, o) => sum + (o.price * o.shares), 0);

        // Generate rungs based on zone
        if (zoneInfo.zone === 'STRUCTURAL') {
            // Normal structural rungs at -5%, -10%, -15%
            const rungPrices = [sma200 * 0.95, sma200 * 0.90, sma200 * 0.85];

            for (const targetPrice of rungPrices) {
                if (price <= targetPrice) continue; // Don't place above current price

                const allocation = Math.min(dryPowder * 0.10, totalPool * zoneInfo.maxRungPct);
                const shares = Math.floor(allocation / targetPrice);
                const cost = shares * targetPrice;

                // Validate caps
                const validation = this.validateSMCIRung(cost, totalSMCIExposure, totalSMCILadderCapital, totalPool);
                if (!validation.allowed) continue;

                // Check banned zones
                if (this.isSMCIPriceBanned(targetPrice)) continue;

                rungs.push({
                    price: targetPrice,
                    shares,
                    probability: 30,
                    status: 'NEW',
                    reason: `SMCI structural (${Math.round(((targetPrice / sma200) - 1) * 100)}% vs SMA200)`
                });
            }
        } else if (zoneInfo.zone === 'SNIPER') {
            // Sniper rung at -20%
            const targetPrice = sma200 * 0.80;
            if (price > targetPrice) {
                const allocation = totalPool * 0.0025; // 0.25% max
                const shares = Math.floor(allocation / targetPrice);
                const cost = shares * targetPrice;

                const validation = this.validateSMCIRung(cost, totalSMCIExposure, totalSMCILadderCapital, totalPool);
                if (validation.allowed && !this.isSMCIPriceBanned(targetPrice)) {
                    rungs.push({
                        price: targetPrice,
                        shares,
                        probability: 10,
                        status: 'NEW',
                        reason: 'SNIPER – deep flush, optional'
                    });
                }
            }
        }

        return rungs;
    }

    // ============================================================
    // ACTION LOGIC PER PHASE
    // ============================================================

    getPhaseAction(asset, regime, dryPowder, totalPool) {
        const { ticker, position_shares, position_value, pending_orders } = asset;
        const { phase } = regime;

        const action = {
            phase,
            coreTrim: null, // { shares, reason }
            coreAction: 'HOLD',
            newRungs: [],
            modifiedRungs: [],
            meltupExits: null
        };

        // GOOG: Monitor only
        if (this.monitorOnly.includes(ticker)) {
            action.coreAction = 'MONITOR (BAN)';
            return action;
        }

        // CATASTROPHIC: Full exit
        if (phase === 'CATASTROPHIC') {
            action.coreAction = 'EXIT';
            action.coreTrim = {
                shares: position_shares,
                reason: 'Catastrophic breakdown - Full exit'
            };
            // Cancel all pending orders
            action.modifiedRungs = pending_orders.map(o => ({
                ...o,
                status: 'CANCEL',
                reason: 'Catastrophic phase - Cancel all'
            }));
            return action;
        }

        // Detect asset type for type-specific actions
        const assetType = this.getAssetType(ticker);

        // ===== PARABOLIC PHASE (Crypto Only) =====
        if (phase === 'PARABOLIC') {
            // Blowoff top detected - hold core but set immediate exit
            const { indicators } = asset;

            // Exit trigger: If RSI > 85 and volume spikes even more, exit 70%
            if (indicators.rsi > 85) {
                action.coreTrim = {
                    shares: Math.floor(position_shares * 0.70),
                    reason: 'PARABOLIC BLOWOFF (RSI > 85) - Exit 70%'
                };
            }

            // Set extreme exit targets (capture moonshot)
            const currentPrice = asset.price;
            const exitTargets = [
                { price: currentPrice * 1.50, pct: 0.10 }, // +50%, sell 10%
                { price: currentPrice * 2.00, pct: 0.20 }, // +100%, sell 20%
                { price: currentPrice * 3.00, pct: 0.30 }, // +200%, sell 30%
                { price: currentPrice * 5.00, pct: 0.40 }  // +400%, sell 40%
            ];

            action.meltupExits = exitTargets.map(t => ({
                price: t.price,
                shares: Math.floor(position_shares * t.pct),
                reason: `Parabolic Exit (+${Math.round((t.price / currentPrice - 1) * 100)}%)`
            })).filter(t => t.shares > 0);

            // Cancel all buys
            action.modifiedRungs = pending_orders.map(o => ({
                ...o,
                status: 'CANCEL',
                reason: 'PARABOLIC - No buying at blowoff'
            }));

            return action;
        }

        // ===== SMCI PHASE (Strict Risk Cage) =====
        if (assetType === 'SMCI') {
            // CATASTROPHIC: Nuke 70% immediately
            if (phase === 'CATASTROPHIC') {
                action.coreTrim = {
                    shares: Math.floor(position_shares * 0.70),
                    reason: 'SMCI CATASTROPHIC – Fail fast 70% exit'
                };

                // Cancel ALL orders
                action.modifiedRungs = pending_orders.map(o => ({
                    ...o,
                    status: 'CANCEL',
                    reason: 'SMCI CATASTROPHIC - Clear all'
                }));

                // Optional sniper of last resort (if remaining exposure <= 2% of portfolio)
                if (position_value * 0.30 <= totalPool * 0.02) {
                    const sniperPrice = asset.indicators.sma200 * 0.78; // -22%
                    const sniperAllocation = totalPool * 0.0025; // 0.25%
                    const sniperShares = Math.floor(sniperAllocation / sniperPrice);

                    if (sniperShares > 0) {
                        action.newRungs.push({
                            price: sniperPrice,
                            shares: sniperShares,
                            probability: 5,
                            status: 'NEW',
                            reason: 'SNIPER – post-flush probe'
                        });
                    }
                }

                return action;
            }

            // RESET: Trim 50% into strength
            if (phase === 'RESET') {
                action.coreTrim = {
                    shares: Math.floor(position_shares * 0.50),
                    reason: 'SMCI RESET – Derisk 50% into strength'
                };

                // Cancel buys ABOVE SMA200
                const { sma200 } = asset.indicators;
                action.modifiedRungs = pending_orders
                    .filter(o => o.price > sma200)
                    .map(o => ({
                        ...o,
                        status: 'CANCEL',
                        reason: 'SMCI RESET - Cancel above SMA200'
                    }));

                return action;
            }

            // NORMAL: Generate rungs (with zone/cap validation)
            if (phase === 'NORMAL') {
                action.newRungs = this.generateSMCIRungs(asset, dryPowder, totalPool);
                return action;
            }
        }

        // ===== RESET PHASE =====
        if (phase === 'RESET') {
            const { price, indicators } = asset;
            const { sma200 } = indicators;

            if (assetType === 'CRYPTO') {
                // CRYPTO RESET: Only trim if above 70% of SMA200
                if (price > sma200 * 0.70) {
                    const trimShares = Math.floor(position_shares * 0.35);
                    if (trimShares > 0) {
                        action.coreTrim = {
                            shares: trimShares,
                            reason: 'CRYPTO RESET - Proactive 35% derisking'
                        };
                    }
                }
            } else {
                // STOCK RESET: Only trim if above 90% of SMA200
                if (price > sma200 * 0.90) {
                    const trimShares = Math.floor(position_shares * 0.35);
                    if (trimShares > 0) {
                        action.coreTrim = {
                            shares: trimShares,
                            reason: 'RESET phase - Proactive 35% derisking'
                        };
                    }
                }
            }

            // Generate new lower rungs
            action.newRungs = this.generateAutoDipRungs(asset, dryPowder);

            // Cancel high-probability rungs (60%, 80%)
            action.modifiedRungs = pending_orders
                .filter(o => o.probability >= 60)
                .map(o => ({
                    ...o,
                    status: 'CANCEL',
                    reason: 'RESET phase - Cancel high-prob rungs'
                }));

            return action;
        }

        // ===== MELTUP PHASE =====
        if (phase === 'MELTUP') {
            const { indicators } = asset;
            const currentPrice = asset.price;

            if (assetType === 'CRYPTO') {
                // CRYPTO MELTUP: Hold until truly insane (RSI > 90)
                if (indicators.rsi > 90) {
                    const trimShares = Math.floor(position_shares * 0.10);
                    if (trimShares > 0) {
                        action.coreTrim = {
                            shares: trimShares,
                            reason: 'CRYPTO MELTUP (RSI > 90) - Light trim 10%'
                        };
                    }
                }

                // Crypto exit targets: Much more aggressive (ride the moon)
                const exitTargets = [
                    { price: currentPrice * 1.50, pct: 0.05 }, // +50%, sell 5%
                    { price: currentPrice * 2.00, pct: 0.10 }, // +100%, sell 10%
                    { price: currentPrice * 3.00, pct: 0.15 }, // +200%, sell 15%
                    { price: currentPrice * 5.00, pct: 0.20 }, // +400%, sell 20%
                    { price: currentPrice * 10.0, pct: 0.50 }  // +900%, sell 50%
                ];

                action.meltupExits = exitTargets.map(t => ({
                    price: t.price,
                    shares: Math.floor(position_shares * t.pct),
                    reason: `Crypto Meltup Exit (+${Math.round((t.price / currentPrice - 1) * 100)}%)`
                })).filter(t => t.shares > 0);

            } else {
                // STOCK MELTUP: Original logic (trim at RSI > 90)
                if (indicators.rsi > 90) {
                    const trimShares = Math.floor(position_shares * 0.10);
                    if (trimShares > 0) {
                        action.coreTrim = {
                            shares: trimShares,
                            reason: 'MELTUP phase (Insane RSI > 90) - Proactive 10% trim'
                        };
                    }
                }

                // Stock exit targets: Conservative
                const exitTargets = [
                    { price: currentPrice * 1.20, pct: 0.05 }, // +20%, sell 5%
                    { price: currentPrice * 1.40, pct: 0.10 }, // +40%, sell 10%
                    { price: currentPrice * 1.70, pct: 0.15 }, // +70%, sell 15%
                    { price: currentPrice * 2.00, pct: 0.20 }, // +100%, sell 20%
                    { price: currentPrice * 3.00, pct: 0.50 }  // +200%, sell 50%
                ];

                action.meltupExits = exitTargets.map(t => ({
                    price: t.price,
                    shares: Math.floor(position_shares * t.pct),
                    reason: `Meltup Exit (+${Math.round((t.price / currentPrice - 1) * 100)}%)`
                })).filter(t => t.shares > 0);
            }

            // Cancel all new buys
            action.modifiedRungs = pending_orders.map(o => ({
                ...o,
                status: 'CANCEL',
                reason: 'MELTUP - Stop buying'
            }));

            return action;
        }

        // IGNITION: Deploy 20% dry powder at fair value
        if (phase === 'IGNITION') {
            const deploymentAmount = dryPowder * 0.20;
            const fairValue = asset.indicators.sma200;

            if (asset.price <= fairValue * 1.02) {
                action.newRungs.push({
                    price: fairValue,
                    shares: Math.floor(deploymentAmount / fairValue),
                    dollarValue: deploymentAmount,
                    probability: 30,
                    status: 'NEW',
                    reason: 'IGNITION - Fair value entry'
                });
            }

            // Freeze deep rungs
            action.modifiedRungs = pending_orders
                .filter(o => o.price < asset.price * 0.85)
                .map(o => ({
                    ...o,
                    status: 'CANCEL',
                    reason: 'IGNITION - Freeze deep rungs'
                }));

            return action;
        }

        // NORMAL: Hold + allow 30% and 5% rungs
        // Keep existing rungs but filter high-probability ones
        action.modifiedRungs = pending_orders
            .filter(o => o.probability >= 60)
            .map(o => ({
                ...o,
                status: 'CANCEL',
                reason: 'NORMAL - Only 30% and 5% allowed'
            }));

        return action;
    }

    /**
     * Generate 5-tranche meltup exit plan
     */
    generate5TrancheExits(asset) {
        const { position_shares, price, indicators } = asset;
        const { sma200, rsi } = indicators;

        const sharesPerTranche = Math.floor(position_shares / 5);

        return {
            tranches: [
                {
                    shares: sharesPerTranche,
                    trigger: `Price >= $${(sma200 * 1.12).toFixed(2)}`,
                    reason: 'SMA200 + 12%'
                },
                {
                    shares: sharesPerTranche,
                    trigger: `Price >= $${(sma200 * 1.18).toFixed(2)}`,
                    reason: 'SMA200 + 18%'
                },
                {
                    shares: sharesPerTranche,
                    trigger: 'RSI >= 80',
                    reason: 'Extreme overbought'
                },
                {
                    shares: sharesPerTranche,
                    trigger: 'New ATH + Divergence',
                    reason: 'Negative divergence signal'
                },
                {
                    shares: position_shares - (sharesPerTranche * 4),
                    trigger: 'Trailing stop -8%',
                    reason: '8% off local peak'
                }
            ]
        };
    }

    // ============================================================
    // MAIN ALLOCATION ENGINE
    // ============================================================

    generateGlobalPoolPlan(input) {
        const plan = {
            assetPlans: {},
            global: {
                totalPool: input.cash_available,
                initialCash: input.cash_available,
                deployedValue: 0,
                dryPowder: input.cash_available,
                regime: null,
                spyRegime: null  // v9.3: Global market regime
            },
            rejectedRungs: [],
            summary: ''
        };

        // v9.3: Analyze global market regime using SPY
        const spyAsset = input.assets['SPY'];
        const globalRegime = this.analyzeGlobalRegime(spyAsset);
        plan.global.spyRegime = globalRegime;

        // Calculate dry powder (40% bootstrap limit)
        const maxInitialDeployment = input.cash_available * this.BOOTSTRAP_LIMIT;
        let dryPowder = input.cash_available;

        // Process each asset
        Object.values(input.assets).forEach(asset => {
            // v9.3: Pass globalRegime to detectPhase for gating
            const regime = this.detectPhase(asset, globalRegime);
            const action = this.getPhaseAction(asset, regime, dryPowder, input.cash_available);

            const assetPlan = {
                ticker: asset.ticker,
                price: asset.price, // Pass price for reporting
                regime,
                action: action.coreAction,
                coreTrim: action.coreTrim,
                ladder: [],
                newRungs: action.newRungs || [],
                meltupExits: action.meltupExits,
                position: {
                    shares: asset.position_shares,
                    value: asset.position_value
                }
            };

            // Process existing orders
            asset.pending_orders.forEach(order => {
                const modified = action.modifiedRungs.find(m =>
                    Math.abs(m.price - order.price) < 0.01 && m.size === order.size
                );

                if (modified) {
                    assetPlan.ladder.push(modified);
                    if (modified.status === 'CANCEL') {
                        dryPowder += order.price * order.size;
                    }
                } else {
                    assetPlan.ladder.push({
                        price: order.price,
                        shares: order.size,
                        status: 'KEEP',
                        reason: 'Active'
                    });
                }
            });

            // Add new rungs
            action.newRungs.forEach(rung => {
                assetPlan.ladder.push(rung);
                dryPowder -= rung.dollarValue;
            });

            plan.assetPlans[asset.ticker] = assetPlan;
        });

        plan.global.dryPowder = dryPowder;
        plan.global.deployedValue = input.cash_available - dryPowder;

        return plan;
    }

    // ============================================================
    // OUTPUT RENDERING
    // ============================================================

    renderReport(input, plan) {
        let report = `╔═══════════════════════════════════════╗\n`;
        report += `║  ANTIGRAVITY v9.2 ALLOCATOR ENGINE  ║\n`;
        report += `╚═══════════════════════════════════════╝\n\n`;

        // Regime Summary
        report += `═══ REGIME SUMMARY ═══\n`;
        Object.values(plan.assetPlans).forEach(p => {
            report += `\n${p.ticker}:\n`;
            report += `  Phase: ${p.regime.phase}\n`;
            report += `  Reason: ${p.regime.reason}\n`;
            report += `  Action: ${p.action}\n`;
            if (p.coreTrim) {
                report += `  Core Trim: ${p.coreTrim.shares} shares (${p.coreTrim.reason})\n`;
            }
        });

        // Core Holdings
        report += `\n\n═══ CORE HOLDINGS ═══\n`;
        Object.values(plan.assetPlans).forEach(p => {
            if (p.position.shares > 0) {
                const targetShares = p.coreTrim
                    ? p.position.shares - p.coreTrim.shares
                    : p.position.shares;

                const value = p.position.shares * p.price;
                const valueStr = value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

                report += `${p.ticker}: ${p.position.shares} shares (${valueStr})`;
                if (targetShares !== p.position.shares) {
                    report += ` → ${targetShares}`;
                }
                if (p.coreTrim) {
                    report += ` (Trim ${p.coreTrim.shares})`;
                }
                report += `\n`;
            }
        });

        // Ladder Details
        report += `\n\n═══ LADDER RUNGS ═══\n`;
        Object.values(plan.assetPlans).forEach(p => {
            if (p.ladder.length > 0 || p.newRungs.length > 0) {
                report += `\n${p.ticker}:\n`;
                p.ladder.forEach(rung => {
                    const statusIcon = rung.status === 'KEEP' ? '✓' :
                        rung.status === 'CANCEL' ? '✗' : '★';
                    report += `  ${statusIcon} $${rung.price.toFixed(2)} × ${rung.shares} shares`;
                    if (rung.probability) {
                        report += ` [${rung.probability}%]`;
                    }
                    report += ` - ${rung.reason}\n`;
                });
            }
        });

        // Meltup Exits
        const meltupAssets = Object.values(plan.assetPlans).filter(p => p.meltupExits);
        if (meltupAssets.length > 0) {
            report += `\n\n═══ MELTUP EXIT PLAN ═══\n`;
            meltupAssets.forEach(p => {
                report += `\n${p.ticker} (5-Tranche Exits):\n`;
                p.meltupExits.tranches.forEach((t, i) => {
                    report += `  ${i + 1}. ${t.shares} shares @ ${t.trigger} (${t.reason})\n`;
                });
            });
        }

        // Pool Summary
        report += `\n\n═══ POOL SUMMARY ═══\n`;
        report += `Total Pool: $${plan.global.totalPool.toLocaleString()}\n`;
        report += `Deployed: $${plan.global.deployedValue.toLocaleString()} (${((plan.global.deployedValue / plan.global.totalPool) * 100).toFixed(1)}%)\n`;
        report += `Dry Powder: $${plan.global.dryPowder.toLocaleString()} (${((plan.global.dryPowder / plan.global.totalPool) * 100).toFixed(1)}%)\n`;

        return report;
    }

    // ============================================================
    // INTEGRATION METHODS (for existing UI)
    // ============================================================

    getUserState() {
        const input = document.getElementById('portfolioInput');
        if (!input) return null;
        try {
            return JSON.parse(input.value);
        } catch (e) {
            console.error("Failed to parse portfolio input:", e);
            return null;
        }
    }

    constructInputState(dataMap) {
        // Build input from dataMap - handles BOTH daily allocator and backtest structures
        const input = {
            cash_available: this.cashAvailable,
            assets: {}
        };

        // Determine data structure type by checking first ticker
        const firstTicker = Object.keys(dataMap)[0];
        const firstData = dataMap[firstTicker];
        const isBacktestData = Array.isArray(firstData) && firstData[0] && firstData[0].close !== undefined;

        // Process tickers in our universe + SPY (needed for global regime analysis)
        const allTickers = [...this.assets, ...this.monitorOnly, 'SPY'];

        allTickers.forEach(ticker => {
            const data = dataMap[ticker];
            if (!data) {
                console.warn(`[Allocator] No data for ${ticker}`);
                return;
            }

            let price, rsi, sma200, ema20, volume, volumeAvg20, drawdown60d;

            if (isBacktestData) {
                // BACKTEST STRUCTURE: Array of {date, close, rsi, sma200, etc}
                if (data.length === 0) return;
                const latest = data[data.length - 1];

                if (!latest || !latest.close) {
                    console.warn(`[Allocator] Skipping ${ticker}: missing price data in backtest`);
                    return;
                }

                price = latest.close;
                rsi = latest.rsi || 50;
                sma200 = latest.sma200 || latest.close;
                ema20 = latest.ema20 || latest.close;
                volume = latest.volume || 1000000;
                volumeAvg20 = latest.volumeAvg20 || volume;

                // Calculate drawdown from 60-day high
                const priceHistory = data.map(d => d.close);
                drawdown60d = this.calculateDrawdown(priceHistory, price);
            } else {
                // DAILY ALLOCATOR STRUCTURE: {indicators: {quote: [{close: [...], high: [...]}]}}
                if (!data.indicators || !data.indicators.quote || !data.indicators.quote[0]) {
                    console.warn(`[Allocator] Skipping ${ticker}: invalid data structure`);
                    return;
                }

                const quote = data.indicators.quote[0];
                const closes = quote.close.filter(c => c !== null);
                const volumes = quote.volume.filter(v => v !== null);

                if (closes.length === 0) {
                    console.warn(`[Allocator] Skipping ${ticker}: no price data`);
                    return;
                }

                price = closes[closes.length - 1];

                // Calculate indicators
                if (closes.length > 200) {
                    const rsiSeries = calculateRSI(closes);
                    rsi = rsiSeries[rsiSeries.length - 1];
                    sma200 = calculateSMA(closes, 200);
                    ema20 = calculateSMA(closes, 20); // Use SMA as proxy for EMA
                } else {
                    rsi = 50;
                    sma200 = price;
                    ema20 = price;
                }

                // Volume metrics
                if (volumes.length > 20) {
                    volume = volumes[volumes.length - 1];
                    volumeAvg20 = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
                } else {
                    volume = 1000000;
                    volumeAvg20 = 1000000;
                }

                // Calculate drawdown from 60-day high
                drawdown60d = this.calculateDrawdown(closes, price);
            }

            const rawHolding = this.userState.holdings[ticker];
            const shares = (typeof rawHolding === 'object' && rawHolding !== null) ? (rawHolding.shares || 0) : (Number(rawHolding) || 0);

            console.log(`[Allocator] ${ticker}: RawHolding=`, rawHolding, `Shares=${shares}`);

            input.assets[ticker] = {
                ticker,
                price: price || 0,
                position_shares: shares,
                position_value: shares * (price || 0),
                pending_orders: this.userState.limits[ticker] || [],
                indicators: {
                    rsi,
                    sma200,
                    ema20,
                    volume,
                    volumeAvg20,
                    drawdown60d  // v9.3: NEW
                }
            };
        });

        return input;
    }

    runDailyCycle(dataMap) {
        // Get user state
        const customState = this.getUserState();
        if (customState) {
            this.cashAvailable = customState.cash !== undefined ? customState.cash : 0;
            this.userState = {
                holdings: customState.holdings || {},
                limits: customState.limits || {},
                blacklist: customState.blacklist || {},
                rejectedRungs: customState.rejectedRungs || {}
            };
        }

        // Construct input
        const input = this.constructInputState(dataMap);

        // Generate plan
        const plan = this.generateGlobalPoolPlan(input);
        this.lastPlan = plan;

        // Render
        const report = this.renderReport(input, plan);

        // Display
        const outputEl = document.getElementById('allocatorOutput');
        if (outputEl) outputEl.textContent = report;

        return plan;
    }

    commitChanges() {
        if (!this.lastPlan) {
            alert("No plan to commit");
            return;
        }

        const inputEl = document.getElementById('portfolioInput');
        if (!inputEl) return;

        let state;
        try {
            state = JSON.parse(inputEl.value);
        } catch (e) {
            alert("Invalid JSON in portfolio input");
            return;
        }

        // Initialize if missing
        if (!state.holdings) state.holdings = {};
        if (!state.limits) state.limits = {};
        if (state.cash === undefined) state.cash = 100000;

        let log = [];

        // Process Plan
        Object.values(this.lastPlan.assetPlans).forEach(plan => {
            const ticker = plan.ticker;

            // 1. Handle Trims/Exits (Immediate Execution)
            if (plan.action === 'EXIT' || (plan.coreTrim && plan.coreTrim.shares > 0)) {
                const rawHolding = state.holdings[ticker];
                const currentShares = (typeof rawHolding === 'object' && rawHolding !== null) ? (rawHolding.shares || 0) : (Number(rawHolding) || 0);

                let sharesToSell = 0;

                if (plan.action === 'EXIT') {
                    sharesToSell = currentShares;
                } else if (plan.coreTrim) {
                    sharesToSell = plan.coreTrim.shares;
                }

                if (sharesToSell > 0) {
                    const newShares = Math.max(0, currentShares - sharesToSell);

                    // Update state preserving structure
                    if (typeof rawHolding === 'object' && rawHolding !== null) {
                        state.holdings[ticker].shares = newShares;
                    } else {
                        state.holdings[ticker] = newShares;
                    }

                    log.push(`SOLD ${sharesToSell} ${ticker} (Update Cash Manually)`);
                }
            }

            // 2. Handle Ladder (Limits)
            if (!state.limits[ticker]) state.limits[ticker] = [];

            // Remove CANCELs
            const cancels = plan.ladder.filter(r => r.status === 'CANCEL');
            cancels.forEach(c => {
                const idx = state.limits[ticker].findIndex(l => Math.abs(l.price - c.price) < 0.01 && l.size === c.shares);
                if (idx !== -1) {
                    state.limits[ticker].splice(idx, 1);
                    // Add cash back? 
                    // state.cash += c.price * c.shares; 
                    log.push(`CANCELLED ${ticker} ${c.shares} @ $${c.price}`);
                }
            });

            // Add NEWs
            const newRungs = plan.ladder.filter(r => r.status === 'NEW');
            newRungs.forEach(r => {
                state.limits[ticker].push({
                    price: r.price,
                    size: r.shares,
                    note: r.reason
                });
                // Deduct cash?
                // state.cash -= r.price * r.shares;
                log.push(`ADDED ${ticker} ${r.shares} @ $${r.price}`);
            });
        });

        // Update UI
        inputEl.value = JSON.stringify(state, null, 4);

        // Feedback
        if (log.length > 0) {
            alert(`Committed Changes:\n${log.join('\n')}\n\nJSON updated. Please review cash balance.`);
        } else {
            alert("No changes to commit.");
        }
    }
}

// Instantiate the Antigravity v9.2 Allocator
const rawArcAllocator = new AntigravityAllocatorV92();

// Initialize Button
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('runAllocatorBtn').addEventListener('click', () => {
        if (!window.marketDataCache) {
            alert("Market data not ready yet. Please wait...");
            return;
        }
        rawArcAllocator.runDailyCycle(window.marketDataCache);
    });

    document.getElementById('confirmChangesBtn').addEventListener('click', () => {
        rawArcAllocator.commitChanges();
    });
});

class DataManager {
    constructor() {
        this.cache = {};
        this.CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
        this.STALE_DURATION = 60 * 1000; // 1 minute (refresh in background if older)
        this.loadFromStorage();
    }

    getProxyBaseUrl() {
        const hostname = window.location.hostname;
        // Handle localhost, 127.0.0.1, AND file protocol (empty hostname)
        if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1') {
            return 'http://localhost:8001';
        }
        return '/api/proxy';
    }

    loadFromStorage() {
        try {
            const stored = localStorage.getItem('stockDataCache');
            if (stored) {
                this.cache = JSON.parse(stored);
            }
        } catch (e) {
            console.error("Failed to load cache", e);
        }
    }

    saveToStorage() {
        try {
            localStorage.setItem('stockDataCache', JSON.stringify(this.cache));
        } catch (e) {
            console.error("Failed to save cache", e);
        }
    }

    async fetchWithRetry(url, retries = 3, backoff = 500) {
        for (let i = 0; i < retries; i++) {
            try {
                const response = await fetch(url);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return await response.json();
            } catch (err) {
                if (i === retries - 1) throw err;
                await new Promise(r => setTimeout(r, backoff * Math.pow(2, i)));
            }
        }
    }

    async getStockData(symbol, range = '1mo', interval = '1d') {
        const key = `${symbol}-${range}-${interval}`;
        const now = Date.now();
        const cached = this.cache[key];

        // 1. Return cached data immediately if available
        if (cached) {
            // If fresh enough, just return it
            if (now - cached.timestamp < this.STALE_DURATION) {
                console.log(`[Cache] Hit for ${key}`);
                return { data: cached.data, source: 'cache' };
            }
            // If stale but valid, return it and fetch in background
            console.log(`[Cache] Stale hit for ${key}. Fetching background...`);
            this.fetchAndCache(symbol, range, interval).then(newData => {
                if (newData) {
                    // Dispatch event to update UI if user is still viewing this
                    document.dispatchEvent(new CustomEvent('dataUpdated', { detail: { symbol, key } }));
                }
            });
            return { data: cached.data, source: 'stale' };
        }

        // 2. No cache, fetch fresh
        console.log(`[Cache] Miss for ${key}`);
        const data = await this.fetchAndCache(symbol, range, interval);
        return { data, source: 'network' };
    }

    async fetchAndCache(symbol, range, interval) {
        try {
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=${range}`;
            // Use dynamic proxy server (local or Vercel)
            const proxyBase = this.getProxyBaseUrl();
            const proxyUrl = `${proxyBase}/?url=${encodeURIComponent(url)}`;

            console.log(`[API] Fetching ${symbol} (${range})...`);
            const response = await fetch(proxyUrl);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const json = await response.json();

            if (!json.chart || !json.chart.result || json.chart.result.length === 0) {
                throw new Error('No data found');
            }

            const result = json.chart.result[0];
            const key = `${symbol}-${range}-${interval}`;

            this.cache[key] = {
                timestamp: Date.now(),
                data: result
            };
            this.saveToStorage();
            console.log(`[API] ✓ Success for ${symbol}`);
            return result;
        } catch (error) {
            console.error(`[API] ✗ Error fetching ${symbol}:`, error.message);
            return null;
        }
    }

    // Fetch current quotes for multiple symbols in one request
    async fetchBatchQuotes(symbols) {
        try {
            const symbolsParam = symbols.join(',');
            const url = `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${symbolsParam}&range=1d&interval=1d`;
            const proxyBase = this.getProxyBaseUrl();
            const proxyUrl = `${proxyBase}/?url=${encodeURIComponent(url)}`;

            console.log('[Batch API] Fetching batch quotes...');
            const response = await fetch(proxyUrl);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const json = await response.json();

            if (!json) {
                throw new Error('No spark data found');
            }

            // Map Spark response to Quote format
            const results = Object.values(json).map(data => {
                const currentPrice = data.close && data.close.length > 0 ? data.close[data.close.length - 1] : null;
                const prevClose = data.chartPreviousClose;

                if (!currentPrice || !prevClose) return null;

                const change = ((currentPrice - prevClose) / prevClose) * 100;

                return {
                    symbol: data.symbol,
                    regularMarketPrice: currentPrice,
                    regularMarketChangePercent: change,
                    regularMarketVolume: 0 // Volume not available in simple spark
                };
            }).filter(item => item !== null);

            console.log(`[Batch API] ✓ Got ${results.length} quotes`);
            return results;

        } catch (error) {
            console.error('[Batch API] ✗ Error:', error.message);
            return [];
        }
    }

    // Clear cache for a specific symbol to force refresh
    invalidate(symbol) {
        Object.keys(this.cache).forEach(key => {
            if (key.startsWith(symbol)) delete this.cache[key];
        });
        this.saveToStorage();
    }
}

const dataManager = new DataManager();
window.dataManager = dataManager; // Expose globally for allocator

// Fetch Stock Data (Wrapper using DataManager)
const fetchStockData = async (symbol, range = '1mo', interval = '1d') => {
    const result = await dataManager.getStockData(symbol, range, interval);
    return result ? result.data : null;
};

// View Management
const showDashboard = () => {
    elements.detailView.classList.add('hidden');
    elements.dashboardView.classList.remove('hidden');
    initDashboard();
};

const showDetail = (symbol) => {
    elements.dashboardView.classList.add('hidden');
    elements.detailView.classList.remove('hidden');
    updateStock(symbol);
};

// Dashboard Logic
const initDashboard = async () => {
    elements.dashboardList.innerHTML = '';

    // 1. Create rows with placeholders immediately
    const rowMap = {};
    for (const symbol of WATCHLIST) {
        const row = document.createElement('tr');
        row.id = `row-${symbol}`;
        row.innerHTML = `
            <td class="ticker-cell">${symbol}</td>
            <td class="price-cell">Loading...</td>
            <td class="change">--</td>
            <td><span class="status-badge neutral">Loading...</span></td>
            <td>--</td>
            <td><span class="status-badge" id="dashSignal-${symbol}">--</span></td>
            <td class="price-cell">--</td>
            <td><button class="action-btn">View</button></td>
        `;
        elements.dashboardList.appendChild(row);
        rowMap[symbol] = row;

        // Add click listener for "View" button
        const viewBtn = row.querySelector('.action-btn');
        if (viewBtn) {
            viewBtn.addEventListener('click', () => showDetail(symbol));
        }
    }

    // 2. Fetch Batch Quotes (Fast)
    console.log("Fetching batch quotes...");
    const quotes = await dataManager.fetchBatchQuotes(WATCHLIST);

    quotes.forEach(quote => {
        const symbol = quote.symbol;
        const row = rowMap[symbol];
        if (!row) return;

        const price = quote.regularMarketPrice;
        const change = quote.regularMarketChangePercent;
        const volume = quote.regularMarketVolume;

        // Update basic info
        row.querySelector('.price-cell').textContent = `$${price.toFixed(2)}`;
        const changeCell = row.querySelector('.change');
        changeCell.textContent = `${change > 0 ? '+' : ''}${change.toFixed(2)}%`;
        changeCell.className = `change ${change >= 0 ? 'positive' : 'negative'}`;
    });

    // 3. Background Fetch for Indicators (Slow)
    console.log("Starting background fetch for indicators...");

    const fullDataMap = {}; // Store data for Ignition Detector

    // Add ETH, DXY, VIX, TNX, and SPY to fetch list
    const extendedWatchlist = [...new Set([...WATCHLIST, 'ETH-USD', 'DX-Y.NYB', '^VIX', '^TNX', 'SPY'])];

    // Process one by one to avoid choking network, but start immediately
    const fetchPromises = extendedWatchlist.map(symbol =>
        fetchStockData(symbol, '1y', '1d').then(data => {
            if (!data) return;

            fullDataMap[symbol] = data; // Store for global analysis

            // Only update UI rows for actual watchlist items
            if (WATCHLIST.includes(symbol)) {
                const row = rowMap[symbol];
                if (!row) return;

                const meta = data.meta;
                const currentPrice = meta.regularMarketPrice;

                // Indicators
                let rsi = null;
                let sma200 = null;
                let status = 'Neutral';
                let statusClass = 'neutral';

                if (data.indicators.quote[0].close) {
                    const quotes = data.indicators.quote[0].close.filter(p => p !== null);
                    const rsiSeries = calculateRSI(quotes);
                    rsi = rsiSeries ? rsiSeries[rsiSeries.length - 1] : null;
                    sma200 = calculateSMA(quotes, 200);
                }

                // Euphoria Logic
                if (rsi && sma200) {
                    const extension = ((currentPrice - sma200) / sma200) * 100;
                    let euphoriaScore = 0;

                    // Adjusted thresholds
                    if (rsi > 75) euphoriaScore += 1;
                    if (rsi > 85) euphoriaScore += 1;
                    if (extension > 30) euphoriaScore += 1;
                    if (extension > 50) euphoriaScore += 1;

                    if (euphoriaScore >= 3) { status = 'EXTREME GREED'; statusClass = 'sell'; }
                    else if (euphoriaScore >= 1) { status = 'Elevated'; statusClass = 'sell'; }
                    else if (rsi < 30) { status = 'Fear'; statusClass = 'buy'; }
                }

                // Update Status and RSI
                const statusBadge = row.querySelectorAll('.status-badge')[0];
                statusBadge.textContent = status;
                statusBadge.className = `status-badge ${statusClass}`;

                const rsiCell = row.children[4];
                rsiCell.textContent = rsi ? rsi.toFixed(1) : 'N/A';
                rsiCell.style.color = rsi > 70 ? 'var(--danger)' : (rsi < 30 ? 'var(--success)' : 'inherit');

                // Calculate Support Levels for "Next Buy Level"
                let nextBuyPrice = currentPrice * 0.85; // Default fallback
                let nextBuyAlloc = 15;

                if (data.indicators.quote[0].close) {
                    const rawQuotes = data.indicators.quote[0].close;
                    const longTermQuotes = rawQuotes.filter(p => p !== null);
                    const volumes = data.indicators.quote[0].volume.filter(v => v !== null);

                    const levels = detectSupportResistanceLevels(longTermQuotes, volumes, currentPrice);
                    if (levels.length > 0) {
                        nextBuyPrice = levels[0].price;
                        nextBuyAlloc = levels[0].allocation;
                    }

                    // Update Next Buy Level
                    const buyCell = row.children[6];
                    buyCell.innerHTML = `$${nextBuyPrice.toFixed(2)} <span style="color: var(--success); font-weight: 600;">(${nextBuyAlloc}%)</span>`;

                    // Calculate Meltup Signal
                    let signal = { signal: 'HOLD', action: 'Hold' };

                    // Check for specific Stock Meltup Exit signals first
                    const specificSignal = stockMeltupExit.analyze(symbol, data, fullDataMap['SPY']);
                    if (specificSignal && specificSignal.status !== 'ACTIVE MELTUP') {
                        signal = { signal: specificSignal.status, action: specificSignal.action };
                    } else {
                        // Fallback to generic signal
                        signal = getMeltupSignal(symbol, longTermQuotes, volumes);
                    }

                    const signalBadge = row.querySelector(`#dashSignal-${symbol}`);

                    if (signalBadge) {
                        signalBadge.textContent = signal.signal;
                        if (signal.signal.includes('TRIM') || signal.signal.includes('EXIT') || signal.signal.includes('EXECUTION')) {
                            signalBadge.className = 'status-badge sell';
                            signalBadge.style.animation = 'pulse 2s infinite';
                        } else if (signal.signal.includes('DISTRIBUTION') || signal.signal.includes('WARNING')) {
                            signalBadge.className = 'status-badge warning';
                        } else {
                            signalBadge.className = 'status-badge neutral';
                        }
                    }
                }
            }
        })
    );

    // Wait for all data then run Ignition Detector
    Promise.all(fetchPromises).then(() => {
        // Store data globally for allocator
        window.marketDataCache = fullDataMap;

        ignitionDetector.analyze(fullDataMap);
        btcDetector.analyze(fullDataMap);

        // Update Market Telemetry (Raw Inputs)
        const updateTelemetry = (id, val, format = v => v.toFixed(2)) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val !== null && val !== undefined ? format(val) : '--';
        };

        // VIX
        if (fullDataMap['^VIX'] && fullDataMap['^VIX'].indicators.quote[0].close) {
            const closes = fullDataMap['^VIX'].indicators.quote[0].close.filter(c => c !== null);
            updateTelemetry('tel-vix', closes[closes.length - 1]);
        }

        // TNX
        if (fullDataMap['^TNX'] && fullDataMap['^TNX'].indicators.quote[0].close) {
            const closes = fullDataMap['^TNX'].indicators.quote[0].close.filter(c => c !== null);
            updateTelemetry('tel-tnx', closes[closes.length - 1], v => `${v.toFixed(2)}%`);
        }

        // DXY
        if (fullDataMap['DX-Y.NYB'] && fullDataMap['DX-Y.NYB'].indicators.quote[0].close) {
            const closes = fullDataMap['DX-Y.NYB'].indicators.quote[0].close.filter(c => c !== null);
            updateTelemetry('tel-dxy', closes[closes.length - 1]);
        }

        // SPY
        if (fullDataMap['SPY'] && fullDataMap['SPY'].indicators.quote[0].close) {
            const closes = fullDataMap['SPY'].indicators.quote[0].close.filter(c => c !== null);
            const current = closes[closes.length - 1];
            const high20 = Math.max(...closes.slice(-20));
            const offHigh = ((current - high20) / high20) * 100;
            updateTelemetry('tel-spy', current);
            updateTelemetry('tel-spy-high', offHigh, v => `${v.toFixed(2)}%`);
        }

        // ETH
        if (fullDataMap['ETH-USD'] && fullDataMap['ETH-USD'].indicators.quote[0].close) {
            const closes = fullDataMap['ETH-USD'].indicators.quote[0].close.filter(c => c !== null);
            updateTelemetry('tel-eth', closes[closes.length - 1], v => `$${v.toFixed(0)}`);
        }

        // Re-run specific stock analysis now that SPY is definitely available
        // AND we know the global ignition state
        const isIgnitionActive = (ignitionDetector.state === 'IGNITION ACTIVE');

        ['NVDA', 'SMCI', 'META', 'MSFT'].forEach(symbol => {
            if (WATCHLIST.includes(symbol) && fullDataMap[symbol]) {
                const signal = stockMeltupExit.analyze(symbol, fullDataMap[symbol], fullDataMap['SPY'], isIgnitionActive);
                // Update row again if needed (logic duplicated above for speed, but this ensures SPY is present)
                const row = rowMap[symbol];
                if (row && signal && signal.status !== 'ACTIVE MELTUP') {
                    const signalBadge = row.querySelector(`#dashSignal-${symbol}`);
                    if (signalBadge) {
                        signalBadge.textContent = signal.status;
                        signalBadge.className = 'status-badge sell'; // Default to sell/warning style
                        if (signal.status.includes('EXECUTION')) signalBadge.style.animation = 'pulse 2s infinite';
                    }
                }
            }
        });

        // Generate Commentary
        generateCommentary(ignitionDetector, btcDetector, fullDataMap);
    });
};

// --- COMMENTARY GENERATOR ---
function generateCommentary(ignDetector, btcDetector, data) {
    const el = document.getElementById('commentaryText');
    if (!el) return;

    let text = "";

    // === BTC ANALYSIS (PRIMARY) ===
    const btcPrice = btcDetector.values.price;
    const btcState = btcDetector.state;
    const btcAction = btcDetector.action;

    text += `**BTC ANALYSIS:** Current state is ${btcState} at $${btcPrice.toFixed(0)}. `;

    // Detailed State Context
    if (btcState === 'COMPRESSION') {
        text += `The market is consolidating with low volatility. Price is below the $95k ignition threshold (Vol Ratio: ${btcDetector.values.volRatio.toFixed(1)}x vs 1.5x required, RSI: ${btcDetector.values.rsi.toFixed(0)} vs 60-78 target). `;
        text += `**CURRENT ACTION:** ${btcAction} Continue laddering limit orders between $85k-94k. `;
        text += `**NEXT TRIGGER:** Watch for price break above $95,000 with volume spike >1.5x average AND RSI entering 60-78 zone. `;
    } else if (btcState === 'PRE-IGNITION') {
        text += `Price is in the pre-ignition zone ($90k-94k) with rising volume and forming higher lows. `;
        text += `**CURRENT ACTION:** ${btcAction} Increase exposure to 70-80% deployed. `;
        text += `**NEXT TRIGGER:** Breakout above $95k with sustained volume confirms full ignition. `;
    } else if (btcState === 'IGNITION CONFIRMED') {
        text += `CONFIRMED BREAKOUT! Price cleared $95k with volume >1.5x average and RSI in optimal 60-78 range. `;
        text += `**CURRENT ACTION:** ${btcAction} This is the high-conviction entry zone. `;
        text += `**RISK MONITOR:** Exit if RSI exceeds 85 or if long upper wicks form (distribution signal). `;
    } else if (btcState === 'MELTUP ACTIVE') {
        text += `Parabolic phase active (+${btcDetector.values.change5d.toFixed(1)}% in 5 days, RSI: ${btcDetector.values.rsi.toFixed(0)}). Euphoria building. `;
        text += `**CURRENT ACTION:** ${btcAction} No new entries. Begin preparing trim sequence. `;
        text += `**EXIT SIGNAL:** RSI >85 OR double top wicks OR volume spike with flat close triggers distribution. `;
    } else if (btcState === 'DISTRIBUTION START') {
        text += `TOP IS IN. Distribution signals detected (RSI: ${btcDetector.values.rsi.toFixed(0)}, long wicks forming). `;
        text += `**CURRENT ACTION:** ${btcAction} Execute systematic exit: 20% at RSI >80, 25% at RSI >85, 30% on blow-off spike. `;
    } else if (btcState === 'FAKE BREAKOUT') {
        text += `FALSE MOVE DETECTED. Price spiked above $95k but closed below $92k with fading volume. Classic bull trap. `;
        text += `**CURRENT ACTION:** ${btcAction} Stand aside and wait for clean retest of structure. `;
    }

    // === STOCKS CONTEXT ===
    text += `|| **STOCKS:** `;
    if (ignDetector.state === 'IGNITION ACTIVE') {
        text += `Meltup confirmed. Leaders (NVDA, META, SMCI) breaking out with strong breadth and volume. Risk-on environment active. `;
    } else if (ignDetector.state === 'PRE-IGNITION') {
        text += `Market is warming up. `;
        if (!ignDetector.metrics.volume) text += `Awaiting volume confirmation. `;
        if (!ignDetector.metrics.breadth) text += `Breadth is lagging (rotation incomplete). `;
    } else {
        text += `Compression phase. No clear directional bias. Accumulation mode. `;
    }

    // === RISK TELEMETRY ===
    if (data['^VIX']) {
        const vix = data['^VIX'].indicators.quote[0].close.slice(-1)[0];
        if (vix > 20) text += `|| **RISK ALERT:** VIX elevated at ${vix.toFixed(1)} (>20 threshold). Hedges recommended. `;
    }

    el.textContent = text;
}


// Initialize Chart
const initChart = () => {
    const ctx = elements.chartCanvas.getContext('2d');

    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, 'rgba(0, 229, 255, 0.2)');
    gradient.addColorStop(1, 'rgba(0, 229, 255, 0)');

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Price',
                    data: [],
                    borderColor: '#00E5FF',
                    backgroundColor: gradient,
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHoverRadius: 6,
                    fill: true,
                    tension: 0.1,
                    yAxisID: 'y'
                },
                {
                    label: 'SMA 200',
                    data: [],
                    borderColor: '#FFB300', // Orange
                    borderWidth: 1.5,
                    pointRadius: 0,
                    fill: false,
                    tension: 0.1,
                    yAxisID: 'y'
                },
                {
                    label: 'RSI (14)',
                    data: [],
                    borderColor: '#7B61FF', // Purple
                    borderWidth: 1.5,
                    pointRadius: 0,
                    fill: false,
                    tension: 0.1,
                    yAxisID: 'y1',
                    hidden: false // Show by default now
                },
                {
                    type: 'bar',
                    label: 'Volume',
                    data: [],
                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                    yAxisID: 'y2',
                    barThickness: 'flex'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    labels: { color: '#8b9bb4', font: { size: 10 } }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(10, 11, 14, 0.9)',
                    titleColor: '#8b9bb4',
                    bodyColor: '#fff',
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    padding: 12
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: '#8b9bb4', maxTicksLimit: 8 }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#8b9bb4' }
                },
                y1: { // RSI Axis
                    type: 'linear',
                    display: true, // Show axis
                    position: 'left',
                    min: 0,
                    max: 100,
                    grid: { display: false },
                    ticks: { color: '#7B61FF', stepSize: 30 }
                },
                y2: { // Volume Axis
                    type: 'linear',
                    display: false,
                    position: 'left',
                    grid: { display: false },
                    beginAtZero: true
                }
            },
            interaction: {
                mode: 'nearest',
                axis: 'x',
                intersect: false
            }
        }
    });
};

// Update Detail View
const updateStock = async (symbol, range = '1mo', interval = '1d') => {
    // Reset UI
    if (currentStock.symbol !== symbol) {
        elements.ticker.textContent = 'LOADING...';
        elements.levelsList.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 20px;">Loading data...</td></tr>`;
        elements.rsi.textContent = '--';
        elements.maExtension.textContent = '--';
        elements.topSignalValue.textContent = '--';
        elements.topSignalStatus.textContent = '--';
        elements.volume.textContent = '--';
    }

    // Fetch Chart + Indicator Data in Parallel for Speed
    console.log(`Fetching chart (${range}) and indicator data in parallel...`);

    const needsLongTermData = range !== '1y' && range !== '2y' && range !== '5y' && range !== 'max';

    const [data, longTermData] = await Promise.all([
        fetchStockData(symbol, range, interval),
        needsLongTermData ? fetchStockData(symbol, '1y', '1d') : Promise.resolve(null)
    ]);

    if (!data) {
        elements.ticker.textContent = 'ERROR';
        console.error('Failed to load chart data');
        return;
    }

    console.log(`✓ Chart data loaded: ${data.timestamp.length} data points`);

    const indicatorData = longTermData || data;

    if (!indicatorData) {
        console.warn("Could not fetch indicator data");
    } else {
        console.log(`✓ Indicator data ready: ${indicatorData.timestamp.length} data points`);
    }

    const meta = data.meta;
    const quotes = data.indicators.quote[0];
    const timestamps = data.timestamp;

    // Filter out null values
    const cleanData = timestamps.map((t, i) => ({
        x: new Date(t * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: 'numeric' }),
        y: quotes.close[i]
    })).filter(d => d.y !== null);

    const currentPrice = meta.regularMarketPrice;

    // Calculate change
    let prevClose = meta.previousClose;
    if (!prevClose && quotes.close) {
        const validQuotes = quotes.close.filter(p => p !== null);
        if (validQuotes.length >= 2) {
            prevClose = validQuotes[validQuotes.length - 2];
        }
    }
    if (!prevClose) prevClose = meta.chartPreviousClose;

    const changePercent = ((currentPrice - prevClose) / prevClose) * 100;

    // Update State
    currentStock = { symbol, price: currentPrice, data: cleanData, meta };

    // Update Header Info
    elements.ticker.textContent = symbol.toUpperCase();
    elements.price.textContent = `$${currentPrice.toFixed(2)}`;
    elements.change.textContent = `${changePercent > 0 ? '+' : ''}${changePercent.toFixed(2)}%`;
    elements.change.className = `change ${changePercent >= 0 ? 'positive' : 'negative'}`;

    // Update Chart
    if (!chartInstance) {
        console.error('Chart instance not initialized');
        return;
    }

    chartInstance.data.labels = cleanData.map(d => d.x);
    chartInstance.data.datasets[0].data = cleanData.map(d => d.y);

    // Calculate RSI for chart
    const chartQuotes = cleanData.map(d => d.y);
    const rsiSeries = calculateRSI(chartQuotes);
    chartInstance.data.datasets[2].data = rsiSeries || [];

    // Plot Volume
    const chartVolumes = quotes.volume.filter((v, i) => timestamps[i] !== null);
    chartInstance.data.datasets[3].data = chartVolumes;

    // Plot SMA 200
    if (range === '1y' || chartQuotes.length > 200) {
        const smaSeries = calculateSMASeries(chartQuotes, 200);
        chartInstance.data.datasets[1].data = smaSeries;
    } else {
        chartInstance.data.datasets[1].data = [];
    }

    chartInstance.update();

    // Update volume
    const vol = meta.regularMarketVolume;
    elements.volume.textContent = vol ? `${(vol / 1000000).toFixed(1)}M` : '--';

    // Calculate Indicators using long-term data
    if (indicatorData && indicatorData.indicators.quote[0].close) {
        try {
            const rawQuotes = indicatorData.indicators.quote[0].close;
            const longTermQuotes = rawQuotes.filter(p => p !== null);
            const volumes = indicatorData.indicators.quote[0].volume.filter(v => v !== null);

            // RSI
            const rsiSeriesLong = calculateRSI(longTermQuotes);
            const rsi = rsiSeriesLong ? rsiSeriesLong[rsiSeriesLong.length - 1] : null;
            elements.rsi.textContent = rsi ? rsi.toFixed(1) : 'N/A';

            // SMA 200
            const sma200 = calculateSMA(longTermQuotes, 200);

            // Top Signal Score System (0-10 scale)
            if (rsi && sma200) {
                const extension = ((currentPrice - sma200) / sma200) * 100;
                elements.maExtension.textContent = `${extension > 0 ? '+' : ''}${extension.toFixed(1)}%`;

                let topSignalScore = 0;

                // 1. RSI Divergence (+3 points)
                const hasDivergence = detectRSIDivergence(longTermQuotes, rsiSeriesLong);
                if (hasDivergence) topSignalScore += 3;

                // 2. Volume Distribution (+2 points)
                const volumes = indicatorData.indicators.quote[0].volume.filter(v => v !== null);
                const hasDistribution = detectDistributionVolume(longTermQuotes, volumes);
                if (hasDistribution) topSignalScore += 2;

                // 3. Extension Threshold (+2 points max)
                if (extension > 30) topSignalScore += 2;
                else if (extension > 20) topSignalScore += 1;

                // 4. RSI Extremes (+3 points max)
                if (rsi > 85) topSignalScore += 3;
                else if (rsi > 75) topSignalScore += 2;
                else if (rsi > 70) topSignalScore += 1;

                // Interpret Score
                let status = '';
                let statusDesc = '';

                if (topSignalScore >= 7) {
                    status = `${topSignalScore}/10 CRITICAL`;
                    statusDesc = 'Top Signal';
                } else if (topSignalScore >= 4) {
                    status = `${topSignalScore}/10 WARNING`;
                    statusDesc = 'Caution Zone';
                } else if (rsi < 30) {
                    status = `${topSignalScore}/10 OPPORTUNITY`;
                    statusDesc = 'Oversold';
                } else {
                    status = `${topSignalScore}/10`;
                    statusDesc = 'Melt-Up Mode';
                }

                elements.topSignalValue.textContent = status;

                // Detect Market Phase (replaces simple status description)
                const marketPhase = detectMarketPhase(longTermQuotes, rsi, extension, topSignalScore, 0, volumes); // We'll calculate buyQuality next
                elements.topSignalStatus.textContent = marketPhase;

                // --- BUY QUALITY SCORE (Inverse Logic) ---
                let buyQualityScore = 0;

                // 1. Bullish RSI Divergence (+3 points)
                const hasBullishDivergence = detectBullishRSIDivergence(longTermQuotes, rsiSeriesLong);
                if (hasBullishDivergence) buyQualityScore += 3;

                // 2. Accumulation Volume (+2 points)
                const hasAccumulation = detectAccumulationVolume(longTermQuotes, volumes);
                if (hasAccumulation) buyQualityScore += 2;

                // 3. Deep Value vs 200MA (+2 points)
                if (extension < -20) buyQualityScore += 2;
                else if (extension < -10) buyQualityScore += 1;

                // 4. RSI Oversold (+3 points)
                if (rsi < 20) buyQualityScore += 3;
                else if (rsi < 30) buyQualityScore += 2;
                else if (rsi < 40) buyQualityScore += 1;

                // Interpret Buy Quality Score
                let buyStatus = '';
                let buyDesc = '';

                if (buyQualityScore >= 8) {
                    buyStatus = `${buyQualityScore}/10 🎯`;
                    buyDesc = 'BEST DEAL EVER';
                } else if (buyQualityScore >= 5) {
                    buyStatus = `${buyQualityScore}/10 ✅`;
                    buyDesc = 'Good Deal';
                } else if (buyQualityScore >= 2) {
                    buyStatus = `${buyQualityScore}/10 🤷`;
                    buyDesc = "It's OK";
                } else {
                    buyStatus = `${buyQualityScore}/10 🚫`;
                    buyDesc = "Don't Buy";
                }

                elements.buyQualityValue.textContent = buyStatus;
                elements.buyQualityStatus.textContent = buyDesc;

                // --- NEXT BUY RECOMMENDATION ---
                // Calculate suggested buy price based on support levels and quality score
                let nextBuyPrice = 0;
                let buyGapPct = 0;
                let suggestedAllocation = 0;

                // Logic: For a "good deal", we want to be near support or -5% to -15% from current
                const buyPrice = longTermQuotes[longTermQuotes.length - 1];

                // Get 200MA value without mutating the array
                const ma200Value = sma200 && sma200.length > 0 ? sma200[sma200.length - 1] : buyPrice * 0.85;

                // Determine next buy level based on quality score
                if (buyQualityScore >= 8) {
                    // Exceptional deal - buy at market or very close
                    nextBuyPrice = buyPrice * 0.98; // Within 2%
                    suggestedAllocation = 5; // 5% allocation for exceptional deals
                } else if (buyQualityScore >= 5) {
                    // Good deal - wait for 5% pullback
                    nextBuyPrice = buyPrice * 0.95;
                    suggestedAllocation = 3; // 3% allocation
                } else if (buyQualityScore >= 2) {
                    // OK deal - wait for 10% pullback
                    nextBuyPrice = buyPrice * 0.90;
                    suggestedAllocation = 2; // 2% allocation
                } else {
                    // Poor timing - wait for significant pullback near 200MA
                    nextBuyPrice = Math.min(buyPrice * 0.85, ma200Value);
                    suggestedAllocation = 1; // 1% allocation only
                }

                buyGapPct = ((buyPrice - nextBuyPrice) / buyPrice) * 100;

                // Update UI
                const nextBuyEl = document.getElementById('nextBuyPrice');
                const buyGapEl = document.getElementById('buyGap');
                const buyAllocationEl = document.getElementById('buyAllocation');

                if (nextBuyEl) nextBuyEl.textContent = `$${nextBuyPrice.toFixed(2)}`;
                if (buyGapEl) buyGapEl.textContent = `-${buyGapPct.toFixed(1)}%`;
                if (buyAllocationEl) buyAllocationEl.textContent = `${suggestedAllocation}%`;


                // Re-calculate Market Phase with actual buyQualityScore
                const finalMarketPhase = detectMarketPhase(longTermQuotes, rsi, extension, topSignalScore, buyQualityScore, volumes);
                elements.topSignalStatus.textContent = finalMarketPhase;

                // --- COLOR CODING & ALERTS ---

                // Reset classes
                elements.rsi.className = 'value';
                elements.maExtension.className = 'value';
                elements.volume.className = 'value';
                elements.topSignalValue.className = 'value';
                elements.buyQualityValue.className = 'value';

                const rsiDesc = document.getElementById('rsiDesc');
                const maDesc = document.getElementById('maDesc');
                const volDesc = document.getElementById('volDesc');
                const summaryText = document.getElementById('trendSummaryText');
                const summaryBox = document.getElementById('trendSummaryBox');

                // RSI Logic
                if (rsi > 70) {
                    elements.rsi.classList.add('text-danger');
                    rsiDesc.textContent = "Overbought";
                    rsiDesc.style.color = "var(--danger)";
                } else if (rsi > 50) {
                    elements.rsi.classList.add('text-warning');
                    rsiDesc.textContent = "Strong";
                    rsiDesc.style.color = "#FFB300";
                } else if (rsi < 30) {
                    elements.rsi.classList.add('text-success');
                    rsiDesc.textContent = "Oversold";
                    rsiDesc.style.color = "var(--success)";
                } else {
                    rsiDesc.textContent = "Neutral";
                    rsiDesc.style.color = "var(--text-muted)";
                }

                // MA Extension Logic
                if (extension > 20) {
                    elements.maExtension.classList.add('text-danger');
                    maDesc.textContent = "Overextended";
                    maDesc.style.color = "var(--danger)";
                } else if (extension > 10) {
                    elements.maExtension.classList.add('text-warning');
                    maDesc.textContent = "Extended";
                    maDesc.style.color = "#FFB300";
                } else if (extension < -10) {
                    elements.maExtension.classList.add('text-success');
                    maDesc.textContent = "Undervalued";
                    maDesc.style.color = "var(--success)";
                } else {
                    maDesc.textContent = "Fair Value";
                    maDesc.style.color = "var(--text-muted)";
                }

                // Volume Logic (Simple approximation since we don't have avg volume easily accessible without calc)
                // We'll just use a placeholder for now or compare to previous days if possible.
                // For now, let's just label it "Active" if it's high? 
                // Better: Just leave it neutral unless we calculate RVOL.
                volDesc.textContent = "Daily Volume";


                // Euphoria Status Colors & TOP SIGNAL
                const marketStatusBox = document.getElementById('marketStatus');
                let summary = "";

                // Color code Buy Quality Score
                if (buyQualityScore >= 8) {
                    elements.buyQualityValue.classList.add('text-success');
                } else if (buyQualityScore >= 5) {
                    elements.buyQualityValue.classList.add('text-success');
                } else if (buyQualityScore >= 2) {
                    elements.buyQualityValue.classList.add('text-neutral');
                } else {
                    elements.buyQualityValue.classList.add('text-danger');
                }

                if (topSignalScore >= 7) { // TOP SIGNAL
                    elements.topSignalValue.classList.add('text-danger');
                    // Show TOP SIGNAL
                    marketStatusBox.innerHTML = `
                        <div style="color: var(--danger); font-weight: bold; display: flex; align-items: center; gap: 8px;">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                            TOP SIGNAL DETECTED - Exit Immediately
                        </div>
                    `;
                    marketStatusBox.style.borderColor = 'var(--danger)';
                    marketStatusBox.style.background = 'rgba(255, 75, 75, 0.1)';

                    let factors = [];
                    if (hasDivergence) factors.push("RSI divergence");
                    if (hasDistribution) factors.push("distribution volume");
                    if (extension > 30) factors.push(`extreme overextension (+${extension.toFixed(0)}%)`);
                    if (rsi > 85) factors.push(`RSI exhaustion (${rsi.toFixed(0)})`);

                    summary = `<strong>🚨 Market Top Detected:</strong> Multiple top signals converging: ${factors.join(', ')}. This is a high-probability reversal zone. <strong>Do NOT buy.</strong> Exit positions or set tight stops.`;

                } else if (buyQualityScore >= 8) { // BEST DEAL EVER
                    elements.topSignalValue.classList.add('text-neutral');
                    marketStatusBox.innerHTML = `<p style="color: var(--success); font-weight: bold;">🎯 BEST DEAL EVER - Generational Opportunity</p>`;
                    marketStatusBox.style.borderColor = 'var(--success)';
                    marketStatusBox.style.background = 'rgba(0, 255, 163, 0.15)';

                    let buyFactors = [];
                    if (hasBullishDivergence) buyFactors.push("bullish divergence");
                    if (hasAccumulation) buyFactors.push("accumulation volume");
                    if (extension < -20) buyFactors.push(`deep value (${extension.toFixed(0)}% below 200MA)`);
                    if (rsi < 20) buyFactors.push(`extreme oversold (RSI ${rsi.toFixed(0)})`);

                    summary = `<strong>🎯 Exceptional Value:</strong> ${buyFactors.join(', ')}. This represents a generational buying opportunity with favorable risk/reward. <strong>Aggressively accumulate on dips.</strong>`;

                } else if (buyQualityScore >= 5) { // GOOD DEAL
                    elements.topSignalValue.classList.add('text-neutral');
                    marketStatusBox.innerHTML = `<p style="color: var(--success);">✅ Good Deal - Favorable Entry</p>`;
                    marketStatusBox.style.borderColor = 'var(--success)';
                    marketStatusBox.style.background = 'rgba(0, 255, 163, 0.08)';

                    summary = `<strong>✅ Good Entry Zone:</strong> RSI is ${rsi < 30 ? 'oversold' : 'pulling back'}, ${extension < -10 ? 'price below 200MA' : 'momentum cooling'}. ${hasAccumulation ? 'Accumulation patterns forming. ' : ''}Risk/reward is favorable. <strong>Consider scaling in.</strong>`;

                } else if (topSignalScore >= 4) { // WARNING ZONE
                    elements.topSignalValue.classList.add('text-warning');
                    marketStatusBox.innerHTML = `<p>⚠️ Warning: Tighten stops</p>`;
                    marketStatusBox.style.borderColor = '#FFB300';
                    marketStatusBox.style.background = 'rgba(255, 179, 0, 0.1)';

                    summary = `<strong>Caution:</strong> Early warning signs detected. ${hasDistribution ? 'Distribution patterns forming. ' : ''}${hasDivergence ? 'RSI divergence emerging. ' : ''}Price is ${extension > 20 ? 'overextended' : 'elevated'}. <strong>Avoid new positions.</strong> Trail stops on existing holdings.`;

                } else if (rsi < 40) { // MILD OPPORTUNITY
                    elements.topSignalValue.classList.add('text-neutral');
                    marketStatusBox.innerHTML = `<p>🤷 ${finalMarketPhase}</p>`;
                    marketStatusBox.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                    marketStatusBox.style.background = 'rgba(255, 255, 255, 0.03)';

                    if (finalMarketPhase === 'ACCUMULATION') {
                        summary = `<strong>Accumulation Phase:</strong> Stock is in a bottoming process. RSI (${rsi.toFixed(0)}) cooling, ${extension < 0 ? 'price below 200MA' : 'momentum settling'}. <strong>Consider limit orders below current price</strong> for better entries.`;
                    } else if (finalMarketPhase === 'DOWNWARD TREND') {
                        summary = `<strong>Downward Trend:</strong> Price is making lower lows. RSI (${rsi.toFixed(0)}), ${extension < 0 ? 'below 200MA' : 'losing momentum'}. <strong>Wait for stabilization</strong> before entering. Look for basing patterns.`;
                    } else {
                        summary = `<strong>Neutral Pullback:</strong> RSI (${rsi.toFixed(0)}) cooling but not deeply oversold. ${extension < 0 ? 'Price below 200MA. ' : ''}No strong signals. <strong>Wait for better setup</strong> or use limit orders.`;
                    }

                } else { // MELT-UP / NEUTRAL / UPWARD TREND
                    elements.topSignalValue.classList.add('text-neutral');
                    marketStatusBox.innerHTML = `<p>📈 ${finalMarketPhase}</p>`;
                    marketStatusBox.style.borderColor = 'rgba(255, 255, 255, 0.05)';
                    marketStatusBox.style.background = 'transparent';

                    if (finalMarketPhase === 'UPWARD TREND') {
                        summary = `<strong>Healthy Uptrend:</strong> Momentum is strong but not overheated. RSI (${rsi.toFixed(0)}) in control. ${extension > 10 ? 'Price extended modestly. ' : ''}Trend is intact. <strong>Hold positions,</strong> set trailing stops, avoid chasing.`;
                    } else if (finalMarketPhase === 'NEUTRAL') {
                        summary = `<strong>Sideways/Neutral:</strong> Stock is consolidating. RSI (${rsi.toFixed(0)}) balanced. No clear direction. Wait for breakout or breakdown confirmation before making decisions.`;
                    } else {
                        summary = `<strong>Trend Intact:</strong> Market phase: ${finalMarketPhase}. ${extension > 10 ? 'Price extended but no divergence yet. ' : ''}<strong>Monitor closely</strong> for warning signs.`;
                    }
                }
                summaryText.innerHTML = summary;

            } else {
                elements.maExtension.textContent = 'N/A';
                elements.topSignalValue.textContent = 'Insufficient Data';
            }
        } catch (e) {
            console.error("Error calculating indicators:", e);
            elements.rsi.textContent = "Err";
        }
    } else {
        console.warn("Invalid indicator data structure", indicatorData);
        elements.rsi.textContent = "N/A";
    }

    // Render Ladder with price/volume data
    if (indicatorData && indicatorData.indicators.quote[0].close) {
        const rawQuotes = indicatorData.indicators.quote[0].close;
        const longTermQuotes = rawQuotes.filter(p => p !== null);
        const volumes = indicatorData.indicators.quote[0].volume.filter(v => v !== null);
        renderLadder(longTermQuotes, volumes);
    } else {
        renderLadder(); // Fallback without data
    }

    // Fetch Analyst Sentiment (in background)
    fetchAnalystSentiment(symbol);

    // Fetch Real-Time Soft Metrics (in background)
    fetchRealTimeData(symbol);

    // Update Meltup Signal Box
    if (indicatorData && indicatorData.indicators.quote[0].close) {
        const rawQuotes = indicatorData.indicators.quote[0].close;
        const longTermQuotes = rawQuotes.filter(p => p !== null);
        const volumes = indicatorData.indicators.quote[0].volume.filter(v => v !== null);

        const signal = getMeltupSignal(symbol, longTermQuotes, volumes);
        const signalBox = document.getElementById('meltupSignalBox');
        const signalStatus = document.getElementById('meltupSignalStatus');
        const signalReasons = document.getElementById('meltupReasons');

        if (signalBox && signalStatus && signalReasons) {
            signalStatus.textContent = signal.signal;

            // Color coding
            if (signal.signal.includes('EXIT') || signal.signal.includes('TRIM')) {
                signalStatus.style.color = 'var(--danger)';
                signalBox.style.borderColor = 'var(--danger)';
                signalBox.style.background = 'rgba(255, 75, 75, 0.1)';
            } else if (signal.signal === 'MONITORING') {
                signalStatus.style.color = 'var(--text-muted)';
                signalBox.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                signalBox.style.background = 'rgba(255, 255, 255, 0.03)';
            } else {
                signalStatus.style.color = 'var(--success)'; // Or neutral/blue for HOLD (EUPHORIA)
                signalBox.style.borderColor = 'var(--primary)';
                signalBox.style.background = 'rgba(0, 229, 255, 0.05)';
            }

            // Reasons
            signalReasons.innerHTML = '';
            if (signal.reasons.length > 0) {
                signal.reasons.forEach(r => {
                    const li = document.createElement('li');
                    li.textContent = `• ${r}`;
                    signalReasons.appendChild(li);
                });
            } else {
                signalReasons.innerHTML = '<li>No active triggers</li>';
            }

            // Add System Activation Details if Monitoring/Active
            if (signal.details) {
                const hr = document.createElement('hr');
                hr.style.borderColor = 'rgba(255,255,255,0.1)';
                hr.style.margin = '8px 0';
                signalReasons.appendChild(hr);

                const details = [
                    `Price vs 6m Low: ${signal.details.priceFromLow}`,
                    `RSI: ${signal.details.rsi}`,
                    `Accel: ${signal.details.acceleration}`,
                    `Media: ${signal.details.mediaTone}`
                ];

                details.forEach(d => {
                    const li = document.createElement('li');
                    li.style.color = '#8b9bb4';
                    li.style.fontSize = '11px';
                    li.textContent = d;
                    signalReasons.appendChild(li);
                });
            }
        }
    }
};

// Initialize Simulation Controls
const initSimulationControls = () => {
    const mediaSelect = document.getElementById('simMediaTone');
    const fearRange = document.getElementById('simFearGreed');
    const fearValue = document.getElementById('simFearGreedValue');
    const fundingSelect = document.getElementById('simFunding');

    if (mediaSelect) {
        mediaSelect.addEventListener('change', (e) => {
            marketState.mediaTone = e.target.value;
            if (currentStock.symbol) updateStock(currentStock.symbol); // Refresh
        });
    }

    if (fearRange) {
        fearRange.addEventListener('input', (e) => {
            marketState.fearGreedIndex = parseInt(e.target.value);
            if (fearValue) fearValue.textContent = e.target.value;
            if (currentStock.symbol) updateStock(currentStock.symbol);
        });
    }

    if (fundingSelect) {
        fundingSelect.addEventListener('change', (e) => {
            marketState.btcFundingRates = e.target.value;
            if (currentStock.symbol) updateStock(currentStock.symbol);
        });
    }
    // Backtest Button Logic
    const backtestBtn = document.getElementById('runBacktestBtn');
    if (backtestBtn) {
        backtestBtn.addEventListener('click', async () => {
            const scenarioSelect = document.getElementById('backtestScenario');
            const scenarioKey = scenarioSelect ? scenarioSelect.value : 'msft_base';

            // Define Scenarios
            const scenarios = {
                'default': { tickers: ['SPY', 'BTC-USD'], start: '2023-01-01', end: '2024-01-01' },
                'btc_2016': { tickers: ['BTC-USD', 'SPY'], start: '2016-01-01', end: '2019-01-01' },
                'nvda_2019': { tickers: ['NVDA', 'SPY'], start: '2019-01-01', end: '2024-01-01' },
                'meta_2019': { tickers: ['META', 'SPY'], start: '2019-01-01', end: '2024-01-01' },
                'smci_2022': { tickers: ['SMCI', 'SPY'], start: '2022-01-01', end: '2024-01-01' },
                'MSFT_2022': { tickers: ['MSFT', 'SPY'], start: '2022-01-01', end: '2023-01-01' },
                'msft_base': { tickers: ['MSFT', 'SPY'], start: '2019-01-01', end: '2024-01-01' }
            };

            const scenario = scenarios[scenarioKey];
            if (!scenario) {
                alert("Invalid scenario selected");
                return;
            }

            backtestBtn.textContent = "Running...";
            backtestBtn.disabled = true;

            try {
                // Initialize Engine with current allocator
                // Ensure rawArcAllocator is available globally
                if (typeof rawArcAllocator === 'undefined') {
                    console.error("Allocator not initialized");
                    alert("Allocator not initialized");
                    return;
                }

                if (typeof BacktestEngine === 'undefined') {
                    console.error("BacktestEngine not loaded");
                    alert("Backtest Engine not loaded. Please use debug.html for backtesting.");
                    return;
                }

                const engine = new BacktestEngine(rawArcAllocator);

                // Run Backtest
                await engine.run(scenario.tickers, 100000, scenario.start, scenario.end);

                // Render Results
                const resultsEl = document.getElementById('backtestResults');
                if (resultsEl) {
                    resultsEl.style.display = 'block';
                    resultsEl.textContent = engine.generateReport();
                }
            } catch (e) {
                console.error("Backtest failed:", e);
                alert("Backtest failed. Check console for details.");
            } finally {
                backtestBtn.textContent = "RUN BACKTEST";
                backtestBtn.disabled = false;
            }
        });
    }
};

// Call initSimulationControls at startup
document.addEventListener('DOMContentLoaded', () => {
    initSimulationControls();
});

// Fetch Analyst Sentiment from Yahoo Finance
const fetchAnalystSentiment = async (symbol) => {
    const analystSummary = document.getElementById('analystSummary');

    try {
        // Use Finnhub API for analyst recommendations (CORS-friendly)
        // Finnhub API Key (Free Tier)
        const apiKey = 'd4j86r1r01queualuh3gd4j86r1r01queualuh40';
        const url = `https://finnhub.io/api/v1/stock/recommendation?symbol=${symbol}&token=${apiKey}`;

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Finnhub API error: ${response.status}`);
        }

        const data = await response.json();

        // Finnhub returns array of monthly recommendations, we want the most recent
        if (data && data.length > 0) {
            const latest = data[0]; // Most recent month

            const strongBuy = latest.strongBuy || 0;
            const buy = latest.buy || 0;
            const hold = latest.hold || 0;
            const sell = latest.sell || 0;
            const strongSell = latest.strongSell || 0;

            const total = strongBuy + buy + hold + sell + strongSell;

            if (total === 0) {
                analystSummary.innerHTML = `<span style="color: #8b9bb4;">No analyst coverage available</span>`;
                return;
            }

            // Calculate overall sentiment
            const bullishScore = (strongBuy * 2 + buy) / total;
            const bearishScore = (strongSell * 2 + sell) / total;

            let sentiment = 'Hold';
            let sentimentColor = '#FFB300';

            if (bullishScore > 1.2) {
                sentiment = 'Strong Buy';
                sentimentColor = '#00E676';
            } else if (bullishScore > 0.6) {
                sentiment = 'Buy';
                sentimentColor = '#4CAF50';
            } else if (bearishScore > 0.6) {
                sentiment = 'Sell';
                sentimentColor = '#FF5252';
            }

            const period = latest.period || 'Current';

            analystSummary.innerHTML = `
                <span style="color: ${sentimentColor}; font-weight: 600;">${sentiment}</span> — 
                ${total} analysts (${period}): <span style="color: #00E676;">${strongBuy} strong buy</span>, 
                <span style="color: #4CAF50;">${buy} buy</span>, 
                <span style="color: #FFB300;">${hold} hold</span>, 
                <span style="color: #FF9800;">${sell} sell</span>, 
                <span style="color: #FF5252;">${strongSell} strong sell</span>
            `;
        } else {
            analystSummary.innerHTML = `<span style="color: #8b9bb4;">No analyst coverage available</span>`;
        }

    } catch (error) {
        console.error('Error fetching analyst sentiment:', error);
        analystSummary.innerHTML = `
            <div style="color: #8b9bb4; line-height: 1.6;">
                <strong style="color: #FFB300;">📊 Analyst Data Unavailable</strong><br>
                Unable to fetch analyst ratings from Finnhub API.<br>
                <span style="font-size: 0.9em;">Check console for details or verify at <a href="https://finance.yahoo.com/quote/${symbol}" target="_blank" style="color: #00E5FF; text-decoration: none;">Yahoo Finance ↗</a></span>
            </div>
        `;
    }
};

// Calculate and Render Ladder
const renderLadder = (prices = null, volumes = null) => {
    if (!currentStock.price) return;

    let html = '';

    // If we have price data, calculate smart support levels
    if (prices && volumes && prices.length >= 60) {
        const supportLevels = detectSupportResistanceLevels(prices, volumes, currentStock.price);

        if (supportLevels.length > 0) {
            supportLevels.forEach(level => {
                // Create type badge
                let typeBadge = '';
                let badgeColor = '#00E5FF';

                if (level.type.startsWith('pivot')) {
                    typeBadge = level.type.toUpperCase().replace('PIVOT_', '');
                    badgeColor = '#7B61FF';
                } else if (level.type === 'swing_low') {
                    typeBadge = 'SWING';
                    badgeColor = '#FFB300';
                } else if (level.type === 'fibonacci') {
                    typeBadge = 'FIB';
                    badgeColor = '#00E676';
                } else if (level.type === 'volume_profile') {
                    typeBadge = 'VOL';
                    badgeColor = '#FF9800';
                } else if (level.type === 'moving_average') {
                    typeBadge = 'MA';
                    badgeColor = '#00E5FF';
                }

                // Create strength indicator (bars)
                const strengthBars = Math.min(Math.floor(level.strength / 2), 5);
                const strengthIndicator = '🟢'.repeat(strengthBars) + '⚪'.repeat(5 - strengthBars);

                // Recommendation based on drop
                let recommendation = '';
                let recColor = '';

                if (level.dropPercent >= 25) {
                    recommendation = "Generational Buy";
                    recColor = 'text-success';
                } else if (level.dropPercent >= 20) {
                    recommendation = "Best Deal";
                    recColor = 'text-success';
                } else if (level.dropPercent >= 15) {
                    recommendation = "Good Deal";
                    recColor = 'text-success';
                } else if (level.dropPercent >= 10) {
                    recommendation = "Fair Value";
                    recColor = '';
                } else {
                    recommendation = "Wait for More";
                    recColor = 'text-neutral';
                }

                html += `
                    <tr>
                        <td><span style="background: ${badgeColor}; color: #000; padding: 2px 6px; border-radius: 4px; font-size: 0.75em; font-weight: 700;">${typeBadge}</span></td>
                        <td class="price-target">$${level.price.toFixed(2)}</td>
                        <td style="font-weight: 600;">${level.allocation}%</td>
                        <td style="font-size: 0.85em;">
                            <span class="${recColor}" style="font-weight: 500;">${recommendation}</span>
                            <span style="color: #8b9bb4; margin-left: 6px;">— ${level.description.substring(0, 30)}${level.description.length > 30 ? '...' : ''}</span>
                        </td>
                    </tr>
                `;
            });
        } else {
            html = '<tr><td colspan="7" style="text-align:center; padding: 20px; color: #8b9bb4;">Insufficient data for support/resistance calculation</td></tr>';
        }
    } else {
        // Fallback to simple percentage-based ladder if no price data
        html = '<tr><td colspan="7" style="text-align:center; padding: 20px; color: #8b9bb4;">Loading support levels...</td></tr>';
    }

    elements.levelsList.innerHTML = html;
};


// Initialize App
// Helper to update last updated time
const updateLastUpdatedTime = () => {
    if (elements.lastUpdated) {
        const now = new Date();
        elements.lastUpdated.textContent = `Last updated: ${now.toLocaleTimeString()}`;
    }
};

// Initialize App
const init = () => {
    // Event Listeners
    if (elements.searchBtn) {
        elements.searchBtn.addEventListener('click', () => {
            const query = elements.search.value.trim().toUpperCase();
            if (query) showDetail(query);
        });
    }

    if (elements.search) {
        elements.search.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const query = elements.search.value.trim().toUpperCase();
                if (query) showDetail(query);
            }
        });
    }

    if (elements.backBtn) elements.backBtn.addEventListener('click', showDashboard);
    if (elements.logoBtn) elements.logoBtn.addEventListener('click', showDashboard);

    // Time Range Filters - Store selected range in currentStock
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            console.log(`[Time Filter] Button clicked: ${btn.getAttribute('data-range')}`);

            // Remove active from all
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            // Add active to clicked
            btn.classList.add('active');

            // Get range
            const rangeLabel = btn.getAttribute('data-range').toLowerCase();
            const rangeMap = {
                '1d': { range: '1d', interval: '5m' },    // Intraday needs 5-minute intervals
                '1w': { range: '5d', interval: '15m' },   // 5 days with 15-min intervals
                '1m': { range: '1mo', interval: '1d' },   // 1 month with daily
                '1y': { range: '1y', interval: '1d' }     // 1 year with daily
            };

            const config = rangeMap[rangeLabel];
            console.log(`[Time Filter] Mapped ${rangeLabel} -> ${config.range} (${config.interval})`);

            // Store in currentStock state
            if (currentStock.symbol) {
                currentStock.selectedRange = config.range;
                currentStock.selectedInterval = config.interval;
                console.log(`[Time Filter] Updating ${currentStock.symbol} with range ${config.range}, interval ${config.interval}`);
                updateStock(currentStock.symbol, config.range, config.interval);
            }
        });
    });


    if (elements.refreshBtn) {
        elements.refreshBtn.addEventListener('click', () => {
            elements.refreshBtn.classList.add('spinning');

            // Invalidate all cache
            WATCHLIST.forEach(symbol => dataManager.invalidate(symbol));

            // Refresh current view
            if (!elements.dashboardView.classList.contains('hidden')) {
                initDashboard().then(() => {
                    setTimeout(() => elements.refreshBtn.classList.remove('spinning'), 500);
                });
            } else if (currentStock.symbol) {
                updateStock(currentStock.symbol).then(() => {
                    setTimeout(() => elements.refreshBtn.classList.remove('spinning'), 500);
                });
            }
            updateLastUpdatedTime();
        });
    }

    // Auto-Refresh Loop (60s)
    setInterval(() => {
        console.log("Auto-refreshing data...");
        if (!elements.dashboardView.classList.contains('hidden')) {
            initDashboard();
        } else if (currentStock.symbol) {
            // Use selected range/interval or default to 1mo/1d
            const range = currentStock.selectedRange || '1mo';
            const interval = currentStock.selectedInterval || '1d';
            updateStock(currentStock.symbol, range, interval);
        }
        updateLastUpdatedTime();
    }, 60000);

    // Initial Load
    showDashboard();
    updateLastUpdatedTime();

    // Initialize Chart
    initChart();

    // Initialize simulation controls
    initSimulationControls();
};

init();
