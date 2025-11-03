/**
 * Timeline Synth Integration Abstractions
 * Base classes and mixins for synths to easily access Wave Band or 32n Band
 * 
 * Wave Band: Continuous Hz automation for frequency-based synths (binaural, carriers)
 * 32n Band: Discrete pulse events for rhythmic synths (ISO, percussion, triggers)
 */

/**
 * Base Timeline Listener
 * Handles common timeline event setup and teardown
 */
class TimelineListener {
  constructor(audioContext, options = {}) {
    this.audioContext = audioContext;
    this.isListening = false;
    this.eventHandlers = new Map();
    
    // Configuration
    this.autoStart = options.autoStart !== false;
    this.autoStop = options.autoStop !== false;
    
    // Current state
    this.currentHz = 0;
    this.currentWaveType = "UNKNOWN";
    this.timelineRunning = false;
    
    this._setupBaseEventListeners();
  }

  /**
   * Setup basic timeline event listeners
   */
  _setupBaseEventListeners() {
    // Transport control
    this._addEventHandler('timeline.started', (event) => {
      this.timelineRunning = true;
      if (this.autoStart) {
        this.onTimelineStart(event.detail);
      }
    });

    this._addEventHandler('timeline.stopped', (event) => {
      this.timelineRunning = false;
      if (this.autoStop) {
        this.onTimelineStop(event.detail);
      }
    });

    this._addEventHandler('timeline.paused', (event) => {
      this.onTimelinePause(event.detail);
    });
  }

  /**
   * Add event handler with automatic cleanup tracking
   */
  _addEventHandler(eventType, handler) {
    if (this.eventHandlers.has(eventType)) {
      // Remove existing handler
      const oldHandler = this.eventHandlers.get(eventType);
      document.removeEventListener(eventType, oldHandler);
    }
    
    // Add new handler
    document.addEventListener(eventType, handler);
    this.eventHandlers.set(eventType, handler);
  }

  /**
   * Start listening to timeline events
   */
  startListening() {
    this.isListening = true;
    console.log(`${this.constructor.name} started listening to timeline`);
  }

  /**
   * Stop listening to timeline events
   */
  stopListening() {
    this.isListening = false;
    console.log(`${this.constructor.name} stopped listening to timeline`);
  }

  /**
   * Override these methods in subclasses
   */
  onTimelineStart(detail) {
    // Override in subclass
  }

  onTimelineStop(detail) {
    // Override in subclass  
  }

  onTimelinePause(detail) {
    // Override in subclass
  }

  /**
   * Clean up event listeners
   */
  dispose() {
    for (const [eventType, handler] of this.eventHandlers) {
      document.removeEventListener(eventType, handler);
    }
    this.eventHandlers.clear();
    this.isListening = false;
  }
}

/**
 * Wave Band Listener (Continuous Hz Automation)
 * For synths that need smooth frequency changes (binaural beats, carrier oscillators)
 */
class WaveBandListener extends TimelineListener {
  constructor(audioContext, options = {}) {
    super(audioContext, options);
    
    // Wave Band specific configuration
    this.smoothTransitions = options.smoothTransitions !== false;
    this.hzUpdateRate = options.hzUpdateRate || 'realtime'; // 'realtime' | 'audio' | 'visual'
    
    this._setupWaveBandListeners();
  }

  /**
   * Setup Wave Band specific event listeners
   */
  _setupWaveBandListeners() {
    // Listen for Hz changes (sample-accurate audio events)
    this._addEventHandler('timeline.hz.changed', (event) => {
      if (!this.isListening) return;
      
      const { hz, time, wave_type } = event.detail;
      this.currentHz = hz;
      this.currentWaveType = wave_type;
      
      if (this.hzUpdateRate === 'audio' || this.hzUpdateRate === 'realtime') {
        this.onHzChanged(hz, time, wave_type);
      }
    });

    // Listen for visual Hz updates (60fps smooth updates)
    this._addEventHandler('timeline.hz.visual', (event) => {
      if (!this.isListening) return;
      
      const { hz, wave_type, time } = event.detail;
      
      if (this.hzUpdateRate === 'visual' || this.hzUpdateRate === 'realtime') {
        this.onHzVisualUpdate(hz, wave_type, time);
      }
    });

    // Listen for transition events
    this._addEventHandler('timeline.transition.start', (event) => {
      if (!this.isListening) return;
      
      const { fromHz, toHz, duration, startTime } = event.detail;
      
      if (this.smoothTransitions) {
        this.onTransitionStart(fromHz, toHz, duration, startTime);
      }
    });

    // Listen for wave type changes
    this._addEventHandler('timeline.wave_type.changed', (event) => {
      if (!this.isListening) return;
      
      const { wave_type, hz } = event.detail;
      this.currentWaveType = wave_type;
      this.onWaveTypeChanged(wave_type, hz);
    });
  }

  /**
   * Override these methods for Wave Band functionality
   */
  onHzChanged(hz, time, waveType) {
    // Override in subclass for sample-accurate Hz changes
    console.log(`Wave Band Hz: ${hz} at ${time} (${waveType})`);
  }

  onHzVisualUpdate(hz, waveType, time) {
    // Override in subclass for smooth visual Hz updates
  }

  onTransitionStart(fromHz, toHz, duration, startTime) {
    // Override in subclass for smooth frequency transitions
    console.log(`Wave Band transition: ${fromHz}Hz → ${toHz}Hz over ${duration}s`);
  }

  onWaveTypeChanged(waveType, hz) {
    // Override in subclass for brainwave band changes
    console.log(`Wave type changed: ${waveType} at ${hz}Hz`);
  }

  /**
   * Helper: Get current Hz value
   */
  getCurrentHz() {
    return this.currentHz;
  }

  /**
   * Helper: Get current wave type
   */
  getCurrentWaveType() {
    return this.currentWaveType;
  }
}

/**
 * 32n Band Listener (Discrete Pulse Events)  
 * For synths that need rhythmic triggers (ISO pulses, percussion, gating)
 */
class PulseBandListener extends TimelineListener {
  constructor(audioContext, options = {}) {
    super(audioContext, options);
    
    // 32n Band specific configuration
    this.pulseAccuracy = options.pulseAccuracy || 'sample'; // 'sample' | 'visual'
    this.enablePulseFlash = options.enablePulseFlash !== false;
    
    // Pulse tracking
    this.pulseCount = 0;
    this.lastPulseTime = 0;
    this.currentPulseInterval = 0;
    
    this._setup32nBandListeners();
  }

  /**
   * Setup 32n Band specific event listeners
   */
  _setup32nBandListeners() {
    // Listen for 32n pulse events (sample-accurate)
    this._addEventHandler('timeline.pulse.32n', (event) => {
      if (!this.isListening) return;
      
      const { time, hz, interval } = event.detail;
      this.pulseCount++;
      this.lastPulseTime = time;
      this.currentPulseInterval = interval;
      
      if (this.pulseAccuracy === 'sample') {
        this.onPulse32n(time, hz, interval, this.pulseCount);
      }
    });

    // Listen for visual pulse flash events (visual feedback)
    this._addEventHandler('timeline.pulse.flash', (event) => {
      if (!this.isListening || !this.enablePulseFlash) return;
      
      const { time, hz } = event.detail;
      
      if (this.pulseAccuracy === 'visual') {
        this.onPulseFlash(time, hz);
      }
    });

    // Listen for Hz changes to update pulse rate
    this._addEventHandler('timeline.hz.changed', (event) => {
      if (!this.isListening) return;
      
      const { hz, time } = event.detail;
      const newInterval = 1 / (hz * 4); // 32n interval calculation
      
      if (Math.abs(newInterval - this.currentPulseInterval) > 0.001) {
        this.currentPulseInterval = newInterval;
        this.onPulseRateChanged(hz, newInterval, time);
      }
    });
  }

  /**
   * Override these methods for 32n Band functionality
   */
  onPulse32n(time, hz, interval, pulseCount) {
    // Override in subclass for sample-accurate pulse triggers
    console.log(`32n Pulse: ${pulseCount} at ${time} (${hz}Hz, ${interval}s interval)`);
  }

  onPulseFlash(time, hz) {
    // Override in subclass for visual pulse feedback
  }

  onPulseRateChanged(hz, interval, time) {
    // Override in subclass when pulse rate changes
    console.log(`Pulse rate changed: ${hz}Hz (${interval}s interval) at ${time}`);
  }

  /**
   * Reset pulse counter
   */
  resetPulseCount() {
    this.pulseCount = 0;
  }

  /**
   * Get current pulse statistics
   */
  getPulseStats() {
    return {
      count: this.pulseCount,
      lastTime: this.lastPulseTime,
      interval: this.currentPulseInterval,
      rate: 1 / this.currentPulseInterval
    };
  }
}

/**
 * Dual Band Listener (Both Wave and 32n Bands)
 * For synths that need both continuous Hz and pulse events
 */
class DualBandListener extends TimelineListener {
  constructor(audioContext, options = {}) {
    super(audioContext, options);
    
    // Create separate band listeners
    this.waveBand = new WaveBandListener(audioContext, {
      ...options.waveBand,
      autoStart: false,
      autoStop: false
    });
    
    this.pulseBand = new PulseBandListener(audioContext, {
      ...options.pulseBand,
      autoStart: false,
      autoStop: false
    });
    
    // Forward band events to this instance
    this._setupBandForwarding();
  }

  /**
   * Forward events from band listeners to this instance
   */
  _setupBandForwarding() {
    // Forward Wave Band events
    this.waveBand.onHzChanged = (hz, time, waveType) => {
      this.onWaveBandHz(hz, time, waveType);
    };
    
    this.waveBand.onTransitionStart = (fromHz, toHz, duration, startTime) => {
      this.onWaveBandTransition(fromHz, toHz, duration, startTime);
    };
    
    // Forward 32n Band events
    this.pulseBand.onPulse32n = (time, hz, interval, pulseCount) => {
      this.onPulseBand32n(time, hz, interval, pulseCount);
    };
    
    this.pulseBand.onPulseRateChanged = (hz, interval, time) => {
      this.onPulseBandRateChanged(hz, interval, time);
    };
  }

  /**
   * Override these methods for dual band functionality
   */
  onWaveBandHz(hz, time, waveType) {
    // Override in subclass for Wave Band Hz changes
  }

  onWaveBandTransition(fromHz, toHz, duration, startTime) {
    // Override in subclass for Wave Band transitions
  }

  onPulseBand32n(time, hz, interval, pulseCount) {
    // Override in subclass for 32n Band pulses
  }

  onPulseBandRateChanged(hz, interval, time) {
    // Override in subclass for 32n Band rate changes
  }

  /**
   * Start listening on both bands
   */
  startListening() {
    super.startListening();
    this.waveBand.startListening();
    this.pulseBand.startListening();
  }

  /**
   * Stop listening on both bands
   */
  stopListening() {
    super.stopListening();
    this.waveBand.stopListening();
    this.pulseBand.stopListening();
  }

  /**
   * Timeline control forwarding
   */
  onTimelineStart(detail) {
    super.onTimelineStart(detail);
    this.waveBand.onTimelineStart(detail);
    this.pulseBand.onTimelineStart(detail);
  }

  onTimelineStop(detail) {
    super.onTimelineStop(detail);
    this.waveBand.onTimelineStop(detail);
    this.pulseBand.onTimelineStop(detail);
  }

  onTimelinePause(detail) {
    super.onTimelinePause(detail);
    this.waveBand.onTimelinePause(detail);
    this.pulseBand.onTimelinePause(detail);
  }

  /**
   * Clean up both bands
   */
  dispose() {
    super.dispose();
    this.waveBand.dispose();
    this.pulseBand.dispose();
  }
}

/**
 * Convenience factory functions for creating timeline listeners
 */
const TimelineFactory = {
  /**
   * Create Wave Band listener for frequency-based synths
   */
  createWaveBandSynth(audioContext, options = {}) {
    return new WaveBandListener(audioContext, options);
  },

  /**
   * Create 32n Band listener for pulse-based synths
   */
  createPulseBandSynth(audioContext, options = {}) {
    return new PulseBandListener(audioContext, options);
  },

  /**
   * Create dual band listener for complex synths
   */
  createDualBandSynth(audioContext, options = {}) {
    return new DualBandListener(audioContext, options);
  }
};

// Export all timeline integration classes
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TimelineListener,
    WaveBandListener,
    PulseBandListener,
    DualBandListener,
    TimelineFactory
  };
} else if (typeof window !== 'undefined') {
  window.TimelineListener = TimelineListener;
  window.WaveBandListener = WaveBandListener;
  window.PulseBandListener = PulseBandListener;
  window.DualBandListener = DualBandListener;
  window.TimelineFactory = TimelineFactory;
}