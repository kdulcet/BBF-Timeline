import { listPresets, importPresetObject, getPreset } from "../../src/preset_resources.js";
import { setVoiceVolume, setBinauralBeat, setVoiceOctaveOffset, getVoiceOctaveOffsets, getCurrentBinauralBeat, getVoiceVolumes, getVoiceWidth } from "../synths/binaural_synth.js";
import { getVoiceWidths as getIsoVoiceWidths } from "../synths/binaural_iso.js";

const FADER_SILENCE_FLOOR_DB = -70; // Must match binaural_widget.js

// ===== ISRESUME FLAG SYSTEM =====
// IsResume tracks whether we're in "resume mode" (user has adjusted controls)
// When IsResume = true: On play, preserve screen values
// When IsResume = false: Fresh start, apply preset values
let IsResume = false;

// Called by View when user touches any control (fader or octave)
export function notifyManualAdjustment() {
  if (!IsResume) {
    IsResume = true;
  }
}

// Get IsResume state for synth/transport to check
export function getIsResumeState() {
  return IsResume;
}

// Reset IsResume and clear all manuallyAdjusted flags (called on preset load)
function resetIsResumeAndFlags() {
  IsResume = false;
  
  // Clear all fader flags
  const faders = document.querySelectorAll('.voice-fader');
  faders.forEach(fader => {
    delete fader.dataset.manuallyAdjusted;
  });
  
  // Clear all octave widget flags
  const octaveWidgets = document.querySelectorAll('.octave-widget');
  octaveWidgets.forEach(widget => {
    delete widget.dataset.manuallyAdjusted;
  });
  
  // Clear all width control flags
  const widthControls = document.querySelectorAll('.width-control');
  widthControls.forEach(control => {
    delete control.dataset.manuallyAdjusted;
  });
  
  // Clear all ISO control flags
  const isoControls = document.querySelectorAll('.pulse-control');
  isoControls.forEach(control => {
    delete control.dataset.manuallyAdjusted;
  });
}

// Get current binaural preset data from UI controls (not synth state - more reliable)
function getCurrentBinauralPresetData() {
  const octaves = getVoiceOctaveOffsets();
  
  // Build preset object
  const presetData = {
    name: 'Custom Preset',
    description: 'Saved from current state',
    version: '1.0',
    voices: {}
  };
  
  // Read directly from UI fader positions
  const faders = document.querySelectorAll('.voice-fader');
  
  // Add each voice's data
  for (let i = 0; i < 5; i++) {
    const voiceNum = i + 1;
    
    // Read volume from UI fader handle position and convert to dB
    let volumeDb = -60; // Default
    if (faders[i]) {
      const handle = faders[i].querySelector('.fader-handle');
      if (handle) {
        const bottomPercent = parseFloat(handle.style.bottom) || 50;
        // Convert constrained 5-95% back to 0-100% 
        const rawPercent = (bottomPercent - 5) / 0.9;
        // Convert to dB using same formula as faderPosToDb
        if (rawPercent <= 0) {
          volumeDb = -Infinity;
        } else {
          volumeDb = (rawPercent / 100) * Math.abs(FADER_SILENCE_FLOOR_DB) + FADER_SILENCE_FLOOR_DB;
        }
      }
    }
    
    // Read width from UI control (width-control handle position)
    let stereoWidth = 1.0;
    const widthControl = document.querySelector(`.width-control[data-voice="${voiceNum}"]`);
    if (widthControl) {
      const handle = widthControl.querySelector('.width-handle');
      if (handle) {
        const leftPercent = parseFloat(handle.style.left) || 100;
        stereoWidth = leftPercent / 100;
      }
    }
    
    // Read ISO crossfade from UI control (pulse-control handle position)
    let isoRatio = 0;
    const isoControl = document.querySelector(`.pulse-control[data-voice="${voiceNum}"]`);
    if (isoControl) {
      const handle = isoControl.querySelector('.pulse-handle');
      if (handle) {
        const leftPercent = parseFloat(handle.style.left) || 0;
        isoRatio = leftPercent / 100; // Convert 0-100% to 0-1
      }
    }
    
    // Read pulse length from UI control (length-control handle position)
    let dutyCycle = 0.5;
    const lengthControl = document.querySelector(`.length-control[data-voice="${voiceNum}"]`);
    if (lengthControl) {
      const handle = lengthControl.querySelector('.length-handle');
      if (handle) {
        const leftPercent = parseFloat(handle.style.left) || 0;
        dutyCycle = 0.2 + (leftPercent / 100) * 0.5; // Map 0-100% to 0.2-0.7
      }
    }
    
    presetData.voices[voiceNum] = {
      oct: octaves[i] ?? 0,                               // Use "oct" not "octaveOffset"
      volume: volumeDb,                                   // Already in dB from fader calculation above
      stereoWidth: stereoWidth,                           // Read from UI width control
      fxLevel: 0.3,                                       // Default fx level
      isochronic: isoRatio,                               // Read from UI
      dutycycle: dutyCycle                                // Read from UI
    };
  }
  
  return presetData;
}

// Capture ALL current UI state that user may have edited
function captureCurrentUIState() {
  const state = {
    faderVolumes: [],
    voiceOctaveOffsets: [],
    // Add more UI elements here as needed
  };

  // Capture fader positions
  const faders = document.querySelectorAll('.voice-fader');
  faders.forEach((fader, index) => {
    const handle = fader.querySelector('.fader-handle');
    if (handle) {
      const bottomValue = handle.style.bottom;
      const faderPosition = bottomValue !== '' ? parseFloat(bottomValue) : 50;
      const volumeDb = (faderPosition / 100) * 60 - 60;
      state.faderVolumes[index] = volumeDb;
    }
  });

  // Capture current octave offsets from the audio system (all 5 voices)
  state.voiceOctaveOffsets = getVoiceOctaveOffsets();

  // TODO: Add capture logic for other UI elements (root key, mood, etc.)
  
  return state;
}

// Restore ALL user-edited UI state after preset operations
function restoreUIState(state) {
  if (!state) return;

  // Restore fader volumes
  if (state.faderVolumes) {
    state.faderVolumes.forEach((volumeDb, index) => {
      if (volumeDb !== undefined) {
        setVoiceVolume(index, volumeDb);
      }
    });
  }

  // Restore octave offsets for all voices
  if (state.voiceOctaveOffsets && Array.isArray(state.voiceOctaveOffsets)) {
    state.voiceOctaveOffsets.forEach((octaveOffset, voiceIndex) => {
      if (octaveOffset !== undefined) {
        setVoiceOctaveOffset(voiceIndex, octaveOffset);
      }
    });
  }

  // TODO: Add restore logic for other UI elements as they're added
}

// Refresh octave UI across all pages when loading a new patch (ONLY during patch load)
function refreshOctaveUIFromPreset(presetData) {
  if (!presetData || !presetData.voices) return;
  
  // Update octave UI elements for each voice across all pages
  Object.keys(presetData.voices).forEach(voiceKey => {
    const voiceIndex = parseInt(voiceKey) - 1; // Convert 1-based to 0-based
    const voiceData = presetData.voices[voiceKey];
    
    if (voiceData && voiceData.oct !== undefined) {
      // Use the existing updateOctaveControlDisplay function from binaural_widget.js
      if (window.BinauralWidget && window.BinauralWidget.updateOctaveControlDisplay) {
        window.BinauralWidget.updateOctaveControlDisplay(parseInt(voiceKey), voiceData.oct);
      }
      
      // NOTE: Don't call setVoiceOctaveOffset here - the binauralPresetChanged listener
      // in binaural_synth.js will handle applying octave offsets to the audio system
    }
  });
}

// NOTE: Old binauralPresetLoaded listener removed - loadAndApplyBinauralPreset() now handles
// resetIsResumeAndFlags() and refreshOctaveUIFromPreset() directly when loading presets

// createBinauralPresetController wires up preset listing, prev/next navigation, and save modal handlers
// options: {
//   debugPanel, presetDisplay, presetPrev, presetNext,
//   saveBtn, revertBtn, saveModal, modalSaveNew, modalOverwrite, modalBack,
//   presetNameInput, nameCount,
//   renderPreset(name) -> callback provided by widget,
//   getCurrentPresetData() -> returns current preset payload,
//   getCurrentPresetFilename() -> returns current filename
// }
// Helper: convert a journeymap payload (segments with minute durations) into
// a simple binaural payload structure expected by the synth (seconds, hz ranges, envelope_type)
function _extractJourneyPayload(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj.segments)) return obj;
  if (obj.payload && Array.isArray(obj.payload.segments)) return obj.payload;
  // common alternate keys
  if (obj.recipe && Array.isArray(obj.recipe.segments)) return obj.recipe;
  if (obj.payload && obj.payload.payload && Array.isArray(obj.payload.payload.segments)) return obj.payload.payload;
  // shallow search one level
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v && typeof v === 'object' && Array.isArray(v.segments)) return v;
  }
  return null;
}

export function convertJourneyToBinauralTimeline(journeyPayload) {
  const jp = _extractJourneyPayload(journeyPayload);
  if (!jp) {
    console.warn('convertJourneyToBinauralTimeline received invalid payload (no segments found)', journeyPayload);
    return null;
  }
  
  // Find the first segment with Hz data to set as synth default
  let firstHz = null;
  for (const seg of jp.segments) {
    if (seg.type === 'plateau' && seg.hz && seg.hz > 0) {
      firstHz = seg.hz;
      break;
    }
  }
  
  if (firstHz) {
    setBinauralBeat(firstHz);
  }
  
  const out = { segments: [] };
  for (const seg of jp.segments) {
    if (seg.type === 'plateau') {
      out.segments.push({
        duration_seconds: (seg.duration_min || 0) * 60,
        hz: seg.hz || 0,
        hz_range: null,
        envelope_type: 'linear'
      });
    } else if (seg.type === 'transition') {
      // transition: look at surrounding plateaus if present
      out.segments.push({
        duration_seconds: (seg.duration_min || 0) * 60,
        hz: null,
        hz_range: null,
        envelope_type: 'linear'
      });
    } else {
      // unknown segment; skip
    }
  }
  // Post-process to fill hz_range for transitions
  for (let i = 0; i < jp.segments.length; i++) {
    const s = jp.segments[i];
    if (s.type === 'transition') {
  const prev = jp.segments[i - 1];
  const next = jp.segments[i + 1];
      const prevHz = prev && prev.hz ? prev.hz : 0;
      const nextHz = next && next.hz ? next.hz : prevHz;
      out.segments[i].hz_range = [prevHz, nextHz];
    } else if (s.type === 'plateau') {
      out.segments[i].hz = s.hz || 0;
    }
  }
  return out;
}

export async function loadTimelinePreset(nameWithoutExt) {
  if (!nameWithoutExt) return null;
  const preset = await getPresetByName(nameWithoutExt);
  if (!preset) return null;
  // assume preset.payload is the journeymap payload
  return convertJourneyToBinauralTimeline(preset.payload || preset);
}

// Load binaural presets from the presets/binaural directory
export async function loadBinauralPresets() {
  try {
    // Try to dynamically load directory contents
    // This requires a server endpoint that lists directory contents
    const response = await fetch('./presets/binaural/');
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
          // Extract just the filename without path or extension
          const nameWithExt = filename.split('/').pop(); // Get last part of path
          const name = nameWithExt.replace(/\.json$/, ''); // Remove .json extension
          jsonFiles.push(name);
        }
      });
      
      if (jsonFiles.length > 0) {
        return jsonFiles.sort(); // Return alphabetically sorted names
      }
    }
    
    // Fallback to known preset names if directory listing fails
    return [
      'Deepflora',
      'Energyzone', 
      'Focalpoint',
      'Skybridge',
      'Sleeptone'
    ];
  } catch (err) {
    console.warn('Failed to load binaural presets dynamically, using fallback:', err);
    // Fallback to known preset names
    return [
      'Deepflora',
      'Energyzone', 
      'Focalpoint',
      'Skybridge',
      'Sleeptone'
    ];
  }
}

async function getPresetByName(name) {
  if (!name) return null;
  try {
    // Load from binaural directory - name should already include proper casing
    const response = await fetch(`./presets/binaural/${name}.json`);
    if (!response.ok) return null;
    return await response.json();
  } catch (err) {
    console.warn(`Failed to load binaural preset ${name}:`, err);
    return null;
  }
}

// Load a binaural preset and fire the binauralPresetChanged event
// This is the entry point for Path 1: Nav Button Loads Fresh Preset
export async function loadAndApplyBinauralPreset(presetName) {
  
  if (!presetName) {
    console.warn('❌ loadAndApplyBinauralPreset: No preset name provided');
    return false;
  }
  
  const presetData = await getPresetByName(presetName);
  if (!presetData) {
    console.warn(`❌ Failed to load preset: ${presetName}`);
    return false;
  }
  
  // Reset IsResume flag and clear all manuallyAdjusted flags (fresh preset load)
  resetIsResumeAndFlags();
  
  console.log(`🔥 Loading preset "${presetData.name}" with data:`, presetData);
  
  // Fire binauralPresetChanged event → MODEL (_synth applies volumes/octaves/widths)
  console.log(`🔥 Firing binauralPresetChanged event`);
  window.dispatchEvent(new CustomEvent('binauralPresetChanged', {
    detail: { presetData }
  }));
  
  // Fire binauralPresetLoaded event → VIEW (_widget updates fader positions)
  console.log(`🔥 Firing binauralPresetLoaded event`);
  window.dispatchEvent(new CustomEvent('binauralPresetLoaded', {
    detail: { presetData }
  }));
  
  // Fire journeymapRestart event → restart ISO synth loops to sync with new preset
  console.log(`🔥 Firing journeymapRestart event to restart ISO loops`);
  window.dispatchEvent(new CustomEvent('journeymapRestart', {
    detail: { timeline: null } // No timeline, just restart loops
  }));
  
  // Also refresh octave UI for this preset
  refreshOctaveUIFromPreset(presetData);
  console.log(`✅ Preset "${presetData.name}" loaded successfully`);
  return true;
}

export async function createBinauralPresetController(options = {}) {
  const {
    debugPanel,
    presetDisplay,
    presetPrev,
    presetNext,
    saveBtn,
    revertBtn,
    saveModal,
    modalSaveNew,
    modalOverwrite,
    modalBack,
    presetNameInput,
    nameCount,
    renderPreset,
    getCurrentPresetData,
    getCurrentPresetFilename,
  } = options;

  let presets = [];
  let currentPresetIndex = 0;
  let lastLoadedPreset = null; // Track which preset is currently loaded to avoid reinitializing

  // initialize: load binaural presets from the binaural directory
  try {
    presets = await loadBinauralPresets();
    if (debugPanel) debugPanel.textContent = (presets || []).join('\n');
    
    // SAFEGUARD: Check if audio is playing AND if a preset has already been loaded
    // This prevents preset changes when navigating between panels during playback
    const { getIsPlaying } = await import('../synths/binaural_synth.js');
    const isCurrentlyPlaying = getIsPlaying();
    
    // Check if this is initial page load (no preset ever loaded) vs panel navigation
    const isInitialLoad = !window.binauralPresetHasBeenLoaded;
    
    // Load the default binaural preset (Deepflora) on initialization
    // Skip ONLY if: (1) audio is playing AND (2) a preset was already loaded before
    const shouldSkipLoad = isCurrentlyPlaying && !isInitialLoad;
    
    if (presets && presets.length > 0 && !shouldSkipLoad) {
      console.log('🎵 Loading default preset (initial load or audio not playing)');
      const defaultPreset = presets.find(p => p === 'Deepflora') || presets[0];
      currentPresetIndex = presets.indexOf(defaultPreset);
      await loadAndApplyBinauralPreset(defaultPreset);
      window.binauralPresetHasBeenLoaded = true; // Mark that we've loaded a preset
      if (presetDisplay) {
        const displayElement = presetDisplay.querySelector('.button_selector__display');
        if (displayElement) {
          displayElement.textContent = defaultPreset;
        }
      }
    } else if (shouldSkipLoad) {
      console.log('🛑 Audio is playing and preset already loaded - skipping auto-load to preserve current sound');
      // Just update the display to show current preset without loading it
      if (presetDisplay) {
        const displayElement = presetDisplay.querySelector('.button_selector__display');
        if (displayElement && presets.length > 0) {
          // Show the first preset name in display, but don't load it
          const defaultPreset = presets.find(p => p === 'Deepflora') || presets[0];
          currentPresetIndex = presets.indexOf(defaultPreset);
          displayElement.textContent = defaultPreset;
        }
      }
    }
  } catch (err) {
    if (debugPanel) debugPanel.textContent = `Error: ${err.message}`;
    console.error('createBinauralPresetController init error', err);
  }

  function flashButton(btn) {
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      const el = e.currentTarget;
      el.classList.add('inverted');
      setTimeout(() => el.classList.remove('inverted'), 160);
    });
  }

  // NOTE: playHandler and stopHandler removed - transport_widget.js now handles play/stop
  // Timeline is pre-scheduled via journeymapRestart events, transport just starts/stops
  
  // Note: Save/Overwrite UI is intentionally disabled for binaural presets at
  // this stage — we are parsing `journeymap` timelines for the synth, not
  // creating dedicated binaural presets. If you later want to enable saving
  // binaural presets, we can reintroduce these handlers.

  flashButton(saveBtn);
  flashButton(revertBtn);
  
  // Remember last saved directory across saves (within same session)
  let lastSaveDirectory = null;
  
  // Simple file save handler - uses File System Access API (Chrome/Edge)
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      console.log('💾 Save button clicked');
      try {
        // Get current preset data from binaural synth
        const presetData = getCurrentBinauralPresetData();
        console.log('📊 Preset data collected:', presetData);
        
        // Convert to JSON
        const jsonString = JSON.stringify(presetData, null, 2);
        console.log('📝 JSON string created, length:', jsonString.length);
        console.log('📝 JSON string created, length:', jsonString.length);
        
        // Try File System Access API first (modern browsers)
        if ('showSaveFilePicker' in window) {
          console.log('✅ File System Access API available');
          const options = {
            suggestedName: 'MyPreset.json',
            types: [{
              description: 'Binaural Preset',
              accept: { 'application/json': ['.json'] }
            }]
          };
          
          // Start in last saved directory if available
          if (lastSaveDirectory) {
            options.startIn = lastSaveDirectory;
          }
          // If no lastSaveDirectory, browser will use its own default (often last location)
          
          console.log('🔍 Calling showSaveFilePicker...');
          const handle = await window.showSaveFilePicker(options);
          console.log('📁 File handle obtained:', handle.name);
          
          // Remember this directory for next save
          lastSaveDirectory = handle;
          
          const writable = await handle.createWritable();
          await writable.write(jsonString);
          await writable.close();
          console.log(`✅ Preset saved to: ${handle.name}`);
        } else {
          console.log('⚠️ File System Access API not available, using fallback download');
          // Fallback: download as file
          const blob = new Blob([jsonString], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'MyPreset.json';
          a.click();
          URL.revokeObjectURL(url);
          console.log(`✅ Preset downloaded`);
        }
      } catch (e) {
        // User cancelled or error occurred
        if (e.name !== 'AbortError') {
          console.error('Save failed:', e);
          alert('Save failed: ' + e.message);
        }
      }
    });
  }

  // NOTE: Play/stop button wiring moved to transport_widget.js for proper separation
  // Transport widget now handles all transport controls (play/stop/render)
  // This controller only manages binaural preset data (loading/saving)

  // Wire up preset navigation (prev/next buttons)
  if (presetPrev) {
    presetPrev.addEventListener('click', async () => {
      if (presets.length === 0) return;
      currentPresetIndex = (currentPresetIndex - 1 + presets.length) % presets.length;
      const presetName = presets[currentPresetIndex];
      console.log(`⬅️ Loading previous preset: ${presetName}`);
      await loadAndApplyBinauralPreset(presetName);
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
      await loadAndApplyBinauralPreset(presetName);
      if (presetDisplay) {
        const displayElement = presetDisplay.querySelector('.button_selector__display');
        if (displayElement) {
          displayElement.textContent = presetName;
        }
      }
    });
  }

  return {
    getPresets: () => presets.slice(),
    getCurrentIndex: () => currentPresetIndex,
    refresh: async () => {
      presets = await loadBinauralPresets();
      // Do not modify shared presetDisplay here.
    }
  };
}

// ===== VOICE-BASED PRESET HELPERS =====

// Validate a binaural preset structure against the specification
export function validateBinauralPreset(preset) {
  if (!preset || typeof preset !== 'object') return false;
  
  // Check required root properties
  if (!preset.name || typeof preset.name !== 'string') return false;
  if (!preset.voices || typeof preset.voices !== 'object') return false;
  
  // Check that all 5 voices exist
  for (let i = 1; i <= 5; i++) {
    const voice = preset.voices[i.toString()];
    if (!voice || typeof voice !== 'object') return false;
    
    // Validate voice properties
    if (typeof voice.oct !== 'number' || voice.oct < -2 || voice.oct > 2) return false;
    if (typeof voice.volume !== 'number' || voice.volume < 0 || voice.volume > 1) return false;
    if (typeof voice.stereoWidth !== 'number' || voice.stereoWidth < 0 || voice.stereoWidth > 1) return false;
    if (typeof voice.fxLevel !== 'number' || voice.fxLevel < 0 || voice.fxLevel > 1) return false;
  }
  
  return true;
}



// Get a specific voice from a preset
export function getVoice(preset, voiceNumber) {
  if (!validateBinauralPreset(preset)) return null;
  if (voiceNumber < 1 || voiceNumber > 5) return null;
  return preset.voices[voiceNumber.toString()] || null;
}

// Update a specific voice in a preset (returns new preset object)
export function setVoice(preset, voiceNumber, voiceData) {
  if (!validateBinauralPreset(preset)) return null;
  if (voiceNumber < 1 || voiceNumber > 5) return null;
  
  // Validate voice data
  if (!voiceData || typeof voiceData !== 'object') return null;
  if (typeof voiceData.oct !== 'number' || voiceData.oct < -2 || voiceData.oct > 2) return null;
  if (typeof voiceData.volume !== 'number' || voiceData.volume < 0 || voiceData.volume > 1) return null;
  if (typeof voiceData.stereoWidth !== 'number' || voiceData.stereoWidth < 0 || voiceData.stereoWidth > 1) return null;
  if (typeof voiceData.fxLevel !== 'number' || voiceData.fxLevel < 0 || voiceData.fxLevel > 1) return null;
  
  // Create updated preset
  const updatedPreset = JSON.parse(JSON.stringify(preset)); // Deep clone
  updatedPreset.voices[voiceNumber.toString()] = { ...voiceData };
  
  return updatedPreset;
}

// Calculate frequency for a voice based on base frequency and oct shift
export function calculateVoiceFrequency(baseFrequency, octShift) {
  if (typeof baseFrequency !== 'number' || typeof octShift !== 'number') return baseFrequency;
  return baseFrequency * Math.pow(2, octShift);
}

// Get all voice frequencies for a preset at a given base frequency
export function getPresetVoiceFrequencies(preset, baseFrequency) {
  if (!validateBinauralPreset(preset)) return [];
  
  const frequencies = [];
  for (let i = 1; i <= 5; i++) {
    const voice = preset.voices[i.toString()];
    frequencies.push({
      voice: i,
      frequency: calculateVoiceFrequency(baseFrequency, voice.oct),
      volume: voice.volume,
      stereoWidth: voice.stereoWidth,
      fxLevel: voice.fxLevel
    });
  }
  
  return frequencies;
}
