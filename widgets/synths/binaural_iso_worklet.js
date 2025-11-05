/**
 * ============================================================================
 * BINAURAL-ISO COMBINED WORKLET
 * ============================================================================
 * 
 * PURPOSE:
 * Combines binaural continuous tones + ISO discrete pulses in single worklet
 * for perfect synchronization. Both systems calculate from identical journey
 * map segments at identical sample boundaries, eliminating transition drift.
 * 
 * ARCHITECTURE:
 * - Single process() call handles both systems
 * - Binaural: Continuous L/R sine waves (carrier ± beatHz/2)
 * - ISO: LFO phase-wrap discrete pulses with randomized frequency
 * - Crossfader: Constant-power mixing between systems (0.0-1.0)
 * - Identical Hz calculation: Both use same getHzAt() at same sample index
 * 
 * ISO FREQUENCY RANDOMIZATION:
 * - Instead of strict carrier ± beatHz/2 alternation, frequency is randomized
 * - Random offset within ±(beatHz/2) range, scaled by ISO_FREQUENCY_RANDOMIZATION
 * - Improves mono compatibility and creates smoother perceptual consistency
 * - Channel alternation (L/R) preserved for stereo positioning
 * 
 * CONTROLS:
 * - Volume: Master gain (0.0-1.0 normalized)
 * - Crossfade: 0.0=binaural, 0.5=50/50, 1.0=ISO
 * - Duty Cycle: ISO pulse duration (0.5-2.0+, default 1.5)
 * - Carrier Octave: Frequency multiplier (-2 to +2 octaves)
 * - Width: Stereo field (0.0-1.0, constant-power panning)
 * 
 * PRESERVED FROM lfo-event BRANCH:
 * - Cosine easing transitions (smooth S-curves)
 * - LFO phase-wrap triggering (beatPhase 0→2π)
 * - Duty cycle system (1.5 default, runtime adjustable)
 * - Constant-power stereo width control
 * 
 * ============================================================================
 */

/**
 * ============================================================================
 * CONFIGURATION
 * ============================================================================
 */

// Default duty cycle for ISO pulses (0.3-1.75 range, adjustable via UI)
const DEFAULT_DUTY_CYCLE = 0.5;

// ISO Pulse Frequency Randomization (0.0 = no randomization, 1.0 = full ±beatHz/2 range)
// This creates pitch variation for mono compatibility and smoother perception
const ISO_FREQUENCY_RANDOMIZATION = 0.0;  // 50% of the beatHz/2 range

// Number of voices (5-voice architecture for production preset compatibility)
const NUM_VOICES = 5;

/**
 * ============================================================================
 * HELPER FUNCTIONS - Journey Map Calculations
 * ============================================================================
 * Inlined from jm_worklet_helper.js (AudioWorklets cannot import modules)
 */

/**
 * Compile raw segments with absolute timing
 */
function compileSegments(segments) {
  const compiled = [];
  let absoluteTime = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const startTime = absoluteTime;
    const endTime = absoluteTime + seg.durationSeconds;

    if (seg.type === 'plateau') {
      compiled.push({
        type: 'plateau',
        hz: seg.hz,
        duration: seg.durationSeconds,
        startTime: startTime,
        endTime: endTime,
        index: i
      });
    } else if (seg.type === 'transition') {
      compiled.push({
        type: 'transition',
        startHz: seg.startHz,
        endHz: seg.endHz,
        duration: seg.durationSeconds,
        startTime: startTime,
        endTime: endTime,
        index: i
      });
    }

    absoluteTime += seg.durationSeconds;
  }

  return compiled;
}

/**
 * Find segment at given time (binary search for performance)
 */
function findSegmentAt(compiledSegments, timeSeconds) {
  for (let i = compiledSegments.length - 1; i >= 0; i--) {
    if (timeSeconds >= compiledSegments[i].startTime) {
      return compiledSegments[i];
    }
  }
  return compiledSegments[0] || null;
}

/**
 * Calculate Hz at given time with COSINE EASING (preserved from lfo-event)
 */
function getHzAt(compiledSegments, timeSeconds) {
  const segment = findSegmentAt(compiledSegments, timeSeconds);
  if (!segment) return 5.0;

  if (segment.type === 'plateau') {
    return segment.hz;
  } else if (segment.type === 'transition') {
    const progress = (timeSeconds - segment.startTime) / segment.duration;
    const clampedProgress = Math.max(0, Math.min(1, progress));
    // Cosine easing: smooth S-curve from 0 to 1
    const easedProgress = (1 - Math.cos(clampedProgress * Math.PI)) / 2;
    return segment.startHz + (segment.endHz - segment.startHz) * easedProgress;
  }

  return 5.0;
}

/**
 * Calculate 32n interval from Hz (half period)
 */
function calculate32nInterval(hz) {
  return 0.5 / hz;
}

/**
 * Calculate pulse duration based on duty cycle
 */
function calculatePulseDuration(hz, dutyCycle) {
  const interval = calculate32nInterval(hz);
  return interval * dutyCycle;
}

/**
 * ============================================================================
 * ADSR ENVELOPE GENERATOR - For ISO Pulses
 * ============================================================================
 */
class AdsrEnvelope {
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this.stage = 'idle';
    this.value = 0;
    
    // Envelope parameters (in samples) - FIXED TIMING
    this.attackSamples = Math.floor(0.000 * sampleRate);  // 0ms instant attack
    this.releaseSamples = Math.floor(0.015 * sampleRate); // 15ms release
    
    // Linear increment per sample
    this.attackIncrement = this.attackSamples > 0 ? 1.0 / this.attackSamples : 1.0;
    this.releaseDecrement = 1.0 / this.releaseSamples;
    
    this.sampleCounter = 0;
  }
  
  trigger() {
    this.stage = 'attack';
    this.value = 0.0;
    this.sampleCounter = 0;
  }
  
  release() {
    if (this.stage === 'idle') return;
    this.stage = 'release';
    this.sampleCounter = 0;
  }
  
  isActive() {
    return this.stage !== 'idle';
  }
  
  process() {
    if (this.stage === 'idle') {
      return 0;
    }
    
    if (this.stage === 'attack') {
      this.value += this.attackIncrement;
      this.sampleCounter++;
      
      if (this.value >= 1.0 || this.sampleCounter >= this.attackSamples) {
        this.value = 1.0;
        this.stage = 'sustain';
        this.sampleCounter = 0;
      }
    } else if (this.stage === 'sustain') {
      this.value = 1.0;
    } else if (this.stage === 'release') {
      this.value -= this.releaseDecrement;
      this.sampleCounter++;
      
      if (this.value <= 0.0 || this.sampleCounter >= this.releaseSamples) {
        this.value = 0.0;
        this.stage = 'idle';
      }
    }
    
    return Math.max(0.0, Math.min(1.0, this.value));
  }
}

/**
 * ============================================================================
 * VOICE CLASS - Used by both Binaural (continuous) and ISO (pulse)
 * ============================================================================
 */
class Voice {
  constructor(sampleRate, isPulse = false) {
    this.sampleRate = sampleRate;
    this.isPulse = isPulse;  // true = ISO pulse, false = binaural continuous
    
    // Oscillator state
    this.frequency = 110;
    this.phase = 0;
    this.active = false;
    
    // ISO pulse-specific properties
    if (this.isPulse) {
      this.envelope = new AdsrEnvelope(sampleRate);
      this.channel = 'left';
      this.pulseId = -1;
      this.startSample = 0;
      this.endSample = 0;
      this.releaseStartSample = 0;
    }
  }
  
  /**
   * Set frequency for oscillator
   */
  setFrequency(freq) {
    this.frequency = freq;
  }
  
  /**
   * Start voice (binaural continuous)
   */
  start() {
    this.active = true;
    this.phase = 0;
  }
  
  /**
   * Stop voice (binaural continuous)
   */
  stop() {
    this.active = false;
  }
  
  /**
   * Trigger pulse (ISO only)
   */
  trigger(frequency, channel, pulseId, currentSample, durationSamples) {
    if (!this.isPulse) return;
    
    this.frequency = frequency;
    this.channel = channel;
    this.pulseId = pulseId;
    this.startSample = currentSample;
    
    // Calculate when release should start
    const releaseDuration = this.envelope.releaseSamples;
    const minSustainSamples = Math.floor(0.005 * this.sampleRate); // 5ms minimum sustain
    
    // Ensure pulse is long enough for release envelope + minimum sustain
    const minTotalSamples = releaseDuration + minSustainSamples;
    const actualDurationSamples = Math.max(durationSamples, minTotalSamples);
    
    this.releaseStartSample = currentSample + actualDurationSamples - releaseDuration;
    this.endSample = currentSample + actualDurationSamples;
    
    this.phase = 0;
    this.active = true;
    this.envelope.trigger();
  }
  
  /**
   * Check if pulse should start release (ISO only)
   */
  checkRelease(currentSample) {
    if (!this.isPulse || !this.active) return;
    
    if (currentSample >= this.releaseStartSample && this.envelope.stage !== 'release') {
      this.envelope.release();
    }
  }
  
  /**
   * Check if voice is active
   */
  isActive() {
    return this.active;
  }
  
  /**
   * Generate one sample of audio
   */
  process() {
    if (!this.active) return 0;
    
    // Check if envelope ended (ISO pulses)
    if (this.isPulse && !this.envelope.isActive()) {
      this.active = false;
      return 0;
    }
    
    // Generate sine wave sample
    const omega = 2 * Math.PI * this.frequency / this.sampleRate;
    const sample = Math.sin(this.phase);
    this.phase += omega;
    
    // Wrap phase
    if (this.phase >= 2 * Math.PI) {
      this.phase -= 2 * Math.PI;
    }
    
    // Apply envelope if pulse
    if (this.isPulse) {
      const env = this.envelope.process();
      return sample * env;
    }
    
    return sample;
  }
}

/**
 * ============================================================================
 * BINAURAL-ISO PROCESSOR - Combined System
 * ============================================================================
 */
class BinauralISOProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    
    // ========================================================================
    // 5-VOICE ARCHITECTURE (Production Preset Compatibility)
    // ========================================================================
    // Each voice has independent:
    // - octaveOffset: Frequency multiplier (-2 to +2 octaves)
    // - volume: Linear gain (0.0-1.0)
    // - width: Stereo field (-1.0 to +1.0)
    // - crossfade: Binaural↔ISO mix (0.0-1.0)
    // - dutyCycle: ISO pulse length (0.3-1.75)
    //
    // PHASE-LOCK GUARANTEE: All voices share this.beatPhase
    // When beatPhase wraps (0→2π), ALL voices trigger ISO pulses simultaneously
    //
    this.voices = [];
    for (let i = 0; i < NUM_VOICES; i++) {
      this.voices.push({
        // Voice parameters (runtime adjustable)
        octaveOffset: 0,
        volume: 1.0,
        width: 1.0,
        crossfade: 0.5,
        dutyCycle: DEFAULT_DUTY_CYCLE,
        
        // Binaural oscillator state
        binaural_phaseL: 0,
        binaural_phaseR: 0,
        
        // ISO pulse state
        iso_phaseL: 0,
        iso_phaseR: 0,
        iso_envelope: new AdsrEnvelope(sampleRate),
        iso_active: false,
        iso_frequencyL: 0,
        iso_frequencyR: 0,
        iso_startSample: 0,
        iso_endSample: 0,
        iso_releaseStartSample: 0
      });
    }
    
    // ========================================================================
    // SHARED PHASE (Phase-Lock Source of Truth)
    // ========================================================================
    this.beatPhase = 0;  // LFO phase accumulator (0 to 2π) - SHARED BY ALL VOICES
    this.pulseCount = 0; // Counter for L/R alternation
    
    // ========================================================================
    // JOURNEY MAP DATA
    // ========================================================================
    this.rawSegments = [];
    this.compiledSegments = [];
    this.carrierFrequency = 110;  // Base carrier (A2)
    
    // ========================================================================
    // TIMING STATE
    // ========================================================================
    this.currentSample = 0;
    this.totalDurationSamples = 0;
    this.isLoaded = false;
    this.isPlaying = false;
    
    // ========================================================================
    // MESSAGE HANDLER
    // ========================================================================
    this.port.onmessage = (event) => {
      const { type, voiceIndex } = event.data;
      
      if (type === 'loadJourneyMap') {
        this.rawSegments = event.data.segments;
        this.compiledSegments = compileSegments(this.rawSegments);
        this.carrierFrequency = event.data.carrierFrequency || 110;
        
        // Calculate total duration
        const lastSegment = this.compiledSegments[this.compiledSegments.length - 1];
        this.totalDurationSamples = lastSegment ? Math.round(lastSegment.endTime * sampleRate) : 0;
        
        // Reset state
        this.currentSample = 0;
        this.beatPhase = 0;
        this.pulseCount = 0;
        this.isLoaded = true;
        
        this.port.postMessage({
          type: 'journeyMapLoaded',
          segmentCount: this.rawSegments.length,
          totalDurationSeconds: this.totalDurationSamples / sampleRate
        });
        
      } else if (type === 'start') {
        if (this.isLoaded) {
          this.isPlaying = true;
          this.currentSample = 0;
          this.beatPhase = 0;
          this.port.postMessage({ type: 'started' });
        }
        
      } else if (type === 'stop') {
        this.isPlaying = false;
        // Stop all ISO pulses
        this.voices.forEach(v => {
          v.iso_active = false;
        });
        this.port.postMessage({ type: 'stopped' });
      
      // ======================================================================
      // PER-VOICE CONTROLS
      // ======================================================================
      } else if (type === 'setVoiceOctave') {
        if (voiceIndex >= 0 && voiceIndex < NUM_VOICES) {
          this.voices[voiceIndex].octaveOffset = event.data.octave;
        }
        
      } else if (type === 'setVoiceVolume') {
        if (voiceIndex >= 0 && voiceIndex < NUM_VOICES) {
          this.voices[voiceIndex].volume = Math.max(0, Math.min(1, event.data.volume));
        }
        
      } else if (type === 'setVoiceWidth') {
        if (voiceIndex >= 0 && voiceIndex < NUM_VOICES) {
          this.voices[voiceIndex].width = Math.max(0, Math.min(1, event.data.width));
        }
        
      } else if (type === 'setVoiceCrossfade') {
        if (voiceIndex >= 0 && voiceIndex < NUM_VOICES) {
          this.voices[voiceIndex].crossfade = Math.max(0, Math.min(1, event.data.crossfade));
        }
        
      } else if (type === 'setVoiceDutyCycle') {
        if (voiceIndex >= 0 && voiceIndex < NUM_VOICES) {
          this.voices[voiceIndex].dutyCycle = Math.max(0.3, Math.min(1.75, event.data.dutyCycle));
        }
      }
    };
    
    this.port.postMessage({ 
      type: 'initialized', 
      numVoices: NUM_VOICES
    });
  }
  
  /**
   * ========================================================================
   * PROCESS() - Main Audio Callback (5-Voice Architecture)
   * ========================================================================
   * Called by browser every 128 samples (render quantum)
   * 
   * PHASE-LOCK GUARANTEE:
   * - Single this.beatPhase shared by ALL voices
   * - Phase wrap triggers ALL voices simultaneously
   * - All voices render from identical currentSample position
   */
  process(inputs, outputs, parameters) {
    if (!this.isLoaded || !this.isPlaying) {
      return true;  // Keep processor alive
    }
    
    const outputL = outputs[0][0];
    const outputR = outputs[0][1];
    
    if (!outputL || !outputR) {
      return true;
    }
    
    const blockSize = outputL.length;  // Always 128
    const TWO_PI = 2 * Math.PI;
    
    // ========================================================================
    // SAMPLE LOOP - Process all 128 samples
    // ========================================================================
    for (let i = 0; i < blockSize; i++) {
      
      // ======================================================================
      // 1. CALCULATE HZ - Single source of truth for ALL voices
      // ======================================================================
      const timeSeconds = this.currentSample / sampleRate;
      const beatHz = getHzAt(this.compiledSegments, timeSeconds);
      
      // ======================================================================
      // 2. LFO PHASE ACCUMULATION - SHARED BY ALL VOICES
      // ======================================================================
      const omega = TWO_PI * beatHz / sampleRate;
      this.beatPhase += omega;
      
      // Check for phase wraparound (2π crossing = trigger ALL voices)
      if (this.beatPhase >= TWO_PI) {
        this.beatPhase -= TWO_PI;
        
        // PHASE-LOCK: Trigger ISO pulse for ALL 5 voices simultaneously
        for (let v = 0; v < NUM_VOICES; v++) {
          const voice = this.voices[v];
          
          // Calculate carrier with voice's octave offset
          const voiceCarrier = this.carrierFrequency * Math.pow(2, voice.octaveOffset);
          
          // Calculate pulse duration with voice's duty cycle
          const pulseDurationSeconds = calculatePulseDuration(beatHz, voice.dutyCycle);
          const pulseDurationSamples = Math.round(pulseDurationSeconds * sampleRate);
          
          // Calculate frequency with randomization
          const randomOffset = (Math.random() * 2 - 1) * ISO_FREQUENCY_RANDOMIZATION;
          const frequencyOffset = (beatHz / 2) * randomOffset;
          const frequencyISO = voiceCarrier + frequencyOffset;
          
          // Alternate L/R channels based on global pulse count
          const isLeftChannel = (this.pulseCount % 2 === 0);
          
          // Trigger pulse (set frequencies for L and R)
          voice.iso_frequencyL = isLeftChannel ? frequencyISO : 0;
          voice.iso_frequencyR = isLeftChannel ? 0 : frequencyISO;
          voice.iso_phaseL = 0;
          voice.iso_phaseR = 0;
          
          // Calculate envelope timing with minimum sustain
          const releaseDuration = voice.iso_envelope.releaseSamples;
          const minSustainSamples = Math.floor(0.005 * sampleRate); // 5ms
          const minTotalSamples = releaseDuration + minSustainSamples;
          const actualDurationSamples = Math.max(pulseDurationSamples, minTotalSamples);
          
          voice.iso_startSample = this.currentSample;
          voice.iso_releaseStartSample = this.currentSample + actualDurationSamples - releaseDuration;
          voice.iso_endSample = this.currentSample + actualDurationSamples;
          voice.iso_active = true;
          voice.iso_envelope.trigger();
        }
        
        this.pulseCount++;
      }
      
      // ======================================================================
      // 3. RENDER ALL 5 VOICES
      // ======================================================================
      let sumL = 0;
      let sumR = 0;
      
      for (let v = 0; v < NUM_VOICES; v++) {
        const voice = this.voices[v];
        
        // Skip silent voices
        if (voice.volume <= 0.001) continue;
        
        // Calculate voice carrier with octave offset
        const voiceCarrier = this.carrierFrequency * Math.pow(2, voice.octaveOffset);
        
        // ------------------------------------------------------------------
        // BINAURAL: Continuous L/R tones
        // ------------------------------------------------------------------
        const freqL_binaural = voiceCarrier - (beatHz / 2);
        const freqR_binaural = voiceCarrier + (beatHz / 2);
        
        const sampleL_binaural = Math.sin(voice.binaural_phaseL);
        const sampleR_binaural = Math.sin(voice.binaural_phaseR);
        
        voice.binaural_phaseL += (TWO_PI * freqL_binaural) / sampleRate;
        voice.binaural_phaseR += (TWO_PI * freqR_binaural) / sampleRate;
        
        // Wrap phases
        if (voice.binaural_phaseL >= TWO_PI) voice.binaural_phaseL -= TWO_PI;
        if (voice.binaural_phaseR >= TWO_PI) voice.binaural_phaseR -= TWO_PI;
        
        // ------------------------------------------------------------------
        // ISO: Discrete pulses
        // ------------------------------------------------------------------
        let sampleL_iso = 0;
        let sampleR_iso = 0;
        
        if (voice.iso_active) {
          // Check if release should start
          if (this.currentSample >= voice.iso_releaseStartSample && voice.iso_envelope.stage !== 'release') {
            voice.iso_envelope.release();
          }
          
          // Check if envelope ended
          if (!voice.iso_envelope.isActive()) {
            voice.iso_active = false;
          } else {
            // Generate ISO samples
            if (voice.iso_frequencyL > 0) {
              sampleL_iso = Math.sin(voice.iso_phaseL);
              voice.iso_phaseL += (TWO_PI * voice.iso_frequencyL) / sampleRate;
              if (voice.iso_phaseL >= TWO_PI) voice.iso_phaseL -= TWO_PI;
            }
            
            if (voice.iso_frequencyR > 0) {
              sampleR_iso = Math.sin(voice.iso_phaseR);
              voice.iso_phaseR += (TWO_PI * voice.iso_frequencyR) / sampleRate;
              if (voice.iso_phaseR >= TWO_PI) voice.iso_phaseR -= TWO_PI;
            }
            
            // Apply envelope
            const env = voice.iso_envelope.process();
            sampleL_iso *= env;
            sampleR_iso *= env;
          }
        }
        
        // ------------------------------------------------------------------
        // CROSSFADE: Blend binaural and ISO with constant-power
        // ------------------------------------------------------------------
        const crossfadeAngle = voice.crossfade * Math.PI / 2;
        const binauralGain = Math.cos(crossfadeAngle);  // 1.0 → 0.0
        const isoGain = Math.sin(crossfadeAngle);        // 0.0 → 1.0
        
        const mixedL = (sampleL_binaural * binauralGain) + (sampleL_iso * isoGain);
        const mixedR = (sampleR_binaural * binauralGain) + (sampleR_iso * isoGain);
        
        // ------------------------------------------------------------------
        // WIDTH: Constant-power panning
        // ------------------------------------------------------------------
        const pan = voice.width;  // 0.0 = mono, 1.0 = full stereo
        const panL = -pan;
        const panR = pan;
        
        const angleL = (panL + 1) * Math.PI / 4;
        const angleR = (panR + 1) * Math.PI / 4;
        
        const gainL_L = Math.cos(angleL);
        const gainL_R = Math.sin(angleL);
        const gainR_L = Math.cos(angleR);
        const gainR_R = Math.sin(angleR);
        
        const widthMixedL = (mixedL * gainL_L) + (mixedR * gainR_L);
        const widthMixedR = (mixedL * gainL_R) + (mixedR * gainR_R);
        
        // ------------------------------------------------------------------
        // VOLUME: Apply voice volume
        // ------------------------------------------------------------------
        sumL += widthMixedL * voice.volume;
        sumR += widthMixedR * voice.volume;
      }
      
      // ======================================================================
      // 4. OUTPUT - Write to buffers with safety headroom
      // ======================================================================
      outputL[i] = sumL * 0.2;  // Headroom for 5 voices
      outputR[i] = sumR * 0.2;
      
      this.currentSample++;
    }
    
    // ========================================================================
    // COMPLETION CHECK
    // ========================================================================
    const allVoicesSilent = this.voices.every(v => !v.iso_active);
    const pastEnd = this.currentSample >= this.totalDurationSamples;
    
    if (allVoicesSilent && pastEnd && this.isLoaded) {
      this.port.postMessage({ type: 'completed' });
      this.isPlaying = false;
    }
    
    return true;  // Keep processor alive
  }
}

registerProcessor('binaural-iso-processor', BinauralISOProcessor);
