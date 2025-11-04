/**
 * ============================================================================
 * BINAURAL WORKLET - AudioWorklet Reference Implementation
 * ============================================================================
 * 
 * PURPOSE:
 * Sample-accurate binaural beat generator running on the Audio Rendering
 * Thread. Generates continuous tones with precise frequency control for
 * binaural beat synthesis.
 * 
 * ============================================================================
 * BINAURAL BEAT PRINCIPLE
 * ============================================================================
 * 
 * WHAT ARE BINAURAL BEATS:
 *   - Two slightly different frequencies played simultaneously (one per ear)
 *   - Brain perceives the DIFFERENCE as a "beat" frequency
 *   - Example: L=108Hz, R=112Hz → Perceived 4Hz beat
 * 
 * FREQUENCY CALCULATIONS:
 *   - Beat Frequency = difference between ears (typically 0.5-40Hz)
 *   - Left Frequency = carrier - (beat/2)
 *   - Right Frequency = carrier + (beat/2)
 *   - Carrier = base tone (e.g., 110Hz, 200Hz, 432Hz)
 * 
 * EXAMPLE:
 *   - Carrier: 110Hz
 *   - Beat: 4Hz (theta wave)
 *   - Left: 110 - 2 = 108Hz
 *   - Right: 110 + 2 = 112Hz
 *   - Perceived: 4Hz beat in brain
 * 
 * ============================================================================
 * AUDIOWORKLET THREAD MODEL
 * ============================================================================
 * 
 * MAIN THREAD (JavaScript):
 *   - UI updates, event handlers, timeline calculations
 *   - Sends parameter updates via postMessage()
 *   - Sets carrier frequency, beat frequency, width, volume
 * 
 * AUDIO RENDERING THREAD (This Worklet):
 *   - HIGH PRIORITY real-time thread
 *   - Runs every 128 samples (~2.9ms at 48kHz)
 *   - process() called automatically by browser
 *   - Generates sine waves with sample-accurate precision
 *   - Protected from main thread interference (GC, UI, etc.)
 * 
 * WHY THIS WORKS:
 *   - Zero jitter from browser event loop
 *   - Sample-accurate frequency control (no setTimeout precision issues)
 *   - Continuous generation (no gaps or clicks)
 *   - OS gives audio thread highest priority
 *   - Zero garbage collection pressure
 * 
 * ============================================================================
 * ARCHITECTURE
 * ============================================================================
 * 
 * COMPONENTS:
 *   1. Voice - Single continuous sine wave generator (L or R channel)
 *   2. BinauralProcessor - Main worklet managing L/R voice pair
 * 
 * VOICE MANAGEMENT:
 *   - 2 voices total: 1 LEFT + 1 RIGHT
 *   - Each voice runs continuously when active
 *   - Phase accumulation for sine wave generation
 *   - Per-voice frequency and pan control
 * 
 * PARAMETER CONTROL:
 *   - Real-time updates via postMessage()
 *   - Carrier frequency: base tone Hz
 *   - Beat frequency: difference between ears
 *   - Width: stereo separation (0.0-1.0)
 *   - Volume: output gain (dB)
 * 
 * ============================================================================
 * MESSAGE PROTOCOL
 * ============================================================================
 * 
 * Main thread sends parameter updates:
 * 
 * {
 *   type: 'setFrequencies',
 *   leftFreq: 108,      // Left ear Hz
 *   rightFreq: 112      // Right ear Hz
 * }
 * 
 * {
 *   type: 'setWidth',
 *   panL: -0.8,         // Left pan (-1.0 to 1.0)
 *   panR: 0.8           // Right pan (-1.0 to 1.0)
 * }
 * 
 * {
 *   type: 'setVolume',
 *   gainDb: -12.5       // Volume in dB
 * }
 * 
 * {
 *   type: 'start'       // Begin audio generation
 * }
 * 
 * {
 *   type: 'stop'        // Stop audio generation
 * }
 * 
 * ============================================================================
 * FACTORY PATTERN NOTES (For Future Worklets)
 * ============================================================================
 * 
 * TEMPLATE STRUCTURE:
 *   1. Voice class (oscillator generation)
 *   2. Main AudioWorkletProcessor class
 *   3. registerProcessor() call
 * 
 * CUSTOMIZATION POINTS:
 *   - Oscillator type (sine, square, saw, noise)
 *   - Voice count (2 for binaural, 10 for iso, etc.)
 *   - Parameter message types
 *   - Effects (filtering, modulation, etc.)
 * 
 * PRESERVE PATTERNS:
 *   - postMessage communication (parameter updates)
 *   - process() loop structure (generate → mix → output)
 *   - Phase accumulation (wrapping to prevent precision loss)
 *   - Real-time parameter interpolation
 * 
 * ============================================================================
 */

/**
 * ============================================================================
 * VOICE - Single Continuous Sine Wave Generator
 * ============================================================================
 * 
 * Represents one continuous tone (either LEFT or RIGHT ear).
 * Runs continuously when active, generates sine wave samples.
 * 
 * LIFECYCLE:
 *   1. Created once during initialization
 *   2. start() → active = true
 *   3. Generate audio samples continuously
 *   4. stop() → active = false
 * 
 * OSCILLATOR:
 *   - Simple sine wave generation
 *   - Phase accumulation (ω = 2πf / sampleRate)
 *   - Phase wrapping to prevent precision loss
 * 
 * MEMORY EFFICIENCY:
 *   - Voice object persists (no allocation)
 *   - Only frequency/pan parameters change
 *   - Zero GC pressure during audio generation
 */
class Voice {
  constructor(sampleRate, channel) {
    this.sampleRate = sampleRate;
    this.channel = channel; // 'left' or 'right'
    
    // Oscillator state
    this.frequency = 110;           // Current frequency in Hz
    this.phase = 0;                 // Oscillator phase (0 to 2π)
    
    // Panning (-1.0 = full left, 0 = center, +1.0 = full right)
    this.pan = channel === 'left' ? -1.0 : 1.0;
    
    // Activity state
    this.active = false;
    
    // Scheduled frequency events (sorted by time, processed in order)
    this.scheduledEvents = []; // [{ startFreq, endFreq, startTime, endTime, duration }]
    
    // Currently active ramp (from scheduledEvents)
    this.activeRamp = null;
  }
  
  /**
   * Start voice (begin audio generation)
   */
  start() {
    this.active = true;
    this.phase = 0; // Reset phase for clean start
    this.activeRamp = null;
    // Keep scheduledEvents - they'll be processed by getCurrentFrequency()
  }
  
  /**
   * Stop voice (end audio generation)
   */
  stop() {
    this.active = false;
    this.activeRamp = null;
    this.scheduledEvents = []; // Clear all pending events
  }
  
  /**
   * Set frequency for this voice (immediate change)
   * @param {number} freq - Frequency in Hz
   */
  setFrequency(freq) {
    this.frequency = freq;
    // Clear all scheduled events - immediate override
    this.scheduledEvents = [];
    this.activeRamp = null;
  }
  
  /**
   * Schedule frequency ramp for smooth transitions
   * Adds event to queue, sorted by startTime
   * @param {number} startFreq - Starting frequency in Hz
   * @param {number} endFreq - Ending frequency in Hz
   * @param {number} startTime - Start time in seconds (Web Audio time)
   * @param {number} endTime - End time in seconds (Web Audio time)
   */
  scheduleFrequencyRamp(startFreq, endFreq, startTime, endTime) {
    // Add event to queue
    const event = {
      startFreq: startFreq,
      endFreq: endFreq,
      startTime: startTime,
      endTime: endTime,
      duration: endTime - startTime
    };
    
    this.scheduledEvents.push(event);
    
    // Sort by startTime (earliest first)
    this.scheduledEvents.sort((a, b) => a.startTime - b.startTime);
  }
  
  /**
   * Get current frequency (interpolated if ramping)
   * Processes scheduledEvents queue in order
   * @param {number} currentTime - Current Web Audio time
   * @returns {number} Current frequency in Hz
   */
  getCurrentFrequency(currentTime) {
    // If no scheduled events, return base frequency
    if (this.scheduledEvents.length === 0 && !this.activeRamp) {
      return this.frequency;
    }
    
    // Check if we need to activate the next scheduled event
    while (this.scheduledEvents.length > 0 && currentTime >= this.scheduledEvents[0].startTime) {
      this.activeRamp = this.scheduledEvents.shift(); // Remove from queue and activate
      this.frequency = this.activeRamp.startFreq; // Update base frequency
    }
    
    // If no active ramp, return base frequency
    if (!this.activeRamp) {
      return this.frequency;
    }
    
    // Check if ramp is complete
    if (currentTime >= this.activeRamp.endTime) {
      // Ramp completed - set final frequency and clear ramp
      this.frequency = this.activeRamp.endFreq;
      this.activeRamp = null;
      return this.frequency;
    }
    
    // Linear interpolation during ramp
    const elapsed = currentTime - this.activeRamp.startTime;
    const progress = elapsed / this.activeRamp.duration; // 0.0 to 1.0
    return this.activeRamp.startFreq + (this.activeRamp.endFreq - this.activeRamp.startFreq) * progress;
  }
  
  /**
   * Set pan position for this voice
   * @param {number} panValue - Pan (-1.0 to 1.0)
   */
  setPan(panValue) {
    this.pan = Math.max(-1.0, Math.min(1.0, panValue));
  }
  
  /**
   * Process one audio sample
   * Generates sine wave and returns value
   * 
   * @param {number} currentTime - Current Web Audio time for frequency interpolation
   * @returns {number} Audio sample value (-1.0 to 1.0)
   */
  process(currentTime) {
    if (!this.active) return 0;
    
    // Get current frequency (interpolated if ramping)
    const freq = this.getCurrentFrequency(currentTime);
    
    // Generate sine wave sample
    // ω = 2πf / sampleRate (angular frequency)
    const omega = 2 * Math.PI * freq / this.sampleRate;
    const sample = Math.sin(this.phase);
    this.phase += omega;
    
    // Wrap phase to prevent precision loss over time
    // Without this, phase → infinity and sine accuracy degrades
    if (this.phase >= 2 * Math.PI) {
      this.phase -= 2 * Math.PI;
    }
    
    return sample;
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
 * BINAURAL PROCESSOR - Main AudioWorklet
 * ============================================================================
 * 
 * The central orchestrator running on the Audio Rendering Thread.
 * Manages L/R voice pair and routes audio to stereo output.
 * 
 * THREAD COMMUNICATION:
 *   Main → Worklet: postMessage({ type: 'setFrequencies', leftFreq: 108, rightFreq: 112 })
 *   Main → Worklet: postMessage({ type: 'setWidth', panL: -0.8, panR: 0.8 })
 *   Main → Worklet: postMessage({ type: 'setVolume', gainDb: -12 })
 *   Main → Worklet: postMessage({ type: 'start' })
 *   Main → Worklet: postMessage({ type: 'stop' })
 *   Worklet → Main: postMessage({ type: 'initialized' })
 * 
 * PROCESS LOOP (Called every 128 samples by browser):
 *   1. Process left voice (generate sine wave sample)
 *   2. Process right voice (generate sine wave sample)
 *   3. Apply panning to route voice to L/R output channels
 *   4. Apply volume gain
 *   5. Write to output buffers
 * 
 * SAMPLE-ACCURATE GENERATION:
 *   - Each sample calculated individually
 *   - No interpolation or approximation
 *   - Continuous phase accumulation for smooth sine waves
 *   - Zero clicks or artifacts
 * 
 * PANNING:
 *   - Constant power panning law
 *   - Left voice mostly in L channel, Right voice mostly in R channel
 *   - Width control adjusts pan positions
 *   - 0% width = both center (mono), 100% width = full stereo
 */
class BinauralProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    
    // Voice pair - LEFT and RIGHT ears
    this.leftVoice = new Voice(sampleRate, 'left');
    this.rightVoice = new Voice(sampleRate, 'right');
    
    // Volume control
    this.volume = 0.3; // Linear gain (0.0 to 1.0)
    
    // Debug logging (active only when voices are running)
    this.debugCounter = 0;
    this.lastReportTime = 0;
    this.reportInterval = 1.0; // Report beat frequency every 1 second
    
    // Message handler - Receive parameter updates from main thread
    this.port.onmessage = (event) => {
      const { type } = event.data;
      
      switch (type) {
        case 'setFrequencies':
          // Update L/R frequencies for binaural beat (immediate)
          this.leftVoice.setFrequency(event.data.leftFreq);
          this.rightVoice.setFrequency(event.data.rightFreq);
          this.port.postMessage({ type: 'debug', msg: `setFrequencies: L=${event.data.leftFreq}Hz, R=${event.data.rightFreq}Hz` });
          break;
          
        case 'scheduleFrequencies':
          // Schedule instant frequency change at specific time (plateau events)
          const { leftFreq, rightFreq, time, rampDuration } = event.data;
          this.port.postMessage({ type: 'debug', msg: `scheduleFrequencies: L=${leftFreq}Hz, R=${rightFreq}Hz at ${time}s, rampDuration=${rampDuration}` });
          if (rampDuration === 0) {
            // Instant change via zero-duration ramp (applies when currentTime >= time)
            this.port.postMessage({ type: 'debug', msg: `🔧 Scheduling instant change: L=${leftFreq}Hz, R=${rightFreq}Hz at ${time}s` });
            this.leftVoice.scheduleFrequencyRamp(leftFreq, leftFreq, time, time + 0.001);
            this.rightVoice.scheduleFrequencyRamp(rightFreq, rightFreq, time, time + 0.001);
            this.port.postMessage({ type: 'debug', msg: `🔧 Scheduled: leftVoice.scheduledCount=${this.leftVoice.scheduledEvents.length}, leftVoice.frequency=${this.leftVoice.frequency}` });
          }
          break;
          
        case 'scheduleFrequencyRamp':
          // Schedule smooth frequency ramp (for timeline transitions)
          const data = event.data;
          this.port.postMessage({ type: 'debug', msg: `scheduleFrequencyRamp: L=${data.startLeftFreq}→${data.endLeftFreq}Hz, R=${data.startRightFreq}→${data.endRightFreq}Hz` });
          this.leftVoice.scheduleFrequencyRamp(
            data.startLeftFreq,
            data.endLeftFreq,
            data.startTime,
            data.endTime
          );
          this.rightVoice.scheduleFrequencyRamp(
            data.startRightFreq,
            data.endRightFreq,
            data.startTime,
            data.endTime
          );
          break;
          
        case 'setWidth':
          // Update stereo width (pan positions)
          this.leftVoice.setPan(event.data.panL);
          this.rightVoice.setPan(event.data.panR);
          break;
          
        case 'setVolume':
          // Convert dB to linear gain
          // dB = 20 * log10(gain) → gain = 10^(dB/20)
          const gainDb = event.data.gainDb;
          this.volume = gainDb === -Infinity ? 0 : Math.pow(10, gainDb / 20);
          break;
          
        case 'start':
          // Start audio generation and reset debug counters
          this.leftVoice.start();
          this.rightVoice.start();
          this.debugCounter = 0;
          this.lastReportTime = 0;
          this.port.postMessage({ type: 'started' });
          break;
          
        case 'stop':
          // Stop audio generation and halt debug logging
          this.leftVoice.stop();
          this.rightVoice.stop();
          this.debugCounter = 0;
          this.lastReportTime = 0;
          this.port.postMessage({ type: 'stopped' });
          break;
      }
    };
    
    // Send initialization message to main thread
    // Confirms worklet is loaded and ready
    this.port.postMessage({ type: 'initialized' });
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
   * CRITICAL: Runs on high-priority real-time audio thread
   *   - Must complete in < 2.67ms (at 48kHz)
   *   - No dynamic allocation
   *   - No blocking operations
   *   - Debug logging via postMessage (minimal overhead)
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
    
    // Get current time for frequency interpolation (from AudioContext)
    const audioTime = currentTime;
    
    // ========================================================================
    // SAMPLE LOOP - Process each of 128 samples in this quantum
    // ========================================================================
    for (let i = 0; i < blockSize; i++) {
      
      // ======================================================================
      // 1. VOICE PROCESSING - Generate audio from L/R voices
      // ======================================================================
      
      // Debug logging (only when voices are active)
      if (this.leftVoice.active || this.rightVoice.active) {
        this.debugCounter++;
        if (this.debugCounter >= 48000) { // Every ~1 second at 48kHz
          const leftFreq = this.leftVoice.getCurrentFrequency(audioTime);
          const rightFreq = this.rightVoice.getCurrentFrequency(audioTime);
          const beatHz = Math.abs(rightFreq - leftFreq);
          this.port.postMessage({ 
            type: 'debug', 
            msg: `🔍 Voice.getCurrentFrequency() returns: L=${leftFreq.toFixed(2)}Hz, R=${rightFreq.toFixed(2)}Hz, Beat=${beatHz.toFixed(2)}Hz (time=${audioTime.toFixed(2)}s)` 
          });
          
          this.port.postMessage({ 
            type: 'debug', 
            msg: `🔍 Left Voice State: frequency=${this.leftVoice.frequency.toFixed(2)}Hz, hasActiveRamp=${!!this.leftVoice.activeRamp}, scheduledCount=${this.leftVoice.scheduledEvents.length}` 
          });
          if (this.leftVoice.activeRamp) {
            this.port.postMessage({ 
              type: 'debug', 
              msg: `🔍 Left Active Ramp: ${this.leftVoice.activeRamp.startFreq.toFixed(2)}→${this.leftVoice.activeRamp.endFreq.toFixed(2)}Hz, ${this.leftVoice.activeRamp.startTime.toFixed(2)}→${this.leftVoice.activeRamp.endTime.toFixed(2)}s` 
            });
          }
          
          this.debugCounter = 0;
        }
      }
      
      const leftSample = this.leftVoice.process(audioTime);
      const rightSample = this.rightVoice.process(audioTime);
      
      // ======================================================================
      // 2. PANNING - Apply constant power panning
      // ======================================================================
      // Constant power pan law: maintain perceived loudness across pan range
      // Left voice: mostly in L output, some in R based on pan
      // Right voice: mostly in R output, some in L based on pan
      
      const leftPan = this.leftVoice.pan;   // -1.0 to 1.0
      const rightPan = this.rightVoice.pan; // -1.0 to 1.0
      
      // Convert pan to L/R gains using constant power law
      // pan = -1: gainL=1, gainR=0 (full left)
      // pan = 0: gainL=0.707, gainR=0.707 (center)
      // pan = +1: gainL=0, gainR=1 (full right)
      
      const leftPanAngle = (leftPan + 1) * Math.PI / 4;  // 0 to π/2
      const leftGainL = Math.cos(leftPanAngle);
      const leftGainR = Math.sin(leftPanAngle);
      
      const rightPanAngle = (rightPan + 1) * Math.PI / 4; // 0 to π/2
      const rightGainL = Math.cos(rightPanAngle);
      const rightGainR = Math.sin(rightPanAngle);
      
      // ======================================================================
      // 3. MIXING - Combine L/R voices into stereo output
      // ======================================================================
      const mixedL = (leftSample * leftGainL) + (rightSample * rightGainL);
      const mixedR = (leftSample * leftGainR) + (rightSample * rightGainR);
      
      // ======================================================================
      // 4. OUTPUT - Apply volume and write to buffers
      // ======================================================================
      outputL[i] = mixedL * this.volume;
      outputR[i] = mixedR * this.volume;
    }
    
    // ========================================================================
    // DEBUG REPORTING - Periodic beat frequency logging (only when active)
    // ========================================================================
    if ((this.leftVoice.active || this.rightVoice.active) && audioTime - this.lastReportTime >= this.reportInterval) {
      const leftFreq = this.leftVoice.getCurrentFrequency(audioTime);
      const rightFreq = this.rightVoice.getCurrentFrequency(audioTime);
      const beatHz = Math.abs(rightFreq - leftFreq);
      this.port.postMessage({ 
        type: 'debug', 
        msg: `🎧 Worklet Beat: ${beatHz.toFixed(2)}Hz (L=${leftFreq.toFixed(2)}Hz, R=${rightFreq.toFixed(2)}Hz) at ${audioTime.toFixed(2)}s` 
      });
      this.lastReportTime = audioTime;
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
 *   await audioContext.audioWorklet.addModule('binaural_worklet.js');
 *   const node = new AudioWorkletNode(audioContext, 'binaural-processor');
 * 
 * This registration makes 'binaural-processor' available as a worklet type.
 */
registerProcessor('binaural-processor', BinauralProcessor);
