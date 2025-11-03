// ============================================================================
// FILTER BANK - Reusable Tone.js filter creation with proper Q/resonance
// ============================================================================
// Provides centralized filter configuration for consistent sound design
// Supports: bandpass, notch, allpass, comb (with feedback)
//
// USAGE:
//   import { createMaskFilter, FILTER_CONSTANTS } from './shared/filter_bank.js';
//   const filter = createMaskFilter('bandpass', 2000, window.Tone);
// ============================================================================

// ============================================================================
// FILTER CONSTANTS - Single source of truth for Q values and comb config
// ============================================================================
export const FILTER_CONSTANTS = {
  // Comb filter settings
  COMB_DELAY_MULTIPLIER: 5.0,  // Delay = multiplier / frequency (seconds)
  COMB_RESONANCE: 0.25,         // Feedback amount (0-1)
  
  // Standard filter Q values (resonance at center frequency)
  Q_ALLPASS: 1.5,   // Moderate-high Q = noticeable phase shift (phaser-like when blended)
  Q_BANDPASS: 1,    // Moderate Q = focused passband
  Q_NOTCH: 0.5      // Low Q = wide, gentle notch (mellow)
};

// ============================================================================
// CREATE MASK FILTER - Factory function for Tone.js filters
// ============================================================================
/**
 * Create a Tone.js filter node based on type and center frequency
 * 
 * @param {string} type - Filter type: 'bandpass', 'notch', 'allpass', 'comb'
 * @param {number} center - Center frequency in Hz
 * @param {object} ToneLib - Reference to Tone.js library (window.Tone)
 * @returns {Tone.Filter | Tone.FeedbackCombFilter} The created filter node
 * 
 * @example
 *   const filter = createMaskFilter('bandpass', 2000, window.Tone);
 *   filter.connect(destination);
 */
export function createMaskFilter(type, center, ToneLib) {
  if (!ToneLib) {
    throw new Error('filter_bank: ToneLib (window.Tone) is required');
  }
  
  if (type === 'comb') {
    // Comb filter: Tone.FeedbackCombFilter
    // Uses delayTime parameter (seconds), not frequency (Hz)
    const delayTime = FILTER_CONSTANTS.COMB_DELAY_MULTIPLIER / center;
    return new ToneLib.FeedbackCombFilter({
      delayTime: delayTime,
      resonance: FILTER_CONSTANTS.COMB_RESONANCE
    });
  } else {
    // Standard filters: bandpass, notch, allpass
    // Uses frequency parameter (Hz)
    let Q = FILTER_CONSTANTS.Q_NOTCH; // Default
    if (type === 'allpass') {
      Q = FILTER_CONSTANTS.Q_ALLPASS;
    } else if (type === 'bandpass') {
      Q = FILTER_CONSTANTS.Q_BANDPASS;
    }
    
    return new ToneLib.Filter({
      type: type,
      frequency: center,
      rolloff: -12,
      Q: Q
    });
  }
}

// ============================================================================
// HELPER: Get filter parameter name (for LFO connection)
// ============================================================================
/**
 * Get the correct AudioParam name for LFO connection
 * 
 * @param {string} type - Filter type: 'bandpass', 'notch', 'allpass', 'comb'
 * @returns {string} Parameter name: 'frequency' or 'delayTime'
 * 
 * @example
 *   const paramName = getFilterParamName('comb'); // 'delayTime'
 *   lfo.connect(filter[paramName]);
 */
export function getFilterParamName(type) {
  return type === 'comb' ? 'delayTime' : 'frequency';
}
