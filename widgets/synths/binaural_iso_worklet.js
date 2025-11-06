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

/**
 * Hz calculation granularity (samples between recalculations)
 * 1 = Calculate every sample (smoothest, highest CPU)
 * 32 = Calculate every 32 samples (~0.7ms at 48kHz)
 * 128 = Calculate per block (~2.6ms at 48kHz)
 * Lower = smoother transitions, higher = better performance
 */
const HZ_CHECK_GRANULARITY = 1;  // Per-sample for zero clicking
const ISO_FREQUENCY_RANDOMIZATION = 0.0;  // 50% of the beatHz/2 range

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
    // BINAURAL SYSTEM - Continuous tones (Phase-Locked)
    // ========================================================================
    // Phase-locked synthesis: Single carrier + beat phase for both channels
    // This eliminates drift by enforcing phase relationship every sample
    this.carrierPhase = 0;  // Shared carrier phase for L/R channels
    this.beatPhase = 0;     // Beat phase for frequency offset
    
    // ========================================================================
    // ISO SYSTEM - Discrete pulses
    // ========================================================================
    this.voicesISO = [];
    for (let i = 0; i < 8; i++) {
      this.voicesISO.push(new Voice(sampleRate, true));
    }
    this.beatPhase = 0;  // LFO phase accumulator (0 to 2π)
    this.pulseId = 0;
    this.channel = 'left';  // Alternating L/R for ISO pulses
    
    // ========================================================================
    // JOURNEY MAP DATA
    // ========================================================================
    this.rawSegments = [];
    this.compiledSegments = [];
    this.carrierFrequency = 110;  // Base carrier (A2)
    
    // ========================================================================
    // CONTROL PARAMETERS
    // ========================================================================
    this.volumeGain = 1.0;           // Master volume (0.0-1.0)
    this.crossfade = 0.5;            // 0.0=binaural, 1.0=ISO
    this.dutyCycle = DEFAULT_DUTY_CYCLE;  // ISO pulse duration
    this.carrierOctave = 0;          // -2 to +2 octaves
    
    // Stereo width controls (separate for ISO and Binaural)
    this.leftPan = -1.0;             // Legacy: combined width
    this.rightPan = 1.0;
    this.leftPanISO = -1.0;          // ISO-specific width
    this.rightPanISO = 1.0;
    this.leftPanBinaural = -1.0;     // Binaural-specific width
    this.rightPanBinaural = 1.0;
    
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
      if (event.data.type === 'loadJourneyMap') {
        this.rawSegments = event.data.segments;
        this.compiledSegments = compileSegments(this.rawSegments);
        this.carrierFrequency = event.data.carrierFrequency || 110;
        
        // Calculate total duration
        const lastSegment = this.compiledSegments[this.compiledSegments.length - 1];
        this.totalDurationSamples = lastSegment ? Math.round(lastSegment.endTime * sampleRate) : 0;
        
        // Reset state
        this.currentSample = 0;
        this.beatPhase = 0;
        this.pulseId = 0;
        this.channel = 'left';
        this.isLoaded = true;
        
        this.port.postMessage({
          type: 'journeyMapLoaded',
          segmentCount: this.rawSegments.length,
          totalDurationSeconds: this.totalDurationSamples / sampleRate
        });
        
      } else if (event.data.type === 'start') {
        if (this.isLoaded) {
          this.carrierPhase = 0;  // Reset carrier phase
          this.beatPhase = 0;     // Reset beat phase
          this.isPlaying = true;
          this.currentSample = 0;
          this.port.postMessage({ type: 'started' });
        }
        
      } else if (event.data.type === 'stop') {
        this.isPlaying = false;
        this.port.postMessage({ type: 'stopped' });
        
      } else if (event.data.type === 'setVolume') {
        this.volumeGain = event.data.gain;
        
      } else if (event.data.type === 'setCrossfade') {
        this.crossfade = Math.max(0, Math.min(1, event.data.value));
        
      } else if (event.data.type === 'setDutyCycle') {
        this.dutyCycle = event.data.dutyCycle;
        
      } else if (event.data.type === 'setCarrierOctave') {
        this.carrierOctave = Math.max(-2, Math.min(2, event.data.octave));
        
      } else if (event.data.type === 'setWidth') {
        // Legacy: sets both ISO and Binaural width
        this.leftPan = event.data.panL;
        this.rightPan = event.data.panR;
        this.leftPanISO = event.data.panL;
        this.rightPanISO = event.data.panR;
        this.leftPanBinaural = event.data.panL;
        this.rightPanBinaural = event.data.panR;
        
      } else if (event.data.type === 'setWidthISO') {
        // ISO-specific width
        this.leftPanISO = event.data.panL;
        this.rightPanISO = event.data.panR;
        
      } else if (event.data.type === 'setWidthBinaural') {
        // Binaural-specific width
        this.leftPanBinaural = event.data.panL;
        this.rightPanBinaural = event.data.panR;
      }
    };
    
    this.port.postMessage({ 
      type: 'initialized', 
      binauralVoices: 2, 
      isoVoices: this.voicesISO.length 
    });
  }
  
  /**
   * Find free voice from ISO pool
   */
  _findFreeVoice() {
    for (let voice of this.voicesISO) {
      if (!voice.isActive()) {
        return voice;
      }
    }
    return null;
  }
  
  /**
   * ========================================================================
   * PROCESS() - Main Audio Callback
   * ========================================================================
   * Called by browser every 128 samples (render quantum)
   */
  process(inputs, outputs, parameters) {
    // Debug: Log first few process calls
    if (this.currentSample < 256) {
      console.log(`[Worklet process()] sample=${this.currentSample}, isLoaded=${this.isLoaded}, isPlaying=${this.isPlaying}`);
    }
    
    if (!this.isLoaded || !this.isPlaying) {
      return true;  // Keep processor alive
    }
    
    const outputL = outputs[0][0];
    const outputR = outputs[0][1];
    
    if (!outputL || !outputR) {
      console.log('[Worklet process()] No output buffers!');
      return true;
    }
    
    const blockSize = outputL.length;  // Always 128
    
    // Debug: Log that we're actually processing
    if (this.currentSample === 0) {
      console.log('[Worklet process()] Starting audio generation!');
    }
    
    // Calculate crossfade gains (constant-power law)
    const crossfadeAngle = this.crossfade * Math.PI / 2;
    const binauralGain = Math.cos(crossfadeAngle);  // 1.0 → 0.0
    const isoGain = Math.sin(crossfadeAngle);        // 0.0 → 1.0
    
    // ========================================================================
    // SAMPLE LOOP - Process all 128 samples
    // ========================================================================
    for (let i = 0; i < blockSize; i++) {
      
      // ======================================================================
      // 1. CALCULATE HZ - Single source of truth for both systems
      // ======================================================================
      const timeSeconds = this.currentSample / sampleRate;
      const beatHz = getHzAt(this.compiledSegments, timeSeconds);
      
      // Calculate carrier frequency with octave adjustment (per-sample)
      const carrierMultiplier = Math.pow(2, this.carrierOctave);
      const actualCarrier = this.carrierFrequency * carrierMultiplier;
      
      // ======================================================================
      // 2. BINAURAL SYSTEM - Phase-Locked Continuous Tones
      // ======================================================================
      // Calculate phase increments (omega = 2π × frequency / sampleRate)
      const carrierOmega = 2 * Math.PI * actualCarrier / sampleRate;
      const beatOmega = 2 * Math.PI * beatHz / sampleRate;
      
      // Accumulate carrier phase
      this.carrierPhase += carrierOmega;
      
      // Wrap carrier phase smoothly to prevent clicking (modulo operation)
      // Using while loop for proper wrapping in case of large jumps
      while (this.carrierPhase >= 2 * Math.PI) {
        this.carrierPhase -= 2 * Math.PI;
      }
      while (this.carrierPhase < 0) {
        this.carrierPhase += 2 * Math.PI;
      }
      
      // Accumulate beat phase (NEVER wrap - used continuously by binaural)
      this.beatPhase += beatOmega;
      
      // Generate phase-locked samples using UNWRAPPED beatPhase
      // Left channel: carrier - beat/2 (lower frequency)
      // Right channel: carrier + beat/2 (higher frequency)
      // Phase relationship enforced mathematically every sample → zero drift
      // Sine is periodic, so unwrapped phase is fine (sin(x) = sin(x + 2πn))
      const binauralLeftSample = Math.sin(this.carrierPhase - (this.beatPhase / 2));
      const binauralRightSample = Math.sin(this.carrierPhase + (this.beatPhase / 2));
      
      // ======================================================================
      // 3. ISO SYSTEM - Gnaural-style Continuous Carrier + Square LFO
      // ======================================================================
      // ARCHITECTURE (discovered from Gnaural analysis):
      // - Continuous carrier wave (same as binaural, never restarted)
      // - Square LFO with slight slew controls L/R channel visibility
      // - At 20Hz: 50ms period = 25ms per channel + slight overlap
      // - When summed to mono: continuous wave (no gaps)
      // - Slew: 1-2ms absolute time for smooth edges (Gnaural spec)
      
      // Generate continuous ISO carrier (same frequency as binaural)
      const isoCarrierSample = Math.sin(this.carrierPhase);
      
      // Calculate square LFO position from wrapped beat phase
      const wrappedPhase = this.beatPhase % (2 * Math.PI);
      const lfoProgress = wrappedPhase / (2 * Math.PI);  // 0.0 to 1.0
      
      // Calculate slew time: 3ms converted to phase units (increased for transitions)
      const beatPeriod = 1.0 / beatHz;  // Period in seconds
      const slewTime = 0.003;  // 3ms slew time (doubled for smooth transitions)
      let slewPhase = slewTime / beatPeriod;  // Slew as fraction of cycle
      
      // Clamp slew phase to reasonable limits (prevent extremes at very low/high Hz)
      const minSlewPhase = 0.01;   // Minimum 1% of cycle
      const maxSlewPhase = 0.25;   // Maximum 25% of cycle
      slewPhase = Math.max(minSlewPhase, Math.min(maxSlewPhase, slewPhase));
      
      // Square wave with duty cycle control
      // dutyCycle = 0.5 means 50% on each channel (perfect square)
      // dutyCycle > 0.5 means longer pulses with overlap
      // dutyCycle < 0.5 means shorter pulses with gaps
      const halfDuty = this.dutyCycle / 2;
      
      let isoLeftGain = 0;
      let isoRightGain = 0;
      
      if (lfoProgress < 0.5) {
        // First half: Left channel active
        const leftEnd = halfDuty;
        
        if (lfoProgress < slewPhase) {
          // Slew in to left at cycle start (fade from 0)
          const slewProgress = lfoProgress / slewPhase;
          isoLeftGain = slewProgress;
        } else if (lfoProgress < leftEnd - slewPhase) {
          // Full left (between slew-in and slew-out)
          isoLeftGain = 1.0;
        } else if (lfoProgress < leftEnd) {
          // Slew out from left (fade to 0)
          const slewProgress = (lfoProgress - (leftEnd - slewPhase)) / slewPhase;
          isoLeftGain = 1.0 - slewProgress;
        }
        
        // Right channel stays at 0 during first half
        isoRightGain = 0;
      } else {
        // Second half: Right channel active
        const rightProgress = lfoProgress - 0.5;
        const rightStart = 0;
        const rightEnd = halfDuty;
        
        if (rightProgress < slewPhase) {
          // Slew in to right (fade from 0)
          const slewProgress = rightProgress / slewPhase;
          isoRightGain = slewProgress;
        } else if (rightProgress < rightEnd - slewPhase) {
          // Full right (between slew-in and slew-out)
          isoRightGain = 1.0;
        } else if (rightProgress < rightEnd) {
          // Slew out from right (fade to 0)
          const slewProgress = (rightProgress - (rightEnd - slewPhase)) / slewPhase;
          isoRightGain = 1.0 - slewProgress;
        }
      }
      
      // Apply LFO gains to continuous carrier
      const isoLeftSample = isoCarrierSample * isoLeftGain;
      const isoRightSample = isoCarrierSample * isoRightGain;
      
      // ======================================================================
      // 4. STEREO WIDTH - Apply SEPARATELY to Binaural and ISO
      // ======================================================================
      // Apply width to Binaural voices
      const binauralLeftPanAngle = (this.leftPanBinaural + 1) * Math.PI / 4;
      const binauralLeftGainL = Math.cos(binauralLeftPanAngle);
      const binauralLeftGainR = Math.sin(binauralLeftPanAngle);
      
      const binauralRightPanAngle = (this.rightPanBinaural + 1) * Math.PI / 4;
      const binauralRightGainL = Math.cos(binauralRightPanAngle);
      const binauralRightGainR = Math.sin(binauralRightPanAngle);
      
      const binauralMixedL = (binauralLeftSample * binauralLeftGainL) + (binauralRightSample * binauralRightGainL);
      const binauralMixedR = (binauralLeftSample * binauralLeftGainR) + (binauralRightSample * binauralRightGainR);
      
      // Apply width to ISO voices
      const isoLeftPanAngle = (this.leftPanISO + 1) * Math.PI / 4;
      const isoLeftGainL = Math.cos(isoLeftPanAngle);
      const isoLeftGainR = Math.sin(isoLeftPanAngle);
      
      const isoRightPanAngle = (this.rightPanISO + 1) * Math.PI / 4;
      const isoRightGainL = Math.cos(isoRightPanAngle);
      const isoRightGainR = Math.sin(isoRightPanAngle);
      
      const isoMixedL = (isoLeftSample * isoLeftGainL) + (isoRightSample * isoRightGainL);
      const isoMixedR = (isoLeftSample * isoLeftGainR) + (isoRightSample * isoRightGainR);
      
      // ======================================================================
      // 5. CROSSFADE MIX - Blend width-adjusted binaural and ISO with constant-power
      // ======================================================================
      const mixedL = (binauralMixedL * binauralGain) + (isoMixedL * isoGain);
      const mixedR = (binauralMixedR * binauralGain) + (isoMixedR * isoGain);
      
      // ======================================================================
      // 6. OUTPUT - Write to buffers with volume control
      // ======================================================================
      outputL[i] = mixedL * this.volumeGain * 0.3;  // 0.3 safety headroom
      outputR[i] = mixedR * this.volumeGain * 0.3;
      
      // Debug: Log first non-zero sample
      if ((outputL[i] !== 0 || outputR[i] !== 0) && this.currentSample < 48000) {
        console.log(`[Worklet] First audio! sample=${this.currentSample}, L=${outputL[i].toFixed(4)}, R=${outputR[i].toFixed(4)}, beatHz=${beatHz.toFixed(2)}, volumeGain=${this.volumeGain}`);
        this.currentSample = 48000; // Only log once
      }
      
      this.currentSample++;
    }
    
    // ========================================================================
    // COMPLETION CHECK
    // ========================================================================
    // Phase-locked binaural is always active when playing, so only check ISO voices
    const allVoicesSilent = this.voicesISO.every(v => !v.isActive());
    const pastEnd = this.currentSample >= this.totalDurationSamples;
    
    if (allVoicesSilent && pastEnd && this.isLoaded) {
      this.port.postMessage({ type: 'completed' });
      this.isPlaying = false;
      return true;
    }
    
    return true;  // Keep processing
  }
}

registerProcessor('binaural-iso-processor', BinauralISOProcessor);
