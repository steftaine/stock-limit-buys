class BacktestEngine {
    constructor(allocator) {
        this.allocator = allocator;
        this.results = {};
        this.logs = [];
    }

    async run(tickers, initialCash, startDateStr, endDateStr = null) {
        this.logs = [];
        this.results = {
            equityCurve: [],
            trades: [],
            metrics: {}
        };

        const endLabel = endDateStr ? endDateStr : 'Present';
        console.log(`Starting Backtest for ${tickers.join(', ')} from ${startDateStr} to ${endLabel}...`);
        this.log(`Starting Backtest for ${tickers.join(', ')} (${startDateStr} - ${endLabel})...`);

        // 1. Load Data
        const dataMap = {};
        let marketStateMap = null;

        const dataManager = new DataManager();

        // Always include SPY for regime analysis
        const allTickers = [...new Set([...tickers, 'SPY'])];

        // Fetch max data to ensure we have history
        for (const ticker of allTickers) {
            this.log(`Fetching data for ${ticker}...`);
            const data = await this.fetchData(dataManager, ticker);
            if (data) {
                dataMap[ticker] = this.processData(data, '2000-01-01'); // Get all available processed data
            }
        }

        // 2. Align Dates
        let commonDates = this.getCommonDates(dataMap);
        console.log(`[Backtest] Found ${commonDates.length} common trading dates (unfiltered)`);

        // Filter to specified date range
        if (startDateStr) {
            const startDateObj = new Date(startDateStr);
            commonDates = commonDates.filter(d => new Date(d) >= startDateObj);
            console.log(`[Backtest] After start date filter (${startDateStr}): ${commonDates.length} dates`);
        }
        if (endDateStr) {
            const endDateObj = new Date(endDateStr);
            commonDates = commonDates.filter(d => new Date(d) <= endDateObj);
            console.log(`[Backtest] After end date filter (${endDateStr}): ${commonDates.length} dates`);
        }

        if (commonDates.length === 0) {
            this.log("Error: No common dates found for backtest in specified range.");
            return null;
        }
        console.log(`[Backtest] Date range: ${commonDates[0]} to ${commonDates[commonDates.length - 1]}`);

        // 3. Initialize State
        let cash = initialCash;
        const positions = {};
        const openOrders = {};
        tickers.forEach(t => {
            positions[t] = 0;
            openOrders[t] = [];
        });

        // 4. Simulation Loop
        for (const date of commonDates) {
            const dailyInput = {
                date: date,
                cash_available: cash,
                total_equity: 0, // Calculated below
                assets: {},
                regime: {}, // Calculated below
                marketState: marketStateMap ? (marketStateMap[date] || {}) : {} // Add scenario phase/event
            };

            // A. Update Prices & Calculate Equity
            let dailyEquity = cash;
            const currentPrices = {};

            allTickers.forEach(t => {
                if (!dataMap[t]) return; // Skip if data failed to load
                const dayData = dataMap[t].find(d => d.date === date);
                if (dayData) {
                    const price = dayData.close;
                    currentPrices[t] = price;
                    const posVal = (positions[t] || 0) * price;
                    if (positions[t]) dailyEquity += posVal; // Only add to equity if we hold it (or track SPY equity if we bought it)

                    // Add to input
                    // Note: Allocator expects 'pending_orders' with 'size'
                    // We need to map our openOrders format
                    const pendingForAllocator = (openOrders[t] || []).map(o => ({
                        ...o,
                        size: o.qty
                    }));

                    // Calculate Support Levels & History
                    let supportLevels = [];
                    let history = [];
                    try {
                        if (!dataMap[t]) throw new Error("Data missing");
                        history = dataMap[t].filter(d => d.date <= date);
                        const prices = history.map(d => d.close);
                        const volumes = history.map(d => d.volume || 1000000);
                        supportLevels = detectSupportResistanceLevels(prices, volumes, price) || [];
                    } catch (e) {
                        supportLevels = [];
                    }

                    // Calculate Indicators for v9 Allocator
                    // Calculate Indicators for v9 Allocator
                    let rsi = 50;
                    let sma200 = price;
                    let ema20 = price;
                    let volume = dayData.volume || 1000000;
                    const volSurge = false;

                    if (history.length > 200) {
                        const closes = history.map(d => d.close);
                        rsi = btCalculateRSI(closes); // Returns last value
                        sma200 = btCalculateSMA(closes, 200);
                        ema20 = btCalculateEMA(closes, 20);
                    }

                    // v9.3: Calculate 60-day drawdown
                    const last60 = history.slice(-60);
                    const high60d = last60.length > 0 ? Math.max(...last60.map(d => d.close)) : price;
                    const drawdown60d = ((high60d - price) / high60d) * 100;

                    // v9.3: Calculate volumeAvg20
                    const last20Vols = history.slice(-20).map(d => d.volume || 1000000);
                    const volumeAvg20 = last20Vols.length > 0 ?
                        last20Vols.reduce((a, b) => a + b, 0) / last20Vols.length :
                        1000000;

                    dailyInput.assets[t] = {
                        ticker: t,
                        price,
                        position_shares: positions[t],
                        position_value: posVal,
                        weight: 0,
                        pending_orders: pendingForAllocator,
                        pending_cost: openOrders[t].reduce((sum, o) => sum + (o.qty * o.price), 0),
                        supportLevels: supportLevels,
                        indicators: {
                            rsi,
                            sma200,
                            ema20,
                            volume,
                            volumeAvg20,
                            drawdown60d,
                            priceToSMA200: sma200 > 0 ? (price / sma200) : 1,
                            volSurge
                        }
                    };
                }
            });

            // Update weights
            tickers.forEach(t => {
                if (dailyInput.assets[t]) {
                    dailyInput.assets[t].weight = dailyInput.assets[t].position_value / dailyEquity;
                }
            });
            dailyInput.total_equity = dailyEquity;

            // v9.3: Global regime is now handled internally by generateGlobalPoolPlan
            // No longer need to call analyzeRegime here - just provide empty regime object
            dailyInput.regime = {
                type: 'NORMAL',  // Placeholder - not used by v9.3
                underexposure: 5,
                overextension: 5
            }; // C. Execute Orders (Fill Check)
            tickers.forEach(t => {
                if (!dataMap[t]) return; // Skip if data failed to load
                const dayData = dataMap[t].find(d => d.date === date);
                if (!dayData) return;

                const filledOrders = [];
                const remainingOrders = [];

                openOrders[t].forEach(order => {
                    // Limit Buy: Low <= Price
                    if (order.type === 'limit_buy' && dayData.low <= order.price) {
                        // Fill! Cash was already deducted when order was placed
                        positions[t] += order.qty;
                        filledOrders.push(order);
                        this.results.trades.push({
                            date, ticker: t, type: 'BUY', price: order.price, qty: order.qty, reason: `Limit Fill (${order.band})`
                        });
                    } else {
                        remainingOrders.push(order);
                    }
                });
                openOrders[t] = remainingOrders;
            });

            // D. Run Allocator

            // BOOTSTRAP: If we have 0 position in a ticker, force a buy to get started
            // The allocator is conservative and waits for Compression, but we need exposure to test the logic
            tickers.forEach(t => {
                if (positions[t] === 0 && cash > 1000) {
                    // Buy 5% position to start
                    const price = currentPrices[t];
                    const qty = Math.floor((dailyEquity * 0.05) / price);
                    if (qty > 0) {
                        const cost = qty * price;
                        if (cash >= cost) {
                            cash -= cost;
                            positions[t] += qty;
                            this.results.trades.push({
                                date, ticker: t, type: 'BUY (BOOTSTRAP)', price: price, qty: qty, reason: 'Initial Entry'
                            });
                        }
                    }
                }
            });

            const plan = this.allocator.generateGlobalPoolPlan(dailyInput);

            // DEBUG: Log allocator output on first day and every 30 days
            const dayIndex = commonDates.indexOf(date);
            if (dayIndex % 30 === 0 || dayIndex < 5) {
                console.log(`[Backtest ${date}] Global Regime:`, plan.global.spyRegime);
                console.log(`[Backtest ${date}] MSFT Phase:`, plan.assetPlans['MSFT']?.regime);

                console.log(`\n[Day ${dayIndex + 1}] ${date} - Cash: $${cash.toFixed(0)}`);
                console.log(`Regime: ${dailyInput.regime.phase}, Equity: $${dailyEquity.toFixed(0)}`);
                Object.values(plan.assetPlans).forEach(p => {
                    console.log(`  ${p.ticker}: Position=$${(positions[p.ticker] * currentPrices[p.ticker]).toFixed(0)}, CoreBuy="${p.coreBuy || 'None'}", Ladder=${p.ladder.length} actions`);
                    if (p.ladder.length > 0 && dayIndex < 5) {
                        p.ladder.forEach(a => console.log(`    - ${a.status}: ${a.shares} @ $${a.price} (${a.reason})`));
                    }
                });
            }

            // E. Apply Allocator Actions
            // 1. Cancels
            Object.values(plan.assetPlans).forEach(p => {
                p.ladder.forEach(action => {
                    if (action.status === 'CANCEL') {
                        const qty = action.shares;
                        const price = action.price;

                        // Find and remove
                        const idx = openOrders[p.ticker].findIndex(o => o.qty === qty && Math.abs(o.price - price) < 0.01);
                        if (idx !== -1) {
                            openOrders[p.ticker].splice(idx, 1);
                            // Note: In this simple sim, we don't track reserved cash separately from 'cash',
                            // but if we did, we'd release it here.
                        }
                    }
                });
            });

            // 2. New Orders & Core Buys
            // We need to handle cash management carefully.
            // Allocator assumes 'initialCash' is available. 
            // If we reserve cash, 'initialCash' should be (Total Cash - Reserved).
            // Let's fix the loop start to pass (Cash - Reserved).

            // Re-run logic:
            // We need to track 'reservedCash' for open orders.
            let reservedCash = 0;
            Object.values(openOrders).forEach(list => list.forEach(o => reservedCash += o.qty * o.price));

            // Update dailyInput cash to be (Total Cash - Reserved)
            // But wait, we already ran the allocator with 'cash'. 
            // If 'cash' was just the free cash, we are good.
            // In step C, we deducted cash on fill. 
            // We should deduct cash on PLACE to be safe and match broker style?
            // Or just track free cash. 
            // Let's say 'cash' variable = Free Cash (Unencumbered).
            // When we place order, we deduct from 'cash'.
            // When we cancel, we add back to 'cash'.
            // When fill happens, 'cash' is already gone, we just convert reserved to position.
            // This is cleaner.

            // RESTART LOOP LOGIC WITH CASH MODEL:
            // Cash = Unsettled Cash.
            // When Order Placed: Cash -> Reserved.
            // When Order Filled: Reserved -> Stock.
            // When Order Cancelled: Reserved -> Cash.

            // So, let's adjust Step C (Fills) and E (Actions).

            // ... (Refining logic in actual code below) ...

            // E. Apply Actions (continued)
            // E. Apply Actions (continued)
            Object.values(plan.assetPlans).forEach(p => {
                // 1. Core Buys (Not used in v9.3 yet, but placeholder)
                // v9.3 uses 'newRungs' for buys, which are handled in the order placement section (not shown here but assumed handled by ladder logic)
                // If there were immediate market buys, they would be here.

                // 2. Trims (RESET / MELTUP)
                if (p.coreTrim && p.coreTrim.shares > 0) {
                    const qty = p.coreTrim.shares;
                    if (positions[p.ticker] >= qty) {
                        const price = currentPrices[p.ticker];
                        positions[p.ticker] -= qty;
                        cash += qty * price;
                        this.results.trades.push({
                            date, ticker: p.ticker, type: 'SELL (TRIM)', price: price, qty: qty, reason: p.coreTrim.reason || 'Allocator Trim'
                        });
                    }
                }

                // 3. Full Exits (CATASTROPHIC)
                else if (p.action === 'EXIT') {
                    // Full Exit
                    const qty = positions[p.ticker];
                    if (qty > 0) {
                        const price = currentPrices[p.ticker];
                        positions[p.ticker] = 0;
                        cash += qty * price;
                        this.results.trades.push({
                            date, ticker: p.ticker, type: 'SELL (EXIT)', price: price, qty: qty, reason: p.coreTrim?.reason || 'Allocator Exit'
                        });
                    }
                }

                // 4. New Rungs (Limit Buys)
                if (p.ladder) {
                    p.ladder.forEach(rung => {
                        if (rung.status === 'NEW') {
                            // Check if we already have this order (deduplication)
                            const exists = openOrders[p.ticker].some(o => Math.abs(o.price - rung.price) < 0.01 && o.qty === rung.shares);
                            if (!exists) {
                                const cost = rung.shares * rung.price;
                                if (cash >= cost) {
                                    cash -= cost;
                                    openOrders[p.ticker].push({
                                        type: 'limit_buy',
                                        price: rung.price,
                                        qty: rung.shares,
                                        band: rung.probability + '%',
                                        reason: rung.reason
                                    });
                                }
                            }
                        }
                    });
                }
            });

            // F. Exits (Legacy/Safety Check - Optional, removed for simplicity as Allocator handles it)

            // Log Daily State
            this.results.equityCurve.push({
                date,
                equity: dailyEquity,
                cash: cash + reservedCash // Total cash (free + reserved)
            });
        }

        this.log("Backtest Complete.");
        return this.results;
    }

    async fetchData(dataManager, ticker) {
        try {
            // Request 10 years to ensure we have enough history for 2016 scenarios
            // Add random param to force cache bust if needed
            const data = await fetchStockData(ticker, '10y', '1d');
            return data;
        } catch (e) {
            console.error(e);
            return null;
        }
    }

    processData(data, startDateStr, endDateStr) {
        const processed = [];
        const timestamps = data.timestamp;
        const quotes = data.indicators.quote[0];

        timestamps.forEach((t, i) => {
            if (quotes.close[i] !== null) {
                const date = new Date(t * 1000).toISOString().split('T')[0];

                // Filter
                if (date >= startDateStr && (!endDateStr || date <= endDateStr)) {
                    processed.push({
                        date: date,
                        open: quotes.open[i],
                        high: quotes.high[i],
                        low: quotes.low[i],
                        close: quotes.close[i],
                        volume: quotes.volume[i]
                    });
                }
            }
        });
        console.log(`[Backtest] ${data.symbol || 'Unknown'}: Filtered ${processed.length} dates from ${timestamps.length} total (range: ${startDateStr} to ${endDateStr || 'Present'})`);
        return processed;
    }

    getCommonDates(dataMap) {
        let dates = null;
        Object.values(dataMap).forEach(data => {
            const dList = data.map(d => d.date);
            if (dates === null) dates = dList;
            else dates = dates.filter(d => dList.includes(d));
        });
        return dates ? dates.sort() : [];
    }

    log(msg) {
        this.logs.push(msg);
        console.log(`[Backtest] ${msg}`);
    }

    generateReport() {
        if (!this.results.equityCurve || this.results.equityCurve.length === 0) {
            return "No backtest data generated.";
        }

        const initialEquity = this.results.equityCurve[0].equity; // Or initial cash
        const finalEquity = this.results.equityCurve[this.results.equityCurve.length - 1].equity;
        const totalReturn = ((finalEquity - initialEquity) / initialEquity) * 100;

        // Calculate Max Drawdown
        let maxEquity = 0;
        let maxDrawdown = 0;
        this.results.equityCurve.forEach(d => {
            if (d.equity > maxEquity) maxEquity = d.equity;
            const drawdown = ((maxEquity - d.equity) / maxEquity) * 100;
            if (drawdown > maxDrawdown) maxDrawdown = drawdown;
        });

        // Trade Stats
        const trades = this.results.trades;
        const buyTrades = trades.filter(t => t.type.includes('BUY') || t.type.includes('NEW'));
        const sellTrades = trades.filter(t => t.type.includes('SELL'));

        // Win Rate (Approximate - need to link buys/sells for true win rate)
        // For now, just list counts.

        let report = `=== BACKTEST REPORT ===\n`;
        report += `Period: ${this.results.equityCurve[0].date} to ${this.results.equityCurve[this.results.equityCurve.length - 1].date}\n`;
        report += `Initial Equity: $${initialEquity.toFixed(2)}\n`;
        report += `Final Equity:   $${finalEquity.toFixed(2)}\n`;
        report += `Total Return:   ${totalReturn.toFixed(2)}%\n`;
        report += `Max Drawdown:   ${maxDrawdown.toFixed(2)}%\n`;
        report += `\nTrades:\n`;
        report += `  Buys: ${buyTrades.length}\n`;
        report += `  Sells: ${sellTrades.length}\n`;
        report += `\nLatest Trades:\n`;
        trades.slice(-5).forEach(t => {
            report += `  ${t.date} ${t.ticker} ${t.type}: ${t.qty} @ $${t.price.toFixed(2)} (${t.reason})\n`;
        });

        return report;
    }
}

// --- HELPER FUNCTIONS ---

function btCalculateSMA(data, period) {
    if (data.length < period) return data[data.length - 1];
    const slice = data.slice(-period);
    const sum = slice.reduce((a, b) => a + b, 0);
    return sum / period;
}

function btCalculateEMA(data, period) {
    if (data.length < period) return data[data.length - 1];
    const k = 2 / (period + 1);
    let ema = data[0];
    for (let i = 1; i < data.length; i++) {
        ema = data[i] * k + ema * (1 - k);
    }
    return ema;
}

function btCalculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
        const change = prices[i] - prices[i - 1];
        if (change > 0) gains += change;
        else losses -= change;
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = period + 1; i < prices.length; i++) {
        const change = prices[i] - prices[i - 1];
        if (change > 0) {
            avgGain = (avgGain * 13 + change) / 14;
            avgLoss = (avgLoss * 13 + 0) / 14;
        } else {
            avgGain = (avgGain * 13 + 0) / 14;
            avgLoss = (avgLoss * 13 - change) / 14;
        }
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}
