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
    }

    // ============================================================
    // PHASE DETECTION ENGINE
    // ============================================================

    detectPhase(asset) {
        const { price, indicators } = asset;
        const { rsi, sma200, ema20, volume, volumeAvg20 } = indicators;

        // Calculate metrics
        const priceTosma200Pct = ((price - sma200) / sma200) * 100;
        const priceToEma20Pct = ((price - ema20) / ema20) * 100;
        const volumeRatio = volume / volumeAvg20;

        // PHASE 5: CATASTROPHIC (highest priority)
        if (price < sma200 && rsi < 40) {
            return {
                phase: 'CATASTROPHIC',
                reason: `Price < SMA200 (${priceTosma200Pct.toFixed(1)}%), RSI ${rsi.toFixed(0)}`,
                score: 0
            };
        }

        // PHASE 4: RESET
        if (rsi < 45 || price < ema20 || volumeRatio < 0.8) {
            return {
                phase: 'RESET',
                reason: `RSI ${rsi.toFixed(0)}, Price ${priceToEma20Pct >= 0 ? '+' : ''}${priceToEma20Pct.toFixed(1)}% vs EMA20, Vol ${(volumeRatio * 100).toFixed(0)}%`,
                score: 2
            };
        }

        // PHASE 3: MELTUP
        if (price > sma200 * 1.12 && rsi > 70 && volumeRatio > 1.5) {
            return {
                phase: 'MELTUP',
                reason: `Price +${priceTosma200Pct.toFixed(1)}% vs SMA200, RSI ${rsi.toFixed(0)}, Vol ${(volumeRatio * 100).toFixed(0)}%`,
                score: 8
            };
        }

        // PHASE 2: IGNITION
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
            reason: `Price ${price > sma200 ? '+' : ''}${priceTosma200Pct.toFixed(1)}% vs SMA200, RSI ${rsi.toFixed(0)}`,
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

    /**
     * Generate automatic dip rungs based on price distance from SMA200
     */
    generateAutoDipRungs(asset, dryPowder) {
        const { ticker, price, indicators } = asset;
        const { sma200 } = indicators;

        const newRungs = [];
        const priceTosma200Pct = ((price - sma200) / sma200) * 100;

        // Auto-generate 30% rung if 10-18% below SMA200
        if (priceTosma200Pct < -10 && priceTosma200Pct > -18) {
            const targetPrice = sma200 * 0.86; // 14% below SMA200
            const allocation = dryPowder * 0.10; // 10% of dry powder
            newRungs.push({
                price: targetPrice,
                shares: Math.floor(allocation / targetPrice),
                dollarValue: allocation,
                probability: 30,
                status: 'NEW',
                reason: 'Auto-generated dip buy (14% below SMA200)'
            });
        }

        // Auto-generate 5% rung if >20% below SMA200
        if (priceTosma200Pct < -20) {
            const targetPrice = sma200 * 0.75; // 25% below SMA200
            const allocation = dryPowder * 0.05; // 5% of dry powder
            newRungs.push({
                price: targetPrice,
                shares: Math.floor(allocation / targetPrice),
                dollarValue: allocation,
                probability: 5,
                status: 'NEW',
                reason: 'Auto-generated deep value (25% below SMA200)'
            });
        }

        return newRungs;
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

        // RESET: Immediate 35% trim + generate lower rungs
        if (phase === 'RESET') {
            const trimShares = Math.floor(position_shares * 0.35);
            if (trimShares > 0) {
                action.coreTrim = {
                    shares: trimShares,
                    reason: 'RESET phase - Proactive 35% derisking'
                };
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

        // MELT UP: Trim 15% + set exits + freeze buys
        if (phase === 'MELTUP') {
            const trimShares = Math.floor(position_shares * 0.15);
            if (trimShares > 0) {
                action.coreTrim = {
                    shares: trimShares,
                    reason: 'MELTUP phase - Lock 15% profits'
                };
            }

            // Set 5-tranche meltup exits
            action.meltupExits = this.generate5TrancheExits(asset);

            // Cancel all new buys
            action.modifiedRungs = pending_orders.map(o => ({
                ...o,
                status: 'CANCEL',
                reason: 'MELTUP - Stop buying'
            }));

            // Special BTC rule
            if (ticker === 'BTC-USD') {
                action.modifiedRungs = pending_orders.map(o => ({
                    ...o,
                    status: 'CANCEL',
                    reason: 'BTC Meltup - Stop accumulation'
                }));
            }

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
                regime: null
            },
            rejectedRungs: [],
            summary: ''
        };

        // Calculate dry powder (40% bootstrap limit)
        const maxInitialDeployment = input.cash_available * this.BOOTSTRAP_LIMIT;
        let dryPowder = input.cash_available;

        // Process each asset
        Object.values(input.assets).forEach(asset => {
            const regime = this.detectPhase(asset);
            const action = this.getPhaseAction(asset, regime, dryPowder, input.cash_available);

            const assetPlan = {
                ticker: asset.ticker,
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
                report += `${p.ticker}: ${p.position.shares} → ${targetShares} shares`;
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
        // Build input from dataMap (legacy compatibility)
        // This will be called with window.marketDataCache
        const input = {
            cash_available: this.cashAvailable,
            assets: {}
        };

        Object.keys(dataMap).forEach(ticker => {
            const data = dataMap[ticker];
            if (!data || data.length === 0) return;

            const latest = data[data.length - 1];

            input.assets[ticker] = {
                ticker,
                price: latest.close,
                position_shares: this.userState.holdings[ticker] || 0,
                position_value: (this.userState.holdings[ticker] || 0) * latest.close,
                pending_orders: this.userState.limits[ticker] || [],
                indicators: {
                    rsi: latest.rsi || 50,
                    sma200: latest.sma200 || latest.close,
                    ema20: latest.ema20 || latest.close,
                    volume: latest.volume || 1000000,
                    volumeAvg20: latest.volumeAvg20 || 1000000
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
        alert("Changes committed (UI integration pending)");
    }
}
