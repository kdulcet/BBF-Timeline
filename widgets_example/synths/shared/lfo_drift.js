// ============================================================================
// LFO DRIFT MANAGER - Reusable drift LFO creation with Hz→seconds conversion
// ============================================================================
// Manages RandomLFO instances for organic parameter drift
// Handles both frequency-based (Hz) and time-based (seconds) parameters
//
// USAGE:
//   import { createDriftLFO, disposeDriftLFO } from './shared/lfo_drift.js';
//   const lfo = createDriftLFO({ 
//     center: 2000, amount: 0.15, rateLo: 5, rateHi: 15, 
//     filterType: 'bandpass', maskFilter: filterNode, ToneLib: window.Tone 
//   });
// ============================================================================

import RandomLFO from './lfo_random.js';
import { FILTER_CONSTANTS } from './filter_bank.js';

// ============================================================================
// CREATE DRIFT LFO - Factory function with Hz→seconds conversion
// ============================================================================
/**
 * Create and connect a RandomLFO for mask center frequency drift
 * Automatically handles Hz→seconds conversion for comb filters
 * 
 * @param {object} config - Configuration object
 * @param {number} config.center - Center frequency (Hz)
 * @param {number} config.amount - Drift amount (0.0-1.0, as percentage of center)
 * @param {number} config.rateLo - Min LFO period (seconds)
 * @param {number} config.rateHi - Max LFO period (seconds)
 * @param {string} config.filterType - Filter type: 'bandpass', 'notch', 'allpass', 'comb'
 * @param {object} config.maskFilter - The Tone.js filter node to modulate
 * @param {object} config.ToneLib - Reference to Tone.js library (window.Tone)
 * @param {object} [config.existingLFO] - Optional existing LFO to dispose first
 * @returns {RandomLFO | null} The created LFO instance (or null on error)
 * 
 * @example
 *   // Bandpass filter (modulates frequency in Hz)
 *   const lfo = createDriftLFO({
 *     center: 2000, amount: 0.15, rateLo: 5, rateHi: 15,
 *     filterType: 'bandpass', maskFilter: bpFilter, ToneLib: window.Tone
 *   });
 * 
 * @example
 *   // Comb filter (converts Hz → seconds for delayTime)
 *   const lfo = createDriftLFO({
 *     center: 2000, amount: 0.15, rateLo: 5, rateHi: 15,
 *     filterType: 'comb', maskFilter: combFilter, ToneLib: window.Tone
 *   });
 */
export function createDriftLFO(config) {
  const {
    center,
    amount,
    rateLo,
    rateHi,
    filterType,
    maskFilter,
    ToneLib,
    existingLFO = null
  } = config;
  
  // Validation
  if (!maskFilter || !ToneLib) {
    console.warn('🎲 lfo_drift: maskFilter and ToneLib are required');
    return null;
  }
  
  // Dispose existing LFO if provided
  if (existingLFO) {
    disposeDriftLFO(existingLFO);
  }
  
  // Calculate drift range: center ± (center * amount)
  const driftRange = center * amount;
  const targetMin = center - driftRange;
  const targetMax = center + driftRange;
  
  // LFO config (period randomization)
  const mean = (rateLo + rateHi) / 2;
  const stdDev = (rateHi - rateLo) / 4; // 95% of values within range
  
  let lfo = null;
  
  if (filterType === 'comb') {
    // ========================================================================
    // COMB FILTER: Convert frequency (Hz) → delay time (seconds)
    // ========================================================================
    // Relationship: delayTime = COMB_DELAY_MULTIPLIER / frequency
    // Inverse: higher Hz = shorter delay, lower Hz = longer delay
    
    const delayMin = FILTER_CONSTANTS.COMB_DELAY_MULTIPLIER / targetMax; // High freq
    const delayMax = FILTER_CONSTANTS.COMB_DELAY_MULTIPLIER / targetMin; // Low freq
    
    lfo = new RandomLFO({
      min: rateLo,
      max: rateHi,
      mean: mean,
      stdDev: stdDev,
      targetMin: delayMin,  // Output in seconds
      targetMax: delayMax,  // Output in seconds
      shape: 'sine'
    });
    
    lfo.connect(maskFilter.delayTime).start();
    
    console.log(`🎲 Drift LFO created (comb): center=${center}Hz (${(FILTER_CONSTANTS.COMB_DELAY_MULTIPLIER / center).toFixed(6)}s), ` +
                `±${(amount * 100).toFixed(0)}%, ` +
                `range=[${targetMin.toFixed(0)}-${targetMax.toFixed(0)}Hz] = ` +
                `[${delayMin.toFixed(6)}-${delayMax.toFixed(6)}s], ` +
                `period=[${rateLo}-${rateHi}s]`);
  } else {
    // ========================================================================
    // STANDARD FILTERS: Use frequency (Hz) directly
    // ========================================================================
    lfo = new RandomLFO({
      min: rateLo,
      max: rateHi,
      mean: mean,
      stdDev: stdDev,
      targetMin: targetMin,  // Output in Hz
      targetMax: targetMax,  // Output in Hz
      shape: 'sine'
    });
    
    lfo.connect(maskFilter.frequency).start();
    
    console.log(`🎲 Drift LFO created: center=${center}Hz, ±${(amount * 100).toFixed(0)}%, ` +
                `range=[${targetMin.toFixed(0)}-${targetMax.toFixed(0)}Hz], ` +
                `period=[${rateLo}-${rateHi}s]`);
  }
  
  return lfo;
}

// ============================================================================
// DISPOSE DRIFT LFO - Cleanup helper
// ============================================================================
/**
 * Safely dispose of a drift LFO
 * 
 * @param {RandomLFO | null} lfo - The LFO to dispose
 * @returns {null} Always returns null (for assignment: lfo = disposeDriftLFO(lfo))
 * 
 * @example
 *   maskCenterLFO = disposeDriftLFO(maskCenterLFO);
 */
export function disposeDriftLFO(lfo) {
  if (lfo) {
    try {
      lfo.dispose();
    } catch (e) {
      console.warn('🎲 lfo_drift: Error disposing LFO:', e);
    }
  }
  return null;
}
