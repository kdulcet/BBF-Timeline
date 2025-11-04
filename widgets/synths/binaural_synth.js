/**
 * Binaural Beat Synthesis System - Continuous Tone Architecture
 * Generates binaural beats by playing two slightly different frequencies
 * 
 * ARCHITECTURE:
 * - Two continuous oscillators (LEFT and RIGHT channels)
 * - Left ear: carrier frequency - (beat/2)
 * - Right ear: carrier frequency + (beat/2)
 * - Example: 110Hz carrier, 4Hz beat → L=108Hz, R=112Hz → 4Hz beat perceived
 * 
 * BINAURAL BEAT FORMULA:
 * - Beat frequency = frequency difference between ears
 * - Left frequency = carrier - (beat/2)
 * - Right frequency = carrier + (beat/2)
 * - Perceived beat = rightFreq - leftFreq
 * 
 * TIMELINE INTEGRATION:
 * - Reads Hz values from timeline.hz.changed events
 * - Uses Hz from timeline as the binaural beat rate (not carrier frequency)
 * - Carrier frequency set separately (e.g., 110Hz, 200Hz)
 * 
 * EXPANDABLE: Ready for future enhancements (presets, voice mixing, etc.)
 */

class BinauralSynth {
  constructor(audioContext) {
    this.audioContext = audioContext;
    this.isRunning = false;
    this.masterGain = null;
    
    // Carrier frequency (base tone, e.g., 110Hz)
    this.carrierFrequency = 200; // Default to 200Hz (common for binaural)
    
    // Current binaural beat frequency (difference between ears)
    this.beatFrequency = 4; // Default to 4Hz (theta wave)
    
    // Stereo width (0-100): 0 = mono (center), 100 = full stereo (L=-1, R=+1)
    this.width = 100; // Default to full stereo separation
    
    // Continuous oscillators (always playing when running)
    this.leftOscillator = null;
    this.rightOscillator = null;
    this.leftGain = null;
    this.rightGain = null;
    this.leftPanner = null;
    this.rightPanner = null;
    
    // Bound event handler methods
    this._boundHandleHzChanged = this._handleHzChanged.bind(this);
    this._boundHandleStarted = this._handleStartedEvent.bind(this);
    this._boundHandleStopped = this._handleStoppedEvent.bind(this);
    
    this.setupAudioGraph();
    this.setupEventListeners();
    
    console.log('Binaural Synth initialized - continuous tone architecture ready');
  }
  
  /**
   * Setup audio graph with L/R channels for binaural beats
   */
  setupAudioGraph() {
    // Master gain for overall volume
    this.masterGain = this.audioContext.createGain();
    this.masterGain.gain.value = 0.3; // Safe default volume
    this.masterGain.connect(this.audioContext.destination);
    
    // LEFT channel: carrier - (beat/2)
    this.leftPanner = this.audioContext.createStereoPanner();
    this.leftGain = this.audioContext.createGain();
    this.leftGain.gain.value = 1.0;
    this.leftGain.connect(this.leftPanner);
    this.leftPanner.connect(this.masterGain);
    
    // RIGHT channel: carrier + (beat/2)
    this.rightPanner = this.audioContext.createStereoPanner();
    this.rightGain = this.audioContext.createGain();
    this.rightGain.gain.value = 1.0;
    this.rightGain.connect(this.rightPanner);
    this.rightPanner.connect(this.masterGain);
    
    // Set initial width
    this.updateWidth();
  }
  
  /**
   * Setup timeline event listeners
   */
  setupEventListeners() {
    document.addEventListener('timeline.hz.changed', this._boundHandleHzChanged);
    document.addEventListener('timeline.started', this._boundHandleStarted);
    document.addEventListener('timeline.stopped', this._boundHandleStopped);
  }
  
  /**
   * Handle timeline Hz change - update binaural beat frequency
   * @private
   */
  _handleHzChanged(event) {
    if (!this.isRunning) return;
    
    const { hz } = event.detail;
    this.setBeatFrequency(hz);
  }
  
  /**
   * Handle timeline started event
   * @private
   */
  _handleStartedEvent(event) {
    console.log('Binaural Synth: Timeline started');
    // Hz will be set via hz.changed events
  }
  
  /**
   * Handle timeline stopped event
   * @private
   */
  _handleStoppedEvent(event) {
    console.log('Binaural Synth: Timeline stopped');
    this.stop();
  }
  
  /**
   * Start binaural beat generation
   */
  start() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    
    // Create and start LEFT oscillator
    this.leftOscillator = this.audioContext.createOscillator();
    this.leftOscillator.type = 'sine';
    this.leftOscillator.connect(this.leftGain);
    
    // Create and start RIGHT oscillator
    this.rightOscillator = this.audioContext.createOscillator();
    this.rightOscillator.type = 'sine';
    this.rightOscillator.connect(this.rightGain);
    
    // Set initial frequencies
    this.updateFrequencies();
    
    // Start oscillators
    const startTime = this.audioContext.currentTime;
    this.leftOscillator.start(startTime);
    this.rightOscillator.start(startTime);
    
    console.log(`Binaural Synth started: Carrier=${this.carrierFrequency}Hz, Beat=${this.beatFrequency}Hz`);
    console.log(`  L=${this.getLeftFrequency()}Hz, R=${this.getRightFrequency()}Hz`);
  }
  
  /**
   * Stop binaural beat generation
   */
  stop() {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    
    // Stop and cleanup oscillators
    const stopTime = this.audioContext.currentTime + 0.01;
    
    if (this.leftOscillator) {
      this.leftOscillator.stop(stopTime);
      this.leftOscillator = null;
    }
    
    if (this.rightOscillator) {
      this.rightOscillator.stop(stopTime);
      this.rightOscillator = null;
    }
    
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
   * Set stereo width (0-100)
   * @param {number} width - Width value (0 = mono/center, 100 = full stereo)
   */
  setWidth(width) {
    this.width = Math.max(0, Math.min(100, width));
    this.updateWidth();
    console.log(`Binaural width set to: ${this.width}%`);
  }
  
  /**
   * Update panner positions based on width
   * @private
   */
  updateWidth() {
    if (!this.leftPanner || !this.rightPanner) return;
    
    // Convert width 0-100 to pan values
    // 0 = both center (0), 100 = full stereo (L=-1, R=+1)
    const panValue = this.width / 100; // 0.0 to 1.0
    
    const currentTime = this.audioContext.currentTime;
    
    // Left channel: 0 width = 0 (center), 100 width = -1 (full left)
    this.leftPanner.pan.setValueAtTime(-panValue, currentTime);
    
    // Right channel: 0 width = 0 (center), 100 width = +1 (full right)
    this.rightPanner.pan.setValueAtTime(panValue, currentTime);
  }
  
  /**
   * Update oscillator frequencies based on carrier and beat
   * @private
   */
  updateFrequencies() {
    if (!this.isRunning || !this.leftOscillator || !this.rightOscillator) return;
    
    const currentTime = this.audioContext.currentTime;
    const leftFreq = this.getLeftFrequency();
    const rightFreq = this.getRightFrequency();
    
    // Use exponentialRampToValueAtTime for smooth frequency changes
    // Small ramp time (50ms) to avoid clicks
    const rampTime = currentTime + 0.05;
    
    this.leftOscillator.frequency.setValueAtTime(this.leftOscillator.frequency.value, currentTime);
    this.leftOscillator.frequency.exponentialRampToValueAtTime(leftFreq, rampTime);
    
    this.rightOscillator.frequency.setValueAtTime(this.rightOscillator.frequency.value, currentTime);
    this.rightOscillator.frequency.exponentialRampToValueAtTime(rightFreq, rampTime);
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
    if (this.masterGain) {
      this.masterGain.gain.setValueAtTime(
        Math.max(0, Math.min(1, volume)),
        this.audioContext.currentTime
      );
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
    
    // Remove event listeners
    document.removeEventListener('timeline.hz.changed', this._boundHandleHzChanged);
    document.removeEventListener('timeline.started', this._boundHandleStarted);
    document.removeEventListener('timeline.stopped', this._boundHandleStopped);
    
    // Disconnect audio nodes
    if (this.leftGain) this.leftGain.disconnect();
    if (this.rightGain) this.rightGain.disconnect();
    if (this.leftPanner) this.leftPanner.disconnect();
    if (this.rightPanner) this.rightPanner.disconnect();
    if (this.masterGain) this.masterGain.disconnect();
    
    console.log('Binaural Synth disposed');
  }
}
