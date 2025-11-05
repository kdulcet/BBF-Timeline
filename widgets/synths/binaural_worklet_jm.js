/**
 * ============================================================================
 * BINAURAL WORKLET - On-Demand Journey Map Calculation
 * ============================================================================
 * 
 * PURPOSE:
 * Sample-accurate binaural beat generator that calculates Hz continuously
 * from journey map segments. Single source of truth ensures perfect
 * synchronization with timeline.
 * 
 * ARCHITECTURE:
 * - Receives journey map segments once at start
 * - Calculates beat Hz per-sample from segments
 * - Generates L/R frequencies: carrier ± (beatHz/2)
 * - Continuous tone generation (not discrete pulses)
 * 
 * DIFFERENCE FROM ISO WORKLET:
 * - ISO: Discrete pulses, check every N samples for triggers
 * - Binaural: Continuous tones, calculate Hz every sample
 * - Both: Use same segments → perfect sync
 * 
 * ============================================================================
 */

/**
 * ============================================================================
 * HELPER FUNCTIONS (Copied inline from jm_worklet_helper.js)
 * ============================================================================
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

/**
 * ============================================================================
 * VOICE - Single Continuous Sine Wave Generator
 * ============================================================================
 */
class Voice {
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this.frequency = 110;
    this.phase = 0;
    this.pan = 0;  // -1.0 (left) to 1.0 (right)
    this.active = false;
  }
  
  setFrequency(freq) {
    this.frequency = freq;
  }
  
  setPan(panValue) {
    this.pan = Math.max(-1.0, Math.min(1.0, panValue));
  }
  
  start() {
    this.active = true;
    this.phase = 0;
  }
  
  stop() {
    this.active = false;
  }
  
  isActive() {
    return this.active;
  }
  
  process() {
    if (!this.active) return 0;
    
    const omega = 2 * Math.PI * this.frequency / this.sampleRate;
    const sample = Math.sin(this.phase);
    this.phase += omega;
    
    if (this.phase >= 2 * Math.PI) {
      this.phase -= 2 * Math.PI;
    }
    
    return sample;
  }
}

/**
 * ============================================================================
 * BINAURAL PROCESSOR - On-Demand Calculation
 * ============================================================================
 */
class BinauralProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    
    // L/R voices
    this.leftVoice = new Voice(sampleRate);
    this.rightVoice = new Voice(sampleRate);
    
    // Journey map data
    this.rawSegments = [];
    this.compiledSegments = [];
    this.carrierFrequency = 200;
    
    // Stereo width control
    this.leftPan = -1.0;
    this.rightPan = 1.0;
    
    // Volume control
    this.volumeGain = 1.0;
    
    // Timing
    this.currentSample = 0;
    this.totalDurationSamples = 0;
    this.isLoaded = false;
    this.isPlaying = false;
    
    // ========================================================================
    // TRIGGER DETECTION SYSTEM (Phase 1 - Non-Destructive)
    // ========================================================================
    // Zero-crossing detection for peak timing extraction
    this.triggerEnabled = true;  // Enable trigger detection
    this.lastDiff = 0;           // Previous L-R difference sample
    this.cooldownCounter = 0;    // Samples until next trigger allowed
    this.triggerCount = 0;       // Total triggers detected
    this.lastTriggerSample = 0;  // Sample position of last trigger
    
    // Message handler
    this.port.onmessage = (event) => {
      if (event.data.type === 'loadJourneyMap') {
        this.rawSegments = event.data.segments;
        this.compiledSegments = compileSegments(this.rawSegments);
        this.carrierFrequency = event.data.carrierFrequency || 200;
        
        // Calculate total duration
        const lastSegment = this.compiledSegments[this.compiledSegments.length - 1];
        this.totalDurationSamples = lastSegment ? Math.round(lastSegment.endTime * sampleRate) : 0;
        
        // Reset state
        this.currentSample = 0;
        this.isLoaded = true;
        
        // Send confirmation
        this.port.postMessage({
          type: 'journeyMapLoaded',
          segmentCount: this.rawSegments.length,
          totalDurationSeconds: this.totalDurationSamples / sampleRate
        });
        
      } else if (event.data.type === 'start') {
        if (this.isLoaded) {
          this.leftVoice.start();
          this.rightVoice.start();
          this.isPlaying = true;
          this.currentSample = 0;
          this.port.postMessage({ type: 'started' });
        }
        
      } else if (event.data.type === 'stop') {
        this.leftVoice.stop();
        this.rightVoice.stop();
        this.isPlaying = false;
        this.port.postMessage({ type: 'stopped' });
        
      } else if (event.data.type === 'setWidth') {
        this.leftPan = event.data.panL;
        this.rightPan = event.data.panR;
        
      } else if (event.data.type === 'setVolume') {
        // Convert dB to linear gain
        this.volumeGain = Math.pow(10, event.data.gainDb / 20);
        
      } else if (event.data.type === 'setCarrier') {
        this.carrierFrequency = event.data.frequency;
        
      } else if (event.data.type === 'enableTriggers') {
        this.triggerEnabled = event.data.enabled;
        this.port.postMessage({ 
          type: 'triggersEnabled', 
          enabled: this.triggerEnabled 
        });
      }
    };
    
    this.port.postMessage({ type: 'initialized' });
  }
  
  /**
   * ============================================================================
   * PROCESS() - Main Audio Callback with On-Demand Calculation
   * ============================================================================
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
    
    const blockSize = outputL.length;
    
    // ========================================================================
    // SAMPLE LOOP - Process each of 128 samples
    // ========================================================================
    for (let i = 0; i < blockSize; i++) {
      
      // ======================================================================
      // 1. CALCULATE BEAT HZ - On-demand from segments
      // ======================================================================
      const beatHz = getHzAtSample(this.compiledSegments, this.currentSample, sampleRate);
      
      // ======================================================================
      // 2. CALCULATE L/R FREQUENCIES - Binaural formula
      // ======================================================================
      // Left = carrier - (beat/2), Right = carrier + (beat/2)
      const leftFreq = this.carrierFrequency - (beatHz / 2);
      const rightFreq = this.carrierFrequency + (beatHz / 2);
      
      // ======================================================================
      // 3. UPDATE VOICE FREQUENCIES
      // ======================================================================
      this.leftVoice.setFrequency(leftFreq);
      this.rightVoice.setFrequency(rightFreq);
      
      // ======================================================================
      // 4. GENERATE AUDIO
      // ======================================================================
      const leftSample = this.leftVoice.process();
      const rightSample = this.rightVoice.process();
      
      // ======================================================================
      // 5. STEREO WIDTH MIXING - Apply constant-power panning
      // ======================================================================
      const leftPanAngle = (this.leftPan + 1) * Math.PI / 4;
      const leftGainL = Math.cos(leftPanAngle);
      const leftGainR = Math.sin(leftPanAngle);
      
      const rightPanAngle = (this.rightPan + 1) * Math.PI / 4;
      const rightGainL = Math.cos(rightPanAngle);
      const rightGainR = Math.sin(rightPanAngle);
      
      const mixedL = (leftSample * leftGainL) + (rightSample * rightGainL);
      const mixedR = (leftSample * leftGainR) + (rightSample * rightGainR);
      
      // ======================================================================
      // 6. OUTPUT - Write mixed audio with volume control
      // ======================================================================
      outputL[i] = mixedL * this.volumeGain * 0.3;  // 0.3 for safety
      outputR[i] = mixedR * this.volumeGain * 0.3;
      
      // ======================================================================
      // 7. TRIGGER DETECTION - Phase 1: Console logging (Non-destructive)
      // ======================================================================
      if (this.triggerEnabled) {
        // Calculate L-R difference (timing extraction signal)
        const diff = outputL[i] - outputR[i];
        const absDiff = Math.abs(diff);
        
        // Decrement cooldown if active
        if (this.cooldownCounter > 0) {
          this.cooldownCounter--;
        } else {
          // PEAK DETECTION: Trigger when amplitude exceeds threshold
          // and is greater than previous sample (rising to peak)
          const threshold = 0.27;  // Adjust this value (0.0 to 1.0)
          
          if (absDiff > threshold && absDiff > Math.abs(this.lastDiff)) {
            // TRIGGER DETECTED (PEAK)
            this.triggerCount++;
            
            // Calculate adaptive cooldown (full beat period)
            const beatPeriodSamples = sampleRate / beatHz;
            this.cooldownCounter = Math.floor(beatPeriodSamples * 0.9);  // 90% of beat period
            
            // Calculate time since last trigger
            const samplesSinceLastTrigger = this.currentSample - this.lastTriggerSample;
            const timeSinceLastTrigger = (samplesSinceLastTrigger / sampleRate * 1000).toFixed(2);
            
            // Log trigger event
            console.log(
              `🎯 Trigger #${this.triggerCount} @ sample ${this.currentSample + i}, ` +
              `beatHz=${beatHz.toFixed(2)}, peak=${absDiff.toFixed(3)}, ` +
              `cooldown=${this.cooldownCounter} samples (${(this.cooldownCounter / sampleRate * 1000).toFixed(2)}ms), ` +
              `interval=${timeSinceLastTrigger}ms`
            );
            
            // Send trigger event to main thread (for ISO worklet)
            this.port.postMessage({
              type: 'trigger',
              triggerCount: this.triggerCount,
              beatHz: beatHz,
              samplePosition: this.currentSample + i,
              peakAmplitude: absDiff
            });
            
            this.lastTriggerSample = this.currentSample + i;
          }
        }
        
        // Store for next iteration
        this.lastDiff = diff;
      }
      
      this.currentSample++;
      
      // Check if past timeline end
      if (this.currentSample >= this.totalDurationSamples) {
        this.port.postMessage({ type: 'completed' });
        this.isPlaying = false;
        this.leftVoice.stop();
        this.rightVoice.stop();
        return true;
      }
    }
    
    return true;  // Keep processing
  }
}

registerProcessor('binaural-processor-jm', BinauralProcessor);
