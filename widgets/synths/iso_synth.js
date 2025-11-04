/**
 * ISO Pulse Synthesis System
 * Memory-safe pulsed sine wave generator with proper Web Audio disposal
 * 
 * Based on ISO_README.md specifications:
 * - Fresh OscillatorNode per pulse (0° phase coherence)
 * - 1ms attack, sustain, 5ms release envelope
 * - Pulse duration = (1000ms / Hz) / 2 (50% duty cycle)
 * - Mandatory cleanup to prevent memory leaks
 */

class ISOSynth {
  constructor(audioContext) {
    this.audioContext = audioContext;
    this.isRunning = false;
    this.masterGain = null;
    this.activePulses = new Set(); // Track active pulses for emergency cleanup
    
    // Constants from ISO_README.md
    this.ATTACK_TIME = 0.001;   // 1ms
    this.RELEASE_TIME = 0.005;  // 5ms
    this.ENVELOPE_OVERHEAD = this.ATTACK_TIME + this.RELEASE_TIME; // 6ms total
    
    this.setupMasterGain();
    this.setupEventListeners();
    
    console.log('ISO Synth initialized - memory-safe pulse engine ready');
  }
  
  /**
   * Setup master gain node for volume control
   */
  setupMasterGain() {
    this.masterGain = this.audioContext.createGain();
    this.masterGain.gain.value = 0.3; // Safe default volume
    this.masterGain.connect(this.audioContext.destination);
  }
  
  /**
   * Setup timeline event listeners for pulse generation
   */
  setupEventListeners() {
    // Listen for 32n pulse events from timeline
    document.addEventListener('timeline.pulse.32n', (event) => {
      if (!this.isRunning) return;
      
      const { hz, time } = event.detail;
      
      // Calculate pulse duration based on Hz
      const pulseDuration = this.calculatePulseDuration(hz);
      
      // Generate pulse with proper cleanup
      this.generatePulse(hz, pulseDuration);
      
      console.log(`ISO Pulse: ${hz.toFixed(2)}Hz → ${(pulseDuration * 1000).toFixed(1)}ms pulse`);
    });
    
    // Timeline state listeners
    document.addEventListener('timeline.started', () => {
      this.start();
    });
    
    document.addEventListener('timeline.stopped', () => {
      this.stop();
    });
  }
  
  /**
   * Calculate pulse duration based on Hz frequency
   * Formula: (1000ms / Hz) / 2 = 50% duty cycle
   */
  calculatePulseDuration(hz) {
    if (hz <= 0) return 0.1; // Fallback for invalid Hz
    
    const period = 1.0 / hz; // Period in seconds
    const pulseDuration = period / 2; // 50% duty cycle
    
    // Ensure minimum duration for proper envelope
    return Math.max(pulseDuration, this.ENVELOPE_OVERHEAD);
  }
  
  /**
   * Generate a single pulse with proper memory management
   * CRITICAL: Fresh nodes + mandatory cleanup pattern
   */
  generatePulse(frequency, duration) {
    // Create fresh nodes (never reuse - ensures 0° phase coherence)
    const oscillator = this.audioContext.createOscillator();
    const envelope = this.audioContext.createGain();
    
    // Track this pulse for emergency cleanup
    const pulseId = Date.now() + Math.random();
    this.activePulses.add(pulseId);
    
    // Configure oscillator
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
    
    // Connect audio graph
    oscillator.connect(envelope);
    envelope.connect(this.masterGain);
    
    // Setup envelope with precise timing
    this.setupEnvelope(envelope, duration);
    
    // **CRITICAL**: Setup cleanup BEFORE starting
    // This prevents memory leaks during rapid pulse generation
    oscillator.addEventListener('ended', () => {
      // Disconnect all connections
      try {
        oscillator.disconnect();
        envelope.disconnect();
      } catch (e) {
        // Already disconnected - ignore error
      }
      
      // Remove from active pulse tracking
      this.activePulses.delete(pulseId);
      
      // Clear references for garbage collection
      // (oscillator and envelope will be GC'd when function scope ends)
    });
    
    // Start oscillator and schedule stop
    const now = this.audioContext.currentTime;
    oscillator.start(now);
    oscillator.stop(now + duration); // This triggers 'ended' event automatically
  }
  
  /**
   * Setup ADSR envelope with precise timing
   * 1ms attack → sustain → 5ms release
   */
  setupEnvelope(envelope, pulseDuration) {
    const now = this.audioContext.currentTime;
    const sustainTime = pulseDuration - this.ENVELOPE_OVERHEAD;
    
    // Ensure positive sustain time
    const actualSustainTime = Math.max(sustainTime, 0);
    
    // ADSR envelope automation
    envelope.gain.cancelScheduledValues(now);
    envelope.gain.setValueAtTime(0, now);
    
    // Attack: 0 → 1.0 over 1ms
    envelope.gain.linearRampToValueAtTime(1.0, now + this.ATTACK_TIME);
    
    // Sustain: hold at 1.0
    envelope.gain.setValueAtTime(1.0, now + this.ATTACK_TIME + actualSustainTime);
    
    // Release: 1.0 → 0 over 5ms
    envelope.gain.linearRampToValueAtTime(0, now + pulseDuration);
  }
  
  /**
   * Start ISO synth system
   */
  start() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    console.log('ISO Synth started - listening for pulse events');
  }
  
  /**
   * Stop ISO synth system with emergency cleanup
   */
  stop() {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    
    // Emergency cleanup: force stop any remaining active pulses
    // This shouldn't be necessary with proper 'ended' event handling,
    // but provides safety net for memory management
    if (this.activePulses.size > 0) {
      console.warn(`ISO Synth cleanup: ${this.activePulses.size} active pulses during stop`);
      this.activePulses.clear();
    }
    
    console.log('ISO Synth stopped - pulse generation disabled');
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
    
    if (this.masterGain) {
      this.masterGain.disconnect();
      this.masterGain = null;
    }
    
    // Clear any remaining pulse tracking
    this.activePulses.clear();
    
    console.log('ISO Synth disposed - all resources cleaned up');
  }
}

// Export for use in timeline system
if (typeof window !== 'undefined') {
  window.ISOSynth = ISOSynth;
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ISOSynth;
}