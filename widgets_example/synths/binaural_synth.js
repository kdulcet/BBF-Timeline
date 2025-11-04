// ============================================================================
// BINAURAL SYNTH - 5-Voice Binaural Beat Engine
// ============================================================================
// Pure audio MODEL - no DOM access, event-driven architecture
// Generates binaural beats using paired oscillators with just intonation
//
// ARCHITECTURE:
// - 5 voices, each = 2 oscillators (L/R) with frequency offset (binaural beat)
// - Two-stage gain: Voice fader → ISO crossfade → Master output
// - Frequencies calculated from: Root key + Mood semitones + Octave offsets
// - Timeline scheduling via Tone.Transport automation curves
//
// TONE.JS INTEGRATION:
// - Uses Tone.Oscillator (continuous sine waves)
// - Uses Tone.Panner (stereo positioning per voice)
// - Uses Tone.Gain (two-stage volume control with dB ramping)
// - Uses Tone.Transport.on('start') (oscillator lifecycle management)
// - Uses .setValueAtTime() + .linearRampToValueAtTime() (frequency automation)
// ============================================================================

import { Scales } from '../../src/key_and_mood.js'; // Just intonation system

// ============================================================================
// STATE: Voice Parameters (set by presets, controlled by widgets)
// ============================================================================
let carrierFreq = null; // Root key frequency (e.g., 196Hz = G3)
let currentMoodSemitones = [1, 4, 7, 11, 14]; // Mood intervals (Radiance)
let currentBinauralBeat = 4.0; // Binaural beat distance in Hz (from journeymap)
let voiceOctaveOffsets = [0, 0, 0, 0, 0]; // Octave shifts per voice (-2 to +2)
let voiceWidths = [1.0, 1.0, 1.0, 1.0, 1.0]; // Stereo width (0=mono, 1=full)
let voiceVolumes = [-70, -70, -70, -70, -70]; // Stage 1: Fader volume (dB)
let voiceCrossfadeGainValues = [0, 0, 0, 0, 0]; // Stage 2: ISO crossfade (dB)

// ============================================================================
// STATE: Tone.js Audio Nodes (created on play, disposed on stop)
// ============================================================================
let ToneLib = null; // Reference to window.Tone
let scalesSystem = null; // Just intonation calculator (Scales instance)

// 5 voice pairs = 10 oscillators total
let leftOscs = []; // Tone.Oscillator[] - Left ear (carrier - beat/2)
let rightOscs = []; // Tone.Oscillator[] - Right ear (carrier + beat/2)
let pannersL = []; // Tone.Panner[] - Stereo positioning (negative)
let pannersR = []; // Tone.Panner[] - Stereo positioning (positive)
let voiceGains = []; // Tone.Gain[] - Stage 1: Main fader volume
let crossfadeGains = []; // Tone.Gain[] - Stage 2: Binaural/ISO blend
let masterGain = null; // Tone.Gain - Final output (0.5 = -6dB headroom)

let isPlaying = false; // Oscillators started by Transport
let nodesInitialized = false; // Nodes created and connected

// ============================================================================
// INTERNAL: Create Tone.js Audio Graph
// ============================================================================
// Called by initializeNodes() - creates all oscillators, panners, gains
// TONE.JS NODES CREATED:
// - Tone.Oscillator: Continuous sine waves (start/stop controlled by Transport)
// - Tone.Panner: Stereo positioning (-1 to +1, width controlled by widget)
// - Tone.Gain: Two-stage volume control with dB units for smooth ramping
//
// SIGNAL FLOW PER VOICE:
//   leftOsc  → pannerL  ↘
//                         → voiceGain → crossfadeGain → masterGain → destination
//   rightOsc → pannerR  ↗
//
// WHY TWO-STAGE GAIN:
// - Stage 1 (voiceGain): Main fader volume control (user sets per-voice level)
// - Stage 2 (crossfadeGain): Binaural/ISO blend (0dB=full binaural, -∞dB=silent)
// ============================================================================
async function _ensureNodes() {
  if (nodesInitialized) return;
  const Tone = ToneLib;
  
  // Initialize scales system for just intonation frequency calculations
  if (!scalesSystem) {
    scalesSystem = new Scales();
    scalesSystem.setScale('just');
    if (carrierFreq) {
      scalesSystem.setBaseFrequency(carrierFreq);
    }
  }
  
  // Create 5 voice pairs (10 oscillators total)
  for (let i = 0; i < 5; i++) {
    // Create oscillator pair (L/R will have frequency offset for binaural beat)
    const leftOsc = new Tone.Oscillator(0, "sine");
    const rightOsc = new Tone.Oscillator(0, "sine");
    
    // Create panners for stereo width control
    // Width stored in state array (set by presets before nodes exist)
    const storedWidth = voiceWidths[i];
    const pannerL = new Tone.Panner(-storedWidth); // Negative = left
    const pannerR = new Tone.Panner(storedWidth);  // Positive = right
    
    // Stage 1: Voice fader gain (main volume control)
    const storedVolume = voiceVolumes[i]; // In dB (-70 = silent)
    const voiceGain = new Tone.Gain(storedVolume, "decibels");
    
    // Stage 2: Crossfade gain (binaural/ISO blend)
    const storedCrossfade = voiceCrossfadeGainValues[i]; // 0dB = full binaural
    const crossfadeGain = new Tone.Gain(storedCrossfade, "decibels");
    
    // Connect signal chain
    leftOsc.connect(pannerL);
    rightOsc.connect(pannerR);
    pannerL.connect(voiceGain);
    pannerR.connect(voiceGain);
    voiceGain.connect(crossfadeGain);
    
    // Store node references
    leftOscs.push(leftOsc);
    rightOscs.push(rightOsc);
    pannersL.push(pannerL);
    pannersR.push(pannerR);
    voiceGains.push(voiceGain);
    crossfadeGains.push(crossfadeGain);
  }
  
  // Create master output gain (0.5 = -6dB headroom for 5 voices)
  masterGain = new Tone.Gain(0.5);
  crossfadeGains.forEach(gain => gain.connect(masterGain));
  masterGain.toDestination();
  
  // Calculate initial frequencies from mood semitones
  _updateVoiceFrequencies();
  
  nodesInitialized = true;
  
  // Set up Transport lifecycle listener (oscillators start when Transport starts)
  _setupTransportListener();
  
  // Apply any preset data that arrived before nodes were ready
  if (pendingPresetData) {
    _applyPresetToVoices(pendingPresetData);
    pendingPresetData = null;
  }
}

// ============================================================================
// EVENT LISTENERS: Set up immediately when module loads
// ============================================================================
// These listeners are established BEFORE nodes exist to catch events during
// page initialization. If preset/journeymap events fire before initializeNodes(),
// data is stored in pendingPresetData for later application.
// ============================================================================

// Transport 'start' event → Start oscillators
let transportListenerSetup = false;
function _setupTransportListener() {
  if (transportListenerSetup) return;
  
  const Tone = ToneLib;
  if (!Tone || !Tone.Transport) return;
  
  // TONE.JS INTEGRATION: Tone.Transport.on('start')
  // Oscillators must be started explicitly when Transport begins playback
  // This ties oscillator lifecycle to Transport state (start/stop coordination)
  Tone.Transport.on('start', () => {
    if (!isPlaying) {
      try {
        leftOscs.forEach(osc => osc.start());
        rightOscs.forEach(osc => osc.start());
        isPlaying = true;
      } catch (e) {
        console.warn('Oscillators already started:', e);
      }
    }
  });
  
  transportListenerSetup = true;
}

// 'journeymapRestart' event → Re-schedule timeline
let journeymapListenerSetup = false;
function _setupJourneymapListener() {
  if (journeymapListenerSetup) return;
  
  // Called when: User drags journeymap, octave changes, or play button pressed
  // Timeline scheduler reads current DOM state and schedules frequency automation
  window.addEventListener('journeymapRestart', async (event) => {
    const timeline = event.detail?.timeline;
    
    try {
      const { scheduleJourneyTimeline } = await import('../../widgets/presets/journeymap_presets.js');
      await scheduleJourneyTimeline(timeline);
    } catch (e) {
      console.error('Error scheduling timeline:', e);
    }
  });
  
  journeymapListenerSetup = true;
}

// 'binauralPresetChanged' event → Apply preset to voices
let presetListenerSetup = false;
let pendingPresetData = null; // Stored if nodes not ready

function _setupPresetListener() {
  if (presetListenerSetup) return;
  
  // Called when: User selects binaural preset from nav buttons
  // Applies volume, octave, width, crossfade from preset JSON
  window.addEventListener('binauralPresetChanged', (event) => {
    const presetData = event.detail?.presetData;
    if (!presetData || !presetData.voices) return;
    
    if (!nodesInitialized) {
      pendingPresetData = presetData;
      return;
    }
    
    _applyPresetToVoices(presetData);
  });
  
  presetListenerSetup = true;
}

// Apply preset voice data to synth (volume, octave, width, crossfade)
function _applyPresetToVoices(presetData) {
  Object.keys(presetData.voices).forEach(voiceKey => {
    const voiceIndex = parseInt(voiceKey) - 1;
    const voiceData = presetData.voices[voiceKey];
    
    if (voiceIndex >= 0 && voiceIndex < 5) {
      // Apply stage 1: Voice fader volume
      if (voiceData.volume !== undefined) {
        setVoiceVolume(voiceIndex, voiceData.volume);
      }
      
      // Apply stage 2: ISO crossfade (calculate binaural gain from ISO ratio)
      if (voiceData.isochronic !== undefined) {
        const ISO_CROSSFADE_CURVE = 1; // Linear (1:1 mapping)
        const rawIsoRatio = voiceData.isochronic; // 0=binaural, 1=ISO
        const rawBinauralRatio = 1 - rawIsoRatio;
        const binauralRatio = Math.pow(rawBinauralRatio, ISO_CROSSFADE_CURVE);
        const binauralCrossfadeDb = binauralRatio <= 0.001 ? -Infinity : 20 * Math.log10(binauralRatio);
        setCrossfadeGain(voiceIndex, binauralCrossfadeDb);
      }
      
      // Apply octave offset
      if (voiceData.oct !== undefined) {
        setVoiceOctaveOffset(voiceIndex, voiceData.oct);
      }
      
      // Apply stereo width
      if (voiceData.stereoWidth !== undefined) {
        setVoiceWidth(parseInt(voiceKey), voiceData.stereoWidth);
      }
    }
  });
}

// Set up listeners IMMEDIATELY at module load (before nodes exist)
_setupPresetListener();
_setupJourneymapListener();

// ============================================================================
// PUBLIC API: Initialize Audio Nodes
// ============================================================================
// Must be called before playback begins. Creates Tone.js audio graph and
// starts audio context. Safe to call multiple times (idempotent).
//
// TONE.JS INTEGRATION:
// - Tone.start(): Resumes audio context (required for browser autoplay policy)
// - Tone.Transport.seconds: Reset to 0 if nodes were disposed/recreated
// ============================================================================
export async function initializeNodes() {
  // Get Tone.js from global window (loaded via <script> in index.html)
  if (!ToneLib) {
    if (!window.Tone) {
      console.error('Tone.js not found - ensure audio/Tone.js is loaded in index.html');
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
  
  // Set default carrier frequency if not set
  if (!carrierFreq) carrierFreq = 196.00; // G3
  
  // Create audio nodes
  const wasDisposed = !nodesInitialized;
  await _ensureNodes();
  
  // If nodes were recreated, re-schedule timeline from beginning
  if (wasDisposed && nodesInitialized) {
    // Reset Transport to start (critical for correct scheduling)
    if (window.Tone && window.Tone.Transport) {
      window.Tone.Transport.seconds = 0;
    }
    
    // Fire journeymapRestart to trigger timeline scheduling
    const journeyData = window.JourneymapWidget?.collectJourneyDataFromDOM();
    if (journeyData && journeyData.segments) {
      window.dispatchEvent(new CustomEvent('journeymapRestart', {
        detail: { 
          timeline: { segments: journeyData.segments },
          preset: journeyData
        }
      }));
    }
  }
  
  return true;
}

// ============================================================================
// INTERNAL: Update Voice Frequencies
// ============================================================================
// Calculates frequencies for all 5 voices using:
// - Root key (carrierFreq)
// - Mood semitones (interval pattern)
// - Octave offsets (per-voice pitch shift)
// - Binaural beat distance (L/R frequency offset)
//
// TONE.JS INTEGRATION:
// - Directly sets oscillator.frequency.value (immediate frequency change)
// - Used for: Preset loading, octave changes while stopped
// - NOT used during playback (scheduleVoiceFrequencies handles that)
// ============================================================================
function _updateVoiceFrequencies() {
  if (!scalesSystem || leftOscs.length === 0) return;
  
  currentMoodSemitones.forEach((semitone, index) => {
    if (index < leftOscs.length) {
      // Calculate frequency using just intonation
      const baseFrequency = scalesSystem.getFrequency(semitone - 1, 0);
      
      // Apply octave offset (multiply by 2^octave)
      const octaveOffset = voiceOctaveOffsets[index] || 0;
      const frequency = baseFrequency * Math.pow(2, octaveOffset);
      
      // Apply binaural beat offset (fixed Hz distance)
      const beatDistance = currentBinauralBeat;
      const leftFreq = frequency - beatDistance / 2;
      const rightFreq = frequency + beatDistance / 2;
      
      try {
        // MEMORY FIX: Use 1ms micro-ramp instead of direct .value assignment
        // Direct assignment creates setValueAtTime events that accumulate
        const now = Tone.now();
        if (leftOscs[index] && leftOscs[index].frequency) {
          leftOscs[index].frequency.cancelScheduledValues(now);
          leftOscs[index].frequency.setValueAtTime(leftOscs[index].frequency.value, now);
          leftOscs[index].frequency.linearRampToValueAtTime(leftFreq, now + 0.001);
        }
        if (rightOscs[index] && rightOscs[index].frequency) {
          rightOscs[index].frequency.cancelScheduledValues(now);
          rightOscs[index].frequency.setValueAtTime(rightOscs[index].frequency.value, now);
          rightOscs[index].frequency.linearRampToValueAtTime(rightFreq, now + 0.001);
        }
      } catch (e) {
        console.warn('Error setting voice frequencies:', e);
      }
    }
  });
}

// ============================================================================
// PUBLIC API: Schedule Timeline Frequency Changes
// ============================================================================
// CORE EXTERNAL API - Called by journeymap scheduler to automate frequencies
// over time. This is how journeys work - scheduled frequency ramps.
//
// TONE.JS INTEGRATION:
// - .setValueAtTime(value, time): Set initial frequency for first segment
// - .linearRampToValueAtTime(value, time): Smooth frequency transitions
// - .exponentialRampToValueAtTime(value, time): Curved frequency transitions
//
// All times are in seconds relative to Tone.Transport.seconds
//
// @param {Array} voiceFrequencies - Array of {voiceIndex, leftFreq, rightFreq, leftEnd, rightEnd}
// @param {number} time - Start time in seconds (Transport time)
// @param {number} duration - Segment duration in seconds
// @param {string} envelopeType - 'linear' or 'exponential'
// @param {boolean} isFirstSegment - If true, setValueAtTime (no ramp from previous)
// ============================================================================
export function scheduleVoiceFrequencies(voiceFrequencies, time, duration, envelopeType = 'linear', isFirstSegment = false) {
  if (!nodesInitialized || leftOscs.length === 0) return;
  
  voiceFrequencies.forEach(({ voiceIndex, leftFreq, rightFreq, leftEnd, rightEnd }) => {
    if (voiceIndex < leftOscs.length) {
      try {
        // CRITICAL: Cancel ALL pending automation before scheduling ANY new segment
        // This prevents timeline event accumulation during journey playback
        leftOscs[voiceIndex].frequency.cancelScheduledValues(time);
        rightOscs[voiceIndex].frequency.cancelScheduledValues(time);
        
        // First segment: Set start frequency (no ramp from previous value)
        if (isFirstSegment) {
          leftOscs[voiceIndex].frequency.setValueAtTime(leftFreq, time);
          rightOscs[voiceIndex].frequency.setValueAtTime(rightFreq, time);
        }
        
        // Ramp to end frequency (creates smooth automation curve)
        if (leftEnd !== undefined && rightEnd !== undefined) {
          if (envelopeType === "linear") {
            leftOscs[voiceIndex].frequency.linearRampToValueAtTime(leftEnd, time + duration);
            rightOscs[voiceIndex].frequency.linearRampToValueAtTime(rightEnd, time + duration);
          } else {
            leftOscs[voiceIndex].frequency.exponentialRampToValueAtTime(leftEnd, time + duration);
            rightOscs[voiceIndex].frequency.exponentialRampToValueAtTime(rightEnd, time + duration);
          }
        }
      } catch (e) {
        console.warn(`Error scheduling voice ${voiceIndex}:`, e);
      }
    }
  });
}

// ============================================================================
// PUBLIC API: Stop Playback
// ============================================================================
// Stops oscillators and disposes all nodes. Next play will recreate nodes.
//
// TONE.JS INTEGRATION:
// - oscillator.stop(): Stops oscillator (cannot be restarted)
// - node.dispose(): Frees Web Audio resources
// ============================================================================
export function stop() {
  if (!isPlaying) return;
  
  try {
    leftOscs.forEach(osc => osc.stop());
    rightOscs.forEach(osc => osc.stop());
  } catch (e) {
    // Oscillators may already be stopped
  }
  
  // Dispose all nodes (Web Audio resource cleanup)
  try {
    leftOscs.forEach(osc => {
      if (osc && typeof osc.dispose === 'function') osc.dispose();
    });
    rightOscs.forEach(osc => {
      if (osc && typeof osc.dispose === 'function') osc.dispose();
    });
    pannersL.forEach(panner => {
      if (panner && typeof panner.dispose === 'function') panner.dispose();
    });
    pannersR.forEach(panner => {
      if (panner && typeof panner.dispose === 'function') panner.dispose();
    });
    voiceGains.forEach(gain => {
      if (gain && typeof gain.dispose === 'function') gain.dispose();
    });
    crossfadeGains.forEach(gain => {
      if (gain && typeof gain.dispose === 'function') gain.dispose();
    });
  } catch (e) {}
  
  // Reset state
  leftOscs = [];
  rightOscs = [];
  pannersL = [];
  pannersR = [];
  voiceGains = [];
  crossfadeGains = [];
  masterGain = null;
  nodesInitialized = false;
  isPlaying = false;
}

// ============================================================================
// PUBLIC API: Getters and Setters
// ============================================================================
// These functions control voice parameters and can be called at any time.
// If nodes don't exist, values are stored in state arrays for later application.
//
// TONE.JS INTEGRATION:
// - gain.gain.rampTo(value, time, startTime, units): Smooth volume transitions
//   - time: Ramp duration (0.05s = 50ms for smooth but responsive changes)
//   - startTime: "+0" = start immediately
//   - units: "decibels" = logarithmic volume scaling (natural perception)
// - panner.pan.value: Direct property assignment (immediate stereo positioning)
// ============================================================================

export function getIsPlaying() {
  return isPlaying;
}

export function setCarrierFrequency(frequency) {
  if (typeof frequency !== 'number' || frequency <= 0) return;
  
  carrierFreq = frequency;
  
  if (scalesSystem) {
    scalesSystem.setBaseFrequency(frequency);
  }
  
  if (nodesInitialized) {
    _updateVoiceFrequencies();
  }
}

// Get the current carrier frequency
export function getCarrierFrequency() {
  return carrierFreq;
}

// Set the mood semitones for voice frequency calculation
export function setMoodSemitones(semitones) {
  if (!Array.isArray(semitones) || semitones.length !== 5) return;
  
  currentMoodSemitones = [...semitones];
  
  if (nodesInitialized) {
    _updateVoiceFrequencies();
  }
}

// Get the current mood semitones
export function getMoodSemitones() {
  return [...currentMoodSemitones];
}

// Set the binaural beat distance in Hz (from journeymap or preset)
export function setBinauralBeat(beatHz) {
  if (typeof beatHz === 'number' && beatHz >= 0) {
    currentBinauralBeat = beatHz;
    
    if (nodesInitialized) {
      _updateVoiceFrequencies();
    }
  }
}

// Get the current binaural beat distance in Hz
export function getBinauralBeat() {
  return currentBinauralBeat;
}

// Get the current actual binaural beat frequency by reading oscillator frequencies
export function getCurrentBinauralBeat() {
  if (!nodesInitialized || leftOscs.length === 0 || rightOscs.length === 0) {
    return currentBinauralBeat;
  }
  
  try {
    // Read the actual frequency difference from the first voice
    const leftFreq = leftOscs[0].frequency.value;
    const rightFreq = rightOscs[0].frequency.value;
    const actualBeat = Math.abs(rightFreq - leftFreq);
    return actualBeat;
  } catch (e) {
    return currentBinauralBeat;
  }
}

// Get the current voice octave offsets
export function getVoiceOctaveOffsets() {
  return [...voiceOctaveOffsets];
}

// Set octave offset for a specific voice
export function setVoiceOctaveOffset(voiceIndex, octaveOffset) {
  if (voiceIndex < 0 || voiceIndex >= voiceOctaveOffsets.length) return;
  if (octaveOffset < -2 || octaveOffset > 2) return;
  
  // Store octave offset - journeymap scheduler reads this via getVoiceOctaveOffsets()
  voiceOctaveOffsets[voiceIndex] = octaveOffset;
  
  // If NOT playing, update frequencies immediately (binaural preset tweaking)
  if (!isPlaying && nodesInitialized) {
    _updateVoiceFrequencies();
  }
  
  // If playing, rewind to start and re-schedule with new octaves (PRAGMATIC SOLUTION)
  // TODO: Future optimization - re-schedule from current position without restart
  if (isPlaying) {
    restartTimelineWithNewOctaves();
  }
}

// Restart timeline from beginning with updated octave offsets (called when octaves change during playback)
async function restartTimelineWithNewOctaves() {
  try {
    const Tone = window.Tone;
    if (!Tone || !Tone.Transport) return;
    
    // Rewind to start (Plateau 1)
    Tone.Transport.seconds = 0;
    
    // Get current journeymap data from DOM
    const journeyData = window.JourneymapWidget?.collectJourneyDataFromDOM();
    if (!journeyData) {
      console.warn('⚠️ No journeymap data to restart with new octaves');
      return;
    }
    
    // Fire journeymapRestart event to trigger re-scheduling (event-driven architecture)
    // The listener will read the new octave offsets via getVoiceOctaveOffsets()
    window.dispatchEvent(new CustomEvent('journeymapRestart', {
      detail: { 
        timeline: { segments: journeyData.segments },
        preset: journeyData
      }
    }));
    
    console.log('✅ Timeline restart triggered with new octave offsets');
  } catch (e) {
    console.error('❌ Failed to restart timeline:', e);
  }
}

/**
 * Set stereo width for a specific voice
 * TONE.JS: Directly sets panner.pan.value (-1 to +1)
 * 
 * @param {number} voiceIndex - Voice number (1-5)
 * @param {number} widthFactor - Width (0.0=mono, 1.0=full stereo)
 */
export function setVoiceWidth(voiceIndex, widthFactor) {
  if (voiceIndex < 1 || voiceIndex > 5) return;
  
  widthFactor = Math.max(0.0, Math.min(1.0, widthFactor));
  const voiceIdx = voiceIndex - 1;
  
  voiceWidths[voiceIdx] = widthFactor;
  
  if (!nodesInitialized) return;
  
  const leftPanner = pannersL[voiceIdx];
  const rightPanner = pannersR[voiceIdx];
  
  if (leftPanner && rightPanner) {
    // MEMORY FIX: Use 1ms micro-ramp instead of direct .value assignment
    const now = Tone.now();
    leftPanner.pan.cancelScheduledValues(now);
    leftPanner.pan.setValueAtTime(leftPanner.pan.value, now);
    leftPanner.pan.linearRampToValueAtTime(-widthFactor, now + 0.001);
    
    rightPanner.pan.cancelScheduledValues(now);
    rightPanner.pan.setValueAtTime(rightPanner.pan.value, now);
    rightPanner.pan.linearRampToValueAtTime(widthFactor, now + 0.001);
  }
}

/**
 * Get current stereo width for a specific voice
 * 
 * @param {number} voiceIndex - Voice number (1-5)
 * @returns {number} Width (0.0=mono, 1.0=full stereo)
 */
export function getVoiceWidth(voiceIndex) {
  if (voiceIndex < 1 || voiceIndex > 5 || !nodesInitialized) return 1.0;
  
  const voiceIdx = voiceIndex - 1;
  const rightPanner = pannersR[voiceIdx];
  
  if (rightPanner) {
    return Math.abs(rightPanner.pan.value);
  }
  
  return 1.0;
}

// ============================================================================
// UTILITY: Volume Conversion Helpers
// ============================================================================
export function linearToDecibels(linear) {
  return linear > 0 ? 20 * Math.log10(linear) : -60;
}

export function decibelsToLinear(db) {
  return Math.pow(10, db / 20);
}

// Set individual voice volume (stage 1 gain)
// TONE.JS: Uses .rampTo() for smooth transitions with decibel units
export function setVoiceVolume(voiceIndex, volumeDb) {
  if (voiceIndex < 0 || voiceIndex >= voiceVolumes.length) return;
  
  voiceVolumes[voiceIndex] = volumeDb;
  
  if (!nodesInitialized || voiceIndex >= voiceGains.length) return;
  
  try {
    const now = Tone.now();
    voiceGains[voiceIndex].gain.cancelScheduledValues(now);
    voiceGains[voiceIndex].gain.setValueAtTime(voiceGains[voiceIndex].gain.value, now);
    voiceGains[voiceIndex].gain.linearRampToValueAtTime(volumeDb, now + 0.001);
  } catch (e) {
    console.warn(`Error setting voice ${voiceIndex + 1} volume:`, e);
  }
}

// Set individual voice crossfade gain (stage 2 gain - ISO blend)
// TONE.JS: Uses .rampTo() for smooth transitions with decibel units
export function setCrossfadeGain(voiceIndex, crossfadeDb) {
  if (voiceIndex < 0 || voiceIndex >= 5) return;
  
  voiceCrossfadeGainValues[voiceIndex] = crossfadeDb;
  
  if (!nodesInitialized || voiceIndex >= crossfadeGains.length) return;
  
  try {
    const now = Tone.now();
    crossfadeGains[voiceIndex].gain.cancelScheduledValues(now);
    crossfadeGains[voiceIndex].gain.setValueAtTime(crossfadeGains[voiceIndex].gain.value, now);
    crossfadeGains[voiceIndex].gain.linearRampToValueAtTime(crossfadeDb, now + 0.001);
  } catch (e) {
    console.warn(`Error setting voice ${voiceIndex + 1} crossfade:`, e);
  }
}

// Get current voice volumes (for debugging/UI feedback)
export function getVoiceVolumes() {
  if (!nodesInitialized || voiceGains.length === 0) return [];
  
  return voiceGains.map((gain, index) => {
    try {
      const gainValue = gain.gain.value;
      const linearVolume = Math.pow(10, gainValue / 20);
      return {
        decibels: gainValue,
        linear: linearVolume,
        index: index + 1
      };
    } catch (e) {
      return {
        decibels: -60,
        linear: 0,
        index: index + 1
      };
    }
  });
}

// ============================================================================
// GLOBAL EXPOSURE: For cross-widget communication
// ============================================================================
// Exposes key functions globally so other widgets (isochronic, journeymap)
// can access binaural state without importing the module
// ============================================================================
if (typeof window !== 'undefined') {
  window.BinauralSynth = window.BinauralSynth || {};
  window.BinauralSynth.setBinauralBeat = setBinauralBeat;
  window.BinauralSynth.getBinauralBeat = getBinauralBeat;
  window.BinauralSynth.getCurrentBinauralBeat = getCurrentBinauralBeat;
  window.BinauralSynth.setCarrierFrequency = setCarrierFrequency;
  window.BinauralSynth.getCarrierFrequency = getCarrierFrequency;
}