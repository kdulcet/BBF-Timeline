/**
 * ============================================================================
 * ISO WORKLET - On-Demand Journey Map Calculation
 * ============================================================================
 * 
 * PURPOSE:
 * Sample-accurate isochronic pulse generator that calculates Hz and pulse
 * timing on-demand from journey map segments. Single source of truth ensures
 * perfect synchronization between Hz and pulse timing.
 * 
 * ============================================================================
 * WEB AUDIO API CONSTANTS (IMMUTABLE)
 * ============================================================================
 * 
 * RENDER QUANTUM SIZE: 128 samples
 *   - Fixed by Web Audio API specification
 *   - Browser calls process() every 128 samples automatically
 *   - At 48kHz: 128 samples = 2.667ms between process() calls
 *   - Cannot be changed - this is browser behavior
 *   - Retrieved via: outputL.length (always returns 128)
 * 
 * ============================================================================
 * NEW ARCHITECTURE (Phase 2+3)
 * ============================================================================
 * 
 * MAIN THREAD (JavaScript):
 *   - Sends journey map segments via postMessage (~500 bytes for 5 segments)
 *   - No pre-calculation of pulse schedules
 *   - Segments contain: type, hz/startHz/endHz, duration
 * 
 * AUDIO RENDERING THREAD (This Worklet):
 *   - Browser calls process() every 128 samples (render quantum)
 *   - Each process() call: loop through all 128 samples
 *   - Calculates Hz per-sample using getHzAtSample()
 *   - Calculates next pulse using getNextPulseSample()
 *   - Check granularity: configurable (how often to check for new pulses)
 *   - Both Hz and pulses use SAME segment data → no drift possible
 * 
 * WHY THIS ELIMINATES DRIFT:
 *   - OLD: Two separate systems (Web Audio Hz ramps + pre-calculated pulses)
 *   - NEW: One source (segments), one calculation point (worklet)
 *   - Mathematical impossibility of drift with identical inputs
 * 
 * CHECK GRANULARITY (USER CONFIGURABLE):
 *   Controls how often worklet checks if new pulse should spawn.
 *   Trade-off between CPU usage and pulse spawn precision.
 *   
 *   - 128 samples: Check once per render quantum (~2.6ms at 48kHz)
 *     * Lowest CPU usage
 *     * Pulse may spawn up to 2.6ms late
 *     * Usually imperceptible
 *   
 *   - 32 samples: Check 4 times per render quantum (~0.7ms at 48kHz)
 *     * Good balance of CPU and accuracy
 *     * Pulse may spawn up to 0.7ms late
 *     * RECOMMENDED DEFAULT
 *   
 *   - 1 sample: Check every single sample (~0.02ms at 48kHz)
 *     * Highest CPU usage
 *     * Perfect sample-accurate spawning
 *     * Use only if 32 has audible issues
 * 
 * NOTE: Check granularity ONLY affects when pulses spawn, not the render quantum.
 *       Browser still calls process() every 128 samples regardless.
 * 
 * ============================================================================
 */

/**
 * ============================================================================
 * CONFIGURATION - Single Source of Truth
 * ============================================================================
 */

// Binaural-style frequency split: carrier ± (hz/2) for L/R channels
// When false: both channels use carrier frequency (no split)
const ENABLE_BINAURAL_SPLIT = true;  // Toggle binaural frequency split on/off

/**
 * ============================================================================
 * HELPER FUNCTIONS (Copied inline from jm_worklet_helper.js)
 * ============================================================================
 * AudioWorklets cannot import external modules, so these are inlined.
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

function findSegmentAt(compiledSegments, timeSeconds) {
  for (let i = compiledSegments.length - 1; i >= 0; i--) {
    if (timeSeconds >= compiledSegments[i].startTime) {
      return compiledSegments[i];
    }
  }
  return compiledSegments[0] || null;
}

function getHzAt(compiledSegments, timeSeconds) {
  const segment = findSegmentAt(compiledSegments, timeSeconds);
  if (!segment) return 5.0;

  if (segment.type === 'plateau') {
    return segment.hz;
  } else if (segment.type === 'transition') {
    const progress = (timeSeconds - segment.startTime) / segment.duration;
    const clampedProgress = Math.max(0, Math.min(1, progress));
    return segment.startHz + (segment.endHz - segment.startHz) * clampedProgress;
  }

  return 5.0;
}

function getHzAtSample(compiledSegments, samplePosition, sampleRate) {
  const timeSeconds = samplePosition / sampleRate;
  return getHzAt(compiledSegments, timeSeconds);
}

function calculate32nInterval(hz) {
  return 0.5 / hz;
}

function getNextPulseSample(compiledSegments, currentSample, sampleRate) {
  const currentTime = currentSample / sampleRate;
  const currentHz = getHzAt(compiledSegments, currentTime);
  const interval = calculate32nInterval(currentHz);
  const nextTime = currentTime + interval;
  
  // Check if we cross segment boundary
  const nextHz = getHzAt(compiledSegments, nextTime);
  
  // Trapezoidal integration if Hz changes
  if (Math.abs(nextHz - currentHz) > 0.01) {
    const avgHz = 0.5 * (currentHz + nextHz);
    const avgInterval = calculate32nInterval(avgHz);
    return currentSample + Math.round(avgInterval * sampleRate);
  }
  
  return currentSample + Math.round(interval * sampleRate);
}

function calculatePulseDuration(hz, dutyCycle = 0.95) {
  const interval = calculate32nInterval(hz);
  return interval * dutyCycle;
}

/**
 * ============================================================================
 * ADSR ENVELOPE GENERATOR
 * ============================================================================
 */
class AdsrEnvelope {
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this.stage = 'idle';
    this.value = 0;
    
    // Envelope parameters (in samples) - FIXED TIMING
    this.attackSamples = Math.floor(0.000 * sampleRate);  // 0ms, essential for phase click
    this.releaseSamples = Math.floor(0.015 * sampleRate); // 15ms release (faster for high Hz)
    
    // Linear increment per sample (simple math, no sketchy exponentials)
    this.attackIncrement = this.attackSamples > 0 ? 1.0 / this.attackSamples : 1.0;  // Rise from 0 to 1
    this.releaseDecrement = 1.0 / this.releaseSamples;    // Fall from 1 to 0
    
    this.sampleCounter = 0;
  }
  
  trigger() {
    this.stage = 'attack';
    this.value = 0.0;  // Start from EXACT zero
    this.sampleCounter = 0;
  }
  
  release() {
    if (this.stage === 'idle') return;
    this.stage = 'release';
    this.sampleCounter = 0;
    // Keep current value, ramp down from wherever we are
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
    
    return Math.max(0.0, Math.min(1.0, this.value));  // Clamp to [0, 1]
  }
}

/**
 * ============================================================================
 * VOICE - Single Pulse Instance
 * ============================================================================
 */
class Voice {
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this.envelope = new AdsrEnvelope(sampleRate);
    
    this.frequency = 110;
    this.phase = 0;
    this.channel = 'left';
    this.pulseId = -1;
    
    this.startSample = 0;
    this.endSample = 0;
    
    this.active = false;
  }
  
  trigger(frequency, channel, pulseId, currentSample, durationSamples) {
    this.frequency = frequency;
    this.channel = channel;
    this.pulseId = pulseId;
    this.startSample = currentSample;
    
    // Calculate when release should START (not when pulse ends)
    // Release needs time to ramp down, so start it BEFORE the pulse duration ends
    const releaseDuration = this.envelope.releaseSamples;
    this.releaseStartSample = currentSample + durationSamples - releaseDuration;
    this.endSample = currentSample + durationSamples;  // When envelope should be silent
    
    this.phase = 0;
    this.active = true;
    this.envelope.trigger();
  }
  
  checkRelease(currentSample) {
    if (this.active && currentSample >= this.releaseStartSample && this.envelope.stage !== 'release') {
      this.envelope.release();
    }
  }
  
  isActive() {
    return this.active;
  }
  
  process() {
    if (!this.active) return 0;
    
    if (!this.envelope.isActive()) {
      this.active = false;
      return 0;
    }
    
    const omega = 2 * Math.PI * this.frequency / this.sampleRate;
    const sample = Math.sin(this.phase);
    this.phase += omega;
    
    if (this.phase >= 2 * Math.PI) {
      this.phase -= 2 * Math.PI;
    }
    
    const env = this.envelope.process();
    return sample * env;
  }
}

/**
 * ============================================================================
 * ISO PULSE PROCESSOR - On-Demand Calculation
 * ============================================================================
 */
class ISOPulseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    
    // Voice pool
    this.voices = [];
    for (let i = 0; i < 8; i++) {
      this.voices.push(new Voice(sampleRate));
    }
    
    // Journey map data
    this.rawSegments = [];
    this.compiledSegments = [];
    this.carrierFrequency = 110;
    
    // Pulse state
    this.currentSample = 0;
    this.nextPulseSample = 0;
    this.pulseId = 0;
    this.channel = 'left';  // Alternating L/R
    this.beatPhase = 0;  // LFO phase accumulator (0 to 2π)
    
    // Stereo width control
    this.leftPan = -1.0;
    this.rightPan = 1.0;
    
    // Timing
    this.totalDurationSamples = 0;
    this.isLoaded = false;
    
    // Message handler
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
        this.nextPulseSample = 0;
        this.pulseId = 0;
        this.channel = 'left';
        this.beatPhase = 0;  // Reset LFO phase
        this.isLoaded = true;
        
        // Send confirmation
        this.port.postMessage({
          type: 'journeyMapLoaded',
          segmentCount: this.rawSegments.length,
          totalDurationSeconds: this.totalDurationSamples / sampleRate
        });
        
      } else if (event.data.type === 'setWidth') {
        this.leftPan = event.data.panL;
        this.rightPan = event.data.panR;
        
      } else if (event.data.type === 'schedule') {
        // Legacy support - ignore pre-calculated schedules
        this.port.postMessage({
          type: 'error',
          message: 'This worklet uses on-demand calculation. Use loadJourneyMap instead.'
        });
      }
    };
    
    this.port.postMessage({ type: 'initialized', voiceCount: this.voices.length });
  }
  
  _findFreeVoice() {
    for (let voice of this.voices) {
      if (!voice.isActive()) {
        return voice;
      }
    }
    return null;
  }
  
  /**
   * ============================================================================
   * PROCESS() - Main Audio Callback with On-Demand Calculation
   * ============================================================================
   */
  process(inputs, outputs, parameters) {
    if (!this.isLoaded) {
      return true;  // Wait for journey map
    }
    
    const outputL = outputs[0][0];
    const outputR = outputs[0][1];
    
    if (!outputL || !outputR) {
      return true;
    }
    
    const blockSize = outputL.length;  // Always 128 (Web Audio render quantum)
    
    // ========================================================================
    // SAMPLE LOOP - Browser provides 128 samples per process() call
    // ========================================================================
    // Process all 128 samples in this render quantum
    for (let i = 0; i < blockSize; i++) {
      
      // ======================================================================
      // 1. PULSE TRIGGERING - LFO Phase-Wrap System
      // ======================================================================
      // Calculate Hz at current sample from journey map
      const hz = getHzAtSample(this.compiledSegments, this.currentSample, sampleRate);
      
      // Calculate omega (phase increment per sample)
      const omega = 2 * Math.PI * hz / sampleRate;
      
      // Accumulate phase
      this.beatPhase += omega;
      
      // Check for phase wraparound (2π crossing = new pulse)
      // Use while loop to catch multiple wraps at high Hz (e.g., 25Hz)
      while (this.beatPhase >= 2 * Math.PI) {
        this.beatPhase -= 2 * Math.PI;  // Wrap phase back to 0
        
        // Calculate pulse duration
        const pulseDurationSeconds = calculatePulseDuration(hz, 0.9);
        const pulseDurationSamples = Math.round(pulseDurationSeconds * sampleRate);
        
        // Calculate frequency (with optional binaural split)
        const frequency = ENABLE_BINAURAL_SPLIT
          ? (this.channel === 'left' 
              ? this.carrierFrequency - (hz / 2)
              : this.carrierFrequency + (hz / 2))
          : this.carrierFrequency;  // No split: both channels use carrier
        
        // Find free voice and trigger
        const voice = this._findFreeVoice();
        if (voice) {
          voice.trigger(frequency, this.channel, this.pulseId, this.currentSample, pulseDurationSamples);
          // console.log(`🔊 ISO Pulse #${this.pulseId} @ sample ${this.currentSample}, Hz=${hz.toFixed(2)}, dur=${pulseDurationSamples} samples`);
        }
        
        // Alternate channels
        this.channel = this.channel === 'left' ? 'right' : 'left';
        this.pulseId++;
      }
      
      // ======================================================================
      // 2. RELEASE CHECK - Check if any voices should start release
      // ======================================================================
      for (let voice of this.voices) {
        voice.checkRelease(this.currentSample);
      }
      
      // ======================================================================
      // 3. VOICE PROCESSING - Generate audio from all active voices
      // ======================================================================
      let leftVoiceSample = 0;
      let rightVoiceSample = 0;
      
      for (let voice of this.voices) {
        if (voice.isActive()) {
          const voiceSample = voice.process();
          
          if (voice.channel === 'left') {
            leftVoiceSample += voiceSample;
          } else {
            rightVoiceSample += voiceSample;
          }
        }
      }
      
      // ======================================================================
      // 4. STEREO WIDTH MIXING - Apply constant-power panning
      // ======================================================================
      const leftPanAngle = (this.leftPan + 1) * Math.PI / 4;
      const leftGainL = Math.cos(leftPanAngle);
      const leftGainR = Math.sin(leftPanAngle);
      
      const rightPanAngle = (this.rightPan + 1) * Math.PI / 4;
      const rightGainL = Math.cos(rightPanAngle);
      const rightGainR = Math.sin(rightPanAngle);
      
      const mixedL = (leftVoiceSample * leftGainL) + (rightVoiceSample * rightGainL);
      const mixedR = (leftVoiceSample * leftGainR) + (rightVoiceSample * rightGainR);
      
      // ======================================================================
      // 5. OUTPUT - Write mixed audio to output buffers
      // ======================================================================
      outputL[i] = mixedL * 0.3;
      outputR[i] = mixedR * 0.3;
      
      this.currentSample++;
    }
    
    // ========================================================================
    // COMPLETION CHECK
    // ========================================================================
    const allVoicesSilent = this.voices.every(v => !v.isActive());
    const pastEnd = this.currentSample >= this.totalDurationSamples;
    
    if (allVoicesSilent && pastEnd && this.isLoaded) {
      this.port.postMessage({ type: 'completed' });
      return false;  // Stop processing
    }
    
    return true;  // Keep processing
  }
}

registerProcessor('iso-pulse-processor', ISOPulseProcessor);
