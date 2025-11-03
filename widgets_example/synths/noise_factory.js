// ============================================================================
// NOISE OSCILLATOR FACTORY
// ============================================================================
// Factory functions for creating complete noise oscillator chains
// Each chain: noise → HP/LP sculpting → mask filter (wet/dry) → volume → width
//
// EXPORTS:
// - createOscillatorChain(index, state, ToneLib) - Factory for single osc
// - createAllOscillators(state, ToneLib) - Factory for dual-osc system
// ============================================================================

import { createDriftLFO } from './shared/lfo_drift.js';

// ============================================================================
// HELPER: Create mask filter (bandpass/notch/allpass/comb)
// ============================================================================
function createMaskFilter(type, centerHz, Tone) {
  if (type === 'comb') {
    const COMB_DELAY_MULTIPLIER = 1.0;
    const delayTime = COMB_DELAY_MULTIPLIER / centerHz;
    return new Tone.FeedbackCombFilter({
      delayTime: delayTime,
      resonance: 0.7
    });
  } else {
    // Standard biquad filters: bandpass, notch, allpass
    let Q = 10; // Default: notch
    if (type === 'allpass') Q = 1;
    else if (type === 'bandpass') Q = 2;
    
    return new Tone.Filter({
      type: type,
      frequency: centerHz,
      Q: Q
    });
  }
}

// ============================================================================
// FACTORY: Create complete oscillator chain
// ============================================================================
/**
 * Factory function to create a complete noise oscillator chain
 * Includes: noise → HP/LP sculpting → mask filter (wet/dry) → volume → width
 * 
 * @param {number} index - Oscillator index (0 or 1)
 * @param {Object} state - State object containing all parameter arrays
 * @param {Object} ToneLib - Reference to Tone.js library
 * @returns {Object} - Node references for array storage
 */
export function createOscillatorChain(index, state, ToneLib) {
  const Tone = ToneLib;
  
  // Read stored state for this oscillator
  const type = state.oscTypes[index];
  const volume = state.oscVolumes[index];
  const sculptLP = state.oscSculptLPs[index];
  const sculptHP = state.oscSculptHPs[index];
  const maskType = state.oscMaskTypes[index];
  const maskCenter = state.oscMaskCenters[index];
  const maskMix = state.oscMaskMixes[index];
  const width = state.oscWidths[index];
  
  // Create noise oscillator
  const osc = new Tone.Noise(type);
  
  // Create sculpt filters (per-osc for nuanced frequency control)
  const hpFilter = new Tone.Filter({
    type: 'highpass',
    frequency: sculptHP,
    rolloff: -12,
    Q: 0.7071
  });
  
  const lpFilter = new Tone.Filter({
    type: 'lowpass',
    frequency: sculptLP,
    rolloff: -12,
    Q: 0.7071
  });
  
  // Create mask filter (per-osc for independent dramatic filtering)
  const maskFilter = createMaskFilter(maskType, maskCenter, Tone);
  
  // Create wet/dry mix gains
  const EPSILON = 0.001;
  const needsRemapping = (maskType === 'allpass' || maskType === 'comb');
  const effectiveMix = needsRemapping ? maskMix * 0.5 : maskMix;
  const dryGain = new Tone.Gain(Math.max(EPSILON, 1.0 - effectiveMix));
  const wetGain = new Tone.Gain(Math.max(EPSILON, effectiveMix));
  
  // Create volume gain
  const oscGain = new Tone.Gain(volume, "decibels");
  
  // Create stereo width control
  const widthSplit = new Tone.Split();
  const pannerL = new Tone.Panner(-width);
  const pannerR = new Tone.Panner(width);
  
  // ============================================================================
  // SIGNAL FLOW: Connect oscillator chain
  // ============================================================================
  // 1. Sculpt stage: HP → LP (transparent bandpass shaping)
  osc.connect(hpFilter);
  hpFilter.connect(lpFilter);
  
  // 2. Mask stage: Split to dry + wet paths
  lpFilter.connect(dryGain);
  lpFilter.connect(maskFilter);
  maskFilter.connect(wetGain);
  
  // 3. Sum stage: dry + wet → volume
  dryGain.connect(oscGain);
  wetGain.connect(oscGain);
  
  // 4. Width stage: volume → split → L/R panners
  oscGain.connect(widthSplit);
  widthSplit.connect(pannerL, 0);
  widthSplit.connect(pannerR, 1);
  
  // Create drift LFO if enabled
  let driftLFO = null;
  if (state.oscDriftEnabled[index]) {
    driftLFO = createDriftLFO({
      center: maskCenter,
      amount: state.oscDriftAmounts[index],
      rateLo: state.oscDriftRateLo[index],
      rateHi: state.oscDriftRateHi[index],
      filterType: maskType,
      maskFilter: maskFilter,
      ToneLib: Tone,
      existingLFO: null
    });
  }
  
  console.log(`✅ Osc ${index + 1} chain created: ${type}, ${volume}dB, sculpt ${sculptHP}-${sculptLP}Hz, mask ${maskType}@${maskCenter}Hz`);
  
  // Return all nodes for array storage
  return {
    osc,
    hpFilter,
    lpFilter,
    maskFilter,
    dryGain,
    wetGain,
    oscGain,
    widthSplit,
    pannerL,
    pannerR,
    driftLFO
  };
}

// ============================================================================
// FACTORY: Create all oscillators + master gain
// ============================================================================
/**
 * Creates dual oscillator system with shared master gain
 * 
 * @param {Object} state - State object containing all parameter arrays
 * @param {Object} ToneLib - Reference to Tone.js library
 * @param {number} numOscillators - Number of oscillators to create (default 2)
 * @returns {Object} - All node arrays + master gain
 */
export function createAllOscillators(state, ToneLib, numOscillators = 2) {
  const Tone = ToneLib;
  
  // Initialize arrays
  const noiseOscs = [];
  const highpassFilters = [];
  const lowpassFilters = [];
  const maskFilters = [];
  const maskDryGains = [];
  const maskWetGains = [];
  const oscGains = [];
  const widthSplits = [];
  const widthPannersL = [];
  const widthPannersR = [];
  const maskCenterLFOs = [];
  
  console.log(`🎚️ Creating ${numOscillators} oscillator chains...`);
  
  // Factory loop: create each oscillator chain
  for (let i = 0; i < numOscillators; i++) {
    const chain = createOscillatorChain(i, state, ToneLib);
    
    // Store all nodes in arrays
    noiseOscs.push(chain.osc);
    highpassFilters.push(chain.hpFilter);
    lowpassFilters.push(chain.lpFilter);
    maskFilters.push(chain.maskFilter);
    maskDryGains.push(chain.dryGain);
    maskWetGains.push(chain.wetGain);
    oscGains.push(chain.oscGain);
    widthSplits.push(chain.widthSplit);
    widthPannersL.push(chain.pannerL);
    widthPannersR.push(chain.pannerR);
    maskCenterLFOs.push(chain.driftLFO);
  }
  
  // Create shared master gain
  const masterGain = new Tone.Gain(0.5); // -6dB headroom
  
  // Connect all L/R panners to master
  widthPannersL.forEach(panner => panner.connect(masterGain));
  widthPannersR.forEach(panner => panner.connect(masterGain));
  
  masterGain.toDestination();
  
  console.log(`✅ ${numOscillators} oscillator chains connected to master`);
  
  // Return all nodes
  return {
    noiseOscs,
    highpassFilters,
    lowpassFilters,
    maskFilters,
    maskDryGains,
    maskWetGains,
    oscGains,
    widthSplits,
    widthPannersL,
    widthPannersR,
    maskCenterLFOs,
    masterGain
  };
}
