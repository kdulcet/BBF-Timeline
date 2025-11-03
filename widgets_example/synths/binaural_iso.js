// widgets/synths/binaural_iso.js
// Isochronic tone pulses - rhythmic sine wave bursts synced to Transport BPM
// MIRRORS binaural_synth architecture: same root, same mood, same scales, same octaves
// From user perspective: part of unified binaural/isochronic channel

// Import scales system for just intonation calculations (SAME AS BINAURAL)
import '../../audio/scales.js'; // Ensures window.Scales is available

// KILL SWITCH: Set to false to disable ISO synth entirely (for debugging/testing)
const ISO_ENABLED = true;

let ToneLib = null;
let isoOscsL = []; // Left oscillators (5 always-on sine waves)
let isoOscsR = []; // Right oscillators (5 always-on sine waves)
let isoGateGainsL = []; // Left gate gain envelopes (pulsing control)
let isoGateGainsR = []; // Right gate gain envelopes (pulsing control)
let pannersL = [];
let pannersR = [];
let voiceGains = []; // Main fader volume (stage 1)
let crossfadeGains = []; // ISO crossfade volume (stage 2)
let masterGain = null;
let gateLoops = []; // One loop per voice
let nodesInitialized = false;

// Voice state - MIRRORS binaural_synth (dynamic, not hardcoded!)
let carrierFreq = null; // Root key (SAME as binaural)
let currentMoodSemitones = [1, 4, 7, 11, 14]; // Mood (SAME as binaural)
let voiceOctaveOffsets = [0, 0, 0, 0, 0]; // Octave offsets (SAME as binaural)
let voiceWidths = [1.0, 1.0, 1.0, 1.0, 1.0]; // Stereo width
let voiceVolumes = [-70, -70, -70, -70, -70]; // All silent until preset/crossfade sets levels
let voicePulseLengths = [0.4, 0.4, 0.4, 0.4, 0.4]; // Pulse duty cycle (20%-60% range, default 40%)
let scalesSystem = null; // Just intonation system (SAME as binaural)

// MEMORY FIX: Use setValueAtTime instead of linearRampToValueAtTime to prevent AudioParam accumulation

// Preset listener state (MUST be declared before setup functions)
let presetListenerSetup = false;
let pendingPresetData = null;

// Set up event listeners IMMEDIATELY when module loads
_setupTransportListener();
_setupPresetListener();

function _setupTransportListener() {
  window.addEventListener('transportPlay', async () => {
    await play();
  });
  
  // NOTE: Commented out to allow seamless octave changes
  // Loops will run continuously once started, regardless of Transport state
  // window.addEventListener('transportStop', () => {
  //   console.log('🎵 ISO: transportStop event received');
  //   stop();
  // });
  
  // Listen for journeymap changes (octave changes trigger timeline re-schedule)
  // Restart loops to maintain pulsing through octave transitions
  window.addEventListener('journeymapRestart', () => {
    // Only restart if nodes are initialized and Transport is running
    if (nodesInitialized && window.Tone?.Transport?.state === 'started') {
      // CRITICAL: Wait for Transport BPM to be updated by scheduler
      // Otherwise loops restart with OLD BPM timing
      setTimeout(() => {
        gateLoops.forEach((loop, i) => {
          loop.stop();
          loop.start(0);
        });
        console.log('🎵 ISO: Loops restarted after BPM update');
      }, 200); // Increased delay to ensure BPM is fully updated
    }
  });
}

// Listen for preset changes and apply octave/width to isochronic voices
function _setupPresetListener() {
  if (presetListenerSetup) return;
  
  window.addEventListener('binauralPresetChanged', (event) => {
    const presetData = event.detail?.presetData;
    console.log('🎵 ISO: binauralPresetChanged event received', presetData);
    if (!presetData || !presetData.voices) {
      console.warn('🎵 ISO: No valid preset data');
      return;
    }
    
    if (!nodesInitialized) {
      console.warn('🎵 ISO: Nodes not initialized, storing preset data for later');
      pendingPresetData = presetData;
      return;
    }
    
    console.log('🎵 ISO: Applying preset to voices');
    _applyPresetToVoices(presetData);
  });
  
  presetListenerSetup = true;
}

// Apply preset octave offsets and stereo widths to isochronic voices
function _applyPresetToVoices(presetData) {
  Object.keys(presetData.voices).forEach(voiceKey => {
    const voiceIndex = parseInt(voiceKey) - 1;
    const voiceData = presetData.voices[voiceKey];
    
    if (voiceIndex >= 0 && voiceIndex < 5) {
      // Apply volume (voice gain - stage 1)
      if (voiceData.volume !== undefined) {
        const volumeDb = (voiceData.volume < 0 || voiceData.volume > 1)
          ? voiceData.volume  // Already in dB
          : (voiceData.volume > 0 ? 20 * Math.log10(voiceData.volume) : -70); // Convert linear to dB
        setVoiceVolume(voiceIndex, volumeDb);
      }
      
      // Apply crossfade (ISO fader - stage 2)
      if (voiceData.isochronic !== undefined) {
        // Calculate ISO crossfade gain from isochronic ratio (0 = binaural, 1 = ISO)
        // Gentle curve = smooth blend in middle
        const ISO_CROSSFADE_CURVE = .3; // Linear for now
        const ISO_MAKEUP_GAIN_DB = 0; // No makeup gain - let it be equal power
        const rawIsoRatio = voiceData.isochronic;
        const isoRatio = Math.pow(rawIsoRatio, 1 / ISO_CROSSFADE_CURVE);
        const isoCrossfadeDb = isoRatio <= 0.001 ? -Infinity : (20 * Math.log10(isoRatio) + ISO_MAKEUP_GAIN_DB);
        console.log(`🎚️ ISO V${voiceIndex + 1}: rawIso=${rawIsoRatio.toFixed(2)}, ratio=${isoRatio.toFixed(3)}, dB=${isoCrossfadeDb.toFixed(1)}`);
        setCrossfadeGain(voiceIndex, isoCrossfadeDb);
      }
      
      // Apply octave offset
      if (voiceData.oct !== undefined) {
        setVoiceOctaveOffset(voiceIndex, voiceData.oct);
      }
      
      // Apply stereo width
      if (voiceData.stereoWidth !== undefined) {
        setVoiceWidth(voiceIndex, voiceData.stereoWidth);
      }
      
      // Apply pulse length (dutycycle)
      if (voiceData.dutycycle !== undefined) {
        console.log(`🎚️ ISO V${voiceIndex + 1}: dutycycle=${voiceData.dutycycle.toFixed(2)}`);
        setPulseLength(voiceIndex, voiceData.dutycycle);
      }
    }
  });
}

// Update voice frequencies using scales system (MIRRORS binaural_synth)
function _updateVoiceFrequencies() {
  if (!scalesSystem) {
    console.warn('🎵 ISO: scalesSystem not initialized');
    return;
  }
  
  // Calculate and set frequencies for all 5 voices
  const now = Tone.now(); // MEMORY FIX: Calculate once for all voices
  currentMoodSemitones.forEach((semitone, index) => {
    const baseFrequency = scalesSystem.getFrequency(semitone - 1, 0);
    const octaveOffset = voiceOctaveOffsets[index] || 0;
    const frequency = baseFrequency * Math.pow(2, octaveOffset);
    
    if (index < 5) {
      // Set frequencies for BOTH L and R synths
      try {
        // MEMORY FIX: Use setValueAtTime (not linearRamp) to prevent AudioParam accumulation
        if (isoSynthsL[index] && isoSynthsL[index].oscillator) {
          isoSynthsL[index].oscillator.frequency.cancelScheduledValues(now);
          isoSynthsL[index].oscillator.frequency.setValueAtTime(frequency, now);
        } else {
          console.warn(`  ❌ synthL[${index}] or oscillator not found!`);
        }
        if (isoSynthsR[index] && isoSynthsR[index].oscillator) {
          isoSynthsR[index].oscillator.frequency.cancelScheduledValues(now);
          isoSynthsR[index].oscillator.frequency.setValueAtTime(frequency, now);
        } else {
          console.warn(`  ❌ synthR[${index}] or oscillator not found!`);
        }
      } catch (e) {
        console.warn('🎵 ISO: Error setting voice frequencies:', e);
      }
    }
  });
}

async function _initializeNodes() {
  if (nodesInitialized) return true;
  
  if (!ToneLib) {
    if (!window.Tone) {
      console.error('🎵 ISO: Tone.js not available');
      return false;
    }
    ToneLib = window.Tone;
  }
  const Tone = ToneLib;
  
  // Set default carrier frequency if not set (MUST MATCH binaural_synth)
  if (!carrierFreq) carrierFreq = 196.00; // Default to G3
  
  // Initialize scales system if not already done (SAME AS BINAURAL)
  if (!scalesSystem && window.Scales) {
    scalesSystem = new window.Scales();
    scalesSystem.setScale('just');
    // Set base frequency from current carrierFreq (now guaranteed to be 196.0)
    scalesSystem.setBaseFrequency(carrierFreq);
  }
  
  try {
    // Create 5 voice pairs
    for (let i = 0; i < 5; i++) {
      // Create L/R always-on oscillators (started once, gate controlled by gain envelope)
      const oscL = new Tone.Oscillator({
        frequency: 440, // Initial frequency (will be updated by loop)
        type: 'sine'
      });
      
      const oscR = new Tone.Oscillator({
        frequency: 440, // Initial frequency (will be updated by loop)
        type: 'sine'
      });
      
      // Create gate gain nodes (manual envelope for pulsing)
      const gateGainL = new Tone.Gain(0); // Start silent
      const gateGainR = new Tone.Gain(0); // Start silent
      
      // Create panners using stored width values
      const pannerL = new Tone.Panner(-voiceWidths[i]);
      const pannerR = new Tone.Panner(voiceWidths[i]);
      
      // Create SEPARATE L/R gain paths to prevent summing
      // Stage 1: Voice gain (main fader volume)
      const voiceGainL = new Tone.Gain(voiceVolumes[i], "decibels");
      const voiceGainR = new Tone.Gain(voiceVolumes[i], "decibels");
      
      // Stage 2: Crossfade gain (ISO fader)
      const crossfadeGainL = new Tone.Gain(0, "decibels");
      const crossfadeGainR = new Tone.Gain(0, "decibels");
      
      // Connect SEPARATE signal chains: oscL → gateGainL → pannerL → voiceGainL → crossfadeGainL
      //                                  oscR → gateGainR → pannerR → voiceGainR → crossfadeGainR
      oscL.connect(gateGainL);
      oscR.connect(gateGainR);
      gateGainL.connect(pannerL);
      gateGainR.connect(pannerR);
      pannerL.connect(voiceGainL);
      pannerR.connect(voiceGainR);
      voiceGainL.connect(crossfadeGainL);
      voiceGainR.connect(crossfadeGainR);
      
      // Store references (L/R pairs stored as objects)
      isoOscsL.push(oscL);
      isoOscsR.push(oscR);
      isoGateGainsL.push(gateGainL);
      isoGateGainsR.push(gateGainR);
      pannersL.push(pannerL);
      pannersR.push(pannerR);
      voiceGains.push({ L: voiceGainL, R: voiceGainR });
      crossfadeGains.push({ L: crossfadeGainL, R: crossfadeGainR });
      
      // Create Tone.Loop for this voice (manual gain envelope, zero memory leak)
      const voiceIndex = i; // Capture index for closure
      const loop = new Tone.Loop((time) => {
        const oscL = isoOscsL[voiceIndex];
        const oscR = isoOscsR[voiceIndex];
        const gateGainL = isoGateGainsL[voiceIndex];
        const gateGainR = isoGateGainsR[voiceIndex];
        
        // Calculate L/R frequencies using binaural beat offset (SAME AS BINAURAL)
        const semitone = currentMoodSemitones[voiceIndex] || 1;
        const baseFrequency = scalesSystem.getFrequency(semitone - 1, 0);
        const octaveOffset = voiceOctaveOffsets[voiceIndex] || 0;
        const centerFrequency = baseFrequency * Math.pow(2, octaveOffset);
        
        // Get current binaural beat from binaural_synth (dynamic, from journeymap)
        const beatDistance = window.BinauralSynth?.getCurrentBinauralBeat?.() || 4.0;
        
        // Split frequency with beat offset (MIRRORS binaural_synth calculation)
        const leftFreq = centerFrequency - beatDistance / 2;
        const rightFreq = centerFrequency + beatDistance / 2;
        
        // Safety check: ensure frequencies are in valid range (20Hz - 20kHz)
        if (leftFreq < 20 || leftFreq > 20000 || rightFreq < 20 || rightFreq > 20000) {
          console.warn(`🎵 ISO Voice ${voiceIndex + 1}: Frequency out of range (L:${leftFreq.toFixed(2)}Hz, R:${rightFreq.toFixed(2)}Hz) - skipping pulse`);
          return;
        }
        
        // Update oscillator frequencies (smooth transition, no clicks)
        oscL.frequency.setValueAtTime(leftFreq, time);
        oscR.frequency.setValueAtTime(rightFreq, time);
        
        // PING-PONG: L triggers at start of cycle, R triggers at midpoint
        // Loop interval = 16n, so halfInterval = 32n
        const loopInterval = Tone.Time('16n').toSeconds();
        const halfInterval = loopInterval / 2; // This is 32n in seconds
        
        // Calculate pulse duration based on pulse length (20%-60% of half-interval)
        const pulseLength = voicePulseLengths[voiceIndex] || 0.4; // Default 40%
        const pulseDuration = halfInterval * pulseLength;
        
        // Envelope timing (smooth attack/release to prevent clicks)
        const attack = 0.002;  // 2ms attack
        const release = 0.002; // 2ms release
        const sustainDuration = pulseDuration - attack - release;
        
        try {
          // ============================================================
          // LEFT PULSE (at time)
          // ============================================================
          // Cancel any previous automation at THIS pulse's start time
          gateGainL.gain.cancelScheduledValues(time);
          
          // Attack: 0 → 1 (smooth ramp)
          gateGainL.gain.setValueAtTime(0, time);
          gateGainL.gain.linearRampToValueAtTime(1, time + attack);
          
          // Sustain (hold at 1)
          gateGainL.gain.setValueAtTime(1, time + attack + sustainDuration);
          
          // Release: 1 → 0 (smooth ramp)
          gateGainL.gain.linearRampToValueAtTime(0, time + pulseDuration);
          
          // ============================================================
          // RIGHT PULSE (at time + halfInterval)
          // ============================================================
          const rightStartTime = time + halfInterval;
          
          // Cancel any previous automation at THIS pulse's start time
          gateGainR.gain.cancelScheduledValues(rightStartTime);
          
          // Attack: 0 → 1 (smooth ramp)
          gateGainR.gain.setValueAtTime(0, rightStartTime);
          gateGainR.gain.linearRampToValueAtTime(1, rightStartTime + attack);
          
          // Sustain (hold at 1)
          gateGainR.gain.setValueAtTime(1, rightStartTime + attack + sustainDuration);
          
          // Release: 1 → 0 (smooth ramp)
          gateGainR.gain.linearRampToValueAtTime(0, rightStartTime + pulseDuration);
          
        } catch (e) {
          console.error(`🎵 ISO Voice ${voiceIndex + 1}: Gate envelope error:`, e);
        }
      }, '16n');
      
      gateLoops.push(loop);
    }
    
    // Create master gain and connect all L/R crossfade gains to it
    masterGain = new Tone.Gain(0.7);
    crossfadeGains.forEach(gainPair => {
      gainPair.L.connect(masterGain);
      gainPair.R.connect(masterGain);
    });
    masterGain.toDestination();
    
    // Set initial frequencies using mood semitones and just intonation (SAME AS BINAURAL)
    _updateVoiceFrequencies();
    
    // Start all oscillators (always-on, gate gains control pulsing)
    isoOscsL.forEach(osc => osc.start());
    isoOscsR.forEach(osc => osc.start());
    
  nodesInitialized = true;
  
  // Apply any pending preset data that arrived before nodes were ready
  if (pendingPresetData) {
    _applyPresetToVoices(pendingPresetData);
    pendingPresetData = null;
  }    return true;
  } catch (e) {
    console.error('🎵 ISO: Failed to initialize:', e);
    return false;
  }
}

export async function play() {
  // KILL SWITCH: Early exit if ISO disabled
  if (!ISO_ENABLED) {
    console.log('🎵 ISO: Disabled via ISO_ENABLED flag');
    return false;
  }
  
  if (!nodesInitialized) {
    const initialized = await _initializeNodes();
    if (!initialized) return false;
  }
  
  try {
    // Wait for timeline scheduling to complete
    setTimeout(() => {
      if (window.Tone.Transport.state === 'started') {
        // Restart all loops (handles both initial start and re-starts after octave changes)
        gateLoops.forEach((loop, i) => {
          // Stop first if already running, then restart from Transport position
          loop.stop();
          loop.start(0);
        });
      }
    }, 100);
    
    return true;
  } catch (e) {
    console.error('🎵 ISO: Failed to start:', e);
    return false;
  }
}

export function stop() {
  if (!nodesInitialized) return;
  
  try {
    // Stop all loops (but don't dispose - octave changes re-schedule without restarting)
    gateLoops.forEach(loop => loop.stop());
    
    // Stop all oscillators (manual envelope technique requires explicit stop)
    isoOscsL.forEach(osc => osc.stop());
    isoOscsR.forEach(osc => osc.stop());
    
    // NOTE: Nodes are NOT disposed to allow seamless octave changes
    // Loops will restart automatically when Transport resumes
    
    console.log('🎵 ISO: Loops + oscillators stopped (nodes preserved for seamless re-start)');
  } catch (e) {
    console.error('🎵 ISO: Error stopping:', e);
  }
}

// Set the carrier frequency (root key) - MIRRORS binaural_synth
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

// Get the current carrier frequency - MIRRORS binaural_synth
export function getCarrierFrequency() {
  return carrierFreq;
}

// Set the mood semitones - MIRRORS binaural_synth
export function setMoodSemitones(semitones) {
  if (!Array.isArray(semitones) || semitones.length !== 5) return;
  
  currentMoodSemitones = [...semitones];
  
  if (nodesInitialized) {
    _updateVoiceFrequencies();
  }
}

// Get the current mood semitones - MIRRORS binaural_synth
export function getMoodSemitones() {
  return [...currentMoodSemitones];
}

// Set octave offset for a specific voice - MIRRORS binaural_synth
export function setVoiceOctaveOffset(voiceIndex, octaveOffset) {
  if (voiceIndex < 0 || voiceIndex >= voiceOctaveOffsets.length) return;
  if (octaveOffset < -2 || octaveOffset > 2) return;
  
  voiceOctaveOffsets[voiceIndex] = octaveOffset;
  
  // NOTE: _updateVoiceFrequencies() removed - Loop callback recalculates dynamically
  // Oscillator.frequency is ignored when passing explicit freq to triggerAttackRelease()
}

// Get the current voice octave offsets - MIRRORS binaural_synth
export function getVoiceOctaveOffsets() {
  return [...voiceOctaveOffsets];
}

// Set voice stereo width (0.0 = mono, 1.0 = full ping-pong)
export function setVoiceWidth(voiceIndex, widthFactor) {
  if (voiceIndex < 0 || voiceIndex >= 5) return;
  
  widthFactor = Math.max(0.0, Math.min(1.0, widthFactor));
  voiceWidths[voiceIndex] = widthFactor;
  
  if (!nodesInitialized) return;
  
  try {
    // MEMORY FIX: Use setValueAtTime (not linearRamp) to prevent AudioParam accumulation
    const now = Tone.now();
    pannersL[voiceIndex].pan.cancelScheduledValues(now);
    pannersL[voiceIndex].pan.setValueAtTime(-widthFactor, now);
    
    pannersR[voiceIndex].pan.cancelScheduledValues(now);
    pannersR[voiceIndex].pan.setValueAtTime(widthFactor, now);
  } catch (e) {
    console.warn(`🎵 ISO: Error setting voice ${voiceIndex + 1} width:`, e);
  }
}

// Set voice volume (in dB)
export function setVoiceVolume(voiceIndex, volumeDb) {
  if (voiceIndex < 0 || voiceIndex >= 5) return;
  
  voiceVolumes[voiceIndex] = volumeDb;
  
  if (!nodesInitialized) return;
  
  try {
    // MEMORY FIX: Use setValueAtTime (not linearRamp) to prevent AudioParam accumulation
    const now = Tone.now();
    // Apply to BOTH L and R gains
    const gainPair = voiceGains[voiceIndex];
    gainPair.L.gain.cancelScheduledValues(now);
    gainPair.L.gain.setValueAtTime(volumeDb, now);
    gainPair.R.gain.cancelScheduledValues(now);
    gainPair.R.gain.setValueAtTime(volumeDb, now);
  } catch (e) {
    console.warn(`🎵 ISO: Error setting voice ${voiceIndex + 1} volume:`, e);
  }
}

// Set crossfade gain (in dB) - separate from voice volume
export function setCrossfadeGain(voiceIndex, crossfadeDb) {
  if (voiceIndex < 0 || voiceIndex >= 5) return;
  
  if (!nodesInitialized) return;
  
  try {
    // MEMORY FIX: Use setValueAtTime (not linearRamp) to prevent AudioParam accumulation
    const now = Tone.now();
    // Apply to BOTH L and R gains
    const gainPair = crossfadeGains[voiceIndex];
    gainPair.L.gain.cancelScheduledValues(now);
    gainPair.L.gain.setValueAtTime(crossfadeDb, now);
    gainPair.R.gain.cancelScheduledValues(now);
    gainPair.R.gain.setValueAtTime(crossfadeDb, now);
  } catch (e) {
    console.warn(`🎵 ISO: Error setting voice ${voiceIndex + 1} crossfade:`, e);
  }
}

// Set pulse length (duty cycle: 0.2 to 0.6, meaning 20% to 60% of half-interval)
export function setPulseLength(voiceIndex, lengthRatio) {
  if (voiceIndex < 0 || voiceIndex >= 5) return;
  
  // Clamp to 20%-60% range
  lengthRatio = Math.max(0.2, Math.min(0.7, lengthRatio));
  voicePulseLengths[voiceIndex] = lengthRatio;
  
  // No need to update nodes - will take effect on next loop iteration
}

// Get current voice widths (for debugging/UI)
export function getVoiceWidths() {
  return [...voiceWidths];
}

// Get current voice volumes (for debugging/UI)
export function getVoiceVolumes() {
  return [...voiceVolumes];
}

// Expose key functions globally (MIRRORS binaural_synth pattern)
if (typeof window !== 'undefined') {
  window.IsochronicSynth = window.IsochronicSynth || {};
  window.IsochronicSynth.setCarrierFrequency = setCarrierFrequency;
  window.IsochronicSynth.getCarrierFrequency = getCarrierFrequency;
  window.IsochronicSynth.setMoodSemitones = setMoodSemitones;
  window.IsochronicSynth.getMoodSemitones = getMoodSemitones;
  window.IsochronicSynth.setVoiceOctaveOffset = setVoiceOctaveOffset;
  window.IsochronicSynth.getVoiceOctaveOffsets = getVoiceOctaveOffsets;
}
