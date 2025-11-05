/**
 * Binaural Beat Synthesis System - AudioWorklet Architecture
 * Generates binaural beats using AudioWorklet for sample-accurate generation
 * 
 * ARCHITECTURE:
 * - AudioWorkletNode with binaural-processor (2 continuous voices)
 * - Main thread: parameter calculations, timeline integration, manual UI control
 * - Audio thread: sample-accurate sine generation, frequency ramping, zero GC
 * - Communication: postMessage() for real-time parameter updates
 * 
 * BINAURAL BEAT FORMULA:
 * - Beat frequency = frequency difference between ears
 * - Left frequency = carrier - (beat/2)
 * - Right frequency = carrier + (beat/2)
 * - Perceived beat = rightFreq - leftFreq
 * 
 * CONTROL MODEL:
 * - Manual UI control: immediate frequency/width/volume changes
 * - Timeline integration: scheduled frequency ramps for smooth transitions
 * - Generates continuous tones (not pulses)
 * 
 * TIMELINE INTEGRATION:
 * - Listens for timeline.hz.changed events
 * - Plateau segments: instant frequency changes at scheduled time
 * - Transition segments: smooth linear ramps (e.g., 2Hz → 5Hz over 3 seconds)
 * - Sample-accurate scheduling via Web Audio time
 * 
 * THREAD MODEL:
 * - Main Thread: UI updates, frequency calculations, timeline event handling
 * - Audio Thread: Sample-accurate tone generation, frequency interpolation, stereo panning
 */

class BinauralSynth {
  constructor(audioContext) {
    this.audioContext = audioContext;
    this.isRunning = false;
    this.workletNode = null;
    this.workletReady = false;
    this.masterGain = null;
    
    // Carrier frequency (base tone, e.g., 110Hz)
    this.carrierFrequency = 200; // Default to 200Hz (common for binaural)
    
    // Current binaural beat frequency (difference between ears)
    this.beatFrequency = 4; // Default to 4Hz (theta wave)
    
    // Track most recent scheduled beat frequency from timeline (used on restart)
    this.scheduledBeatHz = null; // Will be set by timeline events
    
    // Stereo width (0-100): 0 = mono (center), 100 = full stereo (L=-1, R=+1)
    this.width = 100; // Default to full stereo separation
    
    this.setupAudioGraph();
    
    // Timeline integration - bind event handlers
    this._boundHandleHzChanged = this._handleHzChanged.bind(this);
    this.setupTimelineListeners();
    
    console.log('Binaural Synth initialized (worklet pending)');
  }
  
  /**
   * Setup timeline event listeners
   * @private
   */
  setupTimelineListeners() {
    // Listen for timeline Hz changes (both plateau and transition)
    document.addEventListener('timeline.hz.changed', this._boundHandleHzChanged);
  }
  
  /**
   * Handle timeline Hz change events
   * @private
   */
  _handleHzChanged(event) {
    const data = event.detail;
    
    console.log(`[Binaural] ⚡ Hz Event received: type=${data.type}, running=${this.isRunning}, ready=${this.workletReady}`, data);
    
    if (!this.workletReady) {
      console.warn('[Binaural] ❌ Ignoring Hz event - worklet not ready');
      return;
    }
    
    // Process all Hz events - worklet handles timing via scheduled times
    const eventTime = data.type === 'plateau' ? data.time : data.startTime;
    console.log(`[Binaural] 📨 Received Hz event: type=${data.type}, time=${eventTime.toFixed(3)}s, currentTime=${this.audioContext.currentTime.toFixed(3)}s`);
    
    if (data.type === 'plateau') {
      // Instant frequency change at scheduled time
      console.log(`[Binaural] 📍 Plateau: ${data.hz}Hz at ${data.time.toFixed(3)}s`);
      this.scheduleBeatFrequency(data.hz, data.time);
      
    } else if (data.type === 'transition') {
      // Smooth ramp from startHz to endHz over duration
      console.log(`[Binaural] 📈 Transition: ${data.startHz}Hz → ${data.endHz}Hz over ${(data.endTime - data.startTime).toFixed(2)}s`);
      this.scheduleBeatFrequencyRamp(
        data.startHz, 
        data.endHz, 
        data.startTime, 
        data.endTime
      );
    }
  }
  
  /**
   * Initialize AudioWorklet (must be called before use)
   * @returns {Promise<void>}
   */
  async init() {
    if (this.workletReady) return;
    
    try {
      // Load worklet module
      await this.audioContext.audioWorklet.addModule('widgets/synths/binaural_worklet.js');
      
      // Create worklet node (stereo output)
      this.workletNode = new AudioWorkletNode(
        this.audioContext, 
        'binaural-processor',
        { outputChannelCount: [2] }
      );
      
      // Connect to master gain
      this.workletNode.connect(this.masterGain);
      
      this.workletReady = true;
      console.log('Binaural Worklet loaded and ready');
      
    } catch (error) {
      console.error('Failed to load binaural worklet:', error);
      throw error;
    }
  }
  
  /**
   * Setup audio graph - simplified for worklet architecture
   */
  setupAudioGraph() {
    // Master gain for overall volume
    this.masterGain = this.audioContext.createGain();
    this.masterGain.gain.value = 0.3; // Safe default volume
    this.masterGain.connect(this.audioContext.destination);
  }
  
  /**
   * Start binaural beat generation
   */
  start() {
    if (this.isRunning || !this.workletReady) {
      if (!this.workletReady) {
        console.warn('Binaural Synth: Worklet not ready. Call init() first.');
      }
      return;
    }
    
    this.isRunning = true;
    
    // Apply scheduled beat frequency from timeline (if any)
    // This handles restart scenarios where timeline events were received before start()
    if (this.scheduledBeatHz !== null) {
      console.log(`[Binaural] 🔄 Applying stored initial Hz=${this.scheduledBeatHz} at start()`);
      this.scheduleBeatFrequency(this.scheduledBeatHz, 0);
    }
    
    // Set initial width in worklet
    this.updateWidth();
    
    // Start audio generation in worklet
    this.workletNode.port.postMessage({ type: 'start' });
    
    console.log(`Binaural Synth started: Carrier=${this.carrierFrequency}Hz, Beat=${this.beatFrequency}Hz`);
    console.log(`  L=${this.getLeftFrequency()}Hz, R=${this.getRightFrequency()}Hz`);
  }
  
  /**
   * Stop binaural beat generation
   */
  stop() {
    if (!this.isRunning || !this.workletNode) return;
    
    this.isRunning = false;
    
    // Stop audio generation in worklet
    this.workletNode.port.postMessage({ type: 'stop' });
    
    console.log('Binaural Synth stopped');
  }
  
  /**
   * Set carrier frequency (base tone)
   * @param {number} frequency - Carrier frequency in Hz (e.g., 110, 200, 432)
   */
  setCarrierFrequency(frequency) {
    this.carrierFrequency = Math.max(20, Math.min(20000, frequency));
    this.updateFrequencies();
    console.log(`Binaural carrier frequency set to: ${this.carrierFrequency}Hz`);
  }
  
  /**
   * Set binaural beat frequency (difference between ears)
   * @param {number} beatHz - Beat frequency in Hz (typically 0.5-40Hz)
   */
  setBeatFrequency(beatHz) {
    this.beatFrequency = Math.max(0.1, Math.min(40, beatHz));
    this.updateFrequencies();
    console.log(`Binaural beat frequency set to: ${this.beatFrequency}Hz`);
  }
  
  /**
   * Schedule beat frequency change at specific time (for timeline integration)
   * @param {number} beatHz - Target beat frequency in Hz
   * @param {number} time - Web Audio time to apply change
   */
  scheduleBeatFrequency(beatHz, time) {
    if (!this.workletNode) {
      console.error('[Binaural] Cannot schedule - no worklet node');
      return;
    }
    
    const leftFreq = this.carrierFrequency - (beatHz / 2);
    const rightFreq = this.carrierFrequency + (beatHz / 2);
    
    console.log(`[Binaural] Sending scheduleFrequencies: L=${leftFreq.toFixed(2)}Hz, R=${rightFreq.toFixed(2)}Hz at time=${time.toFixed(3)}s`);
    
    // Send instant frequency change scheduled at exact timeline time
    this.workletNode.port.postMessage({
      type: 'scheduleFrequencies',
      leftFreq: leftFreq,
      rightFreq: rightFreq,
      time: time, // Use timeline time for proper scheduling
      rampDuration: 0 // Instant change
    });
  }
  
  /**
   * Schedule smooth frequency ramp (for timeline transitions)
   * @param {number} startBeatHz - Starting beat frequency
   * @param {number} endBeatHz - Ending beat frequency
   * @param {number} startTime - Web Audio time to start ramp
   * @param {number} endTime - Web Audio time to end ramp
   */
  scheduleBeatFrequencyRamp(startBeatHz, endBeatHz, startTime, endTime) {
    if (!this.workletNode) {
      console.error('[Binaural] Cannot schedule ramp - no worklet node');
      return;
    }
    
    // Calculate start frequencies
    const startLeftFreq = this.carrierFrequency - (startBeatHz / 2);
    const startRightFreq = this.carrierFrequency + (startBeatHz / 2);
    
    // Calculate end frequencies
    const endLeftFreq = this.carrierFrequency - (endBeatHz / 2);
    const endRightFreq = this.carrierFrequency + (endBeatHz / 2);
    
    const duration = endTime - startTime;
    
    console.log(`[Binaural] Sending scheduleFrequencyRamp: L=${startLeftFreq.toFixed(2)}→${endLeftFreq.toFixed(2)}Hz, R=${startRightFreq.toFixed(2)}→${endRightFreq.toFixed(2)}Hz over ${duration.toFixed(2)}s`);
    
    // Send frequency ramp to worklet
    this.workletNode.port.postMessage({
      type: 'scheduleFrequencyRamp',
      startLeftFreq: startLeftFreq,
      startRightFreq: startRightFreq,
      endLeftFreq: endLeftFreq,
      endRightFreq: endRightFreq,
      startTime: startTime,
      endTime: endTime,
      duration: duration
    });
  }
  
  /**
   * Set stereo width (0-100)
   * @param {number} width - Width value (0 = mono/center, 100 = full stereo)
   */
  setWidth(width) {
    this.width = Math.max(0, Math.min(100, width));
    this.updateWidth();
    console.log(`Binaural width set to: ${this.width}%`);
  }
  
  /**
   * Update stereo width in worklet
   * @private
   */
  updateWidth() {
    if (!this.workletNode) return;
    
    // Convert width 0-100 to pan values
    // 0 = both center (0), 100 = full stereo (L=-1, R=+1)
    const panValue = this.width / 100; // 0.0 to 1.0
    
    // Send to worklet
    this.workletNode.port.postMessage({
      type: 'setWidth',
      panL: -panValue,  // Left channel: -1 to 0
      panR: panValue    // Right channel: 0 to +1
    });
  }
  
  /**
   * Update frequencies in worklet
   * @private
   */
  updateFrequencies() {
    if (!this.workletNode) return;
    
    const leftFreq = this.getLeftFrequency();
    const rightFreq = this.getRightFrequency();
    
    // Send to worklet
    this.workletNode.port.postMessage({
      type: 'setFrequencies',
      leftFreq: leftFreq,
      rightFreq: rightFreq
    });
  }
  
  /**
   * Calculate left ear frequency
   * @returns {number} Left frequency in Hz
   */
  getLeftFrequency() {
    return this.carrierFrequency - (this.beatFrequency / 2);
  }
  
  /**
   * Calculate right ear frequency
   * @returns {number} Right frequency in Hz
   */
  getRightFrequency() {
    return this.carrierFrequency + (this.beatFrequency / 2);
  }
  
  /**
   * Set master volume (0.0 to 1.0)
   * @param {number} volume - Volume level (0.0 = silent, 1.0 = full)
   */
  setVolume(volume) {
    const clampedVolume = Math.max(0, Math.min(1, volume));
    
    if (this.masterGain) {
      this.masterGain.gain.setValueAtTime(
        clampedVolume,
        this.audioContext.currentTime
      );
    }
    
    // Also send to worklet (convert to dB for worklet)
    if (this.workletNode) {
      const gainDb = clampedVolume > 0 ? 20 * Math.log10(clampedVolume) : -100;
      this.workletNode.port.postMessage({
        type: 'setVolume',
        gainDb: gainDb
      });
    }
  }
  
  /**
   * Get current volume
   * @returns {number} Current volume (0.0 to 1.0)
   */
  getVolume() {
    return this.masterGain ? this.masterGain.gain.value : 0;
  }
  
  /**
   * Cleanup - remove event listeners and dispose audio nodes
   */
  dispose() {
    this.stop();
    
    // Remove timeline event listeners
    if (this._boundHandleHzChanged) {
      document.removeEventListener('timeline.hz.changed', this._boundHandleHzChanged);
    }
    
    // Disconnect worklet node
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    
    // Disconnect master gain
    if (this.masterGain) {
      this.masterGain.disconnect();
      this.masterGain = null;
    }
    
    this.workletReady = false;
    
    console.log('Binaural Synth disposed');
  }
}

// Export for manual UI control
if (typeof window !== 'undefined') {
  window.BinauralSynth = BinauralSynth;
  
  // Auto-cleanup on page unload to prevent memory leaks
  window.addEventListener('beforeunload', () => {
    if (window.binauralSynth && typeof window.binauralSynth.dispose === 'function') {
      window.binauralSynth.dispose();
    }
  });
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BinauralSynth;
}
