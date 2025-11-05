// ============================================================================
// NOISE PARAMETER SETTERS
// ============================================================================
// All parameter setter functions for noise synth
// Separated from main synth module for clarity and maintainability
//
// PATTERN: Setters receive context object with state + node references
// ============================================================================

import { createDriftLFO, disposeDriftLFO } from './shared/lfo_drift.js';
import { createMaskFilter } from './shared/filter_bank.js';

// ============================================================================
// FACTORY: Create setter functions with context closure
// ============================================================================
/**
 * Creates all setter functions with access to shared state/nodes
 * 
 * @param {Object} ctx - Context object with state arrays, node arrays, and helpers
 * @returns {Object} - All setter functions
 */
export function createSetters(ctx) {
  const {
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
    
    // State getters (functions that return current values)
    getNodesInitialized,
    getToneLib,
    getNumOscillators,
    
    // Helper to recreate drift LFO
    recreateDriftLFO
  } = ctx;
  
  // ============================================================================
  // HELPER: Apply width to L/R panners (all oscillators)
  // ============================================================================
  function _applyWidthToPanners() {
    const NUM_OSCILLATORS = getNumOscillators();
    const now = getToneLib().now();
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
  // DUAL-OSCILLATOR SETTERS (Updates both oscillators)
  // ============================================================================
  
  function setNoiseVolume(db) {
    // Store in arrays for both oscillators
    oscVolumes[0] = db;
    oscVolumes[1] = db;
    
    // If nodes exist, apply to all oscillators
    if (getNodesInitialized() && oscGains.length > 0) {
      try {
        const now = getToneLib().now();
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
  
  function setSculptLP(hz) {
    // Store in arrays for both oscillators
    oscSculptLPs[0] = hz;
    oscSculptLPs[1] = hz;
    
    // If nodes exist, apply to all oscillators
    if (getNodesInitialized() && lowpassFilters.length > 0) {
      try {
        const now = getToneLib().now();
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
  
  function setSculptHP(hz) {
    // Store in arrays for both oscillators
    oscSculptHPs[0] = hz;
    oscSculptHPs[1] = hz;
    
    // If nodes exist, apply to all oscillators
    if (getNodesInitialized() && highpassFilters.length > 0) {
      try {
        const now = getToneLib().now();
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
  
  function setMaskType(type) {
    // Store in arrays for both oscillators
    const oldType = oscMaskTypes[0]; // Get current type from first osc
    oscMaskTypes[0] = type;
    oscMaskTypes[1] = type;
    
    console.log('🎯 Filter switch:', oldType, '→', type, '| mix=' + (oscMaskMixes[0] * 100).toFixed(0) + '%');
    
    // If nodes exist, apply to all oscillators
    if (getNodesInitialized() && maskFilters.length > 0) {
      const ToneLib = getToneLib();
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
              recreateDriftLFO(index);
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
          const now = getToneLib().now();
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
  
  function setMaskCenter(hz) {
    // Store in arrays for both oscillators
    oscMaskCenters[0] = hz;
    oscMaskCenters[1] = hz;
    
    // If nodes exist, apply to all oscillators
    if (getNodesInitialized() && maskFilters.length > 0) {
      maskFilters.forEach((maskFilter, index) => {
        if (!maskFilter) return;
        
        try {
          const currentMaskType = oscMaskTypes[index];
          const now = getToneLib().now();
          
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
            recreateDriftLFO(index);
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
  
  function setMaskMix(mix) {
    // Store in arrays for both oscillators
    const clampedMix = Math.max(0, Math.min(1, mix));
    oscMaskMixes[0] = clampedMix;
    oscMaskMixes[1] = clampedMix;
    
    // If nodes exist, apply to all oscillators
    if (getNodesInitialized() && maskDryGains.length > 0 && maskWetGains.length > 0) {
      maskDryGains.forEach((dryGain, index) => {
        if (!dryGain || !maskWetGains[index]) return;
        
        try {
          const currentMaskType = oscMaskTypes[index];
          const needsRemapping = (currentMaskType === 'allpass' || currentMaskType === 'comb');
          const effectiveMix = needsRemapping ? clampedMix * 0.5 : clampedMix;
          const EPSILON = 0.001;
          const dry = Math.max(EPSILON, 1.0 - effectiveMix);
          const wet = Math.max(EPSILON, effectiveMix);
          const now = getToneLib().now();
          
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
  
  function setDriftEnabled(enabled) {
    // Store in arrays for both oscillators
    const enabledBool = Boolean(enabled);
    oscDriftEnabled[0] = enabledBool;
    oscDriftEnabled[1] = enabledBool;
    
    // If nodes exist, apply to all oscillators
    if (getNodesInitialized()) {
      const NUM_OSCILLATORS = getNumOscillators();
      if (enabledBool) {
        for (let i = 0; i < NUM_OSCILLATORS; i++) {
          if (maskCenterLFOs[i]) {
            maskCenterLFOs[i].start();
          }
        }
        console.log('🎲 Drift enabled (all oscillators)');
      } else {
        for (let i = 0; i < NUM_OSCILLATORS; i++) {
          const lfo = maskCenterLFOs[i];
          if (lfo) {
            maskCenterLFOs[i] = disposeDriftLFO(lfo);
          }
        }
        console.log('🎲 Drift disabled (all oscillators)');
      }
    }
  }
  
  function setDriftRateLo(seconds) {
    // Store in arrays for both oscillators
    const clampedSeconds = Math.max(1, seconds);
    oscDriftRateLo[0] = clampedSeconds;
    oscDriftRateLo[1] = clampedSeconds;
    
    // If drift active, recreate LFOs with new rate
    if (getNodesInitialized()) {
      const NUM_OSCILLATORS = getNumOscillators();
      for (let i = 0; i < NUM_OSCILLATORS; i++) {
        if (oscDriftEnabled[i]) {
          recreateDriftLFO(i);
        }
      }
    }
  }
  
  function setDriftRateHi(seconds) {
    // Store in arrays for both oscillators
    const clampedSeconds = Math.max(1, seconds);
    oscDriftRateHi[0] = clampedSeconds;
    oscDriftRateHi[1] = clampedSeconds;
    
    // If drift active, recreate LFOs with new rate
    if (getNodesInitialized()) {
      const NUM_OSCILLATORS = getNumOscillators();
      for (let i = 0; i < NUM_OSCILLATORS; i++) {
        if (oscDriftEnabled[i]) {
          recreateDriftLFO(i);
        }
      }
    }
  }
  
  function setDriftAmount(amount) {
    // Store in arrays for both oscillators (0.0-1.0)
    const clampedAmount = Math.max(0, Math.min(1, amount));
    oscDriftAmounts[0] = clampedAmount;
    oscDriftAmounts[1] = clampedAmount;
    
    // If drift active, recreate LFOs with new amount
    if (getNodesInitialized()) {
      const NUM_OSCILLATORS = getNumOscillators();
      for (let i = 0; i < NUM_OSCILLATORS; i++) {
        if (oscDriftEnabled[i]) {
          recreateDriftLFO(i);
        }
      }
    }
  }
  
  function setNoiseWidth(widthFactor) {
    // Store in arrays for both oscillators
    const clampedWidth = Math.max(0, Math.min(1, widthFactor));
    oscWidths[0] = clampedWidth;
    oscWidths[1] = clampedWidth;
    
    // Apply to width panners if nodes exist
    if (getNodesInitialized()) {
      _applyWidthToPanners();
      console.log('✅ Noise width applied:', clampedWidth.toFixed(2), '(all oscillators)');
    }
  }
  
  // ============================================================================
  // INDEXED SETTERS (Per-Oscillator Control)
  // ============================================================================
  
  // --- NOISE TYPE ---
  function setOscType(index, type) {
    const NUM_OSCILLATORS = getNumOscillators();
    if (index < 0 || index >= NUM_OSCILLATORS) return;
    oscTypes[index] = type;
    if (getNodesInitialized()) {
      console.log(`✅ Osc ${index + 1} type:`, type);
    }
  }
  function setOsc1Type(type) { setOscType(0, type); }
  function setOsc2Type(type) { setOscType(1, type); }
  
  // --- VOLUME ---
  function setOscVolume(index, db) {
    const NUM_OSCILLATORS = getNumOscillators();
    if (index < 0 || index >= NUM_OSCILLATORS) return;
    oscVolumes[index] = db;
    if (getNodesInitialized() && oscGains[index]) {
      const now = getToneLib().now();
      oscGains[index].gain.cancelScheduledValues(now);
      oscGains[index].gain.setValueAtTime(oscGains[index].gain.value, now);
      oscGains[index].gain.linearRampToValueAtTime(db, now + 0.001);
      // console.log(`✅ Osc ${index + 1} volume:`, db.toFixed(1), 'dB'); // PERFORMANCE
    }
  }
  function setOsc1Volume(db) { setOscVolume(0, db); }
  function setOsc2Volume(db) { setOscVolume(1, db); }
  
  // --- SCULPT LP ---
  function setOscSculptLP(index, hz) {
    const NUM_OSCILLATORS = getNumOscillators();
    if (index < 0 || index >= NUM_OSCILLATORS) return;
    oscSculptLPs[index] = hz;
    if (getNodesInitialized() && lowpassFilters[index]) {
      const now = getToneLib().now();
      lowpassFilters[index].frequency.cancelScheduledValues(now);
      lowpassFilters[index].frequency.setValueAtTime(lowpassFilters[index].frequency.value, now);
      lowpassFilters[index].frequency.linearRampToValueAtTime(hz, now + 0.001);
      // console.log(`✅ Osc ${index + 1} sculpt LP:`, oscSculptLPs[index].toFixed(0), 'Hz'); // PERFORMANCE
    }
  }
  function setOsc1SculptLP(hz) { setOscSculptLP(0, hz); }
  function setOsc2SculptLP(hz) { setOscSculptLP(1, hz); }
  
  // --- SCULPT HP ---
  function setOscSculptHP(index, hz) {
    const NUM_OSCILLATORS = getNumOscillators();
    if (index < 0 || index >= NUM_OSCILLATORS) return;
    oscSculptHPs[index] = hz;
    if (getNodesInitialized() && highpassFilters[index]) {
      const now = getToneLib().now();
      highpassFilters[index].frequency.cancelScheduledValues(now);
      highpassFilters[index].frequency.setValueAtTime(highpassFilters[index].frequency.value, now);
      highpassFilters[index].frequency.linearRampToValueAtTime(hz, now + 0.001);
      // console.log(`✅ Osc ${index + 1} sculpt HP:`, oscSculptHPs[index].toFixed(0), 'Hz'); // PERFORMANCE
    }
  }
  function setOsc1SculptHP(hz) { setOscSculptHP(0, hz); }
  function setOsc2SculptHP(hz) { setOscSculptHP(1, hz); }
  
  // --- MASK TYPE ---
  function setOscMaskType(index, type) {
    const NUM_OSCILLATORS = getNumOscillators();
    if (index < 0 || index >= NUM_OSCILLATORS) return;
    oscMaskTypes[index] = type;
    if (getNodesInitialized() && maskFilters[index]) {
      // console.log(`✅ Osc ${index + 1} mask type:`, type); // PERFORMANCE
    }
  }
  function setOsc1MaskType(type) { setOscMaskType(0, type); }
  function setOsc2MaskType(type) { setOscMaskType(1, type); }
  
  // --- MASK CENTER ---
  function setOscMaskCenter(index, hz) {
    const NUM_OSCILLATORS = getNumOscillators();
    if (index < 0 || index >= NUM_OSCILLATORS) return;
    oscMaskCenters[index] = hz;
    if (getNodesInitialized() && maskFilters[index]) {
      const currentMaskType = oscMaskTypes[index];
      
      // COMB FILTER: Convert frequency to delay time
      if (currentMaskType === 'comb') {
        const COMB_DELAY_MULTIPLIER = 1.0;
        const delayTime = COMB_DELAY_MULTIPLIER / hz;
        const now = getToneLib().now();
        maskFilters[index].delayTime.cancelScheduledValues(now);
        maskFilters[index].delayTime.setValueAtTime(maskFilters[index].delayTime.value, now);
        maskFilters[index].delayTime.linearRampToValueAtTime(delayTime, now + 0.001);
        // console.log(`✅ Osc ${index + 1} comb delay:`, delayTime.toFixed(6), 's (from', oscMaskCenters[index].toFixed(0), 'Hz)'); // PERFORMANCE
      } else {
        // STANDARD FILTERS: Use frequency directly
        const now = getToneLib().now();
        maskFilters[index].frequency.cancelScheduledValues(now);
        maskFilters[index].frequency.setValueAtTime(maskFilters[index].frequency.value, now);
        maskFilters[index].frequency.linearRampToValueAtTime(hz, now + 0.001);
        // console.log(`✅ Osc ${index + 1} mask center:`, oscMaskCenters[index].toFixed(0), 'Hz'); // PERFORMANCE
      }
    }
  }
  function setOsc1MaskCenter(hz) { setOscMaskCenter(0, hz); }
  function setOsc2MaskCenter(hz) { setOscMaskCenter(1, hz); }
  
  // --- MASK MIX ---
  function setOscMaskMix(index, mix) {
    const NUM_OSCILLATORS = getNumOscillators();
    if (index < 0 || index >= NUM_OSCILLATORS) return;
    oscMaskMixes[index] = Math.max(0, Math.min(1, mix));
    if (getNodesInitialized() && maskDryGains[index] && maskWetGains[index]) {
      const currentMaskType = oscMaskTypes[index];
      const needsRemapping = (currentMaskType === 'allpass' || currentMaskType === 'comb');
      const effectiveMix = needsRemapping ? oscMaskMixes[index] * 0.5 : oscMaskMixes[index];
      const EPSILON = 0.001;
      const dry = Math.max(EPSILON, 1.0 - effectiveMix);
      const wet = Math.max(EPSILON, effectiveMix);
      const now = getToneLib().now();
      
      maskDryGains[index].gain.cancelScheduledValues(now);
      maskDryGains[index].gain.setValueAtTime(maskDryGains[index].gain.value, now);
      maskDryGains[index].gain.linearRampToValueAtTime(dry, now + 0.001);
      maskWetGains[index].gain.cancelScheduledValues(now);
      maskWetGains[index].gain.setValueAtTime(maskWetGains[index].gain.value, now);
      maskWetGains[index].gain.linearRampToValueAtTime(wet, now + 0.001);
      // console.log(`✅ Osc ${index + 1} mask mix:`, (oscMaskMixes[index] * 100).toFixed(0), '%'); // PERFORMANCE
    }
  }
  function setOsc1MaskMix(mix) { setOscMaskMix(0, mix); }
  function setOsc2MaskMix(mix) { setOscMaskMix(1, mix); }
  
  // --- DRIFT ENABLED ---
  function setOscDriftEnabled(index, enabled) {
    const NUM_OSCILLATORS = getNumOscillators();
    if (index < 0 || index >= NUM_OSCILLATORS) return;
    oscDriftEnabled[index] = enabled;
    if (getNodesInitialized() && maskCenterLFOs[index]) {
      if (enabled) {
        maskCenterLFOs[index].start();
      } else {
        maskCenterLFOs[index].stop();
      }
      // console.log(`✅ Osc ${index + 1} drift:`, enabled ? 'ON' : 'OFF'); // PERFORMANCE
    }
  }
  function setOsc1DriftEnabled(enabled) { setOscDriftEnabled(0, enabled); }
  function setOsc2DriftEnabled(enabled) { setOscDriftEnabled(1, enabled); }
  
  // --- DRIFT RATE LO ---
  function setOscDriftRateLo(index, seconds) {
    const NUM_OSCILLATORS = getNumOscillators();
    if (index < 0 || index >= NUM_OSCILLATORS) return;
    oscDriftRateLo[index] = Math.max(0.1, Math.min(60, seconds));
    // NOTE: Don't recreate LFO here - let caller do it once after both lo/hi are set
    // console.log(`✅ Osc ${index + 1} drift rate lo:`, oscDriftRateLo[index].toFixed(2), 's'); // PERFORMANCE
  }
  function setOsc1DriftRateLo(seconds) { setOscDriftRateLo(0, seconds); }
  function setOsc2DriftRateLo(seconds) { setOscDriftRateLo(1, seconds); }
  
  // --- DRIFT RATE HI ---
  function setOscDriftRateHi(index, seconds) {
    const NUM_OSCILLATORS = getNumOscillators();
    if (index < 0 || index >= NUM_OSCILLATORS) return;
    oscDriftRateHi[index] = Math.max(0.1, Math.min(60, seconds));
    // NOTE: Don't recreate LFO here - let caller do it once after both lo/hi are set
    // console.log(`✅ Osc ${index + 1} drift rate hi:`, oscDriftRateHi[index].toFixed(2), 's'); // PERFORMANCE
  }
  function setOsc1DriftRateHi(seconds) { setOscDriftRateHi(0, seconds); }
  function setOsc2DriftRateHi(seconds) { setOscDriftRateHi(1, seconds); }
  
  // --- DRIFT RATE RANGE (Set both lo/hi + recreate LFO once) ---
  function setOscDriftRateRange(index, loSeconds, hiSeconds) {
    const NUM_OSCILLATORS = getNumOscillators();
    if (index < 0 || index >= NUM_OSCILLATORS) return;
    oscDriftRateLo[index] = Math.max(0.1, Math.min(60, loSeconds));
    oscDriftRateHi[index] = Math.max(0.1, Math.min(60, hiSeconds));
    if (getNodesInitialized()) {
      // MEMORY LEAK FIX: Recreate LFO once after both values updated
      recreateDriftLFO(index);
      console.log(`✅ Osc ${index + 1} drift rate range:`, oscDriftRateLo[index].toFixed(2), '-', oscDriftRateHi[index].toFixed(2), 's');
    }
  }
  function setOsc1DriftRateRange(loSeconds, hiSeconds) { setOscDriftRateRange(0, loSeconds, hiSeconds); }
  function setOsc2DriftRateRange(loSeconds, hiSeconds) { setOscDriftRateRange(1, loSeconds, hiSeconds); }
  
  // --- DRIFT AMOUNT ---
  function setOscDriftAmount(index, amount) {
    const NUM_OSCILLATORS = getNumOscillators();
    if (index < 0 || index >= NUM_OSCILLATORS) return;
    oscDriftAmounts[index] = Math.max(0, Math.min(1, amount));
    if (getNodesInitialized()) {
      // MEMORY LEAK FIX: Only called on mouseup (not during drag), so no spam
      recreateDriftLFO(index);
      // console.log(`✅ Osc ${index + 1} drift amount:`, (oscDriftAmounts[index] * 100).toFixed(0), '%'); // PERFORMANCE
    }
  }
  function setOsc1DriftAmount(amount) { setOscDriftAmount(0, amount); }
  function setOsc2DriftAmount(amount) { setOscDriftAmount(1, amount); }
  
  // --- WIDTH ---
  function setOscWidth(index, width) {
    const NUM_OSCILLATORS = getNumOscillators();
    if (index < 0 || index >= NUM_OSCILLATORS) return;
    oscWidths[index] = Math.max(0, Math.min(1, width));
    if (getNodesInitialized() && widthPannersL[index] && widthPannersR[index]) {
      const panValue = oscWidths[index];
      const now = getToneLib().now();
      widthPannersL[index].pan.cancelScheduledValues(now);
      widthPannersL[index].pan.setValueAtTime(widthPannersL[index].pan.value, now);
      widthPannersL[index].pan.linearRampToValueAtTime(-panValue, now + 0.001);
      widthPannersR[index].pan.cancelScheduledValues(now);
      widthPannersR[index].pan.setValueAtTime(widthPannersR[index].pan.value, now);
      widthPannersR[index].pan.linearRampToValueAtTime(panValue, now + 0.001);
      // console.log(`✅ Osc ${index + 1} width:`, oscWidths[index].toFixed(2)); // PERFORMANCE
    }
  }
  function setOsc1Width(width) { setOscWidth(0, width); }
  function setOsc2Width(width) { setOscWidth(1, width); }
  
  // ============================================================================
  // RETURN ALL SETTERS
  // ============================================================================
  return {
    // Dual-oscillator setters
    setNoiseVolume,
    setSculptLP,
    setSculptHP,
    setMaskType,
    setMaskCenter,
    setMaskMix,
    setDriftEnabled,
    setDriftRateLo,
    setDriftRateHi,
    setDriftAmount,
    setNoiseWidth,
    
    // Indexed setters
    setOscType,
    setOsc1Type,
    setOsc2Type,
    setOscVolume,
    setOsc1Volume,
    setOsc2Volume,
    setOscSculptLP,
    setOsc1SculptLP,
    setOsc2SculptLP,
    setOscSculptHP,
    setOsc1SculptHP,
    setOsc2SculptHP,
    setOscMaskType,
    setOsc1MaskType,
    setOsc2MaskType,
    setOscMaskCenter,
    setOsc1MaskCenter,
    setOsc2MaskCenter,
    setOscMaskMix,
    setOsc1MaskMix,
    setOsc2MaskMix,
    setOscDriftEnabled,
    setOsc1DriftEnabled,
    setOsc2DriftEnabled,
    setOscDriftRateLo,
    setOsc1DriftRateLo,
    setOsc2DriftRateLo,
    setOscDriftRateHi,
    setOsc1DriftRateHi,
    setOsc2DriftRateHi,
    setOscDriftRateRange,
    setOsc1DriftRateRange,
    setOsc2DriftRateRange,
    setOscDriftAmount,
    setOsc1DriftAmount,
    setOsc2DriftAmount,
    setOscWidth,
    setOsc1Width,
    setOsc2Width
  };
}
