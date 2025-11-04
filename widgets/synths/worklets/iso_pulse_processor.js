/**
 * ISO Pulse Processor - AudioWorklet
 * 
 * Sample-by-sample isochronic pulse generator with ADSR envelopes.
 * Receives pre-calculated pulse schedule from main thread.
 * 
 * ARCHITECTURE:
 * - Voice pool for concurrent overlapping pulses
 * - Per-sample ADSR envelope calculation (no clicks)
 * - Sample-accurate pulse triggering (integer comparison)
 * - Zero node creation, zero GC pressure
 * 
 * REFERENCE:
 * - Based on g200kg/audioworklet-adsrnode (ADSR math)
 * - Based on biocommando/simple-synth (voice management)
 */

/**
 * ADSR Envelope Generator
 * Per-sample envelope calculation with exponential curves
 */
class AdsrEnvelope {
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    
    // Envelope times (in seconds)
    this.attackTime = 0.003;   // 3ms attack
    this.releaseTime = 0.003;  // 3ms release
    
    // Calculate ratios for exponential curves
    // Uses 1/e constant (0.36787944) for 63.2% approach
    this.attackRatio = this._calculateRatio(this.attackTime);
    this.releaseRatio = this._calculateRatio(this.releaseTime);
    
    // Current state
    this.value = 0;
    this.stage = 'idle'; // 'idle', 'attack', 'sustain', 'release'
  }
  
  /**
   * Calculate exponential ratio
   * From g200kg/audioworklet-adsrnode
   */
  _calculateRatio(timeSeconds) {
    const samples = timeSeconds * this.sampleRate;
    return 1 - Math.pow(0.36787944, 1 / samples);
  }
  
  /**
   * Trigger envelope attack
   */
  trigger() {
    this.stage = 'attack';
  }
  
  /**
   * Trigger envelope release
   */
  release() {
    if (this.stage !== 'idle') {
      this.stage = 'release';
    }
  }
  
  /**
   * Process one sample
   * Returns envelope value (0.0 - 1.0)
   */
  process() {
    switch (this.stage) {
      case 'attack':
        // Exponential rise to 1.0
        this.value += (1 - this.value) * this.attackRatio;
        if (this.value >= 0.999) {
          this.value = 1.0;
          this.stage = 'sustain';
        }
        break;
        
      case 'sustain':
        // Hold at 1.0
        this.value = 1.0;
        break;
        
      case 'release':
        // Exponential decay to 0.0
        this.value *= (1 - this.releaseRatio);
        if (this.value <= 0.001) {
          this.value = 0;
          this.stage = 'idle';
        }
        break;
        
      case 'idle':
        this.value = 0;
        break;
    }
    
    return this.value;
  }
  
  /**
   * Check if envelope is active
   */
  isActive() {
    return this.stage !== 'idle';
  }
}

/**
 * Voice - Single pulse instance
 */
class Voice {
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this.envelope = new AdsrEnvelope(sampleRate);
    
    // Voice parameters
    this.frequency = 110;
    this.phase = 0;
    this.channel = 'left'; // 'left' or 'right'
    this.pulseId = -1;
    
    // Timing
    this.startSample = 0;
    this.endSample = 0;
    
    // State
    this.active = false;
  }
  
  /**
   * Trigger voice with pulse parameters
   */
  trigger(pulse, currentSample) {
    this.frequency = pulse.carrierFrequency;
    this.channel = pulse.channel;
    this.pulseId = pulse.pulseId;
    this.startSample = currentSample;
    this.endSample = currentSample + pulse.durationSamples;
    this.phase = 0;
    this.active = true;
    this.envelope.trigger();
  }
  
  /**
   * Check if voice should release
   */
  checkRelease(currentSample) {
    if (this.active && currentSample >= this.endSample) {
      this.envelope.release();
    }
  }
  
  /**
   * Process one sample
   * Returns audio sample value
   */
  process() {
    if (!this.active) return 0;
    
    // Check if envelope finished
    if (!this.envelope.isActive()) {
      this.active = false;
      return 0;
    }
    
    // Generate sine wave
    const omega = 2 * Math.PI * this.frequency / this.sampleRate;
    const sample = Math.sin(this.phase);
    this.phase += omega;
    
    // Wrap phase to prevent precision loss
    if (this.phase >= 2 * Math.PI) {
      this.phase -= 2 * Math.PI;
    }
    
    // Apply envelope
    const envelopeValue = this.envelope.process();
    return sample * envelopeValue;
  }
  
  /**
   * Check if voice is active
   */
  isActive() {
    return this.active;
  }
}

/**
 * ISO Pulse Processor - Main AudioWorklet
 */
class ISOPulseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    
    // Voice pool (8 concurrent voices should be plenty)
    this.voices = [];
    for (let i = 0; i < 8; i++) {
      this.voices.push(new Voice(sampleRate));
    }
    
    // Pulse schedule (received from main thread)
    this.pulseSchedule = [];
    this.nextPulseIndex = 0;
    
    // Sample counter
    this.currentSample = 0;
    
    // Message handler
    this.port.onmessage = (event) => {
      if (event.data.type === 'schedule') {
        this.pulseSchedule = event.data.pulses;
        this.nextPulseIndex = 0;
        this.currentSample = 0;
        
        // Send confirmation back to main thread
        this.port.postMessage({
          type: 'scheduleReceived',
          pulseCount: this.pulseSchedule.length
        });
      }
    };
    
    // Send initialization message to main thread
    this.port.postMessage({ type: 'initialized', voiceCount: this.voices.length });
  }
  
  /**
   * Find free voice
   */
  _findFreeVoice() {
    for (let voice of this.voices) {
      if (!voice.isActive()) {
        return voice;
      }
    }
    return null; // All voices busy (shouldn't happen with 8 voices)
  }
  
  /**
   * Process audio block (128 samples)
   */
  process(inputs, outputs, parameters) {
    const outputL = outputs[0][0]; // Left channel
    const outputR = outputs[0][1]; // Right channel
    
    if (!outputL || !outputR) {
      this.port.postMessage({ type: 'error', message: 'No output buffers available' });
      return true;
    }
    
    const blockSize = outputL.length;
    
    // Debug: Log EVERY process call for first 3 calls
    if (this.currentSample < 3 * blockSize) {
      this.port.postMessage({
        type: 'processCall',
        currentSample: this.currentSample,
        blockSize: blockSize,
        nextPulseIndex: this.nextPulseIndex,
        scheduleLength: this.pulseSchedule.length,
        nextPulsePosition: this.pulseSchedule[this.nextPulseIndex]?.samplePosition,
        hasSchedule: this.pulseSchedule.length > 0
      });
    }
    
    // Process each sample
    for (let i = 0; i < blockSize; i++) {
      // Check if any pulses should trigger at this sample
      while (
        this.nextPulseIndex < this.pulseSchedule.length &&
        this.currentSample >= this.pulseSchedule[this.nextPulseIndex].samplePosition
      ) {
        const pulse = this.pulseSchedule[this.nextPulseIndex];
        const voice = this._findFreeVoice();
        
        if (voice) {
          voice.trigger(pulse, this.currentSample);
          
          // Notify main thread of first pulse (for debugging)
          if (this.nextPulseIndex === 0) {
            this.port.postMessage({ type: 'firstPulseTriggered', pulseId: pulse.pulseId });
          }
        } else {
          this.port.postMessage({ type: 'noFreeVoice', pulseId: pulse.pulseId });
        }
        
        this.nextPulseIndex++;
      }
      
      // Check for voice releases
      for (let voice of this.voices) {
        voice.checkRelease(this.currentSample);
      }
      
      // Sum all active voices
      let sampleL = 0;
      let sampleR = 0;
      
      for (let voice of this.voices) {
        if (voice.isActive()) {
          const voiceSample = voice.process();
          
          // Route to L or R channel
          if (voice.channel === 'left') {
            sampleL += voiceSample;
          } else {
            sampleR += voiceSample;
          }
        }
      }
      
      // Write to output buffers
      outputL[i] = sampleL * 0.3; // -10dB to prevent clipping
      outputR[i] = sampleR * 0.3;
      
      this.currentSample++;
    }
    
    // Stop when all pulses processed and voices silent
    const allVoicesSilent = this.voices.every(v => !v.isActive());
    const allPulsesProcessed = this.nextPulseIndex >= this.pulseSchedule.length;
    
    if (allVoicesSilent && allPulsesProcessed && this.pulseSchedule.length > 0) {
      console.log('[ISOPulseProcessor] Playback complete');
      return false; // Stop processing
    }
    
    return true; // Keep processing
  }
}

// Register processor
registerProcessor('iso-pulse-processor', ISOPulseProcessor);
