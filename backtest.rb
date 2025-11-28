
# Backtest Simulation for Regime-Based Logic (Ruby Version)

def calculate_sma(data, period)
  return nil if data.length < period
  data.last(period).sum / period.to_f
end

def calculate_rsi(prices, period = 14)
  return [50] if prices.length < period + 1
  
  gains = 0.0
  losses = 0.0
  
  (1..period).each do |i|
    diff = prices[i] - prices[i - 1]
    if diff >= 0
      gains += diff
    else
      losses -= diff
    end
  end
  
  avg_gain = gains / period
  avg_loss = losses / period
  
  rsi_series = []
  if avg_loss == 0
    rsi_series << 100
  else
    rs = avg_gain / avg_loss
    rsi_series << 100 - (100 / (1 + rs))
  end

  (period + 1...prices.length).each do |i|
    diff = prices[i] - prices[i - 1]
    gain = diff > 0 ? diff : 0
    loss = diff < 0 ? -diff : 0
    
    avg_gain = (avg_gain * (period - 1) + gain) / period
    avg_loss = (avg_loss * (period - 1) + loss) / period
    
    if avg_loss == 0
      rsi_series << 100
    else
      rs = avg_gain / avg_loss
      rsi_series << 100 - (100 / (1 + rs))
    end
  end
  
  rsi_series
end

def get_regime_exit_signal(closes, volumes)
  current_price = closes.last
  rsi = calculate_rsi(closes).last
  sma20 = calculate_sma(closes, 20)
  sma200 = calculate_sma(closes, 200)

  # 1. REGIME SETUP (Are we extended?)
  is_overheated = (rsi > 75)
  # Check if we were extended recently (last 5 days)
  recent_high = closes.last(5).max
  is_extended = (sma200 && recent_high > sma200 * 1.3) # >30% above 200d MA

  # 2. TRIGGER EVENTS
  # Dynamic Stop: If extended, use tighter SMA10. Otherwise SMA20.
  sma10 = calculate_sma(closes, 10)
  
  stop_price = is_extended ? sma10 : sma20
  trend_break = (current_price < stop_price)
  
  # Blow-off Top: High Vol Reversal
  avg_vol = volumes.last(20).sum / 20.0
  current_vol = volumes.last
  is_reversal = (current_price < closes[-2]) # Red day
  blow_off = (current_vol > avg_vol * 2.5 && is_reversal && is_extended)

  # 3. DECISION MATRIX
  if blow_off
    return 'EXIT EXECUTION (Blow-off)'
  end
  
  if trend_break && is_extended
    return 'EXIT EXECUTION (Trend Break)'
  end

  # Debug logging for failure analysis
  if trend_break || is_extended
     puts "DEBUG: Price=#{current_price.round(0)} SMA20=#{sma20.round(0)} SMA200=#{sma200.round(0)} Ext=#{is_extended} Break=#{trend_break}"
  end

  return 'DISTRIBUTION (Watch)' if is_overheated
  return 'SAFE (Hold)'
end

# --- SCENARIOS ---

puts "\n--- SCENARIO 1: BTC 2017 (Parabolic Run) ---"
puts "Goal: HOLD through RSI > 80, EXIT only at end."
closes = []
volumes = []
price = 100.0
# 200 days history
200.times { closes << price; volumes << 1000; price *= 1.001 }

# The Run (60 days)
60.times do |i|
  price *= 1.02
  closes << price
  volumes << 2000
  signal = get_regime_exit_signal(closes, volumes)
  puts "Day #{i}: Price #{price.round(0)} | Signal: #{signal}" if i % 10 == 0
end
# The Crash
price *= 0.85
closes << price
volumes << 5000
puts "Day 61 (CRASH): Price #{price.round(0)} | Signal: #{get_regime_exit_signal(closes, volumes)}"


puts "\n--- SCENARIO 2: 2020 Shakeout (Volatility) ---"
puts "Goal: HOLD because not extended > 30% above 200d MA."
closes = []
volumes = []
price = 100.0
200.times { closes << price; volumes << 1000; price *= 1.001 }
# Modest run
20.times { price *= 1.005; closes << price; volumes << 1000 }
# Shakeout
price *= 0.90
closes << price
volumes << 1500
puts "Shakeout Day: Price #{price.round(0)} | Signal: #{get_regime_exit_signal(closes, volumes)}"


puts "\n--- SCENARIO 3: Blow-off Top (Volume Climax) ---"
puts "Goal: EXIT on massive volume reversal."
closes = []
volumes = []
price = 100.0
200.times { closes << price; volumes << 1000; price *= 1.001 }
# Extended run
50.times { price *= 1.01; closes << price; volumes << 1000 }
# Climax
price *= 0.98
closes << price
volumes << 3000 # 3x vol
puts "Climax Day: Price #{price.round(0)} | Vol 3x | Signal: #{get_regime_exit_signal(closes, volumes)}"
