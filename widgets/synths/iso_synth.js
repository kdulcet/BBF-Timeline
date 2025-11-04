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
    this.pulseCounter = 0; // DEBUG: Track pulse numbers to identify odd/even pattern
    
    // Constants from ISO_README.md
    this.ATTACK_TIME = 0.001;   // 1ms
    this.RELEASE_TIME = 0.007;  // 5ms
    this.ENVELOPE_OVERHEAD = this.ATTACK_TIME + this.RELEASE_TIME; // 6ms total
    
    // Carrier frequency (the actual sine wave pitch) - separate from pulse rate
    this.carrierFrequency = 440; // Default to A4 (440Hz)
    
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
      
      // Increment pulse counter
      this.pulseCounter++;
      const isOdd = this.pulseCounter % 2 === 1;
      
      // Calculate pulse duration based on timeline Hz (pulse rate)
      const pulseDuration = this.calculatePulseDuration(hz);
      
      // Generate pulse at scheduled time (sample-accurate)
      this.generatePulse(pulseDuration, time);
      
      console.log(`[PULSE #${this.pulseCounter} ${isOdd ? 'ODD' : 'EVEN'}] ISO Pulse: ${this.carrierFrequency}Hz carrier, ${hz.toFixed(2)}Hz pulse rate → ${(pulseDuration * 1000).toFixed(1)}ms pulse @ ${time.toFixed(3)}s`);
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
   * @param {number} pulseDuration - Duration of the pulse envelope (from timeline Hz)
   * @param {number} startTime - Web Audio scheduled start time (sample-accurate)
   */
  generatePulse(pulseDuration, startTime = null) {
    // Use provided time or current time (for backward compatibility)
    const scheduleTime = startTime !== null ? startTime : this.audioContext.currentTime;
    
    // Create fresh nodes (never reuse - ensures 0° phase coherence)
    const oscillator = this.audioContext.createOscillator();
    const envelope = this.audioContext.createGain();
    
    // Track this pulse for emergency cleanup
    const pulseId = Date.now() + Math.random();
    this.activePulses.add(pulseId);
    
    // Configure oscillator - use carrier frequency (NOT timeline Hz)
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(this.carrierFrequency, scheduleTime);
    
    // Connect audio graph
    oscillator.connect(envelope);
    envelope.connect(this.masterGain);
    
    // Setup envelope with precise timing (using scheduled time)
    this.setupEnvelope(envelope, pulseDuration, scheduleTime);
    
    // **CRITICAL**: Calculate exact timing for cleanup
    const envelopeEndTime = scheduleTime + pulseDuration;
    const oscillatorStopTime = envelopeEndTime + 0.01; // 10ms buffer after envelope
    
    // **CRITICAL FIX**: Disconnect envelope IMMEDIATELY after release completes
    // This prevents ANY overlap between consecutive pulses
    const disconnectDelay = (envelopeEndTime - this.audioContext.currentTime) * 1000 + 1; // +1ms safety
    setTimeout(() => {
      try {
        envelope.disconnect();
        console.log(`[PULSE #${this.pulseCounter}] Envelope disconnected at ${this.audioContext.currentTime.toFixed(3)}s`);
      } catch (e) {
        // Already disconnected - ignore
      }
    }, disconnectDelay);
    
    // Oscillator cleanup when it ends
    oscillator.addEventListener('ended', () => {
      try {
        oscillator.disconnect();
      } catch (e) {
        // Already disconnected - ignore
      }
      
      // Remove from active pulse tracking
      this.activePulses.delete(pulseId);
      
      console.log(`[PULSE #${this.pulseCounter}] Oscillator ended at ${this.audioContext.currentTime.toFixed(3)}s`);
    });
    
    // Start oscillator and schedule stop
    oscillator.start(scheduleTime);
    oscillator.stop(oscillatorStopTime);
    
    // DEBUG: Log timing
    console.log(`[PULSE #${this.pulseCounter}] envelope=${envelopeEndTime.toFixed(3)}s oscillator=${oscillatorStopTime.toFixed(3)}s`);
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
    
    // Clear automation and start from zero at scheduleTime
    envelope.gain.cancelScheduledValues(scheduleTime);
    envelope.gain.setValueAtTime(0, scheduleTime);
    
    // Attack: 0 → 1.0 over attack time (linear for clean start)
    envelope.gain.linearRampToValueAtTime(1.0, attackEnd);
    
    // Sustain: hold at 1.0
    envelope.gain.setValueAtTime(1.0, releaseStart);
    
    // Release: 1.0 → 0 over release time (linear to reach TRUE zero)
    envelope.gain.linearRampToValueAtTime(0, releaseEnd);
    
    // **CRITICAL**: Lock envelope at zero after release completes
    // This prevents ANY residual signal if envelope stays connected
    envelope.gain.setValueAtTime(0, releaseEnd);
    
    // DEBUG: Log envelope timing
    console.log(`Envelope: attack=${attackEnd.toFixed(3)}s sustain=${releaseStart.toFixed(3)}s release=${releaseEnd.toFixed(3)}s`);
    console.log(`Envelope: attack=${attackEnd.toFixed(3)}s release=${releaseStart.toFixed(3)}→${releaseEnd.toFixed(3)}s (${(releaseEnd - releaseStart) * 1000}ms)`);
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