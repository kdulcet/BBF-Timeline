/**
 * ISO Pulse Synthesis System - Alternating L/R Architecture
 * Memory-safe pulsed sine wave generator with proper Web Audio disposal
 * 
 * ARCHITECTURE:
 * - Two independent oscillator channels (LEFT and RIGHT)
 * - Alternating pulse pattern: L → R → L → R
 * - Each channel gets 750ms rest at 2Hz (250ms pulse + 250ms silence + 500ms wait)
 * - Discrete envelopes eliminate overlap interference
 * - 50% duty cycle: 250ms pulse, 250ms silence at 2Hz
 * 
 * STEREO MODES:
 * - Ping-pong: L fully left, R fully right (spatial alternation)
 * - Center: L and R both center (temporal alternation, mono image)
 * 
 * EXPANDABLE: Ready for future 5x2 factory architecture
 */

class ISOSynth {
  constructor(audioContext) {
    this.audioContext = audioContext;
    this.isRunning = false;
    this.masterGain = null;
    this.pulseCounter = 0;
    
    // Carrier frequency (the actual sine wave pitch) - separate from pulse rate
    this.carrierFrequency = 440; // Default to A4 (440Hz)
    
    // Stereo width (0-100): 0 = mono (center), 100 = full stereo (L=-1, R=+1)
    this.width = 100; // Default to full stereo separation
    
    // Stereo positioning - DEFAULT TO PINGPONG for obvious L/R separation
    this.stereoMode = 'pingpong'; // 'pingpong' or 'center'
    
    // LEFT and RIGHT channel state tracking
    this.channels = {
      left: {
        activePulses: new Set(),
        panNode: null,
        pulseCount: 0
      },
      right: {
        activePulses: new Set(),
        panNode: null,
        pulseCount: 0
      }
    };
    
    this.setupAudioGraph();
    // DISABLED: Old node-based pulse generation (replaced by AudioWorklet)
    // this.setupEventListeners();
    
    // console.log('ISO Synth initialized - Alternating L/R architecture ready');
  }
  
  /**
   * Setup audio graph with L/R channels and stereo positioning
   */
  setupAudioGraph() {
    // Master gain for overall volume
    this.masterGain = this.audioContext.createGain();
    this.masterGain.gain.value = 0.3; // Safe default volume
    this.masterGain.connect(this.audioContext.destination);
    
    // LEFT channel pan node
    this.channels.left.panNode = this.audioContext.createStereoPanner();
    this.channels.left.panNode.connect(this.masterGain);
    
    // RIGHT channel pan node
    this.channels.right.panNode = this.audioContext.createStereoPanner();
    this.channels.right.panNode.connect(this.masterGain);
    
    // Set initial width
    this.updateWidth();
  }
  
  /**
   * Set stereo width (0-100)
   * @param {number} width - Width value (0 = mono/center, 100 = full stereo)
   */
  setWidth(width) {
    this.width = Math.max(0, Math.min(100, width));
    this.updateWidth();
    // console.log(`ISO Synth width set to: ${this.width}%`);
  }
  
  /**
   * Update panner positions based on width
   * @private
   */
  updateWidth() {
    if (!this.channels.left.panNode || !this.channels.right.panNode) return;
    
    // Convert width 0-100 to pan values
    // 0 = both center (0), 100 = full stereo (L=-1, R=+1)
    const panValue = this.width / 100; // 0.0 to 1.0
    
    const currentTime = this.audioContext.currentTime;
    
    // Left channel: 0 width = 0 (center), 100 width = -1 (full left)
    this.channels.left.panNode.pan.setValueAtTime(-panValue, currentTime);
    
    // Right channel: 0 width = 0 (center), 100 width = +1 (full right)
    this.channels.right.panNode.pan.setValueAtTime(panValue, currentTime);
  }
  
  /**
   * Set stereo positioning mode (legacy - now uses width instead)
   * @param {string} mode - 'pingpong' or 'center'
   */
  setStereoMode(mode) {
    this.stereoMode = mode;
    
    if (mode === 'pingpong') {
      this.setWidth(100);  // Full stereo
    } else {
      this.setWidth(0);    // Mono/center
    }
    
    // console.log(`Stereo mode: ${mode} (L=${this.channels.left.panNode.pan.value}, R=${this.channels.right.panNode.pan.value})`);
  }
  
  /**
   * Set carrier frequency (the actual sine wave pitch)
   * This is separate from the pulse rate which comes from timeline Hz
   */
  setCarrierFrequency(frequency) {
    this.carrierFrequency = Math.max(20, Math.min(20000, frequency)); // Human hearing range
    // console.log(`ISO Synth carrier frequency set to: ${this.carrierFrequency}Hz`);
  }

  /**
   * Get current carrier frequency
   */
  getCarrierFrequency() {
    return this.carrierFrequency;
  }

  /**
   * Set master volume (0.0 to 1.0)
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
   */
  getVolume() {
    return this.masterGain ? this.masterGain.gain.value : 0;
  }
  
  /**
   * Start ISO synth system
   */
  start() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    this.pulseCounter = 0; // Reset pulse counter on start
    // console.log('ISO Synth started - listening for pulse events');
  }
  
  /**
   * Stop ISO synth system with emergency cleanup
   */
  stop() {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    
    // Emergency cleanup: force stop any remaining active pulses on BOTH channels
    const leftActive = this.channels.left.activePulses.size;
    const rightActive = this.channels.right.activePulses.size;
    const totalActive = leftActive + rightActive;
    
    if (totalActive > 0) {
      console.warn(`ISO Synth cleanup: ${leftActive} LEFT + ${rightActive} RIGHT = ${totalActive} active pulses during stop`);
      this.channels.left.activePulses.clear();
      this.channels.right.activePulses.clear();
    }
    
    // console.log('ISO Synth stopped - L/R pulse generation disabled');
  }
  
  /**
   * Cleanup method for disposal
   */
  dispose() {
    this.stop();
    
    // Disconnect pan nodes
    if (this.channels.left.panNode) {
      this.channels.left.panNode.disconnect();
      this.channels.left.panNode = null;
    }
    
    if (this.channels.right.panNode) {
      this.channels.right.panNode.disconnect();
      this.channels.right.panNode = null;
    }
    
    // Disconnect master gain
    if (this.masterGain) {
      this.masterGain.disconnect();
      this.masterGain = null;
    }
    
    // Clear any remaining pulse tracking on both channels
    this.channels.left.activePulses.clear();
    this.channels.right.activePulses.clear();
    
    // Null out audioContext reference
    this.audioContext = null;
    
    // console.log('ISO Synth disposed - L/R channels and all resources cleaned up');
  }
}

// Export for use in timeline system
if (typeof window !== 'undefined') {
  window.ISOSynth = ISOSynth;
  
  // Auto-cleanup on page unload to prevent memory leaks
  window.addEventListener('beforeunload', () => {
    // Find and dispose any ISOSynth instances
    if (window.isoSynth && typeof window.isoSynth.dispose === 'function') {
      window.isoSynth.dispose();
    }
  });
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ISOSynth;
}