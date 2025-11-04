/**
 * Timeline Synth Integration System
 * 
 * PURPOSE:
 * Provides base classes for synths to connect to the JourneyMap timeline engine.
 * Uses document events for loose coupling between timeline and synthesis modules.
 * 
 * ARCHITECTURE OVERVIEW:
 * ┌──────────────────────────────────────────────────────────────┐
 * │ Timeline Engine (JMTimeline)                                 │
 * │ • Manages timeline segments (plateaus/transitions)           │
 * │ • Dispatches events via document.dispatchEvent()             │
 * └──────────────────────────────────────────────────────────────┘
 *                          ↓ (events)
 * ┌──────────────────────────────────────────────────────────────┐
 * │ Integration Layer (this file)                                │
 * │ • TimelineListener: Base class with auto cleanup             │
 * │ • WaveBandListener: Continuous Hz automation                 │
 * │ • PulseBandListener: Discrete rhythmic triggers              │
 * │ • DualBandListener: Both Hz and pulse events                 │
 * └──────────────────────────────────────────────────────────────┘
 *                          ↓ (inheritance)
 * ┌──────────────────────────────────────────────────────────────┐
 * │ Synth Implementations                                        │
 * │ • BinauralSynth: extends WaveBandListener                    │
 * │ • ISOSynth: extends PulseBandListener                        │
 * │ • ComplexSynth: extends DualBandListener                     │
 * └──────────────────────────────────────────────────────────────┘
 * 
 * INTEGRATION PATTERNS:
 * 
 * 1. WAVE BAND (Continuous Frequency Automation)
 *    - Use for: Binaural beats, carrier oscillators, frequency-modulated synths
 *    - Events: Hz changes with Web Audio scheduling times
 *    - Override: onHzChanged(hz, time, waveType)
 * 
 * 2. PULSE BAND (Discrete Rhythmic Triggers)
 *    - Use for: ISO pulses, percussion, rhythmic gating, event triggers
 *    - Events: 32nd-note-aligned pulse triggers
 *    - Override: onPulse32n(time, hz, interval, pulseCount)
 * 
 * 3. DUAL BAND (Both Continuous and Rhythmic)
 *    - Use for: Complex synthesis needing both smooth automation and triggers
 *    - Combines both Wave and Pulse band events
 *    - Override: Both wave and pulse methods
 * 
 * REFERENCE: Inspired by Tone.js Transport patterns
 * - Transport.scheduleRepeat() → our PulseBandListener
 * - Signal automation → our WaveBandListener
 * - Document events replace direct callbacks for decoupling
 */

/**
 * TimelineListener - Base Class for Timeline-Aware Synths
 * 
 * RESPONSIBILITY:
 * Foundation class providing automatic event management and cleanup for all
 * timeline-connected synthesis modules.
 * 
 * KEY FEATURES:
 * • Automatic event listener cleanup (prevents memory leaks)
 * • Optional auto-start/stop tied to timeline transport
 * • Timeline state tracking (Hz, waveType, running/stopped)
 * • Subclass override points for custom behavior
 * 
 * USAGE:
 * ```javascript
 * class MySynth extends TimelineListener {
 *   constructor(audioContext) {
 *     super(audioContext, { autoStart: true });
 *   }
 *   
 *   onTimelineStart(detail) {
 *     // Start your oscillators/generators here
 *   }
 *   
 *   onTimelineStop(detail) {
 *     // Stop and cleanup here
 *   }
 * }
 * ```
 * 
 * OPTIONS:
 * • autoStart (default: true) - Automatically call onTimelineStart() when timeline starts
 * • autoStop (default: true) - Automatically call onTimelineStop() when timeline stops
 */
class TimelineListener {
  constructor(audioContext, options = {}) {
    this.audioContext = audioContext;
    this.isListening = false;
    this.eventHandlers = new Map();
    
    // Automatic synth lifecycle management
    this.autoStart = options.autoStart !== false;
    this.autoStop = options.autoStop !== false;
    
    // Current timeline state tracking
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
   * @private
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
 * WaveBandListener - Continuous Hz Automation
 * 
 * PURPOSE:
 * For synths requiring smooth, continuous frequency changes from the timeline.
 * Receives Hz updates with Web Audio scheduling times for sample-accurate automation.
 * 
 * USE CASES:
 * • Binaural beat generators (carrier frequency automation)
 * • Frequency-modulated oscillators
 * • Filter cutoff automation based on brainwave frequencies
 * • Any parameter that follows timeline Hz smoothly
 * 
 * EVENTS RECEIVED:
 * • timeline.hz.changed - Sample-accurate Hz changes (use for audio-rate automation)
 * • timeline.hz.visual - 60fps smooth updates (use for visual feedback only)
 * • timeline.transition.start - Notification when Hz begins ramping
 * • timeline.wave_type.changed - Brainwave band changes (DELTA/THETA/ALPHA/etc)
 * 
 * USAGE EXAMPLE:
 * ```javascript
 * class BinauralSynth extends WaveBandListener {
 *   onHzChanged(hz, time, waveType) {
 *     // Schedule smooth ramp at exact Web Audio time
 *     this.oscillator.frequency.linearRampToValueAtTime(
 *       hz, 
 *       time
 *     );
 *   }
 * }
 * ```
 * 
 * OPTIONS:
 * • smoothTransitions (default: true) - Enable onTransitionStart() callbacks
 * • updateMode (default: 'audio') - Which Hz updates to receive:
 *     'audio': Sample-accurate audio-rate updates only
 *     'visual': Visual 60fps updates only  
 *     'both': Receive both audio and visual updates
 */
class WaveBandListener extends TimelineListener {
  constructor(audioContext, options = {}) {
    super(audioContext, options);
    
    // Configuration
    this.smoothTransitions = options.smoothTransitions !== false;
    this.updateMode = options.updateMode || 'audio'; // 'audio', 'visual', or 'both'
    
    this._setupWaveBandListeners();
  }

  /**
   * Setup Wave Band specific event listeners
   * @private
   */
  _setupWaveBandListeners() {
    // Sample-accurate Hz changes for audio-rate automation
    this._addEventHandler('timeline.hz.changed', (event) => {
      if (!this.isListening) return;
      
      const { hz, time, wave_type } = event.detail;
      this.currentHz = hz;
      this.currentWaveType = wave_type;
      
      if (this.updateMode === 'audio' || this.updateMode === 'both') {
        this.onHzChanged(hz, time, wave_type);
      }
    });

    // Visual-rate Hz updates (60fps) for UI/feedback
    this._addEventHandler('timeline.hz.visual', (event) => {
      if (!this.isListening) return;
      
      const { hz, wave_type, time } = event.detail;
      
      if (this.updateMode === 'visual' || this.updateMode === 'both') {
        this.onHzVisualUpdate(hz, wave_type, time);
      }
    });

    // Transition start notifications
    this._addEventHandler('timeline.transition.start', (event) => {
      if (!this.isListening) return;
      
      const { fromHz, toHz, duration, startTime } = event.detail;
      
      if (this.smoothTransitions) {
        this.onTransitionStart(fromHz, toHz, duration, startTime);
      }
    });

    // Brainwave band changes
    this._addEventHandler('timeline.wave_type.changed', (event) => {
      if (!this.isListening) return;
      
      const { wave_type, hz } = event.detail;
      this.currentWaveType = wave_type;
      this.onWaveTypeChanged(wave_type, hz);
    });
  }

  /**
   * OVERRIDE POINTS - Implement these in your synth subclass
   */
  
  /**
   * Called when Hz changes (sample-accurate, use for audio automation)
   * @param {number} hz - New Hz value
   * @param {number} time - Web Audio scheduled time for the change
   * @param {string} waveType - Brainwave band (DELTA/THETA/ALPHA/SMR/BETA)
   */
  onHzChanged(hz, time, waveType) {
    // Override in subclass for sample-accurate Hz automation
  }

  /**
   * Called on visual update cycle (60fps, use for UI feedback only)
   * @param {number} hz - Current Hz value
   * @param {string} waveType - Current brainwave band
   * @param {number} time - Current time
   */
  onHzVisualUpdate(hz, waveType, time) {
    // Override in subclass for visual Hz feedback
  }

  /**
   * Called when transition begins (optional, for transition-aware synthesis)
   * @param {number} fromHz - Starting Hz
   * @param {number} toHz - Target Hz  
   * @param {number} duration - Transition duration in seconds
   * @param {number} startTime - Web Audio time when transition starts
   */
  onTransitionStart(fromHz, toHz, duration, startTime) {
    // Override in subclass for transition awareness
  }

  /**
   * Called when brainwave band changes
   * @param {string} waveType - New brainwave band
   * @param {number} hz - Current Hz when band changed
   */
  onWaveTypeChanged(waveType, hz) {
    // Override in subclass for band-aware behavior
  }

  /**
   * HELPER METHODS - Utility functions for synth implementations
   */
  
  /**
   * Get current Hz value from timeline
   * @returns {number} Current Hz
   */
  getCurrentHz() {
    return this.currentHz;
  }

  /**
   * Get current brainwave band from timeline
   * @returns {string} Current wave type (DELTA/THETA/ALPHA/SMR/BETA)
   */
  getCurrentWaveType() {
    return this.currentWaveType;
  }
}

/**
 * PulseBandListener - Discrete Rhythmic Triggers
 * 
 * PURPOSE:
 * For synths requiring rhythmic trigger events aligned to 32nd note subdivisions.
 * Receives pulse events with sample-accurate Web Audio timing.
 * 
 * USE CASES:
 * • ISO pulse generators (binaural entrainment pulses)
 * • Rhythmic gating/triggering
 * • Percussion/drum synthesis
 * • Event-driven synthesis (trigger notes, samples, etc)
 * 
 * PULSE TIMING:
 * Pulses fire at 32nd-note boundaries relative to timeline Hz:
 * • At 2Hz: pulse every 125ms (8 pulses per second)
 * • At 10Hz: pulse every 25ms (40 pulses per second)  
 * • Formula: interval = 1 / (Hz × 4)
 * 
 * NOTE: Current implementation uses discrete Hz snapshots during transitions.
 * Future enhancement: Trapezoidal integration for smooth pulse rate changes.
 * 
 * EVENTS RECEIVED:
 * • timeline.pulse.32n - Sample-accurate pulse triggers with Hz context
 * • timeline.pulse.flash - Visual pulse events (for UI feedback)
 * • timeline.hz.changed - Monitors Hz to track pulse rate changes
 * 
 * USAGE EXAMPLE:
 * ```javascript
 * class ISOSynth extends PulseBandListener {
 *   onPulse32n(time, hz, interval, pulseCount) {
 *     // Create fresh oscillator at scheduled time
 *     const osc = this.audioContext.createOscillator();
 *     osc.start(time);
 *     osc.stop(time + interval / 2); // 50% duty cycle
 *   }
 * }
 * ```
 * 
 * OPTIONS:
 * • accuracyMode (default: 'sample') - Timing precision mode:
 *     'sample': Sample-accurate Web Audio scheduling
 *     'visual': Visual-rate feedback only (not for audio)
 * • enableFlash (default: false) - Receive visual pulse flash events
 */
class PulseBandListener extends TimelineListener {
  constructor(audioContext, options = {}) {
    super(audioContext, options);
    
    // Configuration
    this.accuracyMode = options.accuracyMode || 'sample'; // 'sample' or 'visual'
    this.enableFlash = options.enableFlash || false; // Visual feedback
    
    // Pulse tracking state
    this.pulseCount = 0;
    this.lastPulseTime = 0;
    this.currentPulseInterval = 0;
    
    this._setup32nBandListeners();
  }

  /**
   * Setup 32n Band specific event listeners
   * @private
   */
  _setup32nBandListeners() {
    // Sample-accurate pulse triggers
    this._addEventHandler('timeline.pulse.32n', (event) => {
      if (!this.isListening) return;
      
      const { time, hz, interval } = event.detail;
      this.pulseCount++;
      this.lastPulseTime = time;
      this.currentPulseInterval = interval;
      
      if (this.accuracyMode === 'sample') {
        this.onPulse32n(time, hz, interval, this.pulseCount);
      }
    });

    // Visual pulse flash events
    this._addEventHandler('timeline.pulse.flash', (event) => {
      if (!this.isListening || !this.enableFlash) return;
      
      const { time, hz } = event.detail;
      
      if (this.accuracyMode === 'visual') {
        this.onPulseFlash(time, hz);
      }
    });

    // Monitor Hz changes to track pulse rate changes
    this._addEventHandler('timeline.hz.changed', (event) => {
      if (!this.isListening) return;
      
      const { hz, time } = event.detail;
      const newInterval = 1 / (hz * 4); // 32n interval: 1/(Hz × 4)
      
      if (Math.abs(newInterval - this.currentPulseInterval) > 0.001) {
        this.currentPulseInterval = newInterval;
        this.onPulseRateChanged(hz, newInterval, time);
      }
    });
  }

  /**
   * OVERRIDE POINTS - Implement these in your synth subclass
   */
  
  /**
   * Called on each 32nd-note pulse (sample-accurate, use for audio triggers)
   * @param {number} time - Web Audio scheduled time for this pulse
   * @param {number} hz - Current timeline Hz at pulse time
   * @param {number} interval - Time until next pulse (seconds)
   * @param {number} pulseCount - Sequential pulse number (starts at 1)
   */
  onPulse32n(time, hz, interval, pulseCount) {
    // Override in subclass for sample-accurate pulse triggers
  }

  /**
   * Called on visual pulse flash (for UI feedback only, not audio)
   * @param {number} time - Current time
   * @param {number} hz - Current Hz
   */
  onPulseFlash(time, hz) {
    // Override in subclass for visual pulse feedback
  }

  /**
   * Called when pulse rate changes (Hz change results in interval change)
   * @param {number} hz - New Hz value
   * @param {number} interval - New interval between pulses (seconds)
   * @param {number} time - Time when rate changed
   */
  onPulseRateChanged(hz, interval, time) {
    // Override in subclass for pulse rate awareness
  }

  /**
   * HELPER METHODS - Utility functions for synth implementations
   */
  
  /**
   * Reset pulse counter to zero
   */
  resetPulseCount() {
    this.pulseCount = 0;
  }

  /**
   * Get current pulse statistics
   * @returns {Object} Pulse stats {count, lastTime, interval, rate}
   */
  getPulseStats() {
    return {
      count: this.pulseCount,
      lastTime: this.lastPulseTime,
      interval: this.currentPulseInterval,
      rate: this.currentPulseInterval > 0 ? 1 / this.currentPulseInterval : 0
    };
  }
}

/**
 * DualBandListener - Combined Wave and Pulse Events
 * 
 * PURPOSE:
 * For complex synths requiring both continuous Hz automation AND discrete pulses.
 * Combines WaveBandListener and PulseBandListener functionality.
 * 
 * USE CASES:
 * • Complex synthesis with smooth frequency AND rhythmic triggers
 * • Synths that modulate carrier while generating pulses
 * • Multi-parameter timeline-driven synthesis
 * 
 * USAGE EXAMPLE:
 * ```javascript
 * class ComplexSynth extends DualBandListener {
 *   onWaveBandHz(hz, time, waveType) {
 *     // Update carrier frequency smoothly
 *     this.carrier.frequency.linearRampToValueAtTime(hz, time);
 *   }
 *   
 *   onPulseBand32n(time, hz, interval, pulseCount) {
 *     // Trigger envelope at pulse time
 *     this.envelope.trigger(time);
 *   }
 * }
 * ```
 */
class DualBandListener extends TimelineListener {
  constructor(audioContext, options = {}) {
    super(audioContext, options);
    
    // Create internal band listeners (not directly exposed)
    this.waveBand = new WaveBandListener(audioContext, {
      ...options.wave,
      autoStart: false,
      autoStop: false
    });
    
    this.pulseBand = new PulseBandListener(audioContext, {
      ...options.pulse,
      autoStart: false,
      autoStop: false
    });
    
    this._setupBandForwarding();
  }

  /**
   * Forward events from internal band listeners to override points
   * @private
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
   * OVERRIDE POINTS - Implement these in your synth subclass
   */
  
  /**
   * Called when Wave Band Hz changes
   * @param {number} hz - New Hz value
   * @param {number} time - Web Audio scheduled time
   * @param {string} waveType - Brainwave band
   */
  onWaveBandHz(hz, time, waveType) {
    // Override in subclass for Wave Band Hz automation
  }

  /**
   * Called when Wave Band transition begins
   * @param {number} fromHz - Starting Hz
   * @param {number} toHz - Target Hz
   * @param {number} duration - Transition duration (seconds)
   * @param {number} startTime - Web Audio start time
   */
  onWaveBandTransition(fromHz, toHz, duration, startTime) {
    // Override in subclass for Wave Band transitions
  }

  /**
   * Called on each Pulse Band 32nd-note trigger
   * @param {number} time - Web Audio scheduled time
   * @param {number} hz - Current Hz
   * @param {number} interval - Interval to next pulse
   * @param {number} pulseCount - Sequential pulse number
   */
  onPulseBand32n(time, hz, interval, pulseCount) {
    // Override in subclass for Pulse Band triggers
  }

  /**
   * Called when Pulse Band rate changes
   * @param {number} hz - New Hz value
   * @param {number} interval - New pulse interval
   * @param {number} time - Time of change
   */
  onPulseBandRateChanged(hz, interval, time) {
    // Override in subclass for Pulse Band rate changes
  }

  /**
   * Start listening on both Wave and Pulse bands
   */
  startListening() {
    super.startListening();
    this.waveBand.startListening();
    this.pulseBand.startListening();
  }

  /**
   * Stop listening on both Wave and Pulse bands
   */
  stopListening() {
    super.stopListening();
    this.waveBand.stopListening();
    this.pulseBand.stopListening();
  }

  /**
   * Forward timeline start to both bands
   * @param {Object} detail - Timeline start details
   */
  onTimelineStart(detail) {
    super.onTimelineStart(detail);
    this.waveBand.onTimelineStart(detail);
    this.pulseBand.onTimelineStart(detail);
  }

  /**
   * Forward timeline stop to both bands
   * @param {Object} detail - Timeline stop details
   */
  onTimelineStop(detail) {
    super.onTimelineStop(detail);
    this.waveBand.onTimelineStop(detail);
    this.pulseBand.onTimelineStop(detail);
  }

  /**
   * Forward timeline pause to both bands
   * @param {Object} detail - Timeline pause details
   */
  onTimelinePause(detail) {
    super.onTimelinePause(detail);
    this.waveBand.onTimelinePause(detail);
    this.pulseBand.onTimelinePause(detail);
  }

  /**
   * Clean up both Wave and Pulse bands
   */
  dispose() {
    super.dispose();
    this.waveBand.dispose();
    this.pulseBand.dispose();
  }
}

/**
 * EXPORTS
 * 
 * Available classes for synth integration:
 * • TimelineListener - Base class with auto cleanup
 * • WaveBandListener - Continuous Hz automation
 * • PulseBandListener - Discrete rhythmic triggers
 * • DualBandListener - Both Wave and Pulse events
 */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TimelineListener,
    WaveBandListener,
    PulseBandListener,
    DualBandListener
  };
} else if (typeof window !== 'undefined') {
  window.TimelineListener = TimelineListener;
  window.WaveBandListener = WaveBandListener;
  window.PulseBandListener = PulseBandListener;
  window.DualBandListener = DualBandListener;
}