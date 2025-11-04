// ============================================================================
// NOISE SYNTH - Dual Oscillator Noise Engine
// ============================================================================
// Pure audio MODEL - no DOM access, event-driven architecture
// Generates textured noise using dual independent Tone.js Noise oscillators
//
// IMPORTS
import RandomLFO from './shared/lfo_random.js';
import { createMaskFilter, FILTER_CONSTANTS } from './shared/filter_bank.js';
import { createDriftLFO, disposeDriftLFO } from './shared/lfo_drift.js';
import { createAllOscillators } from './noise_factory.js';
import { createSetters } from './noise_set.js';
//
// ARCHITECTURE:
// - 2 independent noise oscillators (brown/pink/white per oscillator)
// - Multi-stage filtering: Sculpt (HP/LP) → Mask (bandpass/notch/allpass/comb)
// - Drift LFO: RandomLFO modulates mask center frequency for organic variation
// - Stereo width: Split + dual panners per oscillator
// - 9 controls per oscillator = 18 total parameters
//
// SIGNAL FLOW PER OSCILLATOR:
//   Noise → HP Filter → LP Filter → [SPLIT: Dry/Wet paths]
//                                      Dry → maskDryGain ↘
//                                      Wet → maskFilter → maskWetGain ↗
//                                                                      ↓
//                                   oscGain (volume) ← [WET/DRY MIX]
//                                                      ↓
//                                   widthSplit → widthPannerL → masterGain
//                                              ↘ widthPannerR ↗
//
// TONE.JS INTEGRATION:
// - Uses Tone.Noise (continuous noise generators)
// - Uses Tone.Filter (sculpt HP/LP + mask bandpass/notch/allpass)
// - Uses Tone.FeedbackCombFilter (mask comb type)
// - Uses Tone.Panner (stereo width positioning)
// - Uses Tone.Gain (volume + wet/dry mixing with dB ramping)
// - Uses RandomLFO (custom drift modulation, not Tone.js built-in)
// - Uses Tone.Transport.on('start') (oscillator lifecycle management)
//
// MODULE-LEVEL STATE PATTERN:
// - All values stored in per-oscillator arrays FIRST (oscVolumes, oscTypes, etc.)
// - Applied to nodes IF nodes exist
// - Nodes created using stored values (not hardcoded)
// - Pattern enforced by presetter workflow
// ============================================================================

// ============================================================================
// STATE: Noise Parameters (set by presets, controlled by widgets)
// ============================================================================
// DUAL OSCILLATOR FACTORY PATTERN - Per-oscillator arrays
const NUM_OSCILLATORS = 2;

// Per-oscillator state (independent control for "super milky, nuanced noise")
let oscTypes = ['brown', 'brown']; // 'brown', 'pink', or 'white'
let oscVolumes = [-70, -70]; // Volume in dB (-70 = silence floor)
let oscSculptLPs = [8000, 8000]; // Lowpass filter cutoff (Hz) - shapes high end
let oscSculptHPs = [800, 800]; // Highpass filter cutoff (Hz) - shapes low end
let oscMaskTypes = ['bandpass', 'bandpass']; // 'bandpass', 'notch', 'allpass', 'comb'
let oscMaskCenters = [2000, 2000]; // Center frequency (Hz) - 350Hz-20kHz range
let oscMaskMixes = [0.5, 0.5]; // Wet/dry mix (0.0 = dry, 1.0 = wet)
let oscWidths = [1.0, 1.0]; // Stereo width (0.0 = mono center, 1.0 = full stereo spread)

// Per-oscillator drift parameters (RandomLFO for organic parameter variation)
let oscDriftEnabled = [false, false]; // Enable/disable drift modulation per osc
let oscDriftRateLo = [5, 5]; // Min period (seconds) for drift LFO
let oscDriftRateHi = [15, 15]; // Max period (seconds) for drift LFO
let oscDriftAmounts = [0.15, 0.15]; // Modulation depth (0.0-1.0, represents ±15% of maskCenter)

// ============================================================================
// STATE: Tone.js Audio Nodes (created on play, disposed on stop)
// ============================================================================
let ToneLib = null; // Reference to window.Tone

// Per-oscillator node arrays (dual oscillator factory pattern)
let noiseOscs = []; // [osc1, osc2] - Tone.Noise generators
let highpassFilters = []; // [hp1, hp2] - Per-osc highpass filters
let lowpassFilters = []; // [lp1, lp2] - Per-osc lowpass filters
let maskFilters = []; // [mask1, mask2] - Per-osc dramatic mask filters
let maskDryGains = []; // [dry1, dry2] - Per-osc dry signal gains
let maskWetGains = []; // [wet1, wet2] - Per-osc wet signal gains
let oscGains = []; // [gain1, gain2] - Per-osc volume controls
let widthSplits = []; // [split1, split2] - Per-osc stereo splits
let widthPannersL = []; // [panL1, panL2] - Per-osc left panners
let widthPannersR = []; // [panR1, panR2] - Per-osc right panners
let maskCenterLFOs = []; // [lfo1, lfo2] - Per-osc drift LFOs

// Shared nodes (single instance for all oscillators)
let masterGain = null; // Tone.Gain - Final output

let isPlaying = false; // Oscillator started by Transport
let nodesInitialized = false; // Nodes created and connected

// ============================================================================
// HELPER: Recreate drift LFO (wrapper for shared lfo_drift module)
// ============================================================================
function _recreateDriftLFO(index) {
  if (!nodesInitialized || !maskFilters[index]) return;
  
  maskCenterLFOs[index] = createDriftLFO({
    center: oscMaskCenters[index],
    amount: oscDriftAmounts[index],
    rateLo: oscDriftRateLo[index],
    rateHi: oscDriftRateHi[index],
    filterType: oscMaskTypes[index],
    maskFilter: maskFilters[index],
    ToneLib: ToneLib,
    existingLFO: maskCenterLFOs[index]
  });
}

// ============================================================================
// SETTER FUNCTIONS: Initialize with context
// ============================================================================
// Create setter functions once with access to state/nodes
// These will be exported and used by noise_widget.js
let setters = null;

function _initializeSetters() {
  if (setters) return setters; // Already initialized
  
  setters = createSetters({
    // State arrays
    oscTypes,
    oscVolumes,
    oscSculptLPs,
    oscSculptHPs,
    oscMaskTypes,
    oscMaskCenters,
    oscMaskMixes,
    oscWidths,
    oscDriftEnabled,
    oscDriftAmounts,
    oscDriftRateLo,
    oscDriftRateHi,
    
    // Node arrays
    noiseOscs,
    oscGains,
    lowpassFilters,
    highpassFilters,
    maskFilters,
    maskDryGains,
    maskWetGains,
    widthPannersL,
    widthPannersR,
    maskCenterLFOs,
    
    // State getters
    getNodesInitialized: () => nodesInitialized,
    getToneLib: () => ToneLib,
    getNumOscillators: () => NUM_OSCILLATORS,
    
    // Helper
    recreateDriftLFO: _recreateDriftLFO
  });
  
  return setters;
}

// Initialize setters immediately (they need to be available for exports)
_initializeSetters();

// ============================================================================
// INTERNAL: Create Tone.js Audio Graph (DUAL OSCILLATOR FACTORY)
// ============================================================================
// Uses noise_factory.js to create dual oscillator system
async function _ensureNodes() {
  if (nodesInitialized) return;
  
  // Gather all state into object for factory
  const state = {
    oscTypes,
    oscVolumes,
    oscSculptLPs,
    oscSculptHPs,
    oscMaskTypes,
    oscMaskCenters,
    oscMaskMixes,
    oscWidths,
    oscDriftEnabled,
    oscDriftAmounts,
    oscDriftRateLo,
    oscDriftRateHi
  };
  
  // Call factory to create all oscillators
  const nodes = createAllOscillators(state, ToneLib, NUM_OSCILLATORS);
  
  // Store node arrays in module-level variables
  noiseOscs = nodes.noiseOscs;
  highpassFilters = nodes.highpassFilters;
  lowpassFilters = nodes.lowpassFilters;
  maskFilters = nodes.maskFilters;
  maskDryGains = nodes.maskDryGains;
  maskWetGains = nodes.maskWetGains;
  oscGains = nodes.oscGains;
  widthSplits = nodes.widthSplits;
  widthPannersL = nodes.widthPannersL;
  widthPannersR = nodes.widthPannersR;
  maskCenterLFOs = nodes.maskCenterLFOs;
  masterGain = nodes.masterGain;
  
  nodesInitialized = true;
  
  // Set up Transport lifecycle listener
  _setupTransportListener();
}

// ============================================================================
// EVENT LISTENERS: Transport lifecycle
// ============================================================================
// Noise oscillators start when Transport starts (array-based loop)
// ============================================================================
let transportListenerSetup = false;
function _setupTransportListener() {
  if (transportListenerSetup) return;
  
  const Tone = ToneLib;
  if (!Tone || !Tone.Transport) return;
  
  // TONE.JS INTEGRATION: Tone.Transport.on('start')
  // All oscillators must be started explicitly when Transport begins playback
  Tone.Transport.on('start', async () => {
    // Ensure nodes are created before trying to start them
    if (!nodesInitialized) {
      console.log('🎚️ Noise: Auto-initializing nodes on Transport start');
      await _ensureNodes();
    }
    
    if (!isPlaying) {
      noiseOscs.forEach((osc, i) => {
        if (osc) {
          try {
            osc.start();
            console.log(`✅ Noise osc ${i + 1} started`);
          } catch (e) {
            console.warn(`Osc ${i + 1} already started:`, e);
          }
        }
      });
      isPlaying = true;
      console.log(`✅ All ${NUM_OSCILLATORS} oscillators started`);
    }
  });
  
  transportListenerSetup = true;
}

// ============================================================================
// PUBLIC API: Initialize Audio Nodes
// ============================================================================
// Must be called before playback begins. Creates Tone.js audio graph and
// starts audio context. Safe to call multiple times (idempotent).
//
// TONE.JS INTEGRATION:
// - Tone.start(): Resumes audio context (required for browser autoplay policy)
// ============================================================================
export async function initializeNodes() {
  // Get Tone.js from global window (loaded via <script> in index.html)
  if (!ToneLib) {
    if (!window.Tone) {
      console.error('Tone.js not found - ensure audio/tone.js/Tone.js is loaded in index.html');
      return false;
    }
    ToneLib = window.Tone;
  }
  const Tone = ToneLib;
  
  // Start audio context (required for browser autoplay policy)
  if (typeof Tone.start === 'function') {
    await Tone.start();
  } else if (Tone.context && Tone.context.resume) {
    await Tone.context.resume();
  }
  
  // Create audio nodes
  await _ensureNodes();
  
  console.log('✅ Noise synth initialized:', { 
    osc1Type: oscTypes[0], 
    osc2Type: oscTypes[1], 
    osc1Volume: oscVolumes[0], 
    osc2Volume: oscVolumes[1] 
  });
  
  return true;
}

// ============================================================================
// PUBLIC API: Stop Playback (DUAL OSCILLATOR ARRAY CLEANUP)
// ============================================================================
// Stops all oscillators and disposes all nodes. Next play will recreate nodes.
//
// TONE.JS INTEGRATION:
// - oscillator.stop(): Stops oscillator (cannot be restarted)
// - node.dispose(): Frees Web Audio resources
// ============================================================================
export function stop() {
  if (!isPlaying) return;
  
  // Stop all oscillators
  noiseOscs.forEach((osc, i) => {
    try {
      if (osc) {
        osc.stop();
        console.log(`🛑 Osc ${i + 1} stopped`);
      }
    } catch (e) {
      // Oscillator may already be stopped
    }
  });
  
  // Dispose all node arrays (Web Audio resource cleanup)
  const nodeArrays = [
    noiseOscs, highpassFilters, lowpassFilters, maskFilters,
    maskDryGains, maskWetGains, oscGains, widthSplits,
    widthPannersL, widthPannersR
  ];
  
  nodeArrays.forEach(array => {
    array.forEach(node => {
      if (node && typeof node.dispose === 'function') {
        node.dispose();
      }
    });
  });
  
  // Dispose drift LFOs
  maskCenterLFOs.forEach((lfo, i) => {
    maskCenterLFOs[i] = disposeDriftLFO(lfo);
  });
  
  // Dispose master gain
  if (masterGain && typeof masterGain.dispose === 'function') {
    masterGain.dispose();
  }
  
  // Reset all arrays
  noiseOscs = [];
  highpassFilters = [];
  lowpassFilters = [];
  maskFilters = [];
  maskDryGains = [];
  maskWetGains = [];
  oscGains = [];
  widthSplits = [];
  widthPannersL = [];
  widthPannersR = [];
  maskCenterLFOs = [];
  masterGain = null;
  
  nodesInitialized = false;
  isPlaying = false;
  
  console.log(`✅ All ${NUM_OSCILLATORS} oscillators stopped and disposed`);
}

// ============================================================================
// PUBLIC API: Legacy Dual-Oscillator Setters (Convenience Wrappers)
// ============================================================================
// These functions set BOTH oscillators at once (backward compatibility).
// PATTERN: Store in both array indices, apply to both node arrays if initialized.
//
// NOTE: Widget now uses indexed setters (setOsc1Volume, setOsc2Volume) for
// independent control. These functions remain for preset loading and backward
// compatibility but are NOT the primary API.
//
// ACTUAL PRIMARY API: See indexed setters section below
//   - setOscVolume(index, db) - Generic indexed setter
//   - setOsc1Volume(db), setOsc2Volume(db) - Convenience wrappers
//
// TONE.JS INTEGRATION:
// - gain.gain.linearRampToValueAtTime(): Smooth volume transitions
//   - time: 0.001s = 1ms for responsive changes without clicks
//   - cancelScheduledValues() + setValueAtTime() pattern prevents automation conflicts
// ============================================================================

/**
 * Set noise type for both oscillators (legacy dual-osc wrapper)
 * @param {string} type - 'brown', 'pink', or 'white'
 * 
 * NOTE: Tone.Noise type is immutable - requires stop/restart to change.
 * If playing, this delegates to indexed setters which handle restart.
 * 
 * CURRENT USE: Backward compatibility only.
 * PREFERRED: Use setOsc1Type() / setOsc2Type() for independent control.
 */
export function setNoiseType(type) {
  const validTypes = ['brown', 'pink', 'white'];
  if (!validTypes.includes(type)) {
    console.warn('Invalid noise type:', type);
    return;
  }
  
  // Delegate to indexed setters (updates both oscillators)
  setOsc1Type(type);
  setOsc2Type(type);
  console.log('✅ Noise type set:', type, '(both oscillators)');
}

/**
 * Set volume for both oscillators (legacy dual-osc wrapper)
 * @param {number} db - Volume in dB (-70 = silence floor, 0 = unity gain)
 * 
 * PATTERN: Store in both array indices → Apply to both nodes if initialized
 * - ALWAYS stores: oscVolumes[0] = db; oscVolumes[1] = db;
 * - IF nodes exist: Applies to oscGains[0] and oscGains[1]
 * - IF nodes don't exist: Value stored for later (node creation reads arrays)
 * 
 * CURRENT USE: Backward compatibility only.
 * PREFERRED: Use setOsc1Volume() / setOsc2Volume() for independent control.
 */
export function setNoiseVolume(db) {
  // Store in arrays for both oscillators
  oscVolumes[0] = db;
  oscVolumes[1] = db;
  
  // If nodes exist, apply to all oscillators
  if (nodesInitialized && oscGains.length > 0) {
    try {
      // Get current time once (performance optimization)
      const now = Tone.now();
      
      // Apply to all oscillators (dual osc system)
      oscGains.forEach((gain, i) => {
        if (gain) {
          gain.gain.cancelScheduledValues(now);
          gain.gain.setValueAtTime(gain.gain.value, now);
          gain.gain.linearRampToValueAtTime(db, now + 0.001);
        }
      });
      console.log('✅ Noise volume set:', db, 'dB (all oscillators)');
    } catch (e) {
      console.warn('Error setting noise volume:', e);
    }
  } else {
    // Nodes don't exist yet, but value is STORED for later
    console.log('✅ Noise volume stored:', db, 'dB (will apply when nodes created)');
  }
}

/**
 * Set lowpass filter cutoff for both oscillators (sculpt LP)
 * @param {number} hz - Cutoff frequency in Hz (350-20000)
 * 
 * Shapes noise by removing high frequencies above cutoff.
 * PATTERN: Store in both array indices → Apply to both filters if initialized.
 * 
 * CURRENT USE: Backward compatibility only.
 * PREFERRED: Use setOsc1SculptLP() / setOsc2SculptLP() for independent control.
 */
export function setSculptLP(hz) {
  // Store in arrays for both oscillators
  oscSculptLPs[0] = hz;
  oscSculptLPs[1] = hz;
  
  // If nodes exist, apply to all oscillators
  if (nodesInitialized && lowpassFilters.length > 0) {
    try {
      const now = Tone.now();
      lowpassFilters.forEach((filter, i) => {
        if (filter) {
          filter.frequency.cancelScheduledValues(now);
          filter.frequency.setValueAtTime(filter.frequency.value, now);
          filter.frequency.linearRampToValueAtTime(hz, now + 0.001);
        }
      });
      console.log('✅ Sculpt LP set:', hz, 'Hz (all oscillators)');
    } catch (e) {
      console.warn('Error setting sculpt LP:', e);
    }
  } else {
    console.log('✅ Sculpt LP stored:', hz, 'Hz (will apply when nodes created)');
  }
}

/**
 * Set highpass filter cutoff for both oscillators (sculpt HP)
 * @param {number} hz - Cutoff frequency in Hz (20-16000)
 * 
 * Shapes noise by removing low frequencies below cutoff.
 * PATTERN: Store in both array indices → Apply to both filters if initialized.
 * 
 * CURRENT USE: Backward compatibility only.
 * PREFERRED: Use setOsc1SculptHP() / setOsc2SculptHP() for independent control.
 */
export function setSculptHP(hz) {
  // Store in arrays for both oscillators
  oscSculptHPs[0] = hz;
  oscSculptHPs[1] = hz;
  
  // If nodes exist, apply to all oscillators
  if (nodesInitialized && highpassFilters.length > 0) {
    try {
      const now = Tone.now();
      highpassFilters.forEach((filter, i) => {
        if (filter) {
          filter.frequency.cancelScheduledValues(now);
          filter.frequency.setValueAtTime(filter.frequency.value, now);
          filter.frequency.linearRampToValueAtTime(hz, now + 0.001);
        }
      });
      console.log('✅ Sculpt HP set:', hz, 'Hz (all oscillators)');
    } catch (e) {
      console.warn('Error setting sculpt HP:', e);
    }
  } else {
    console.log('✅ Sculpt HP stored:', hz, 'Hz (will apply when nodes created)');
  }
}

/**
 * Set mask filter type for both oscillators
 * @param {string} type - 'bandpass', 'notch', 'allpass', or 'comb'
 * 
 * SPECIAL CASE: Comb filter uses FeedbackCombFilter (different Tone.js class)
 * - Switching to/from comb requires node recreation + reconnection
 * - Other filter types can be changed in-place (just update .type property)
 * 
 * SIDE EFFECT: Reapplies mix gains after filter change (allpass/comb use remapped range)
 * 
 * CURRENT USE: Backward compatibility only.
 * PREFERRED: Use setOsc1MaskType() / setOsc2MaskType() for independent control.
 */
export function setMaskType(type) {
  // Store in arrays for both oscillators
  const oldType = oscMaskTypes[0]; // Get current type from first osc
  oscMaskTypes[0] = type;
  oscMaskTypes[1] = type;
  
  console.log('🎯 Filter switch:', oldType, '→', type, '| mix=' + (oscMaskMixes[0] * 100).toFixed(0) + '%');
  
  // If nodes exist, apply to all oscillators
  if (nodesInitialized && maskFilters.length > 0) {
    const now = Tone.now();
    maskFilters.forEach((maskFilter, index) => {
      if (!maskFilter) return;
      
      try {
        const wasComb = oldType === 'comb';
        const isComb = type === 'comb';
        
        if (wasComb !== isComb) {
          // RECREATE: Switching between FeedbackCombFilter and regular Filter
          console.log(`   🔄 Osc ${index + 1}: Recreating filter node...`);
          maskFilter.disconnect();
          maskFilter.dispose();
          maskFilters[index] = createMaskFilter(type, oscMaskCenters[index], ToneLib);
          
          // Reconnect to signal chain
          lowpassFilters[index].connect(maskFilters[index]);
          maskFilters[index].connect(maskWetGains[index]);
          
          // Reconnect drift LFO if enabled
          if (oscDriftEnabled[index]) {
            maskCenterLFOs[index] = createDriftLFO({
              center: oscMaskCenters[index],
              amount: oscDriftAmounts[index],
              rateLo: oscDriftRateLo[index],
              rateHi: oscDriftRateHi[index],
              filterType: type,
              maskFilter: maskFilters[index],
              ToneLib: ToneLib,
              existingLFO: maskCenterLFOs[index]
            });
          }
        } else if (!isComb) {
          // SIMPLE UPDATE: Change type and Q
          maskFilters[index].type = type;
          const Q_NOTCH = 10;
          const Q_ALLPASS = 1;
          const Q_BANDPASS = 2;
          let Q = Q_NOTCH;
          if (type === 'allpass') Q = Q_ALLPASS;
          else if (type === 'bandpass') Q = Q_BANDPASS;
          maskFilters[index].Q.value = Q;
          console.log(`   ✅ Osc ${index + 1}: type=${type}, Q=${Q}`);
        }
        
        // Reapply mix gains
        const needsRemapping = (type === 'allpass' || type === 'comb');
        const effectiveMix = needsRemapping ? oscMaskMixes[index] * 0.5 : oscMaskMixes[index];
        const EPSILON = 0.001;
        const dryGain = Math.max(EPSILON, 1.0 - effectiveMix);
        const wetGain = Math.max(EPSILON, effectiveMix);
        maskDryGains[index].gain.cancelScheduledValues(now);
        maskDryGains[index].gain.setValueAtTime(maskDryGains[index].gain.value, now);
        maskDryGains[index].gain.linearRampToValueAtTime(dryGain, now + 0.001);
        maskWetGains[index].gain.cancelScheduledValues(now);
        maskWetGains[index].gain.setValueAtTime(maskWetGains[index].gain.value, now);
        maskWetGains[index].gain.linearRampToValueAtTime(wetGain, now + 0.001);
      } catch (e) {
        console.warn(`Error setting mask type for osc ${index + 1}:`, e);
      }
    });
    console.log('   ✅ All oscillators: mask type updated');
  } else {
    console.log('✅ Mask filter type stored:', type, '(will apply when nodes created)');
  }
}

/**
 * Set mask filter center frequency for both oscillators
 * @param {number} hz - Center/cutoff frequency in Hz (350-20000)
 * 
 * SPECIAL CASE: Comb filter uses delay time (1/hz) instead of frequency
 * - Standard filters: Update .frequency property directly
 * - Comb filter: Convert hz → delay time, update .delayTime property
 * 
 * SIDE EFFECT: If drift enabled, recreates drift LFO with new center
 * (LFO modulates around this center frequency)
 * 
 * CURRENT USE: Backward compatibility only.
 * PREFERRED: Use setOsc1MaskCenter() / setOsc2MaskCenter() for independent control.
 */
export function setMaskCenter(hz) {
  // Store in arrays for both oscillators
  oscMaskCenters[0] = hz;
  oscMaskCenters[1] = hz;
  
  // If nodes exist, apply to all oscillators
  if (nodesInitialized && maskFilters.length > 0) {
    const now = Tone.now();
    maskFilters.forEach((maskFilter, index) => {
      if (!maskFilter) return;
      
      try {
        const currentMaskType = oscMaskTypes[index];
        
        // COMB FILTER: Convert frequency to delay time
        if (currentMaskType === 'comb') {
          const COMB_DELAY_MULTIPLIER = 1.0;
          const delayTime = COMB_DELAY_MULTIPLIER / hz;
          maskFilter.delayTime.cancelScheduledValues(now);
          maskFilter.delayTime.setValueAtTime(maskFilter.delayTime.value, now);
          maskFilter.delayTime.linearRampToValueAtTime(delayTime, now + 0.001);
        } else {
          // STANDARD FILTERS: Use frequency directly
          maskFilter.frequency.cancelScheduledValues(now);
          maskFilter.frequency.setValueAtTime(maskFilter.frequency.value, now);
          maskFilter.frequency.linearRampToValueAtTime(hz, now + 0.001);
        }
        
        // Recreate drift LFO if enabled (updates drift range)
        if (oscDriftEnabled[index]) {
          _recreateDriftLFO(index);
        }
      } catch (e) {
        console.warn(`Error setting mask center for osc ${index + 1}:`, e);
      }
    });
    console.log('✅ Mask center frequency set:', hz, 'Hz (all oscillators)');
  } else {
    console.log('✅ Mask center frequency stored:', hz, 'Hz (will apply when nodes created)');
  }
}

/**
 * Set mask filter wet/dry mix for both oscillators
 * @param {number} mix - Mix amount 0.0-1.0 (0=dry/bypassed, 1=wet/full effect)
 * 
 * SPECIAL REMAPPING: Allpass and comb use 50% max effective mix
 * - Reason: These filters don't reduce signal energy, 100% can cause phase issues
 * - Implementation: effectiveMix = mix * 0.5 for allpass/comb
 * - UI shows 0-100%, but internally clamped to 0-50% for these types
 * 
 * SIGNAL FLOW:
 * - Dry path: maskDryGains (1.0 - effectiveMix)
 * - Wet path: maskWetGains (effectiveMix)
 * 
 * CURRENT USE: Backward compatibility only.
 * PREFERRED: Use setOsc1MaskMix() / setOsc2MaskMix() for independent control.
 */
export function setMaskMix(mix) {
  // Store in arrays for both oscillators
  const clampedMix = Math.max(0, Math.min(1, mix));
  oscMaskMixes[0] = clampedMix;
  oscMaskMixes[1] = clampedMix;
  
  // If nodes exist, apply to all oscillators
  if (nodesInitialized && maskDryGains.length > 0 && maskWetGains.length > 0) {
    const now = Tone.now();
    maskDryGains.forEach((dryGain, index) => {
      if (!dryGain || !maskWetGains[index]) return;
      
      try {
        const currentMaskType = oscMaskTypes[index];
        const needsRemapping = (currentMaskType === 'allpass' || currentMaskType === 'comb');
        const effectiveMix = needsRemapping ? clampedMix * 0.5 : clampedMix;
        
        const EPSILON = 0.001;
        const dry = Math.max(EPSILON, 1.0 - effectiveMix);
        const wet = Math.max(EPSILON, effectiveMix);
        
        dryGain.gain.cancelScheduledValues(now);
        dryGain.gain.setValueAtTime(dryGain.gain.value, now);
        dryGain.gain.linearRampToValueAtTime(dry, now + 0.001);
        maskWetGains[index].gain.cancelScheduledValues(now);
        maskWetGains[index].gain.setValueAtTime(maskWetGains[index].gain.value, now);
        maskWetGains[index].gain.linearRampToValueAtTime(wet, now + 0.001);
        
        // PERFORMANCE: Commented to reduce console spam
        // if (Math.random() < 0.1) {
        //   console.log(`🎚️ Osc ${index + 1} Mix: ${(maskMix * 100).toFixed(0)}% → dry=${dry.toFixed(3)}, wet=${wet.toFixed(3)}`);
        // }
      } catch (e) {
        console.warn(`Error setting mask mix for osc ${index + 1}:`, e);
      }
    });
  }
}

// ============================================================================
// PUBLIC API: Drift Parameter Setters (RandomLFO for organic variation)
// ============================================================================
// Drift LFO modulates mask center frequency for organic, living sound quality.
// 
// ARCHITECTURE:
// - Each oscillator has independent drift LFO (maskCenterLFOs array)
// - LFO created by shared lfo_drift.js module (wraps RandomLFO)
// - Modulation range: center ± (amount × center) Hz
// - Period range: Random between rateLo and rateHi seconds
//
// THESE ARE LEGACY DUAL-OSC WRAPPERS (set both oscillators at once)
// PREFERRED: Use indexed setters (setOsc1DriftEnabled, etc.) below
// ============================================================================
export function setDriftEnabled(enabled) {
  // Store in arrays for both oscillators
  const enabledBool = Boolean(enabled);
  oscDriftEnabled[0] = enabledBool;
  oscDriftEnabled[1] = enabledBool;
  
  // If nodes not initialized, just store state and return
  if (!nodesInitialized) return;
  
  // Apply to all oscillators
  if (enabledBool) {
    // Create and start drift LFOs for all oscillators
    for (let i = 0; i < NUM_OSCILLATORS; i++) {
      _recreateDriftLFO(i);
    }
    console.log('🎲 Drift enabled (all oscillators)');
  } else {
    // Stop and dispose all drift LFOs
    maskCenterLFOs.forEach((lfo, i) => {
      maskCenterLFOs[i] = disposeDriftLFO(lfo);
    });
    console.log('🎲 Drift disabled (all oscillators)');
  }
}

export function setDriftRateLo(seconds) {
  // Store in arrays for both oscillators
  const clampedSeconds = Math.max(1, seconds);
  oscDriftRateLo[0] = clampedSeconds;
  oscDriftRateLo[1] = clampedSeconds;
  
  // If drift active, recreate LFOs with new rate
  if (nodesInitialized) {
    for (let i = 0; i < NUM_OSCILLATORS; i++) {
      if (oscDriftEnabled[i]) {
        _recreateDriftLFO(i);
      }
    }
  }
}

export function setDriftRateHi(seconds) {
  // Store in arrays for both oscillators
  const clampedSeconds = Math.max(1, seconds);
  oscDriftRateHi[0] = clampedSeconds;
  oscDriftRateHi[1] = clampedSeconds;
  
  // If drift active, recreate LFOs with new rate
  if (nodesInitialized) {
    for (let i = 0; i < NUM_OSCILLATORS; i++) {
      if (oscDriftEnabled[i]) {
        _recreateDriftLFO(i);
      }
    }
  }
}

export function setDriftAmount(amount) {
  // Store in arrays for both oscillators (0.0-1.0)
  const clampedAmount = Math.max(0, Math.min(1, amount));
  oscDriftAmounts[0] = clampedAmount;
  oscDriftAmounts[1] = clampedAmount;
  
  // If drift active, recreate LFOs with new amount
  if (nodesInitialized) {
    for (let i = 0; i < NUM_OSCILLATORS; i++) {
      if (oscDriftEnabled[i]) {
        _recreateDriftLFO(i);
      }
    }
  }
}

// ============================================================================
// INTERNAL: Apply Width to L/R Panners (ALL OSCILLATORS)
// ============================================================================
function _applyWidthToPanners() {
  const now = Tone.now();
  for (let i = 0; i < NUM_OSCILLATORS; i++) {
    if (!widthPannersL[i] || !widthPannersR[i]) continue;
    
    const panValue = oscWidths[i];
    widthPannersL[i].pan.cancelScheduledValues(now);
    widthPannersL[i].pan.setValueAtTime(widthPannersL[i].pan.value, now);
    widthPannersL[i].pan.linearRampToValueAtTime(-panValue, now + 0.001);
    widthPannersR[i].pan.cancelScheduledValues(now);
    widthPannersR[i].pan.setValueAtTime(widthPannersR[i].pan.value, now);
    widthPannersR[i].pan.linearRampToValueAtTime(panValue, now + 0.001);
  }
}

// ============================================================================
// PUBLIC API: Stereo Width Control
// ============================================================================
export function setNoiseWidth(widthFactor) {
  // Store in arrays for both oscillators
  const clampedWidth = Math.max(0, Math.min(1, widthFactor));
  oscWidths[0] = clampedWidth;
  oscWidths[1] = clampedWidth;
  
  // Apply to width panners if nodes exist
  if (nodesInitialized) {
    _applyWidthToPanners();
    console.log('✅ Noise width applied:', clampedWidth.toFixed(2), '(all oscillators)');
  }
}

// ============================================================================
// PUBLIC API: INDEXED SETTERS (Per-Oscillator Control)
// ============================================================================
// These functions enable independent control of each oscillator.
// Pattern: setOsc{Parameter}(index, value) + convenience wrappers setOsc1/2{Parameter}
// ============================================================================

// --- NOISE TYPE ---
export function setOscType(index, type) {
  if (index < 0 || index >= NUM_OSCILLATORS) return;
  oscTypes[index] = type;
  if (nodesInitialized && noiseOscs[index]) {
    noiseOscs[index].type = type;
    console.log(`✅ Osc ${index + 1} type:`, type);
  }
}
export function setOsc1Type(type) { setOscType(0, type); }
export function setOsc2Type(type) { setOscType(1, type); }

// --- VOLUME ---
export function setOscVolume(index, db) {
  if (index < 0 || index >= NUM_OSCILLATORS) return;
  oscVolumes[index] = db;
  if (nodesInitialized && oscGains[index]) {
    const now = Tone.now();
    oscGains[index].gain.cancelScheduledValues(now);
    oscGains[index].gain.setValueAtTime(oscGains[index].gain.value, now); // Anchor current value
    oscGains[index].gain.linearRampToValueAtTime(db, now + 0.001); // 1ms micro-ramp for smoothing
    // console.log(`✅ Osc ${index + 1} volume:`, db.toFixed(1), 'dB'); // PERFORMANCE: Disabled - fires on every drag
  }
}
export function setOsc1Volume(db) { setOscVolume(0, db); }
export function setOsc2Volume(db) { setOscVolume(1, db); }

// --- SCULPT LP (Lowpass Filter) ---
export function setOscSculptLP(index, hz) {
  if (index < 0 || index >= NUM_OSCILLATORS) return;
  oscSculptLPs[index] = Math.max(350, Math.min(20000, hz));
  if (nodesInitialized && lowpassFilters[index]) {
    const now = Tone.now();
    lowpassFilters[index].frequency.cancelScheduledValues(now);
    lowpassFilters[index].frequency.setValueAtTime(lowpassFilters[index].frequency.value, now);
    lowpassFilters[index].frequency.linearRampToValueAtTime(oscSculptLPs[index], now + 0.001);
    console.log(`✅ Osc ${index + 1} sculpt LP:`, oscSculptLPs[index].toFixed(0), 'Hz');
  }
}
export function setOsc1SculptLP(hz) { setOscSculptLP(0, hz); }
export function setOsc2SculptLP(hz) { setOscSculptLP(1, hz); }

// --- SCULPT HP (Highpass Filter) ---
export function setOscSculptHP(index, hz) {
  if (index < 0 || index >= NUM_OSCILLATORS) return;
  oscSculptHPs[index] = Math.max(20, Math.min(16000, hz));
  if (nodesInitialized && highpassFilters[index]) {
    const now = Tone.now();
    highpassFilters[index].frequency.cancelScheduledValues(now);
    highpassFilters[index].frequency.setValueAtTime(highpassFilters[index].frequency.value, now);
    highpassFilters[index].frequency.linearRampToValueAtTime(oscSculptHPs[index], now + 0.001);
    console.log(`✅ Osc ${index + 1} sculpt HP:`, oscSculptHPs[index].toFixed(0), 'Hz');
  }
}
export function setOsc1SculptHP(hz) { setOscSculptHP(0, hz); }
export function setOsc2SculptHP(hz) { setOscSculptHP(1, hz); }

// --- MASK TYPE ---
export function setOscMaskType(index, type) {
  if (index < 0 || index >= NUM_OSCILLATORS) return;
  oscMaskTypes[index] = type;
  
  if (nodesInitialized && maskFilters[index]) {
    const oldMask = maskFilters[index];
    
    // Create new mask filter with current center frequency
    const newMask = createMaskFilter(type, oscMaskCenters[index], ToneLib);
    
    // Reconnect: lpFilter → newMask → wetGain
    lowpassFilters[index].disconnect(oldMask);
    lowpassFilters[index].connect(newMask);
    oldMask.disconnect(maskWetGains[index]);
    newMask.connect(maskWetGains[index]);
    
    // Dispose old, save new reference
    oldMask.dispose();
    maskFilters[index] = newMask;
    
    console.log(`✅ Osc ${index + 1} mask type:`, type);
  }
}
export function setOsc1MaskType(type) { setOscMaskType(0, type); }
export function setOsc2MaskType(type) { setOscMaskType(1, type); }

// --- MASK CENTER ---
export function setOscMaskCenter(index, hz) {
  if (index < 0 || index >= NUM_OSCILLATORS) return;
  oscMaskCenters[index] = Math.max(100, Math.min(20000, hz));
  if (nodesInitialized && maskFilters[index]) {
    const currentMaskType = oscMaskTypes[index];
    
    // COMB FILTER: Convert frequency to delay time
    if (currentMaskType === 'comb') {
      const COMB_DELAY_MULTIPLIER = 1.0;
      const delayTime = COMB_DELAY_MULTIPLIER / oscMaskCenters[index];
      const now = Tone.now();
      maskFilters[index].delayTime.cancelScheduledValues(now);
      maskFilters[index].delayTime.setValueAtTime(maskFilters[index].delayTime.value, now);
      maskFilters[index].delayTime.linearRampToValueAtTime(delayTime, now + 0.001);
      console.log(`✅ Osc ${index + 1} comb delay:`, delayTime.toFixed(6), 's (from', oscMaskCenters[index].toFixed(0), 'Hz)');
    } else {
      // STANDARD FILTERS: Use frequency directly
      const now = Tone.now();
      maskFilters[index].frequency.cancelScheduledValues(now);
      maskFilters[index].frequency.setValueAtTime(maskFilters[index].frequency.value, now);
      maskFilters[index].frequency.linearRampToValueAtTime(oscMaskCenters[index], now + 0.001);
      console.log(`✅ Osc ${index + 1} mask center:`, oscMaskCenters[index].toFixed(0), 'Hz');
    }
    
    // NOTE: Don't recreate drift LFO here - let caller do it on mouseup if needed
    // LFO will continue modulating around old center during drag (acceptable)
  }
}
export function setOsc1MaskCenter(hz) { setOscMaskCenter(0, hz); }
export function setOsc2MaskCenter(hz) { setOscMaskCenter(1, hz); }

// --- MASK MIX ---
export function setOscMaskMix(index, mix) {
  if (index < 0 || index >= NUM_OSCILLATORS) return;
  oscMaskMixes[index] = Math.max(0, Math.min(1, mix));
  if (nodesInitialized && maskDryGains[index] && maskWetGains[index]) {
    const now = Tone.now();
    maskDryGains[index].gain.cancelScheduledValues(now);
    maskDryGains[index].gain.setValueAtTime(maskDryGains[index].gain.value, now);
    maskDryGains[index].gain.linearRampToValueAtTime(1.0 - oscMaskMixes[index], now + 0.001);
    maskWetGains[index].gain.cancelScheduledValues(now);
    maskWetGains[index].gain.setValueAtTime(maskWetGains[index].gain.value, now);
    maskWetGains[index].gain.linearRampToValueAtTime(oscMaskMixes[index], now + 0.001);
    console.log(`✅ Osc ${index + 1} mask mix:`, (oscMaskMixes[index] * 100).toFixed(0), '%');
  }
}
export function setOsc1MaskMix(mix) { setOscMaskMix(0, mix); }
export function setOsc2MaskMix(mix) { setOscMaskMix(1, mix); }

// --- DRIFT ENABLED ---
export function setOscDriftEnabled(index, enabled) {
  if (index < 0 || index >= NUM_OSCILLATORS) return;
  oscDriftEnabled[index] = enabled;
  if (nodesInitialized && maskCenterLFOs[index]) {
    if (enabled) {
      maskCenterLFOs[index].start();
    } else {
      maskCenterLFOs[index].stop();
    }
    console.log(`✅ Osc ${index + 1} drift:`, enabled ? 'ON' : 'OFF');
  }
}
export function setOsc1DriftEnabled(enabled) { setOscDriftEnabled(0, enabled); }
export function setOsc2DriftEnabled(enabled) { setOscDriftEnabled(1, enabled); }

// --- DRIFT RATE LO ---
export function setOscDriftRateLo(index, seconds) {
  if (index < 0 || index >= NUM_OSCILLATORS) return;
  oscDriftRateLo[index] = Math.max(0.1, Math.min(60, seconds));
  if (nodesInitialized) {
    // LFOs don't have setRateLo method - recreate LFO (creates if doesn't exist)
    _recreateDriftLFO(index);
    console.log(`✅ Osc ${index + 1} drift rate lo:`, oscDriftRateLo[index].toFixed(2), 's');
  }
}
export function setOsc1DriftRateLo(seconds) { setOscDriftRateLo(0, seconds); }
export function setOsc2DriftRateLo(seconds) { setOscDriftRateLo(1, seconds); }

// --- DRIFT RATE HI ---
export function setOscDriftRateHi(index, seconds) {
  if (index < 0 || index >= NUM_OSCILLATORS) return;
  oscDriftRateHi[index] = Math.max(0.1, Math.min(60, seconds));
  if (nodesInitialized) {
    // LFOs don't have setRateHi method - recreate LFO (creates if doesn't exist)
    _recreateDriftLFO(index);
    console.log(`✅ Osc ${index + 1} drift rate hi:`, oscDriftRateHi[index].toFixed(2), 's');
  }
}
export function setOsc1DriftRateHi(seconds) { setOscDriftRateHi(0, seconds); }
export function setOsc2DriftRateHi(seconds) { setOscDriftRateHi(1, seconds); }

// --- DRIFT RATE RANGE (Set both lo/hi + recreate LFO once) ---
export function setOscDriftRateRange(index, loSeconds, hiSeconds) {
  if (index < 0 || index >= NUM_OSCILLATORS) return;
  oscDriftRateLo[index] = Math.max(0.1, Math.min(60, loSeconds));
  oscDriftRateHi[index] = Math.max(0.1, Math.min(60, hiSeconds));
  if (nodesInitialized) {
    // MEMORY LEAK FIX: Recreate LFO once after both values updated
    _recreateDriftLFO(index);
    console.log(`✅ Osc ${index + 1} drift rate range:`, oscDriftRateLo[index].toFixed(2), '-', oscDriftRateHi[index].toFixed(2), 's');
  }
}
export function setOsc1DriftRateRange(loSeconds, hiSeconds) { setOscDriftRateRange(0, loSeconds, hiSeconds); }
export function setOsc2DriftRateRange(loSeconds, hiSeconds) { setOscDriftRateRange(1, loSeconds, hiSeconds); }

// --- DRIFT AMOUNT ---
export function setOscDriftAmount(index, amount) {
  if (index < 0 || index >= NUM_OSCILLATORS) return;
  oscDriftAmounts[index] = Math.max(0, Math.min(1, amount));
  // NOTE: Don't recreate LFO here - let caller do it on mouseup if needed
  // LFO will continue with old amount during drag (acceptable)
  console.log(`✅ Osc ${index + 1} drift amount stored:`, (oscDriftAmounts[index] * 100).toFixed(0), '%');
}
export function setOsc1DriftAmount(amount) { setOscDriftAmount(0, amount); }
export function setOsc2DriftAmount(amount) { setOscDriftAmount(1, amount); }

// --- DRIFT LFO UPDATE (Recreate after parameter changes) ---
/**
 * Update drift center frequency and recreate LFO
 * Call this on mouseup after center slider drag completes
 */
export function updateOscDriftCenter(index) {
  if (index < 0 || index >= NUM_OSCILLATORS) return;
  if (nodesInitialized && oscDriftEnabled[index]) {
    _recreateDriftLFO(index);
    console.log(`🔄 Osc ${index + 1} drift LFO updated (center changed)`);
  }
}
export function updateOsc1DriftCenter() { updateOscDriftCenter(0); }
export function updateOsc2DriftCenter() { updateOscDriftCenter(1); }

/**
 * Update drift amount and recreate LFO
 * Call this on mouseup after amount slider drag completes
 */
export function updateOscDriftAmount(index) {
  if (index < 0 || index >= NUM_OSCILLATORS) return;
  if (nodesInitialized && oscDriftEnabled[index]) {
    _recreateDriftLFO(index);
    console.log(`🔄 Osc ${index + 1} drift LFO updated (amount changed)`);
  }
}
export function updateOsc1DriftAmount() { updateOscDriftAmount(0); }
export function updateOsc2DriftAmount() { updateOscDriftAmount(1); }

// --- WIDTH ---
export function setOscWidth(index, widthFactor) {
  if (index < 0 || index >= NUM_OSCILLATORS) return;
  oscWidths[index] = Math.max(0, Math.min(1, widthFactor));
  if (nodesInitialized && widthPannersL[index] && widthPannersR[index]) {
    const now = Tone.now();
    widthPannersL[index].pan.cancelScheduledValues(now);
    widthPannersL[index].pan.setValueAtTime(widthPannersL[index].pan.value, now);
    widthPannersL[index].pan.linearRampToValueAtTime(-oscWidths[index], now + 0.001);
    widthPannersR[index].pan.cancelScheduledValues(now);
    widthPannersR[index].pan.setValueAtTime(widthPannersR[index].pan.value, now);
    widthPannersR[index].pan.linearRampToValueAtTime(oscWidths[index], now + 0.001);
    console.log(`✅ Osc ${index + 1} width:`, oscWidths[index].toFixed(2));
  }
}
export function setOsc1Width(widthFactor) { setOscWidth(0, widthFactor); }
export function setOsc2Width(widthFactor) { setOscWidth(1, widthFactor); }

// ============================================================================
// PUBLIC API: Getters (STATE ACCESSORS)
// ============================================================================
// These getters return oscillator 1 (index 0) values for backward compatibility
// with legacy single-oscillator code. For dual-oscillator access, use the
// module-level arrays directly (oscTypes[index], oscVolumes[index], etc.)
// ============================================================================
export function getNoiseType() {
  return oscTypes[0]; // ✅ FIXED: Returns oscillator 1 noise type
}

export function getNoiseVolume() {
  return oscVolumes[0]; // ✅ FIXED: Returns oscillator 1 volume (dB)
}

export function getSculptLP() {
  return oscSculptLPs[0]; // ✅ FIXED: Returns oscillator 1 lowpass cutoff (Hz)
}

export function getSculptHP() {
  return oscSculptHPs[0]; // ✅ FIXED: Returns oscillator 1 highpass cutoff (Hz)
}

export function getMaskType() {
  return oscMaskTypes[0]; // ✅ FIXED: Returns oscillator 1 mask filter type
}

export function getMaskCenter() {
  return oscMaskCenters[0]; // ✅ FIXED: Returns oscillator 1 mask center frequency (Hz)
}

export function getMaskMix() {
  return oscMaskMixes[0]; // ✅ FIXED: Returns oscillator 1 mask wet/dry mix (0-1)
}

export function getDriftEnabled() {
  return oscDriftEnabled[0]; // ✅ FIXED: Returns oscillator 1 drift enabled state (boolean)
}

export function getDriftRateLo() {
  return oscDriftRateLo[0]; // ✅ FIXED: Returns oscillator 1 drift rate low bound (seconds)
}

export function getDriftRateHi() {
  return oscDriftRateHi[0]; // ✅ FIXED: Returns oscillator 1 drift rate high bound (seconds)
}

export function getDriftAmount() {
  return oscDriftAmounts[0]; // ✅ FIXED: Returns oscillator 1 drift modulation depth (0-1)
}

export function getNoiseWidth() {
  return oscWidths[0]; // ✅ FIXED: Returns oscillator 1 stereo width (0=mono, 1=stereo)
}

export function getIsPlaying() {
  return isPlaying;
}

// ============================================================================
// GLOBAL EXPOSURE: For cross-widget communication
// ============================================================================
// Exposes key functions globally so other widgets can access noise state
// ============================================================================
if (typeof window !== 'undefined') {
  window.NoiseSynth = window.NoiseSynth || {};
  window.NoiseSynth.setNoiseType = setNoiseType;
  window.NoiseSynth.setNoiseVolume = setNoiseVolume;
  window.NoiseSynth.setSculptLP = setSculptLP;
  window.NoiseSynth.setSculptHP = setSculptHP;
  window.NoiseSynth.setMaskType = setMaskType;
  window.NoiseSynth.setMaskCenter = setMaskCenter;
  window.NoiseSynth.setMaskMix = setMaskMix;
  window.NoiseSynth.setDriftEnabled = setDriftEnabled;
  window.NoiseSynth.setDriftRateLo = setDriftRateLo;
  window.NoiseSynth.setDriftRateHi = setDriftRateHi;
  window.NoiseSynth.setDriftAmount = setDriftAmount;
  window.NoiseSynth.setNoiseWidth = setNoiseWidth;
  window.NoiseSynth.setOscDriftRateRange = setOscDriftRateRange;
  window.NoiseSynth.setOsc1DriftRateRange = setOsc1DriftRateRange;
  window.NoiseSynth.setOsc2DriftRateRange = setOsc2DriftRateRange;
  window.NoiseSynth.updateOscDriftCenter = updateOscDriftCenter;
  window.NoiseSynth.updateOsc1DriftCenter = updateOsc1DriftCenter;
  window.NoiseSynth.updateOsc2DriftCenter = updateOsc2DriftCenter;
  window.NoiseSynth.updateOscDriftAmount = updateOscDriftAmount;
  window.NoiseSynth.updateOsc1DriftAmount = updateOsc1DriftAmount;
  window.NoiseSynth.updateOsc2DriftAmount = updateOsc2DriftAmount;
  window.NoiseSynth.getNoiseType = getNoiseType;
  window.NoiseSynth.getNoiseVolume = getNoiseVolume;
  window.NoiseSynth.getSculptLP = getSculptLP;
  window.NoiseSynth.getSculptHP = getSculptHP;
  window.NoiseSynth.getMaskType = getMaskType;
  window.NoiseSynth.getMaskCenter = getMaskCenter;
  window.NoiseSynth.getMaskMix = getMaskMix;
  window.NoiseSynth.getDriftEnabled = getDriftEnabled;
  window.NoiseSynth.getDriftRateLo = getDriftRateLo;
  window.NoiseSynth.getDriftRateHi = getDriftRateHi;
  window.NoiseSynth.getDriftAmount = getDriftAmount;
  window.NoiseSynth.getNoiseWidth = getNoiseWidth;
  window.NoiseSynth.initializeNodes = initializeNodes;
  window.NoiseSynth.stop = stop;
}
