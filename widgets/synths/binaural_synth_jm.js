/**
 * ============================================================================
 * BINAURAL SYNTH - Journey Map Segment-Based (Simplified)
 * ============================================================================
 * 
 * PURPOSE:
 * Main thread controller for binaural synth. Sends journey map segments to
 * worklet once, worklet calculates Hz on-demand. Single source of truth.
 * 
 * ARCHITECTURE CHANGE:
 * OLD: Timeline sends events → main thread calculates → schedules in worklet
 * NEW: Timeline compiles segments → send once to worklet → worklet calculates
 * 
 * DIFFERENCE FROM ISO:
 * - ISO: Pulse-based, discrete trigger events
 * - Binaural: Continuous tones, per-sample Hz calculation
 * - Both: Use same segment data from timeline
 * 
 * SIMPLIFICATIONS:
 * - No timeline event listeners (removed)
 * - No scheduleBeatFrequency/Ramp methods (removed)
 * - Just send segments at start, worklet handles rest
 * 
 * ============================================================================
 */

class BinauralSynthJM {
  constructor(audioContext) {
    this.audioContext = audioContext;
    this.isRunning = false;
    this.workletNode = null;
    this.workletReady = false;
    this.masterGain = null;
    
    // Carrier frequency (base tone, e.g., 110Hz, 200Hz, 432Hz)
    this.carrierFrequency = 200; // Default to 200Hz (common for binaural)
    
    // Stereo width (0-100): 0 = mono (center), 100 = full stereo (L=-1, R=+1)
    this.width = 100; // Default to full stereo separation
    
    this.setupAudioGraph();
    
    console.log('Binaural Synth JM initialized (worklet pending)');
  }
  
  /**
   * ============================================================================
   * INITIALIZATION - Load Worklet Module
   * ============================================================================
   */
  async init() {
    if (this.workletReady) return;
    
    try {
      // Load segment-based worklet module
      await this.audioContext.audioWorklet.addModule('widgets/synths/binaural_worklet_jm.js');
      
      // Create worklet node (stereo output)
      this.workletNode = new AudioWorkletNode(
        this.audioContext, 
        'binaural-processor-jm',
        { outputChannelCount: [2] }
      );
      
      // Connect to master gain
      this.workletNode.connect(this.masterGain);
      
      // Message handler for worklet feedback
      this.workletNode.port.onmessage = (event) => {
        if (event.data.type === 'journeyMapLoaded') {
          console.log(`[Binaural JM] ✅ Journey map loaded: ${event.data.segmentCount} segments, ${event.data.totalDurationSeconds.toFixed(1)}s`);
        } else if (event.data.type === 'started') {
          console.log('[Binaural JM] ▶️  Audio started');
        } else if (event.data.type === 'stopped') {
          console.log('[Binaural JM] ⏹️  Audio stopped');
        } else if (event.data.type === 'completed') {
          console.log('[Binaural JM] ✅ Timeline completed');
          this.isRunning = false;
        }
      };
      
      this.workletReady = true;
      console.log('[Binaural JM] ✅ Worklet loaded and ready');
      
    } catch (error) {
      console.error('[Binaural JM] ❌ Failed to load worklet:', error);
      throw error;
    }
  }
  
  /**
   * ============================================================================
   * AUDIO GRAPH - Simplified (just master gain)
   * ============================================================================
   */
  setupAudioGraph() {
    // Master gain for overall volume
    this.masterGain = this.audioContext.createGain();
    this.masterGain.gain.value = 0.3; // Safe default volume
    this.masterGain.connect(this.audioContext.destination);
  }
  
  /**
   * ============================================================================
   * SEND SEGMENTS - Single Source of Truth
   * ============================================================================
   * 
   * Sends journey map segments to worklet. Worklet will calculate Hz on-demand
   * for every audio sample. No pre-calculation, no drift.
   * 
   * @param {Array} segments - Raw journey map segments from timeline
   */
  loadJourneyMap(segments) {
    if (!this.workletReady || !this.workletNode) {
      console.error('[Binaural JM] ❌ Cannot load journey map - worklet not ready');
      return;
    }
    
    console.log(`[Binaural JM] 📨 Sending journey map: ${segments.length} segments, carrier=${this.carrierFrequency}Hz`);
    
    // Send segments to worklet
    this.workletNode.port.postMessage({
      type: 'loadJourneyMap',
      segments: segments,
      carrierFrequency: this.carrierFrequency
    });
  }
  
  /**
   * ============================================================================
   * PLAYBACK CONTROLS
   * ============================================================================
   */
  
  /**
   * Start binaural beat generation
   */
  start() {
    if (this.isRunning || !this.workletReady) {
      if (!this.workletReady) {
        console.warn('[Binaural JM] ⚠️  Worklet not ready. Call init() first.');
      }
      return;
    }
    
    this.isRunning = true;
    
    // Set initial width in worklet
    this.updateWidth();
    
    // Start audio generation in worklet
    this.workletNode.port.postMessage({ type: 'start' });
    
    console.log(`[Binaural JM] ▶️  Started: Carrier=${this.carrierFrequency}Hz`);
  }
  
  /**
   * Stop binaural beat generation
   */
  stop() {
    if (!this.isRunning || !this.workletNode) return;
    
    this.isRunning = false;
    
    // Stop audio generation in worklet
    this.workletNode.port.postMessage({ type: 'stop' });
    
    console.log('[Binaural JM] ⏹️  Stopped');
  }
  
  /**
   * ============================================================================
   * PARAMETER CONTROLS - Manual UI Adjustments
   * ============================================================================
   */
  
  /**
   * Set carrier frequency (base tone)
   * @param {number} frequency - Carrier frequency in Hz (e.g., 110, 200, 432)
   */
  setCarrierFrequency(frequency) {
    this.carrierFrequency = Math.max(20, Math.min(20000, frequency));
    
    // Send to worklet
    if (this.workletNode) {
      this.workletNode.port.postMessage({
        type: 'setCarrier',
        frequency: this.carrierFrequency
      });
    }
    
    console.log(`[Binaural JM] 🎵 Carrier frequency set to: ${this.carrierFrequency}Hz`);
  }
  
  /**
   * Set stereo width (0-100)
   * @param {number} width - Width value (0 = mono/center, 100 = full stereo)
   */
  setWidth(width) {
    this.width = Math.max(0, Math.min(100, width));
    this.updateWidth();
    console.log(`[Binaural JM] 📏 Width set to: ${this.width}%`);
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
   * Set volume in decibels
   * @param {number} gainDb - Gain in decibels (-60 to 0)
   */
  setVolume(gainDb) {
    if (!this.workletNode) return;
    
    const clampedDb = Math.max(-60, Math.min(0, gainDb));
    
    // Send to worklet
    this.workletNode.port.postMessage({
      type: 'setVolume',
      gainDb: clampedDb
    });
    
    console.log(`[Binaural JM] 🔊 Volume set to: ${clampedDb.toFixed(1)}dB`);
  }
  
  /**
   * ============================================================================
   * HELPERS - Information Getters
   * ============================================================================
   */
  
  /**
   * Get left channel frequency (for display)
   * NOTE: This is a snapshot, actual worklet calculates from segments
   */
  getLeftFrequency(beatHz = 5) {
    return this.carrierFrequency - (beatHz / 2);
  }
  
  /**
   * Get right channel frequency (for display)
   * NOTE: This is a snapshot, actual worklet calculates from segments
   */
  getRightFrequency(beatHz = 5) {
    return this.carrierFrequency + (beatHz / 2);
  }
  
  /**
   * Check if currently playing
   */
  isPlaying() {
    return this.isRunning;
  }
  
  /**
   * ============================================================================
   * CLEANUP
   * ============================================================================
   */
  dispose() {
    this.stop();
    
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    
    if (this.masterGain) {
      this.masterGain.disconnect();
      this.masterGain = null;
    }
    
    this.workletReady = false;
    console.log('[Binaural JM] 🗑️  Disposed');
  }
}
