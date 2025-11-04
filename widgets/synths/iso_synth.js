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
    
    // Constants from ISO_README.md
    this.ATTACK_TIME = 0.007;   // 1ms
    this.RELEASE_TIME = 0.025;  // 5ms
    this.ENVELOPE_OVERHEAD = this.ATTACK_TIME + this.RELEASE_TIME; // 6ms total
    
    // Carrier frequency (the actual sine wave pitch) - separate from pulse rate
    this.carrierFrequency = 440; // Default to A4 (440Hz)
    
    // Stereo positioning - DEFAULT TO PINGPONG for obvious L/R separation
    this.stereoMode = 'pingpong'; // 'pingpong' or 'center'
    
    // TESTING: Disable problematic RIGHT channel
    this.enableRightChannel = true; // Set to true to re-enable for testing
    
    // Store event listener references for cleanup
    this.eventListeners = {
      pulse: null,
      started: null,
      stopped: null
    };
    
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
    this.setupEventListeners();
    
    console.log('ISO Synth initialized - Alternating L/R architecture ready');
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
    
    // Set initial stereo positioning
    this.setStereoMode(this.stereoMode);
  }
  
  /**
   * Set stereo positioning mode
   * @param {string} mode - 'pingpong' or 'center'
   */
  setStereoMode(mode) {
    this.stereoMode = mode;
    
    if (mode === 'pingpong') {
      this.channels.left.panNode.pan.value = -1.0;  // Fully left
      this.channels.right.panNode.pan.value = 1.0;  // Fully right
    } else {
      this.channels.left.panNode.pan.value = 0.0;   // Center
      this.channels.right.panNode.pan.value = 0.0;  // Center
    }
    
    console.log(`Stereo mode: ${mode} (L=${this.channels.left.panNode.pan.value}, R=${this.channels.right.panNode.pan.value})`);
  }
  
  /**
   * Setup timeline event listeners for pulse generation
   */
  setupEventListeners() {
    // TWO INDEPENDENT CHANNELS - each listens separately
    // LEFT channel fires on ODD pulse numbers: 1, 3, 5, 7, 9...
    // RIGHT channel fires on EVEN pulse numbers: 2, 4, 6, 8, 10...
    // This creates true L/R separation with independent timing per channel
    
    // Store listener references for cleanup
    this.eventListeners.pulse = (event) => {
      if (!this.isRunning) return;
      
      const { hz, time } = event.detail;
      
      // Increment pulse counter
      this.pulseCounter++;
      
      // Calculate pulse duration based on timeline Hz (pulse rate)
      const pulseDuration = this.calculatePulseDuration(hz);
      
      // LEFT CHANNEL - fires on ODD pulses only
      if (this.pulseCounter % 2 === 1) {
        this.generatePulse('left', pulseDuration, time);
      }
      
      // RIGHT CHANNEL - fires on EVEN pulses only (DISABLED FOR TESTING)
      if (this.enableRightChannel && this.pulseCounter % 2 === 0) {
        this.generatePulse('right', pulseDuration, time);
      }
    };
    
    this.eventListeners.started = () => {
      this.start();
    };
    
    this.eventListeners.stopped = () => {
      this.stop();
    };
    
    // Add listeners
    document.addEventListener('timeline.pulse.32n', this.eventListeners.pulse);
    document.addEventListener('timeline.started', this.eventListeners.started);
    document.addEventListener('timeline.stopped', this.eventListeners.stopped);
  }
  
  /**
   * Calculate pulse duration based on Hz frequency
   * Formula: (1000ms / Hz) / 2 = 50% duty cycle
   */
  calculatePulseDuration(hz) {
    if (hz <= 0) return 0.1; // Fallback for invalid Hz
    
    const period = 1.0 / hz; // Period in seconds
    const pulseDuration = period / 1.25; // 50% duty cycle
    
    // Ensure minimum duration for proper envelope
    return Math.max(pulseDuration, this.ENVELOPE_OVERHEAD);
  }
  
  /**
   * Generate a single pulse on specified channel
   * CRITICAL: Fresh nodes per pulse + discrete channel cleanup
   * @param {string} channelName - 'left' or 'right'
   * @param {number} pulseDuration - Duration of the pulse envelope (from timeline Hz)
   * @param {number} startTime - Web Audio scheduled start time (sample-accurate)
   */
  generatePulse(channelName, pulseDuration, startTime = null) {
    const scheduleTime = startTime !== null ? startTime : this.audioContext.currentTime;
    const channel = this.channels[channelName];
    
    // Create fresh nodes for THIS pulse on THIS channel
    const oscillator = this.audioContext.createOscillator();
    const envelope = this.audioContext.createGain();
    
    // Track this pulse for channel-specific cleanup
    const pulseId = Date.now() + Math.random();
    channel.activePulses.add(pulseId);
    channel.pulseCount++;
    
    // Configure oscillator - use carrier frequency (NOT timeline Hz)
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(this.carrierFrequency, scheduleTime);
    
    // Connect: oscillator → envelope → channel pan → master gain → destination
    oscillator.connect(envelope);
    envelope.connect(channel.panNode);
    
    // Setup envelope with precise timing
    this.setupEnvelope(envelope, pulseDuration, scheduleTime);
    
    // Calculate exact timing for cleanup
    const envelopeEndTime = scheduleTime + pulseDuration;
    
    // **FIX FROM STACK OVERFLOW**: Stop oscillator AT THE SAME TIME envelope reaches zero
    // Not after! Stopping after creates discontinuity click
    const oscillatorStopTime = envelopeEndTime; // Same time as release completes
    
    // **CRITICAL**: Disconnect envelope IMMEDIATELY after release completes
    // This prevents overlap between consecutive pulses on THIS channel
    const disconnectDelay = Math.max(0, (envelopeEndTime - this.audioContext.currentTime) * 1000 + 5);
    setTimeout(() => {
      try {
        envelope.disconnect();
      } catch (e) {
        // Already disconnected
      }
    }, disconnectDelay);
    
    // Oscillator cleanup when it ends
    oscillator.addEventListener('ended', () => {
      try {
        oscillator.disconnect();
      } catch (e) {
        // Already disconnected
      }
      
      // Remove from channel's active pulse tracking
      channel.activePulses.delete(pulseId);
    });
    
    // Start oscillator and schedule stop AT RELEASE END TIME
    oscillator.start(scheduleTime);
    oscillator.stop(oscillatorStopTime);
  }
  
  /**
   * Setup ADSR envelope with precise timing
   * 1ms attack → sustain → 5ms release
   * @param {GainNode} envelope - The gain node to automate
   * @param {number} pulseDuration - Total pulse duration
   * @param {number} startTime - Web Audio scheduled start time
   */
  setupEnvelope(envelope, pulseDuration, startTime = null) {
    const scheduleTime = startTime !== null ? startTime : this.audioContext.currentTime;
    const sustainTime = pulseDuration - this.ENVELOPE_OVERHEAD;
    
    // Ensure positive sustain time
    const actualSustainTime = Math.max(sustainTime, 0);
    
    // Calculate envelope timing points
    const attackEnd = scheduleTime + this.ATTACK_TIME;
    const releaseStart = scheduleTime + this.ATTACK_TIME + actualSustainTime;
    const releaseEnd = scheduleTime + pulseDuration;
    
    // Clean envelope with exponential ramps for smooth onset/offset
    envelope.gain.cancelScheduledValues(scheduleTime);
    
    // Start from near-zero (exponentialRamp can't use true 0)
    envelope.gain.setValueAtTime(0.0001, scheduleTime);
    
    // Attack: exponential ramp to peak (smoother onset than linear)
    envelope.gain.exponentialRampToValueAtTime(1.0, attackEnd);
    
    // Sustain: hold at 1.0
    envelope.gain.setValueAtTime(1.0, releaseStart);
    
    // Release: exponential ramp to near-zero (smoother offset than linear)
    envelope.gain.exponentialRampToValueAtTime(0.0001, releaseEnd);
    
    // Lock at true zero after release completes
    envelope.gain.setValueAtTime(0, releaseEnd);
  }
  
  /**
   * Start ISO synth system
   */
  start() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    this.pulseCounter = 0; // Reset pulse counter on start
    console.log('ISO Synth started - listening for pulse events');
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
    
    console.log('ISO Synth stopped - L/R pulse generation disabled');
  }
  
  /**
   * Set carrier frequency (the actual sine wave pitch)
   * This is separate from the pulse rate which comes from timeline Hz
   */
  setCarrierFrequency(frequency) {
    this.carrierFrequency = Math.max(20, Math.min(20000, frequency)); // Human hearing range
    console.log(`ISO Synth carrier frequency set to: ${this.carrierFrequency}Hz`);
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
   * Cleanup method for disposal
   */
  dispose() {
    this.stop();
    
    // Remove event listeners
    if (this.eventListeners.pulse) {
      document.removeEventListener('timeline.pulse.32n', this.eventListeners.pulse);
      this.eventListeners.pulse = null;
    }
    
    if (this.eventListeners.started) {
      document.removeEventListener('timeline.started', this.eventListeners.started);
      this.eventListeners.started = null;
    }
    
    if (this.eventListeners.stopped) {
      document.removeEventListener('timeline.stopped', this.eventListeners.stopped);
      this.eventListeners.stopped = null;
    }
    
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
    
    console.log('ISO Synth disposed - L/R channels, event listeners, and all resources cleaned up');
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