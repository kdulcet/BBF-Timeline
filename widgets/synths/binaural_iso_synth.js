/**
 * ============================================================================
 * BINAURAL-ISO COMBINED SYNTH - Main Thread Wrapper
 * ============================================================================
 * 
 * PURPOSE:
 * JavaScript wrapper for binaural_iso_worklet.js, providing a simple API for
 * loading the combined worklet and controlling it from the main thread.
 * 
 * USAGE:
 * ```javascript
 * const synth = new BinauralISOSynth(audioContext);
 * await synth.init();
 * synth.loadJourneyMap(segments, carrierHz);
 * synth.start();
 * synth.setCrossfade(0.5);  // 50/50 mix
 * synth.setCarrierOctave(1);  // +1 octave
 * synth.setVolume(0.7);
 * synth.setWidth(50);  // 50% width
 * synth.setDutyCycle(1.5);
 * synth.stop();
 * ```
 * 
 * ============================================================================
 */

class BinauralISOSynth {
  constructor(audioContext) {
    this.audioContext = audioContext;
    this.workletNode = null;
    this.isInitialized = false;
    this.isPlaying = false;
    
    // Current settings (for tracking)
    this.currentVolume = 1.0;
    this.currentCrossfade = 0.5;  // 50/50 mix by default
    this.currentDutyCycle = 1.5;  // ISO default
    this.currentCarrierOctave = 0;
    this.currentWidth = 100;  // 100% width
    this.currentCarrierFrequency = 110;
  }
  
  /**
   * Initialize worklet (load AudioWorkletModule)
   */
  async init() {
    if (this.isInitialized) return;
    
    try {
      // Load worklet module
      await this.audioContext.audioWorklet.addModule('widgets/synths/binaural_iso_worklet.js');
      
      // Create worklet node with stereo output
      this.workletNode = new AudioWorkletNode(this.audioContext, 'binaural-iso-processor', {
        outputChannelCount: [2]  // Stereo output (L + R channels)
      });
      
      // Connect to output
      this.workletNode.connect(this.audioContext.destination);
      
      // Setup message listener
      this.workletNode.port.onmessage = (event) => {
        this._handleWorkletMessage(event.data);
      };
      
      this.isInitialized = true;
      console.log('[BinauralISOSynth] Initialized - combined worklet loaded');
      
    } catch (error) {
      console.error('[BinauralISOSynth] Failed to initialize:', error);
      throw error;
    }
  }
  
  /**
   * Handle messages from worklet
   */
  _handleWorkletMessage(data) {
    switch (data.type) {
      case 'initialized':
        console.log('[BinauralISOSynth] Worklet initialized');
        break;
        
      case 'journeyMapLoaded':
        console.log(`[BinauralISOSynth] Journey map loaded: ${data.segmentCount} segments, ${data.totalDurationSeconds.toFixed(2)}s`);
        // Resolve promise if waiting
        if (this._journeyMapLoadResolve) {
          this._journeyMapLoadResolve();
          this._journeyMapLoadResolve = null;
        }
        break;
        
      case 'started':
        this.isPlaying = true;
        console.log('[BinauralISOSynth] Playback started');
        break;
        
      case 'stopped':
        this.isPlaying = false;
        console.log('[BinauralISOSynth] Playback stopped');
        break;
        
      case 'completed':
        this.isPlaying = false;
        console.log('[BinauralISOSynth] Journey map completed');
        break;
        
      default:
        console.log('[BinauralISOSynth] Unknown message:', data);
    }
  }
  
  /**
   * Load journey map segments
   * @param {Array} segments - Journey map segments
   * @param {number} carrierFrequency - Carrier frequency in Hz (default: 110)
   * @returns {Promise} Resolves when worklet confirms journey map loaded
   */
  loadJourneyMap(segments, carrierFrequency = 110) {
    if (!this.isInitialized) {
      console.error('[BinauralISOSynth] Not initialized - call init() first');
      return Promise.reject(new Error('Not initialized'));
    }
    
    this.currentCarrierFrequency = carrierFrequency;
    
    // Return promise that resolves when worklet confirms load
    return new Promise((resolve) => {
      this._journeyMapLoadResolve = resolve;
      
      this.workletNode.port.postMessage({
        type: 'loadJourneyMap',
        segments: segments,
        carrierFrequency: carrierFrequency
      });
    });
  }
  
  /**
   * Start playback
   */
  start() {
    if (!this.isInitialized) {
      console.error('[BinauralISOSynth] Not initialized - call init() first');
      return;
    }
    
    this.workletNode.port.postMessage({ type: 'start' });
  }
  
  /**
   * Stop playback
   */
  stop() {
    if (!this.isInitialized) {
      console.error('[BinauralISOSynth] Not initialized - call init() first');
      return;
    }
    
    this.workletNode.port.postMessage({ type: 'stop' });
  }
  
  /**
   * Set volume (0.0-1.0)
   * @param {number} volume - Volume level (0.0 = silent, 1.0 = full)
   */
  setVolume(volume) {
    if (!this.isInitialized) return;
    
    this.currentVolume = Math.max(0.0, Math.min(1.0, volume));
    
    this.workletNode.port.postMessage({
      type: 'setVolume',
      gain: this.currentVolume
    });
  }
  
  /**
   * Set crossfade (0.0-1.0)
   * @param {number} crossfade - Crossfade position (0.0 = pure binaural, 1.0 = pure ISO)
   */
  setCrossfade(crossfade) {
    if (!this.isInitialized) return;
    
    this.currentCrossfade = Math.max(0.0, Math.min(1.0, crossfade));
    
    this.workletNode.port.postMessage({
      type: 'setCrossfade',
      value: this.currentCrossfade
    });
  }
  
  /**
   * Set duty cycle (ISO pulse duration, typically 0.5-2.0)
   * @param {number} dutyCycle - Duty cycle multiplier (1.0 = pulse equals interval)
   */
  setDutyCycle(dutyCycle) {
    if (!this.isInitialized) return;
    
    this.currentDutyCycle = Math.max(0.5, Math.min(3.0, dutyCycle));
    
    this.workletNode.port.postMessage({
      type: 'setDutyCycle',
      dutyCycle: this.currentDutyCycle
    });
  }
  
  /**
   * Set carrier octave (-2 to +2)
   * @param {number} octave - Octave shift (-2, -1, 0, +1, +2)
   */
  setCarrierOctave(octave) {
    if (!this.isInitialized) return;
    
    this.currentCarrierOctave = Math.max(-2, Math.min(2, octave));
    
    this.workletNode.port.postMessage({
      type: 'setCarrierOctave',
      octave: this.currentCarrierOctave
    });
  }
  
  /**
   * Set stereo width (0-100) - applies to both ISO and Binaural
   * @param {number} width - Width percentage (0 = mono, 100 = full stereo)
   */
  setWidth(width) {
    if (!this.isInitialized) return;
    
    this.currentWidth = Math.max(0, Math.min(100, width));
    
    // Convert 0-100 to pan values (-1.0 to +1.0)
    const normalizedWidth = this.currentWidth / 100.0;
    const leftPan = -normalizedWidth;  // Full left when width=100
    const rightPan = normalizedWidth;  // Full right when width=100
    
    this.workletNode.port.postMessage({
      type: 'setWidth',
      panL: leftPan,
      panR: rightPan
    });
  }
  
  /**
   * Set ISO stereo width (0-100)
   * @param {number} width - Width percentage (0 = mono, 100 = full stereo)
   */
  setWidthISO(width) {
    if (!this.isInitialized) return;
    
    const widthValue = Math.max(0, Math.min(100, width));
    
    // Convert 0-100 to pan values (-1.0 to +1.0)
    const normalizedWidth = widthValue / 100.0;
    const leftPan = -normalizedWidth;
    const rightPan = normalizedWidth;
    
    this.workletNode.port.postMessage({
      type: 'setWidthISO',
      panL: leftPan,
      panR: rightPan
    });
  }
  
  /**
   * Set Binaural stereo width (0-100)
   * @param {number} width - Width percentage (0 = mono, 100 = full stereo)
   */
  setWidthBinaural(width) {
    if (!this.isInitialized) return;
    
    const widthValue = Math.max(0, Math.min(100, width));
    
    // Convert 0-100 to pan values (-1.0 to +1.0)
    const normalizedWidth = widthValue / 100.0;
    const leftPan = -normalizedWidth;
    const rightPan = normalizedWidth;
    
    this.workletNode.port.postMessage({
      type: 'setWidthBinaural',
      panL: leftPan,
      panR: rightPan
    });
  }
  
  /**
   * Set ISO pulse duty cycle (0.3-1.75)
   * @param {number} dutyCycle - Duty cycle value (0.3 = short pulses, 1.75 = long/overlapping pulses)
   */
  setDutyCycle(dutyCycle) {
    if (!this.isInitialized) return;
    
    const dutyCycleValue = Math.max(0.3, Math.min(1.75, dutyCycle));
    
    this.workletNode.port.postMessage({
      type: 'setDutyCycle',
      dutyCycle: dutyCycleValue
    });
  }
  
  /**
   * Set carrier frequency directly
   * @param {number} frequency - Carrier frequency in Hz
   */
  setCarrierFrequency(frequency) {
    if (!this.isInitialized) return;
    
    this.currentCarrierFrequency = Math.max(20, Math.min(2000, frequency));
    
    this.workletNode.port.postMessage({
      type: 'setCarrier',
      frequency: this.currentCarrierFrequency
    });
  }
  
  /**
   * Dispose synth
   */
  dispose() {
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    this.isInitialized = false;
    this.isPlaying = false;
  }
}
