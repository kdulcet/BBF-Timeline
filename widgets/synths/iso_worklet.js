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
 * NEW ARCHITECTURE (Phase 2+3)
 * ============================================================================
 * 
 * MAIN THREAD (JavaScript):
 *   - Sends journey map segments via postMessage (~500 bytes for 5 segments)
 *   - No pre-calculation of pulse schedules
 *   - Segments contain: type, hz/startHz/endHz, duration
 * 
 * AUDIO RENDERING THREAD (This Worklet):
 *   - Receives segments once at start
 *   - Calculates Hz per-sample using getHzAtSample()
 *   - Calculates next pulse using getNextPulseSample()
 *   - Check granularity: configurable (128, 64, 32, or 1 sample)
 *   - Both Hz and pulses use SAME segment data → no drift possible
 * 
 * WHY THIS ELIMINATES DRIFT:
 *   - OLD: Two separate systems (Web Audio Hz ramps + pre-calculated pulses)
 *   - NEW: One source (segments), one calculation point (worklet)
 *   - Mathematical impossibility of drift with identical inputs
 * 
 * CHECK GRANULARITY:
 *   - 128 samples: Default, ~2.6ms latency at 48kHz (usually imperceptible)
 *   - 64 samples: ~1.3ms latency (if 128 causes interruptions)
 *   - 32 samples: ~0.7ms latency (if 64 causes interruptions)
 *   - 1 sample: Perfect but higher CPU usage
 * 
 * ============================================================================
 */

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

function calculatePulseDuration(hz, dutyCycle = 0.8) {
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
    
    // Envelope parameters (in samples)
    this.attackSamples = Math.floor(0.000 * sampleRate);  // 5ms attack
    this.releaseSamples = Math.floor(0.020 * sampleRate); // 20ms release
    
    // Exponential coefficients
    this.attackRatio = 1 - Math.pow(0.36787944, 1 / this.attackSamples);
    this.releaseRatio = 1 - Math.pow(0.36787944, 1 / this.releaseSamples);
    
    this.sampleCounter = 0;
  }
  
  trigger() {
    this.stage = 'attack';
    this.value = 0;
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
      this.value += (1.0 - this.value) * this.attackRatio;
      this.sampleCounter++;
      
      if (this.value >= 0.999 || this.sampleCounter >= this.attackSamples) {
        this.value = 1.0;
        this.stage = 'sustain';
      }
    } else if (this.stage === 'sustain') {
      this.value = 1.0;
    } else if (this.stage === 'release') {
      this.value += (0.0 - this.value) * this.releaseRatio;
      this.sampleCounter++;
      
      if (this.value <= 0.001 || this.sampleCounter >= this.releaseSamples) {
        this.value = 0;
        this.stage = 'idle';
      }
    }
    
    return this.value;
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
    this.endSample = currentSample + durationSamples;
    this.phase = 0;
    this.active = true;
    this.envelope.trigger();
  }
  
  checkRelease(currentSample) {
    if (this.active && currentSample >= this.endSample) {
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
    this.checkGranularity = 128;  // Check for new pulses every N samples
    
    // Pulse state
    this.currentSample = 0;
    this.nextPulseSample = 0;
    this.pulseId = 0;
    this.channel = 'left';  // Alternating L/R
    
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
        this.checkGranularity = event.data.checkGranularity || 128;
        
        // Calculate total duration
        const lastSegment = this.compiledSegments[this.compiledSegments.length - 1];
        this.totalDurationSamples = lastSegment ? Math.round(lastSegment.endTime * sampleRate) : 0;
        
        // Reset state
        this.currentSample = 0;
        this.nextPulseSample = 0;
        this.pulseId = 0;
        this.channel = 'left';
        this.isLoaded = true;
        
        // Send confirmation
        this.port.postMessage({
          type: 'journeyMapLoaded',
          segmentCount: this.rawSegments.length,
          totalDurationSeconds: this.totalDurationSamples / sampleRate,
          checkGranularity: this.checkGranularity
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
    
    const blockSize = outputL.length;
    
    // ========================================================================
    // SAMPLE LOOP - Process each of 128 samples
    // ========================================================================
    for (let i = 0; i < blockSize; i++) {
      
      // ======================================================================
      // 1. PULSE TRIGGERING - Check every N samples (configurable)
      // ======================================================================
      // Check if it's time to evaluate pulse triggers
      if (i % this.checkGranularity === 0) {
        // Check if we need a new pulse
        while (this.currentSample >= this.nextPulseSample && this.currentSample < this.totalDurationSamples) {
          // Calculate Hz at exact trigger sample
          const hz = getHzAtSample(this.compiledSegments, this.currentSample, sampleRate);
          
          // Calculate pulse duration
          const pulseDurationSeconds = calculatePulseDuration(hz, 0.8);
          const pulseDurationSamples = Math.round(pulseDurationSeconds * sampleRate);
          
          // Calculate frequency split (binaural-style)
          const frequency = this.channel === 'left' 
            ? this.carrierFrequency - (hz / 2)
            : this.carrierFrequency + (hz / 2);
          
          // Find free voice and trigger
          const voice = this._findFreeVoice();
          if (voice) {
            voice.trigger(frequency, this.channel, this.pulseId, this.currentSample, pulseDurationSamples);
            
            if (this.pulseId === 0) {
              this.port.postMessage({ type: 'firstPulseTriggered', sample: this.currentSample });
            }
          } else {
            this.port.postMessage({ type: 'noFreeVoice', pulseId: this.pulseId });
          }
          
          // Alternate channels
          this.channel = this.channel === 'left' ? 'right' : 'left';
          this.pulseId++;
          
          // Calculate next pulse sample using helper function
          this.nextPulseSample = getNextPulseSample(this.compiledSegments, this.currentSample, sampleRate);
        }
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
