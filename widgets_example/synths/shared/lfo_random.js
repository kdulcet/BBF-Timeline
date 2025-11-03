// RandomLFO.js - Reusable random period LFO for humanization
// STUB - Ready for implementation when needed

/**
 * RandomLFO - Headless LFO with randomly changing periods using normal distribution
 * 
 * Features:
 * - Independent of Tone.Transport (runs continuously)
 * - Normal distribution for natural-feeling randomness
 * - Period changes at end of each cycle
 * - Set-and-forget design
 * 
 * Use Cases:
 * - Noise filter cutoff randomization
 * - Voice fader variance (±15% humanization)
 * - Width/Pan subtle movement
 * - Any continuous parameter that needs organic variation
 */

class RandomLFO {
  constructor(options = {}) {
    const {
      min = 5,           // Min period (seconds)
      max = 10,          // Max period (seconds)
      mean = 7.5,        // Mean period
      stdDev = 1.5,      // Standard deviation
      targetMin = 0,     // Min modulation value
      targetMax = 1,     // Max modulation value
      shape = 'sine'     // LFO shape: 'sine', 'triangle', 'square', 'sawtooth'
    } = options;
    
    this.config = { min, max, mean, stdDev, targetMin, targetMax, shape };
    this.isRunning = false;
    this.currentPeriod = mean;
    this.lfo = null;
    this.updateLoop = null;
    this.periodTimer = null; // MEMORY LEAK FIX: Track setTimeout for cleanup
  }
  
  /**
   * Generate random period using Box-Muller transform for normal distribution
   * Returns value clamped to [min, max] range
   */
  getRandomPeriod() {
    // Box-Muller transform for normal distribution
    const u1 = Math.random();
    const u2 = Math.random();
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    
    // Scale to desired mean and standard deviation
    let value = this.config.mean + z0 * this.config.stdDev;
    
    // Clamp to min/max range
    return Math.max(this.config.min, Math.min(this.config.max, value));
  }
  
  /**
   * Connect LFO to target parameter (e.g., filter.frequency, gain.gain)
   * @param {AudioParam} target - Tone.js audio parameter
   * @returns {RandomLFO} this (for chaining)
   */
  connect(target) {
    // Create LFO with initial random period
    this.currentPeriod = this.getRandomPeriod();
    
    this.lfo = new Tone.LFO({
      frequency: 1 / this.currentPeriod,  // Convert period to frequency
      type: this.config.shape,
      min: this.config.targetMin,
      max: this.config.targetMax
    });
    
    this.lfo.connect(target);
    return this;
  }
  
  /**
   * Start LFO and begin period randomization
   */
  start() {
    if (!this.lfo) {
      console.warn('RandomLFO: Must connect() before start()');
      return;
    }
    
    // CRITICAL: Only start if not already running to prevent Tone.js timing errors
    if (!this.isRunning) {
      this.lfo.start();
      this.isRunning = true;
      
      // Start period randomization loop
      this.schedulePeriodChange();
    }
  }
  
  /**
   * Schedule next period change recursively
   * @private
   */
  schedulePeriodChange() {
    if (!this.isRunning) return;
    
    // MEMORY LEAK FIX: Clear any existing timer before scheduling new one
    if (this.periodTimer) {
      clearTimeout(this.periodTimer);
    }
    
    // Schedule next period change after current period completes
    this.periodTimer = setTimeout(() => {
      if (!this.isRunning) return;
      
      // Get new random period
      this.currentPeriod = this.getRandomPeriod();
      
      // CRITICAL: Use 1ms micro-ramp to prevent AudioParam accumulation
      const newFreq = 1 / this.currentPeriod;
      const now = Tone.now();
      this.lfo.frequency.cancelScheduledValues(now);
      this.lfo.frequency.setValueAtTime(this.lfo.frequency.value, now);
      this.lfo.frequency.linearRampToValueAtTime(newFreq, now + 0.001);
      
      // console.log(`🎲 RandomLFO: New period = ${this.currentPeriod.toFixed(2)}s`); // PERFORMANCE: Commented to reduce console spam during playback
      
      // Schedule next change
      this.schedulePeriodChange();
    }, this.currentPeriod * 1000); // Convert to milliseconds
  }
  
  /**
   * Stop LFO
   */
  stop() {
    this.isRunning = false;
    
    // MEMORY LEAK FIX: Clear pending period timer
    if (this.periodTimer) {
      clearTimeout(this.periodTimer);
      this.periodTimer = null;
    }
    
    if (this.lfo) this.lfo.stop();
  }
  
  /**
   * Clean up resources
   */
  dispose() {
    this.stop();
    if (this.lfo) this.lfo.dispose();
  }
}

// Export for use in synths
export default RandomLFO;

/**
 * USAGE EXAMPLES:
 * 
 * // 1. Noise filter cutoff randomization (200-1200Hz, 5-10s periods)
 * const noiseLFO = new RandomLFO({
 *   min: 5,
 *   max: 10,
 *   mean: 7.5,
 *   stdDev: 1.5,
 *   targetMin: 200,
 *   targetMax: 1200,
 *   shape: 'sine'
 * });
 * noiseLFO.connect(noiseFilter.frequency).start();
 * 
 * 
 * // 2. Voice fader variance (±1.5dB humanization, 8-15s periods)
 * const voice1VarianceLFO = new RandomLFO({
 *   min: 8,
 *   max: 15,
 *   mean: 10,
 *   stdDev: 2,
 *   targetMin: -1.5,  // -1.5dB
 *   targetMax: 1.5    // +1.5dB
 * });
 * 
 * // Create variance gain node (inserted after main fader)
 * const voice1Variance = new Tone.Gain(0, "decibels");
 * voice1VarianceLFO.connect(voice1Variance.gain).start();
 * 
 * // Signal chain: voiceGain → voice1Variance → crossfadeGain → output
 * 
 * 
 * // 3. Width subtle movement (0.85-1.0, slow 15-25s periods)
 * const widthLFO = new RandomLFO({
 *   min: 15,
 *   max: 25,
 *   mean: 20,
 *   stdDev: 3,
 *   targetMin: 0.85,
 *   targetMax: 1.0,
 *   shape: 'sine'
 * });
 * widthLFO.connect(widthParam).start();
 */
