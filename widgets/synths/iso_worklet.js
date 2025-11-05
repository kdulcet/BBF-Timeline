/**
 * ============================================================================
 * ISO WORKLET - AudioWorklet Reference Implementation
 * ============================================================================
 * 
 * PURPOSE:
 * Sample-accurate isochronic pulse generator running on the Audio Rendering
 * Thread. This is the REFERENCE IMPLEMENTATION for all future worklet-based
 * synths in the AuraMatrix system.
 * 
 * ============================================================================
 * AUDIOWORKLET THREAD MODEL
 * ============================================================================
 * 
 * MAIN THREAD (JavaScript):
 *   - UI updates, event handlers, timeline calculations
 *   - compileForWorklet() builds pulse schedule
 *   - Sends schedule via postMessage() ONE TIME at start
 *   - Does NOT control individual pulses (no setTimeout)
 * 
 * AUDIO RENDERING THREAD (This Worklet):
 *   - HIGH PRIORITY real-time thread
 *   - Runs every 128 samples (~2.9ms at 48kHz)
 *   - Receives pulse schedule ONCE at initialization
 *   - process() called automatically by browser
 *   - Sample-accurate triggering (0.02ms precision at 48kHz)
 *   - Protected from main thread interference (GC, UI, etc.)
 * 
 * WHY THIS WORKS:
 *   - No jitter from browser event loop
 *   - No setTimeout timing errors (~10ms precision)
 *   - Sample-accurate comparison: currentSample >= pulse.samplePosition
 *   - OS gives audio thread highest priority
 *   - Zero node creation = zero garbage collection pressure
 * 
 * ============================================================================
 * ARCHITECTURE
 * ============================================================================
 * 
 * COMPONENTS:
 *   1. AdsrEnvelope - Per-sample exponential envelope (attack/sustain/release)
 *   2. Voice - Single pulse instance with envelope and sine generation
 *   3. ISOPulseProcessor - Main worklet managing voice pool and scheduling
 * 
 * VOICE POOL PATTERN:
 *   - Pre-allocate N voices (8 concurrent pulses)
 *   - Find free voice when pulse triggers
 *   - Voice becomes idle when envelope completes
 *   - No dynamic allocation during playback
 * 
 * SAMPLE-ACCURATE TRIGGERING:
 *   - currentSample increments: 0, 128, 256, 384...
 *   - Pulse schedule: [{samplePosition: 1234, ...}, {samplePosition: 5678, ...}]
 *   - Comparison: if (currentSample >= pulse.samplePosition) trigger()
 *   - Integer comparison = no floating point error
 * 
 * ============================================================================
 * PULSE SCHEDULE FORMAT
 * ============================================================================
 * 
 * Received from main thread via postMessage:
 * 
 * {
 *   type: 'schedule',
 *   pulses: [
 *     {
 *       samplePosition: 0,           // Exact sample to trigger
 *       durationSamples: 6000,       // Length in samples (e.g., 125ms)
 *       channel: 'left',             // 'left' or 'right'
 *       carrierFrequency: 110,       // Base carrier frequency in Hz
 *       beatHz: 4,                   // Timeline Hz for frequency split
 *       pulseId: 0                   // Unique identifier
 *     },
 *     // ... 295 more pulses
 *   ]
 * }
 * 
 * BINAURAL-STYLE FREQUENCY SPLIT:
 *   - Left pulse:  frequency = carrierFrequency - (beatHz / 2)
 *   - Right pulse: frequency = carrierFrequency + (beatHz / 2)
 *   - Example: carrier=110Hz, beat=4Hz → L=108Hz, R=112Hz
 *   - Creates frequency separation matching timeline Hz progression
 * 
 * ============================================================================
 * FACTORY PATTERN NOTES (For Future Worklets)
 * ============================================================================
 * 
 * TEMPLATE STRUCTURE:
 *   1. Envelope class (if needed)
 *   2. Voice class (oscillator + envelope)
 *   3. Main AudioWorkletProcessor class
 *   4. registerProcessor() call
 * 
 * CUSTOMIZATION POINTS:
 *   - Oscillator type (sine, square, saw, noise)
 *   - Envelope shape (ADSR, AR, exponential vs linear)
 *   - Voice count (trade-off: concurrency vs memory)
 *   - Channel routing (mono, stereo, surround)
 *   - Effects (filtering, modulation, etc.)
 * 
 * PRESERVE PATTERNS:
 *   - Voice pool allocation (no dynamic allocation)
 *   - Sample-accurate triggering (integer comparison)
 *   - postMessage communication (schedule delivery)
 *   - process() loop structure (trigger → release → sum → output)
 * 
 * ============================================================================
 * REFERENCES
 * ============================================================================
 * 
 * ADSR Math:
 *   - g200kg/audioworklet-adsrnode
 *   - Exponential ratio: 1 - Math.pow(0.36787944, 1 / samples)
 *   - 0.36787944 = 1/e for 63.2% approach per time constant
 * 
 * Voice Management:
 *   - biocommando/simple-synth
 *   - Pre-allocated voice pool pattern
 * 
 * AudioWorklet API:
 *   - MDN: AudioWorkletProcessor
 *   - process(inputs, outputs, parameters) callback
 *   - 128-sample quantum processing
 * 
 * ============================================================================
 */

/**
 * ============================================================================
 * ADSR ENVELOPE GENERATOR
 * ============================================================================
 * 
 * Per-sample envelope calculation with exponential curves.
 * Processes one sample at a time, tracking envelope stage internally.
 * 
 * STAGES:
 *   idle    - Silent (value = 0)
 *   attack  - Exponential rise from 0 → 1
 *   sustain - Hold at peak (value = 1)
 *   release - Exponential decay from 1 → 0
 * 
 * EXPONENTIAL MATH:
 *   Ratio = 1 - Math.pow(1/e, 1/samples)
 *   Where 1/e ≈ 0.36787944 (63.2% approach per time constant)
 *   Each sample: value += (target - value) * ratio
 * 
 * CLICK-FREE:
 *   - Smooth exponential curves (not linear ramps)
 *   - Per-sample calculation (no automation node jumps)
 *   - Stage transitions at exact thresholds (>= 0.999, <= 0.001)
 */
class AdsrEnvelope {
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    
    // Envelope times (in seconds) - ADJUST FOR SYNTH TYPE
    this.attackTime = 0.000;   // 0ms: intentional phase click
    this.releaseTime = 0.005;  // 5ms: release, fast decay
    
    // Calculate exponential ratios for curves
    // Formula from g200kg/audioworklet-adsrnode
    this.attackRatio = this._calculateRatio(this.attackTime);
    this.releaseRatio = this._calculateRatio(this.releaseTime);
    
    // Current envelope state
    this.value = 0;
    this.stage = 'idle'; // 'idle', 'attack', 'sustain', 'release'
  }
  
  /**
   * Calculate exponential ratio for time constant
   * Uses 1/e (0.36787944) for natural exponential curve
   * 
   * @param {number} timeSeconds - Time in seconds
   * @returns {number} Per-sample ratio (0-1)
   */
  _calculateRatio(timeSeconds) {
    const samples = timeSeconds * this.sampleRate;
    return 1 - Math.pow(0.36787944, 1 / samples);
  }
  
  /**
   * Trigger envelope attack stage
   * Called when voice starts
   */
  trigger() {
    this.stage = 'attack';
  }
  
  /**
   * Trigger envelope release stage
   * Called when pulse duration expires
   */
  release() {
    if (this.stage !== 'idle') {
      this.stage = 'release';
    }
  }
  
  /**
   * Process one sample of envelope
   * Called 48,000 times per second (at 48kHz)
   * 
   * @returns {number} Envelope value (0.0 - 1.0)
   */
  process() {
    switch (this.stage) {
      case 'attack':
        // Exponential rise: approach 1.0
        this.value += (1 - this.value) * this.attackRatio;
        if (this.value >= 0.999) {
          this.value = 1.0;
          this.stage = 'sustain';
        }
        break;
        
      case 'sustain':
        // Hold at peak
        this.value = 1.0;
        break;
        
      case 'release':
        // Exponential decay: approach 0.0
        this.value *= (1 - this.releaseRatio);
        if (this.value <= 0.001) {
          this.value = 0;
          this.stage = 'idle';
        }
        break;
        
      case 'idle':
        // Silent
        this.value = 0;
        break;
    }
    
    return this.value;
  }
  
  /**
   * Check if envelope is generating audio
   * 
   * @returns {boolean} True if not idle
   */
  isActive() {
    return this.stage !== 'idle';
  }
}


/**
 * ============================================================================
 * VOICE - Single Pulse Instance
 * ============================================================================
 * 
 * Represents one active pulse with its own envelope and oscillator state.
 * Part of a voice pool - allocated once, reused many times.
 * 
 * LIFECYCLE:
 *   1. idle → trigger() → active
 *   2. Generate audio samples
 *   3. Check for release condition
 *   4. Envelope completes → idle (ready for reuse)
 * 
 * OSCILLATOR:
 *   - Simple sine wave generation
 *   - Phase accumulation (ω = 2πf / sampleRate)
 *   - Phase wrapping to prevent precision loss
 * 
 * MEMORY EFFICIENCY:
 *   - Voice object persists (no allocation)
 *   - Only parameters change per pulse
 *   - Envelope object persists
 */
class Voice {
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this.envelope = new AdsrEnvelope(sampleRate);
    
    // Pulse parameters (set by trigger())
    this.frequency = 110;           // Carrier frequency in Hz
    this.phase = 0;                 // Oscillator phase (0 to 2π)
    this.channel = 'left';          // 'left' or 'right'
    this.pulseId = -1;              // Unique pulse identifier
    
    // Timing control
    this.startSample = 0;           // When pulse triggered
    this.endSample = 0;             // When release should occur
    
    // Activity state
    this.active = false;
  }
  
  /**
   * Trigger voice with new pulse parameters
   * Called when pulse schedule position is reached
   * 
   * @param {Object} pulse - Pulse parameters from schedule
   * @param {number} currentSample - Current audio sample position
   */
  trigger(pulse, currentSample) {
    // Calculate frequency split based on channel (binaural-style)
    // Left: carrier - (beat/2), Right: carrier + (beat/2)
    if (pulse.channel === 'left') {
      this.frequency = pulse.carrierFrequency - (pulse.beatHz / 2);
    } else {
      this.frequency = pulse.carrierFrequency + (pulse.beatHz / 2);
    }
    
    this.channel = pulse.channel;
    this.pulseId = pulse.pulseId;
    this.startSample = currentSample;
    this.endSample = currentSample + pulse.durationSamples;
    this.phase = 0; // Reset phase for clean start
    this.active = true;
    this.envelope.trigger();
  }
  
  /**
   * Check if voice should enter release stage
   * Called every sample to compare currentSample vs endSample
   * 
   * @param {number} currentSample - Current audio sample position
   */
  checkRelease(currentSample) {
    if (this.active && currentSample >= this.endSample) {
      this.envelope.release();
    }
  }
  
  /**
   * Process one audio sample
   * Generates sine wave and applies envelope
   * 
   * @returns {number} Audio sample value (-1.0 to 1.0)
   */
  process() {
    if (!this.active) return 0;
    
    // Check if envelope finished (voice can become idle)
    if (!this.envelope.isActive()) {
      this.active = false;
      return 0;
    }
    
    // Generate sine wave sample
    // ω = 2πf / sampleRate (angular frequency)
    const omega = 2 * Math.PI * this.frequency / this.sampleRate;
    const sample = Math.sin(this.phase);
    this.phase += omega;
    
    // Wrap phase to prevent precision loss over time
    // Without this, phase → infinity and sine accuracy degrades
    if (this.phase >= 2 * Math.PI) {
      this.phase -= 2 * Math.PI;
    }
    
    // Apply envelope to sine wave
    const envelopeValue = this.envelope.process();
    return sample * envelopeValue;
  }
  
  /**
   * Check if voice is generating audio
   * 
   * @returns {boolean} True if voice is active
   */
  isActive() {
    return this.active;
  }
}


/**
 * ============================================================================
 * ISO PULSE PROCESSOR - Main AudioWorklet
 * ============================================================================
 * 
 * The central orchestrator running on the Audio Rendering Thread.
 * Manages voice pool, pulse scheduling, and audio output.
 * 
 * THREAD COMMUNICATION:
 *   Main → Worklet: postMessage({ type: 'schedule', pulses: [...] })
 *   Worklet → Main: postMessage({ type: 'initialized' })
 *   Worklet → Main: postMessage({ type: 'scheduleReceived' })
 * 
 * PROCESS LOOP (Called every 128 samples by browser):
 *   1. Check if pulses should trigger (currentSample >= pulse.samplePosition)
 *   2. Find free voice and trigger with pulse parameters
 *   3. Check if voices should release (currentSample >= endSample)
 *   4. Process all active voices (generate audio + apply envelope)
 *   5. Sum voices and route to L/R channels
 *   6. Write to output buffers
 *   7. Increment currentSample
 * 
 * SAMPLE-ACCURATE TIMING:
 *   - Integer comparison: currentSample >= pulse.samplePosition
 *   - No floating point error
 *   - Quantum = 128 samples but triggers are per-sample accurate
 *   - Example: pulse at sample 137 triggers on sample 137 (not 128 or 256)
 * 
 * VOICE STEALING:
 *   - 8 voices pre-allocated
 *   - If all busy, _findFreeVoice() returns null
 *   - Currently logs error (shouldn't happen with 8 voices + short pulses)
 *   - Future: Steal oldest voice or skip pulse
 * 
 * COMPLETION DETECTION:
 *   - All pulses triggered: nextPulseIndex >= pulseSchedule.length
 *   - All voices silent: voices.every(v => !v.isActive())
 *   - Returns false to stop process() loop
 */
class ISOPulseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    
    // Voice pool - Pre-allocate all voices at construction
    // 8 voices = 8 concurrent pulses (overlap during transitions)
    // Increase if voice stealing occurs
    this.voices = [];
    for (let i = 0; i < 8; i++) {
      this.voices.push(new Voice(sampleRate));
    }
    
    // Pulse schedule - Set by main thread via postMessage
    // Array of: {samplePosition, durationSamples, channel, carrierFrequency, pulseId}
    this.pulseSchedule = [];
    this.nextPulseIndex = 0;        // Next pulse to trigger
    
    // Sample counter - Increments every sample (0, 1, 2, 3...)
    // Used for sample-accurate pulse triggering
    this.currentSample = 0;
    
    // Stereo width control via panning
    // -1.0 = full left, 0 = center, +1.0 = full right
    // Width 100%: L=-1.0, R=+1.0 (full stereo)
    // Width 0%: L=0, R=0 (mono/center)
    this.leftPan = -1.0;   // L channel default: full left
    this.rightPan = 1.0;   // R channel default: full right
    
    // Message handler - Receive schedule from main thread
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
      } else if (event.data.type === 'setWidth') {
        // Update stereo width (pan positions)
        this.leftPan = event.data.panL;
        this.rightPan = event.data.panR;
      }
    };
    
    // Send initialization message to main thread
    // Confirms worklet is loaded and ready
    this.port.postMessage({ type: 'initialized', voiceCount: this.voices.length });
  }
  
  /**
   * Find a free (inactive) voice from the pool
   * 
   * @returns {Voice|null} Free voice, or null if all busy
   * @private
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
   * ============================================================================
   * PROCESS() - Main Audio Callback
   * ============================================================================
   * 
   * Called automatically by browser's Audio Rendering Thread.
   * Frequency: Every 128 samples (quantum size)
   * At 48kHz: ~375 times per second (~2.67ms between calls)
   * 
   * CRITICAL: This runs on real-time thread
   *   - Must complete in < 2.67ms (at 48kHz)
   *   - No dynamic allocation
   *   - No blocking operations
   *   - No console.log in production (slows thread)
   * 
   * @param {Float32Array[][]} inputs - Input audio (unused for generator)
   * @param {Float32Array[][]} outputs - Output audio buffers
   * @param {Object} parameters - AudioParam values (unused here)
   * @returns {boolean} True = keep processing, False = stop
   */
  process(inputs, outputs, parameters) {
    // Access stereo output buffers
    const outputL = outputs[0][0]; // Left channel buffer (128 samples)
    const outputR = outputs[0][1]; // Right channel buffer (128 samples)
    
    // Safety check - should never happen if outputChannelCount: [2]
    if (!outputL || !outputR) {
      this.port.postMessage({ type: 'error', message: 'No output buffers available' });
      return true;
    }
    
    const blockSize = outputL.length; // Always 128 (quantum size)
    
    // ========================================================================
    // SAMPLE LOOP - Process each of 128 samples in this quantum
    // ========================================================================
    for (let i = 0; i < blockSize; i++) {
      
      // ======================================================================
      // 1. PULSE TRIGGERING - Check if any pulses should start
      // ======================================================================
      // SAMPLE-ACCURATE: Compare integer sample positions
      // WHILE loop: Multiple pulses can trigger on same sample
      while (
        this.nextPulseIndex < this.pulseSchedule.length &&
        this.currentSample >= this.pulseSchedule[this.nextPulseIndex].samplePosition
      ) {
        const pulse = this.pulseSchedule[this.nextPulseIndex];
        const voice = this._findFreeVoice();
        
        if (voice) {
          // Trigger voice with pulse parameters
          voice.trigger(pulse, this.currentSample);
          
          // Notify main thread of first pulse (for debugging)
          if (this.nextPulseIndex === 0) {
            this.port.postMessage({ type: 'firstPulseTriggered', pulseId: pulse.pulseId });
          }
        } else {
          // Voice stealing would go here
          // Currently just log error (shouldn't happen)
          this.port.postMessage({ type: 'noFreeVoice', pulseId: pulse.pulseId });
        }
        
        this.nextPulseIndex++;
      }
      
      // ======================================================================
      // 2. RELEASE CHECK - Check if any voices should start release stage
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
          
          // Route voice to appropriate channel
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
      // Convert pan to L/R gains using constant power law
      // pan = -1: gainL=1, gainR=0 (full left)
      // pan = 0: gainL=0.707, gainR=0.707 (center)
      // pan = +1: gainL=0, gainR=1 (full right)
      
      const leftPanAngle = (this.leftPan + 1) * Math.PI / 4;  // 0 to π/2
      const leftGainL = Math.cos(leftPanAngle);
      const leftGainR = Math.sin(leftPanAngle);
      
      const rightPanAngle = (this.rightPan + 1) * Math.PI / 4; // 0 to π/2
      const rightGainL = Math.cos(rightPanAngle);
      const rightGainR = Math.sin(rightPanAngle);
      
      // Mix L/R voices into stereo output with panning
      const mixedL = (leftVoiceSample * leftGainL) + (rightVoiceSample * rightGainL);
      const mixedR = (leftVoiceSample * leftGainR) + (rightVoiceSample * rightGainR);
      
      // ======================================================================
      // 5. OUTPUT - Write mixed audio to output buffers
      // ======================================================================
      // -10dB gain (0.3) to prevent clipping when voices overlap
      outputL[i] = mixedL * 0.3;
      outputR[i] = mixedR * 0.3;
      
      // Increment sample counter for next sample
      this.currentSample++;
    }
    
    // ========================================================================
    // COMPLETION CHECK - Stop when done
    // ========================================================================
    const allVoicesSilent = this.voices.every(v => !v.isActive());
    const allPulsesProcessed = this.nextPulseIndex >= this.pulseSchedule.length;
    
    if (allVoicesSilent && allPulsesProcessed && this.pulseSchedule.length > 0) {
      // Return false to stop process() loop
      // Worklet will stop generating audio
      return false;
    }
    
    // Keep processing (return true = call process() again in ~2.67ms)
    return true;
  }
}

/**
 * ============================================================================
 * PROCESSOR REGISTRATION
 * ============================================================================
 * 
 * Register this processor with the AudioWorklet system.
 * Name must match addModule() call in main thread:
 * 
 * Main thread:
 *   await audioContext.audioWorklet.addModule('iso_worklet.js');
 *   const node = new AudioWorkletNode(audioContext, 'iso-pulse-processor');
 * 
 * This registration makes 'iso-pulse-processor' available as a worklet type.
 */
registerProcessor('iso-pulse-processor', ISOPulseProcessor);

