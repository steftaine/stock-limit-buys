
// Backtest Simulation for Regime-Based Logic
// Scenarios: BTC 2017 (Parabolic), NVDA 2023 (Grind), 2020 (Crash+V)

// --- MOCK LOGIC (Copied from app.js for isolation) ---
const calculateSMA = (data, period) => {
    if (data.length < period) return null;
    return data.slice(-period).reduce((a, b) => a + b, 0) / period;
};

const calculateRSI = (prices, period = 14) => {
    if (prices.length < period + 1) return [50];
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        const diff = prices[i] - prices[i - 1];
        if (diff >= 0) gains += diff;
        else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    const rsiSeries = [100 - (100 / (1 + avgGain / avgLoss))];

    for (let i = period + 1; i < prices.length; i++) {
        const diff = prices[i] - prices[i - 1];
        const gain = diff > 0 ? diff : 0;
        const loss = diff < 0 ? -diff : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
        rsiSeries.push(100 - (100 / (1 + avgGain / avgLoss)));
    }
    return rsiSeries;
};

const getRegimeExitSignal = (closes, highs, lows, volumes) => {
    const currentPrice = closes[closes.length - 1];
    const rsi = calculateRSI(closes).pop();
    const sma20 = calculateSMA(closes, 20);
    const sma200 = calculateSMA(closes, 200);

    // 1. REGIME SETUP (Are we extended?)
    const isOverheated = (rsi > 75);
    const isExtended = (sma200 && currentPrice > sma200 * 1.3); // >30% above 200d MA

    // 2. TRIGGER EVENTS
    const trendBreak = (currentPrice < sma20); // Close below 20d MA

    // Blow-off Top: High Vol Reversal
    const avgVol = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const currentVol = volumes[volumes.length - 1];
    const isReversal = (currentPrice < closes[closes.length - 2]); // Red day
    const blowOff = (currentVol > avgVol * 2.5 && isReversal && isExtended);

    // 3. DECISION MATRIX
    if (blowOff) return 'EXIT EXECUTION (Blow-off)';
    if (trendBreak && isExtended) return 'EXIT EXECUTION (Trend Break)';
    if (isOverheated) return 'DISTRIBUTION (Watch)';
    return 'SAFE (Hold)';
};

// --- DATA GENERATORS ---

// 1. The "Parabolic Run" (BTC 2017)
// Price doubles in 60 days, RSI stays > 70, no 20d MA break until the end.
function generateParabolicRun() {
    const closes = [];
    const volumes = [];
    let price = 100;

    // 200 days of history for MA200
    for (let i = 0; i < 200; i++) { closes.push(price); volumes.push(1000); price *= 1.001; }

    console.log("\n--- SCENARIO 1: BTC 2017 (Parabolic Run) ---");
    console.log("Goal: HOLD through RSI > 80, EXIT only at end.");

    // The Run (60 days)
    for (let i = 0; i < 60; i++) {
        price *= 1.02; // +2% daily
        closes.push(price);
        volumes.push(2000); // High vol

        const signal = getRegimeExitSignal(closes, [], [], volumes);
        if (i % 10 === 0) console.log(`Day ${i}: Price ${price.toFixed(0)} | Signal: ${signal}`);
    }

    // The Crash (Trend Break)
    price *= 0.85; // -15% drop
    closes.push(price);
    volumes.push(5000); // Huge vol
    console.log(`Day 61 (CRASH): Price ${price.toFixed(0)} | Signal: ${getRegimeExitSignal(closes, [], [], volumes)}`);
}

// 2. The "Shakeout" (2020 Volatility)
// High volatility, price drops but recovers quickly. Should NOT exit if not extended.
function generateShakeout() {
    const closes = [];
    const volumes = [];
    let price = 100;

    // 200 days base
    for (let i = 0; i < 200; i++) { closes.push(price); volumes.push(1000); price *= 1.001; }

    console.log("\n--- SCENARIO 2: 2020 Shakeout (Volatility) ---");
    console.log("Goal: HOLD because not extended > 30% above 200d MA.");

    // Modest run up
    for (let i = 0; i < 20; i++) { price *= 1.005; closes.push(price); volumes.push(1000); }

    // Shakeout (-10% drop below 20d MA)
    price *= 0.90;
    closes.push(price);
    volumes.push(1500);

    const signal = getRegimeExitSignal(closes, [], [], volumes);
    console.log(`Shakeout Day: Price ${price.toFixed(0)} | Signal: ${signal}`);
}

// 3. The "Blow-off Top" (NVDA Style)
// Huge gap up, massive volume, then reversal.
function generateBlowOff() {
    const closes = [];
    const volumes = [];
    let price = 100;

    // 200 days base
    for (let i = 0; i < 200; i++) { closes.push(price); volumes.push(1000); price *= 1.001; }

    console.log("\n--- SCENARIO 3: Blow-off Top (Volume Climax) ---");
    console.log("Goal: EXIT on massive volume reversal.");

    // Extended run
    for (let i = 0; i < 50; i++) { price *= 1.01; closes.push(price); volumes.push(1000); }

    // Climax Day: +5% intraday but closes lower (Reversal) on 3x volume
    // We simulate the close being lower than yesterday
    const yesterday = price;
    price *= 0.98; // Close lower
    closes.push(price);
    volumes.push(3000); // 3x Volume

    const signal = getRegimeExitSignal(closes, [], [], volumes);
    console.log(`Climax Day: Price ${price.toFixed(0)} | Vol 3x | Signal: ${signal}`);
}

generateParabolicRun();
generateShakeout();
generateBlowOff();
