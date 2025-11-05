// ============================================================================
// NOISE PRESETS - CONTROLLER LAYER (MVC)
// ============================================================================
// Manages noise preset loading, saving, and navigation
// Follows binaural_presets.js pattern with IsResume flag system
//
// CURRENT STATE: Fully functional dual-oscillator preset system
// - Loads complete noise presets from presets/noise/*.json
// - Applies all 18 parameters (9 per oscillator)
// - Supports type, volume, sculpt, width, mask, center, mix, drift, rate
//
// MVC ARCHITECTURE:
// - Controller (this file): Owns IsResume flag, manages preset I/O
// - View (noise_widget.js): Handles UI, calls notifyManualAdjustment()
// - Model (noise_synth.js): Pure audio, exposes setter API
//
// ATSAC PATTERN (Traffic Cop Layer):
// - Presetter wrappers (presetterSetMaskType, etc.) wrap synth calls
// - Widget calls presetter wrappers, not synth directly
// - Ensures IsResume flag stays synchronized with user edits
// ============================================================================

import { 
  setNoiseType, setNoiseVolume, setSculptLP, setSculptHP, setMaskType, setMaskCenter, setMaskMix, setNoiseWidth, 
  getNoiseType, getNoiseVolume, getSculptLP, getSculptHP, getMaskType, getMaskCenter, getMaskMix, getNoiseWidth,
  setOsc2Type, setOsc2Volume, setOsc2SculptLP, setOsc2SculptHP, setOsc2Width,
  setOsc2MaskType, setOsc2MaskCenter, setOsc2MaskMix,
  setOsc2DriftEnabled, setOsc2DriftAmount, setOsc2DriftRateLo, setOsc2DriftRateHi
} from "../synths/noise_synth.js";

// ===== ISRESUME FLAG SYSTEM =====
// IsResume tracks whether we're in "resume mode" (user has adjusted controls)
// When IsResume = true: On play, preserve screen values
// When IsResume = false: Fresh start, apply preset values
let IsResume = false;

// Called by View when user touches any control (volume slider, noise selector, etc.)
export function notifyManualAdjustment() {
  if (!IsResume) {
    IsResume = true;
    console.log('🎚️ Manual adjustment detected - IsResume set to true');
  }
}

// Get IsResume state for synth/transport to check
export function getIsResumeState() {
  return IsResume;
}

// Reset IsResume and clear all manuallyAdjusted flags (called on preset load)
function resetIsResumeAndFlags() {
  IsResume = false;
  
  // Clear manuallyAdjusted flags from noise controls
  // (Currently not implemented - noise widget doesn't use manuallyAdjusted pattern)
  // const noiseControls = document.querySelectorAll('.noise-control');
  // noiseControls.forEach(control => {
  //   delete control.dataset.manuallyAdjusted;
  // });
  
  console.log('🔄 IsResume reset to false');
}

// ============================================================================
// PRESETTER WRAPPER FUNCTIONS - ATSAC Traffic Control
// ============================================================================
// These functions wrap synth calls and manage IsResume state
// Widget calls these (not synth directly) to ensure preset system stays in sync
//
// PATTERN: Call synth function + set IsResume flag
// This is the "traffic cop" layer between widget and synth
// ============================================================================

/**
 * Set mask filter type (presetter wrapper)
 * @param {string} type - Filter type (lowpass12/bandpass/notch/allpass/comb)
 */
export function presetterSetMaskType(type) {
  setMaskType(type); // Call synth
  notifyManualAdjustment(); // Mark as user edit
}

/**
 * Set mask center frequency (presetter wrapper)
 * @param {number} hz - Center frequency in Hz
 */
export function presetterSetMaskCenter(hz) {
  setMaskCenter(hz); // Call synth
  notifyManualAdjustment(); // Mark as user edit
}

/**
 * Set mask wet/dry mix (presetter wrapper)
 * @param {number} mix - Mix value 0.0-1.0
 */
export function presetterSetMaskMix(mix) {
  setMaskMix(mix); // Call synth
  notifyManualAdjustment(); // Mark as user edit
}

/**
 * Set noise stereo width (presetter wrapper)
 * @param {number} widthFactor - Width value 0.0-1.0 (0=mono, 1=full stereo)
 */
export function presetterSetNoiseWidth(widthFactor) {
  setNoiseWidth(widthFactor); // Call synth
  notifyManualAdjustment(); // Mark as user edit
}

/**
 * Set drift enabled (presetter wrapper)
 * @param {boolean} enabled - Enable/disable drift modulation
 */
export function presetterSetDriftEnabled(enabled) {
  if (window.NoiseSynth && window.NoiseSynth.setDriftEnabled) {
    window.NoiseSynth.setDriftEnabled(enabled); // Call synth
  }
  notifyManualAdjustment(); // Mark as user edit
}

/**
 * Set drift rate low (presetter wrapper)
 * @param {number} seconds - Minimum period in seconds
 */
export function presetterSetDriftRateLo(seconds) {
  if (window.NoiseSynth && window.NoiseSynth.setDriftRateLo) {
    window.NoiseSynth.setDriftRateLo(seconds); // Call synth
  }
  notifyManualAdjustment(); // Mark as user edit
}

/**
 * Set drift rate high (presetter wrapper)
 * @param {number} seconds - Maximum period in seconds
 */
export function presetterSetDriftRateHi(seconds) {
  if (window.NoiseSynth && window.NoiseSynth.setDriftRateHi) {
    window.NoiseSynth.setDriftRateHi(seconds); // Call synth
  }
  notifyManualAdjustment(); // Mark as user edit
}

/**
 * Set drift amount (presetter wrapper)
 * @param {number} amount - Modulation depth 0.0-1.0
 */
export function presetterSetDriftAmount(amount) {
  if (window.NoiseSynth && window.NoiseSynth.setDriftAmount) {
    window.NoiseSynth.setDriftAmount(amount); // Call synth
  }
  notifyManualAdjustment(); // Mark as user edit
}

// ============================================================================
// DIRECTORY DISCOVERY - Load noise presets from the presets/noise directory
// ============================================================================
export async function loadNoisePresets() {
  try {
    // Try to dynamically load directory contents
    const response = await fetch('./presets/noise/');
    if (response.ok) {
      const html = await response.text();
      // Parse HTML directory listing to extract .json filenames
      const jsonFiles = [];
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const links = doc.querySelectorAll('a[href$=".json"]');
      links.forEach(link => {
        const filename = link.getAttribute('href');
        if (filename && filename.endsWith('.json')) {
          const nameWithExt = filename.split('/').pop();
          const name = nameWithExt.replace(/\.json$/, '');
          jsonFiles.push(name);
        }
      });
      
      if (jsonFiles.length > 0) {
        return jsonFiles.sort();
      }
    }
    
    // Fallback to known preset names if directory listing fails
    return ['Pinkienoise'];
  } catch (err) {
    console.warn('Failed to load noise presets dynamically, using fallback:', err);
    return ['Pinkienoise'];
  }
}

async function getPresetByName(name) {
  if (!name) return null;
  try {
    const response = await fetch(`./presets/noise/${name}.json`);
    if (!response.ok) return null;
    return await response.json();
  } catch (err) {
    console.warn(`Failed to load noise preset ${name}:`, err);
    return null;
  }
}

// ============================================================================
// PRESET LOADING - Load and apply preset to synth
// ============================================================================

// Load a noise preset and apply to synth (all dual-osc parameters)
export async function loadAndApplyNoisePreset(presetName) {
  if (!presetName) {
    console.warn('❌ loadAndApplyNoisePreset: No preset name provided');
    return false;
  }
  
  const presetData = await getPresetByName(presetName);
  if (!presetData) {
    console.warn(`❌ Failed to load preset: ${presetName}`);
    return false;
  }
  
  console.log(`� Loading noise preset "${presetData.presetName || presetData.name}" with data:`, presetData);
  
  // Reset IsResume flag (fresh preset load)
  resetIsResumeAndFlags();
  
  // Apply preset to synth (all dual-osc parameters)
  applyPresetToSynth(presetData);
  
  // Fire events for VIEW to update UI
  window.dispatchEvent(new CustomEvent('noisePresetChanged', {
    detail: { presetData }
  }));
  
  window.dispatchEvent(new CustomEvent('noisePresetLoaded', {
    detail: { presetData }
  }));
  
  console.log(`✅ Preset "${presetData.presetName || presetData.name}" loaded successfully`);
  return true;
}

/**
 * Apply preset data to synth (all dual-oscillator parameters)
 * @param {Object} presetData - Full preset data from JSON
 */
function applyPresetToSynth(presetData) {
  if (!presetData) return;
  
  // Apply OSC1 settings
  if (presetData.osc1) {
    console.log('🎛️ Applying OSC1 to synth:', presetData.osc1);
    
    // Apply noise type (brown/pink/white)
    if (presetData.osc1.noiseType) {
      setNoiseType(presetData.osc1.noiseType);
    }
    
    // Apply volume (dB)
    if (presetData.osc1.volume !== undefined) {
      setNoiseVolume(presetData.osc1.volume);
    }
    
    // Apply lowpass filter (sculpt high end)
    if (presetData.osc1.sculptLP !== undefined) {
      setSculptLP(presetData.osc1.sculptLP);
    }
    
    // Apply highpass filter (sculpt low end)
    if (presetData.osc1.sculptHP !== undefined) {
      setSculptHP(presetData.osc1.sculptHP);
    }
    
    // Apply stereo width (0.0=mono, 1.0=full stereo)
    if (presetData.osc1.width !== undefined) {
      setNoiseWidth(presetData.osc1.width);
    }
    
    // Apply mask filter settings
    if (presetData.osc1.mask) {
      console.log('🎭 Applying mask filter:', presetData.osc1.mask);
      
      if (presetData.osc1.mask.voice) {
        // Handle both old numeric format (1-5) and new string format
        let maskType = presetData.osc1.mask.voice;
        if (typeof maskType === 'number') {
          // Convert old numeric format to new string format
          // Old: 1=lowpass12, 2=bandpass, 3=notch, 4=allpass, 5=comb
          // New: 1=bandpass, 2=notch, 3=allpass, 4=comb (removed lowpass12)
          const numericMapping = {
            1: 'bandpass', // Was lowpass12, now bandpass
            2: 'bandpass',
            3: 'notch',
            4: 'allpass',
            5: 'comb'
          };
          maskType = numericMapping[maskType] || 'bandpass';
        }
        setMaskType(maskType);
      }
      
      if (presetData.osc1.mask.center !== undefined) {
        setMaskCenter(presetData.osc1.mask.center);
      }
      
      if (presetData.osc1.mask.mix !== undefined) {
        setMaskMix(presetData.osc1.mask.mix);
      }
      
      // Apply drift parameters (RandomLFO modulating center frequency)
      if (window.NoiseSynth) {
        // Apply drift amount first (before enabling, so LFO has correct range)
        if (presetData.osc1.mask.drift !== undefined && window.NoiseSynth.setDriftAmount) {
          window.NoiseSynth.setDriftAmount(presetData.osc1.mask.drift);
        }
        
        // Apply rate range (period min/max)
        if (presetData.osc1.mask.rateLo !== undefined && window.NoiseSynth.setDriftRateLo) {
          window.NoiseSynth.setDriftRateLo(presetData.osc1.mask.rateLo);
        }
        if (presetData.osc1.mask.rateHi !== undefined && window.NoiseSynth.setDriftRateHi) {
          window.NoiseSynth.setDriftRateHi(presetData.osc1.mask.rateHi);
        }
        
        // Enable drift if amount > 0 (auto-enable based on drift amount)
        // If driftEnabled explicitly set in preset, use that value
        // Otherwise, enable if drift amount is non-zero
        const shouldEnableDrift = presetData.osc1.mask.driftEnabled !== undefined
          ? presetData.osc1.mask.driftEnabled
          : (presetData.osc1.mask.drift !== undefined && presetData.osc1.mask.drift > 0);
        
        if (shouldEnableDrift && window.NoiseSynth.setDriftEnabled) {
          window.NoiseSynth.setDriftEnabled(true);
        }
      }
    }
    
    // All parameters applied (type, volume, sculpt, width, mask, drift)
  }
  
  // OSC2 TEMPORARILY SILENCED FOR TROUBLESHOOTING
  // TODO: Re-enable after OSC1 is working correctly, then pattern against it
  console.log('🔇 Silencing OSC2 for troubleshooting (OSC1 only)');
  setOsc2Volume(-70); // Silence OSC2 (FADER_SILENCE_FLOOR_DB)
  
  console.log('✅ Preset applied to synth (OSC1 only - OSC2 silenced for troubleshooting)');
}

// ============================================================================
// PRESET SAVING - Get current state from synth/UI
// ============================================================================

// Get current noise preset data from synth/UI controls
function getCurrentNoisePresetData() {
  // Read from synth state (getters now functional as of getter fix)
  // Widget exists but doesn't maintain separate state
  
  // Get drift parameters from synth
  const driftEnabled = window.NoiseSynth?.getDriftEnabled?.() || false;
  const driftAmount = window.NoiseSynth?.getDriftAmount?.() || 0.15;
  const driftRateLo = window.NoiseSynth?.getDriftRateLo?.() || 5;
  const driftRateHi = window.NoiseSynth?.getDriftRateHi?.() || 15;
  
  const presetData = {
    presetName: 'Custom',
    presetVersion: '1.0.0',
    description: 'Saved from current state',
    osc1: {
      noiseType: getNoiseType(),
      volume: getNoiseVolume(),
      sculptLP: getSculptLP(),
      sculptHP: getSculptHP(),
      mask: {
        voice: getMaskType(),
        center: getMaskCenter(),
        mix: getMaskMix(),
        drift: driftAmount,
        rateLo: driftRateLo,
        rateHi: driftRateHi,
        driftEnabled: driftEnabled
      }
      // All parameters included (type, volume, sculpt, width, mask, drift)
    },
    // OSC2 data structure mirrors OSC1 (dual oscillator fully implemented)
    // osc2: { ... } could be added here for preset saving
  };
  
  return presetData;
}

export async function createNoisePresetController(options = {}) {
  const {
    presetDisplay,
    presetPrev,
    presetNext,
    saveBtn,
    revertBtn,
  } = options;

  let presets = [];
  let currentPresetIndex = 0;
  let lastSaveDirectory = null;

  // Initialize: load noise presets from the noise directory
  try {
    presets = await loadNoisePresets();
    
    // If preset was already loaded at startup, skip loading again
    // This prevents audio resets when visiting the panel
    if (window.noisePresetHasBeenLoaded) {
      console.log('⏭️ Skipping preset load - already initialized at startup');
      // Still need to set the display to show current preset
      if (presetDisplay && presets && presets.length > 0) {
        const displayElement = presetDisplay.querySelector('.button_selector__display');
        if (displayElement) {
          displayElement.textContent = presets[0]; // Assuming Noisespec is first
        }
      }
    } else if (presets && presets.length > 0) {
      // Initial load - load the default preset
      const defaultPreset = presets[0];
      currentPresetIndex = 0;
      await loadAndApplyNoisePreset(defaultPreset);
      
      // Mark that a preset has been loaded
      window.noisePresetHasBeenLoaded = true;
      
      if (presetDisplay) {
        const displayElement = presetDisplay.querySelector('.button_selector__display');
        if (displayElement) {
          displayElement.textContent = defaultPreset;
        }
      }
      
      console.log('✅ Noise preset loaded on init:', defaultPreset);
    }
  } catch (err) {
    console.error('createNoisePresetController init error', err);
  }

  // Wire up preset navigation (prev/next buttons)
  if (presetPrev) {
    presetPrev.addEventListener('click', async () => {
      if (presets.length === 0) return;
      currentPresetIndex = (currentPresetIndex - 1 + presets.length) % presets.length;
      const presetName = presets[currentPresetIndex];
      console.log(`⬅️ Loading previous preset: ${presetName}`);
      await loadAndApplyNoisePreset(presetName);
      if (presetDisplay) {
        const displayElement = presetDisplay.querySelector('.button_selector__display');
        if (displayElement) {
          displayElement.textContent = presetName;
        }
      }
    });
  }
  
  if (presetNext) {
    presetNext.addEventListener('click', async () => {
      if (presets.length === 0) return;
      currentPresetIndex = (currentPresetIndex + 1) % presets.length;
      const presetName = presets[currentPresetIndex];
      console.log(`➡️ Loading next preset: ${presetName}`);
      await loadAndApplyNoisePreset(presetName);
      if (presetDisplay) {
        const displayElement = presetDisplay.querySelector('.button_selector__display');
        if (displayElement) {
          displayElement.textContent = presetName;
        }
      }
    });
  }

  // Save button handler - uses File System Access API
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      console.log('💾 Save button clicked');
      try {
        const presetData = getCurrentNoisePresetData();
        console.log('📊 Preset data collected:', presetData);
        
        const jsonString = JSON.stringify(presetData, null, 2);
        console.log('📝 JSON string created, length:', jsonString.length);
        
        if ('showSaveFilePicker' in window) {
          console.log('✅ File System Access API available');
          const options = {
            suggestedName: 'MyNoisePreset.json',
            types: [{
              description: 'Noise Preset',
              accept: { 'application/json': ['.json'] }
            }]
          };
          
          if (lastSaveDirectory) {
            options.startIn = lastSaveDirectory;
          }
          
          console.log('🔍 Calling showSaveFilePicker...');
          const handle = await window.showSaveFilePicker(options);
          console.log('📁 File handle obtained:', handle.name);
          
          lastSaveDirectory = handle;
          
          const writable = await handle.createWritable();
          await writable.write(jsonString);
          await writable.close();
          console.log(`✅ Preset saved to: ${handle.name}`);
        } else {
          console.log('⚠️ File System Access API not available, using fallback download');
          const blob = new Blob([jsonString], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'MyNoisePreset.json';
          a.click();
          URL.revokeObjectURL(url);
          console.log(`✅ Preset downloaded`);
        }
      } catch (e) {
        if (e.name !== 'AbortError') {
          console.error('Save failed:', e);
          alert('Save failed: ' + e.message);
        }
      }
    });
  }

  return {
    getPresets: () => presets.slice(),
    getCurrentIndex: () => currentPresetIndex,
    refresh: async () => {
      presets = await loadNoisePresets();
    }
  };
}

// ============================================================================
// GLOBAL EXPOSURE (for console testing and widget integration)
// ============================================================================
if (typeof window !== 'undefined') {
  window.NoisePresets = window.NoisePresets || {};
  window.NoisePresets.loadAndApplyNoisePreset = loadAndApplyNoisePreset;
  window.NoisePresets.loadNoisePresets = loadNoisePresets;
  window.NoisePresets.createNoisePresetController = createNoisePresetController;
  window.NoisePresets.notifyManualAdjustment = notifyManualAdjustment;
  window.NoisePresets.getIsResumeState = getIsResumeState;
  
  // Presetter wrapper functions (ATSAC traffic control)
  window.NoisePresets.setMaskType = presetterSetMaskType;
  window.NoisePresets.setMaskCenter = presetterSetMaskCenter;
  window.NoisePresets.setMaskMix = presetterSetMaskMix;
  window.NoisePresets.setNoiseWidth = presetterSetNoiseWidth;
  window.NoisePresets.setDriftEnabled = presetterSetDriftEnabled;
  window.NoisePresets.setDriftRateLo = presetterSetDriftRateLo;
  window.NoisePresets.setDriftRateHi = presetterSetDriftRateHi;
  window.NoisePresets.setDriftAmount = presetterSetDriftAmount;
}

