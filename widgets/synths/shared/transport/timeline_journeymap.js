/**
 * JMTimeline - JourneyMap Timeline Engine
 * 
 * PURPOSE:
 * Dual-band scheduling system for binaural beat synthesis with timeline-based automation.
 * Manages both continuous Hz changes (Wave Band) and discrete rhythmic triggers (Pulse Band).
 * 
 * TWO-BAND ARCHITECTURE:
 * 
 * Wave Band (Continuous Hz Automation):
 * • Uses Web Audio linearRampToValueAtTime() for sample-accurate frequency changes
 * • Virtual Hz parameter (ConstantSourceNode.offset) tracks current frequency
 * • Perfect for binaural carrier oscillators and smooth frequency modulation
 * 
 * Pulse Band (Discrete 32nd-Note Triggers):
 * • Generates rhythmic pulse events aligned to 32n boundaries
 * • Uses transition-aware calculations for smooth pulse rate changes during ramps
 * • Perfect for ISO pulse synthesis and rhythmic gating
 * 
 * SCHEDULING APPROACH:
 * • 32ms ticker loop with 100ms lookahead window (events scheduled ahead of time)
 * • Immediate event dispatch with future Web Audio times (no jitter)
 * • Transition-aware pulse timing using trapezoidal integration
 * • Binary search timelines for efficient event storage and retrieval
 * 
 * TONE.JS INTEGRATION REFERENCE:
 * This implementation adapts patterns from Tone.js for robust timing:
 * • Transport._processTick() → Dynamic scheduling with lookahead (lines 732-780)
 * • TickParam._getTicksUntilEvent() → Trapezoidal integration for transitions (lines 425-449)
 * • StateTimeline → Transport state tracking (line 139)
 * • Timeline → Binary search event storage (lines 149-169)
 * • Signal/Param → Virtual Hz parameter automation (lines 210-221)
 * 
 * See: https://github.com/Tonejs/Tone.js/blob/main/Tone/core/clock/TickParam.ts#L163-L175
 */

/**
 * Core Formula Constants (IMMUTABLE)
 */
const TIMELINE_CONSTANTS = {
  // BPM = (Hz × 60) / 8
  BPM_MULTIPLIER: 60 / 8,
  
  // 32n interval = 1 / (Hz × 4) 
  PULSE_32N_MULTIPLIER: 1,
  
  // Hz validation range
  HZ_MIN: 0.5,
  HZ_MAX: 25.0,
  
  // Visual update rate
  VISUAL_UPDATE_FPS: 60,
  VISUAL_UPDATE_INTERVAL: 1000 / 60, // ~16.67ms
  
  // Performance constants
  AUDIO_LOOKAHEAD: 0.1, // 100ms audio scheduling lookahead
  MEMORY_LIMIT: 1000,    // Max events to keep in memory
  
  // Ticker constants (Tone.js Ticker pattern)
  TICKER_INTERVAL: 32,   // 32ms ticker loop (matches Tone.js)
  
  // Tone.js TickParam uses ~10 linear segments per second for exponential curves
  // We use Web Audio native ramping instead, but this could be used for pulse calc
  // See: Tone.js/core/clock/TickParam.ts#L130-L141 (exponentialRampToValueAtTime)
  TRANSITION_SEGMENTS_PER_SECOND: 10
};

/**
 * Brainwave band classification
 */
function getWaveType(hz) {
  if (hz >= 0.5 && hz <= 4)   return "DELTA";   // Deep sleep
  if (hz > 4 && hz <= 8)      return "THETA";   // Meditation  
  if (hz > 8 && hz <= 12)     return "ALPHA";   // Relaxed awareness
  if (hz > 12 && hz <= 15)    return "SMR";     // Sensorimotor rhythm
  if (hz > 15 && hz <= 25)    return "BETA";    // Active focus
  return "UNKNOWN";
}

/**
 * Core BPM calculation (IMMUTABLE)
 */
function calculateTimelineBPM(hz) {
  return hz * TIMELINE_CONSTANTS.BPM_MULTIPLIER;
}

/**
 * Calculate 32nd note pulse interval
 */
function calculate32nInterval(hz) {
  return 1 / (hz * TIMELINE_CONSTANTS.PULSE_32N_MULTIPLIER);
}

/**
 * Validate Hz range
 */
function validateHz(hz) {
  if (isNaN(hz)) return false;
  return hz >= TIMELINE_CONSTANTS.HZ_MIN && hz <= TIMELINE_CONSTANTS.HZ_MAX;
}

/**
 * Timeline segment types
 */
const SegmentType = {
  PLATEAU: 'plateau',
  TRANSITION: 'transition'
};

/**
 * Timeline event types for synth communication
 */
const TimelineEvents = {
  // Transport control
  STARTED: 'timeline.started',
  PAUSED: 'timeline.paused',
  STOPPED: 'timeline.stopped',
  
  // Hz automation (Wave Band)
  HZ_CHANGED: 'timeline.hz.changed',
  WAVE_TYPE_CHANGED: 'timeline.wave_type.changed',
  
  // Segment management
  SEGMENT_CHANGED: 'timeline.segment.changed', 
  TRANSITION_START: 'timeline.transition.start',
  TRANSITION_END: 'timeline.transition.end',
  
  // Random access
  JUMP: 'timeline.jump',
  
  // 32n pulse events (32n Band)
  PULSE_32N: 'timeline.pulse.32n',
  
  // Visual feedback
  HZ_VISUAL: 'timeline.hz.visual',
  PULSE_FLASH: 'timeline.pulse.flash'
};

/**
 * JMTimeline - Main timeline engine
 */
class JMTimeline {
  constructor(audioContext, segments = []) {
    this.audioContext = audioContext;
    this.segments = segments;
    this.compiledTimeline = this._compile(segments);
    this.playbackMode = "sequential";
    this.isRunning = false;
    this.isPaused = false;
    
    // Timeline state
    this.startTime = null;
    this.pauseTime = null;
    this.currentSegmentIndex = 0;
    this.timelinePosition = 0;
    
    // Transport state tracking (start/stop/pause)
    this._stateTimeline = new StateTimeline(PlaybackState.STOPPED, {
      memory: 100,
      increasing: true
    });
    
    // Wave Band event storage (binary search timeline with memory management)
    this._waveEvents = new Timeline({
      memory: TIMELINE_CONSTANTS.MEMORY_LIMIT,
      increasing: true
    });
    
    // Pulse Band event storage (transition-aware pulse scheduling)
    this._pulseEvents = new Timeline({
      memory: TIMELINE_CONSTANTS.MEMORY_LIMIT / 2,
      increasing: true
    });
    
    // Segment tracking for user-defined timeline progression
    this._segmentEvents = new Timeline({
      memory: 100,
      increasing: true
    });
    
    // Performance optimization
    this._lastUpdate = 0;
    this._eventMemoization = new Map();
    this._scheduledCallbacks = new Set();
    
    // Visual feedback system
    this._visualUpdateId = null;
    this._lastVisualUpdate = 0;
    
    // Current Hz tracking for visual feedback
    this._currentHz = 0;
    this._lastWaveType = "UNKNOWN";
    
    // Web Audio virtual Hz parameter (sample-accurate automation)
    this._virtualHzParam = this._createVirtualHzParam();
    
    // Dynamic pulse scheduling state
    this._scheduledPulseKeys = new Set();  // Prevent duplicate scheduling
    this._nextPulseTime = null;            // Current pulse scheduling cursor
    this._lastScheduledPulseTime = 0;      // Track last scheduled pulse to prevent duplicates
    
    // Ticker-based scheduling loop
    this._tickerInterval = null;           // 32ms ticker loop
    
    this._setupEventListeners();
  }

  /**
   * Create virtual Hz parameter using Web Audio automation
   * 
   * Uses ConstantSourceNode.offset as a virtual parameter for sample-accurate
   * Hz automation. Synths can read via .value property or connect directly.
   * 
   * @returns {AudioParam} Sample-accurate Hz parameter
   * @private
   */
  _createVirtualHzParam() {
    const constantSource = this.audioContext.createConstantSource();
    constantSource.offset.value = 2.0; // Default starting Hz
    constantSource.start(0); // Must start to enable parameter updates
    
    return constantSource.offset;
  }

  /**
   * Get current Hz from virtual parameter (sample-accurate)
   * 
   * Returns instantaneous Hz value from Web Audio automation curve.
   * Note: Pulse Band scheduling uses transition-aware calculations during ramps.
   * 
   * @returns {number} Current Hz value
   */
  getCurrentHz() {
    if (!this.isRunning) return 0;
    
    return this._virtualHzParam.value;
  }

  /**
   * Schedule Hz ramp using Web Audio automation
   * 
   * @param {number} fromHz - Starting Hz
   * @param {number} toHz - Target Hz
   * @param {number} startTime - Web Audio start time
   * @param {number} duration - Ramp duration in seconds
   * @private
   * See: Tone.js/core/context/Param.ts#L369-L381 (linearRampToValueAtTime)
   * 
   * This creates smooth, sample-accurate frequency transitions that work perfectly
   * @private
   */
  _scheduleHzRamp(fromHz, toHz, startTime, duration) {
    this._virtualHzParam.setValueAtTime(fromHz, startTime);
    this._virtualHzParam.linearRampToValueAtTime(toHz, startTime + duration);
    
    console.log(`Hz automation: ${fromHz}→${toHz}Hz over ${duration}s @ ${startTime.toFixed(3)}s`);
  }

  /**
   * Compile user segments into executable timeline
   * 
   * @param {Array} segments - User-defined timeline segments
   * @returns {Array} Compiled timeline with cumulative time positions
   * @private
   */
  _compile(segments) {
    const timeline = [];
    let cursor = 0;
    
    for (const segment of segments) {
      const compiledSegment = {
        time_sec: cursor,
        hz: segment.hz || null,
        duration_sec: segment.durationSeconds || (segment.duration_min * 60),
        type: segment.type,
        index: timeline.length
      };
      
      // Add transition properties if applicable
      if (segment.type === SegmentType.TRANSITION) {
        compiledSegment.startHz = segment.startHz;
        compiledSegment.endHz = segment.endHz;
        compiledSegment.transitionType = segment.transitionType || 'linear';
      }
      
      timeline.push(compiledSegment);
      cursor += compiledSegment.duration_sec;
    }
    
    return timeline;
  }

  /**
   * Schedule Wave Band Hz automation for entire timeline
   * 
   * Creates sample-accurate frequency automation using Web Audio's linearRampToValueAtTime.
   * Schedules all plateau and transition segments for smooth Hz changes.
   * 
   * @private
   */
  _scheduleWaveBandAutomation() {
    let currentHz = 2.0; // Default starting Hz
    
    // Clear existing automation
    this._virtualHzParam.cancelScheduledValues(0);
    
    for (const segment of this.compiledTimeline) {
      const segmentStartTime = this.startTime + segment.time_sec;
      
      if (segment.type === SegmentType.PLATEAU) {
        // Plateau: constant Hz
        currentHz = segment.hz;
        this._virtualHzParam.setValueAtTime(currentHz, segmentStartTime);
        
        console.log(`Plateau: ${currentHz}Hz @ ${segmentStartTime.toFixed(3)}s (${segment.duration_sec}s)`);
        
      } else if (segment.type === SegmentType.TRANSITION) {
        // Transition: linear ramp  
        this._virtualHzParam.setValueAtTime(segment.startHz, segmentStartTime);
        this._virtualHzParam.linearRampToValueAtTime(
          segment.endHz, 
          segmentStartTime + segment.duration_sec
        );
        
        currentHz = segment.endHz;
        console.log(`Transition: ${segment.startHz}→${segment.endHz}Hz over ${segment.duration_sec}s @ ${segmentStartTime.toFixed(3)}s`);
      }
    }
    
    console.log(`Wave Band Hz automation scheduled`);
  }

  /**
   * Initialize Pulse Band scheduling system
   * 
   * Sets up transition-aware pulse scheduling with trapezoidal integration for
   * smooth pulse rate changes during Hz transitions.
   * 
   * @private
   */
  _initializePulseBandScheduling() {
    this._scheduledPulseKeys.clear();
    
    console.log(`Pulse Band scheduling initialized (transition-aware)`);
  }

  /**
   * Convert ticks to seconds (assuming 120 BPM base)
   * 
   * @param {number} ticks - Ticks to convert
   * @returns {number} Time in seconds
   * @private
   */
  _ticksToSeconds(ticks) {
    const bpm = 120; // Base BPM for tick calculation
    const beatsPerSecond = bpm / 60;
    const ticksPerSecond = beatsPerSecond * this._ppq;
    return ticks / ticksPerSecond;
  }

  /**
   * Get Hz value at specific time, accounting for Web Audio ramping
   * 
   * For current time, uses direct parameter value. For future times, interpolates
   * based on timeline segment (constant for plateaus, linear for transitions).
   * 
   * @param {number} time - Web Audio time
   * @returns {number} Hz value at specified time
   * @private
   */
  _getHzAtTime(time) {
    if (!this.isRunning || !this._virtualHzParam) return 0;
    
    // For current time, use direct parameter value (most accurate)
    if (Math.abs(time - this.audioContext.currentTime) < 0.001) {
      return this._virtualHzParam.value;
    }
    
    // For future times, find the segment and interpolate if in transition
    const timelinePosition = time - this.startTime;
    const segment = this._findSegmentAtTime(timelinePosition);
    
    if (!segment) return 0;
    
    if (segment.type === SegmentType.PLATEAU) {
      // Plateau segment: constant Hz
      return segment.hz;
    } else if (segment.type === SegmentType.TRANSITION) {
      // Transition segment: linear interpolation (matching Web Audio ramping)
      const segmentProgress = (timelinePosition - segment.time_sec) / segment.duration_sec;
      const clampedProgress = Math.max(0, Math.min(1, segmentProgress));
      
      // Linear interpolation between startHz and endHz
      return segment.startHz + (segment.endHz - segment.startHz) * clampedProgress;
    }
    
    return 0;
  }

  /**
   * Calculate next pulse time using transition-aware interval calculation
   * 
   * Uses trapezoidal integration (averaging Hz over interval) for smooth pulse
   * rate changes during Hz transitions.
   * 
   * @param {number} currentTime - Current Web Audio time
   * @param {number} currentHz - Current Hz value
   * @returns {number} Time of next pulse
   * @private
   */
  _getNextPulseTime(currentTime, currentHz) {
    // Basic 32n interval calculation
    const baseInterval = calculate32nInterval(currentHz);
    
    // For very small intervals or plateau segments, use direct calculation
    if (baseInterval < 0.01) {
      return currentTime + baseInterval;
    }
    
    // Check if we're in a transition segment
    const timelinePosition = currentTime - this.startTime;
    const segment = this._findSegmentAtTime(timelinePosition);
    
    if (!segment || segment.type === SegmentType.PLATEAU) {
      // Plateau: use direct interval calculation
      return currentTime + baseInterval;
    }
    
    // Transition: use trapezoidal integration for smooth pulse rate changes
    const lookAheadTime = Math.min(baseInterval, 0.1); // Look ahead up to 100ms
    const futureTime = currentTime + lookAheadTime;
    const futureHz = this._getHzAtTime(futureTime);
    
    // Trapezoidal integration: average Hz over interval
    // Based on Tone.js TickParam: 0.5 * (time - event.time) * (val0 + val1)
    const avgHz = 0.5 * (currentHz + futureHz);
    
    if (avgHz <= 0) return currentTime + baseInterval;
    
    // Calculate interval using average Hz for smooth transitions
    const transitionAwareInterval = calculate32nInterval(avgHz);
    
    return currentTime + transitionAwareInterval;
  }

  /**
   * Setup internal event listeners and scheduling
   * @private
   */
  _setupEventListeners() {
    // Bind context for callbacks
    this._boundAudioLoop = this._audioSchedulingLoop.bind(this);
    this._boundVisualLoop = this._visualUpdateLoop.bind(this);
    
    // Setup audio scheduling interval (background processing)
    this._audioSchedulingInterval = null;
  }

  // ============================================================================
  // TRANSPORT CONTROL (Start/Stop/Pause)
  // ============================================================================

  /**
   * Start timeline playback
   */
  start() {
    if (this.isRunning && !this.isPaused) {
      return; // Already running
    }
    
    const startTime = this.audioContext.currentTime;
    
    if (this.isPaused) {
      // Resume from pause
      const pauseDuration = startTime - this.pauseTime;
      this.startTime += pauseDuration;
      this.isPaused = false;
    } else {
      // Fresh start
      this.startTime = startTime;
      this.timelinePosition = 0;
      this.currentSegmentIndex = 0;
      
      // Clear scheduled pulse tracking
      this._scheduledPulseKeys.clear();
      
      // Reset pulse timing for dynamic scheduling
      this._nextPulseTime = startTime;
      
      // Schedule Hz automation and pulse events
      console.log(`Scheduling Wave Band automation and Pulse Band events...`);
      this._scheduleWaveBandAutomation();
      this._initializePulseBandScheduling();
    }
    
    this.isRunning = true;
    
    // Update state timeline
    this._stateTimeline.setStateAtTime(PlaybackState.STARTED, startTime);
    
    // Start audio scheduling loop
    this._startAudioScheduling();
    
    // Start visual feedback loop
    this._startVisualFeedback();
    
    // Schedule initial events
    this._scheduleInitialEvents(startTime);
    
    // Dispatch start event
    this._dispatchEvent(TimelineEvents.STARTED, {
      startTime,
      timelinePosition: this.timelinePosition
    });
    
    console.log(`JMTimeline started at ${startTime}`);
  }

  /**
   * Pause timeline playback
   */
  pause() {
    if (!this.isRunning || this.isPaused) {
      return; // Not running or already paused
    }
    
    const pauseTime = this.audioContext.currentTime;
    this.pauseTime = pauseTime;
    this.isPaused = true;
    
    // Update state timeline
    this._stateTimeline.setStateAtTime(PlaybackState.PAUSED, pauseTime);
    
    // Stop scheduling new events
    this._stopAudioScheduling();
    
    // Cancel future scheduled events
    this._cancelScheduledEvents();
    
    // Visual feedback continues during pause
    
    // Dispatch pause event
    this._dispatchEvent(TimelineEvents.PAUSED, {
      pauseTime,
      timelinePosition: this._getTimelinePosition(pauseTime)
    });
    
    console.log(`JMTimeline paused at ${pauseTime}`);
  }

  /**
   * Stop timeline playback
   */
  stop() {
    if (!this.isRunning) {
      return; // Already stopped
    }
    
    const stopTime = this.audioContext.currentTime;
    
    this.isRunning = false;
    this.isPaused = false;
    this.startTime = null;
    this.pauseTime = null;
    this.timelinePosition = 0;
    this.currentSegmentIndex = 0;
    
    // Update state timeline
    this._stateTimeline.setStateAtTime(PlaybackState.STOPPED, stopTime);
    
    // Stop all scheduling
    this._stopAudioScheduling();
    this._stopVisualFeedback();
    
    // Cancel all scheduled events
    this._cancelScheduledEvents();
    
    // Clear scheduled pulse tracking
    this._scheduledPulseKeys.clear();
    
    // Clear timelines
    this._clearEventTimelines();
    
    // Dispatch stop event
    this._dispatchEvent(TimelineEvents.STOPPED, {
      stopTime,
      finalPosition: this._getTimelinePosition(stopTime)
    });
    
    console.log(`JMTimeline stopped at ${stopTime}`);
  }

  /**
   * Get current timeline position in seconds
   */
  _getTimelinePosition(currentTime = null) {
    if (!this.isRunning) return 0;
    
    const time = currentTime || this.audioContext.currentTime;
    
    if (this.isPaused) {
      return this.pauseTime - this.startTime;
    }
    
    return time - this.startTime;
  }

  /**
   * Get total timeline duration in seconds
   * 
   * @returns {number} Total duration in seconds
   */
  getTotalDuration() {
    if (this.compiledTimeline.length === 0) return 0;
    
    const lastSegment = this.compiledTimeline[this.compiledTimeline.length - 1];
    return lastSegment.time_sec + lastSegment.duration_sec;
  }

  /**
   * Get current Hz value from Web Audio parameter (sample-accurate)
   * 
   * Returns instantaneous Hz value from Web Audio automation curve.
   * Note: Pulse Band scheduling uses transition-aware calculations during ramps.
   * 
   * @returns {number} Current Hz value
   */
  getCurrentHz() {
    if (!this.isRunning || !this._virtualHzParam) return 0;
    
    return this._virtualHzParam.value;
  }

  /**
   * Find timeline segment at given time position
   * 
   * @param {number} position - Timeline position in seconds
   * @returns {Object|null} Segment at position, or null if not found
   * @private
   */
  _findSegmentAtTime(position) {
    for (const segment of this.compiledTimeline) {
      const segmentEnd = segment.time_sec + segment.duration_sec;
      if (position >= segment.time_sec && position < segmentEnd) {
        return segment;
      }
    }
    return null;
  }

  // ============================================================================
  // AUDIO SCHEDULING SYSTEM (32ms Ticker Loop)
  // ============================================================================

  /**
   * Start audio scheduling with 32ms ticker loop
   * 
   * Runs background scheduling loop that checks lookahead window and dispatches
   * pulse events ahead of time for sample-accurate timing.
   * 
   * @private
   */
  _startAudioScheduling() {
    if (this._tickerInterval) {
      clearInterval(this._tickerInterval);
    }
    
    console.log(`Starting 32ms ticker loop`);
    
    // 32ms ticker loop    // 32ms ticker loop (like Tone.js Ticker.ts)
    this._tickerInterval = setInterval(this._boundAudioLoop, TIMELINE_CONSTANTS.TICKER_INTERVAL);
  }

  /**
   * Stop audio scheduling ticker
   * @private
   */
  _stopAudioScheduling() {
    if (this._tickerInterval) {
      clearInterval(this._tickerInterval);
      this._tickerInterval = null;
    }
  }

  /**
   * Audio scheduling loop (background processing)
   * 
   * Called every 32ms to process Wave Band Hz changes, Pulse Band events,
   * and segment transitions.
   * 
   * @private
   */
  _audioSchedulingLoop() {
    if (!this.isRunning || this.isPaused) {
      return;
    }
    
    const startTime = this._lastUpdate;
    const endTime = this.audioContext.currentTime;
    this._lastUpdate = endTime;
    
    if (startTime === endTime) {
      return; // No time has passed
    }
    
    // Process Wave Band events (Hz automation)
    this._processWaveBandEvents(startTime, endTime);
    
    // Process Pulse Band events (32n triggers)
    this._processPulseBandEvents(startTime, endTime);
    
    // Process segment transitions
    this._updateCurrentSegment(startTime, endTime);
  }

  // ============================================================================
  // WAVE BAND PROCESSING
  // ============================================================================

  /**
   * Process Wave Band events (Hz change notifications for synths)
   * 
   * Hz automation is handled by Web Audio ramping (_scheduleWaveBandAutomation).
   * This method reads current Hz and dispatches change events for synth listeners.
   * 
   * @param {number} startTime - Period start time
   * @param {number} endTime - Period end time
   * @private
   */
  _processWaveBandEvents(startTime, endTime) {
    // Read current Hz from Web Audio parameter (sample-accurate)
    const displayHz = this.getCurrentHz();
    
    // Dispatch Hz change events for synths (throttled to avoid spam)
    if (Math.abs(displayHz - this._currentHz) > 0.2) {
      const previousHz = this._currentHz;
      this._currentHz = displayHz;
      
      // Significant change threshold to reduce event noise
      if (Math.abs(displayHz - previousHz) > 0.15) {
        this._dispatchEvent(TimelineEvents.HZ_CHANGED, {
          hz: displayHz,
          time: this.audioContext.currentTime,
          wave_type: getWaveType(displayHz)
        });
      }
    }
  }

  // ============================================================================
  // PULSE BAND PROCESSING
  // ============================================================================

  /**
   * Process Pulse Band 32n events (rhythmic triggers)
   * 
   * Uses 32ms ticker loop with 100ms lookahead window. Dispatches events
   * immediately with future scheduled time for sample-accurate synth timing.
   * 
   * @param {number} startTime - Period start time
   * @param {number} endTime - Period end time
   * @private
   */
  _processPulseBandEvents(startTime, endTime) {
    const now = this.audioContext.currentTime;
    const lookahead = now + TIMELINE_CONSTANTS.AUDIO_LOOKAHEAD;
    
    // Initialize pulse cursor on first call
    if (!this._nextPulseTime) {
      this._nextPulseTime = now;
      console.log(`Initializing pulse scheduling at ${now.toFixed(3)}s`);
    }
    
    // Schedule new pulses up to lookahead time and dispatch immediately
    let newPulsesScheduled = 0;
    while (this._nextPulseTime < lookahead) {
      const pulseTime = this._nextPulseTime;
      
      // Check if timeline has ended
      const timelineEnd = this.startTime + this.getTotalDuration();
      if (pulseTime >= timelineEnd) {
        break;
      }
      
      // Get Hz at pulse time (transition-aware)
      const pulseHz = this._getHzAtTime(pulseTime);
      
      // Create unique pulse key for deduplication
      const pulseKey = Math.round(pulseTime * 10000);
      
      // Only schedule if not already scheduled and Hz is valid
      if (pulseHz > 0 && !this._scheduledPulseKeys.has(pulseKey)) {
        this._scheduledPulseKeys.add(pulseKey);
        
        // Dispatch event IMMEDIATELY with future time
        // ISO synth will schedule Web Audio nodes for exact time
        this._dispatchPulseEvent(pulseTime, pulseHz, pulseKey);
        newPulsesScheduled++;
        
        // Calculate next pulse time using transition-aware interval
        this._nextPulseTime = this._getNextPulseTime(pulseTime, pulseHz);
      } else {
        // Skip invalid Hz or duplicate pulse
        this._nextPulseTime += 0.001;
      }
    }
    
    if (newPulsesScheduled > 0) {
      console.log(`Scheduled ${newPulsesScheduled} pulses in lookahead window`);
    }
  }

  /**
   * Dispatch pulse event immediately (ISO synth schedules Web Audio nodes)
   */
  _dispatchPulseEvent(time, hz, tick = null) {
    // Remove from scheduled tracking
    if (tick !== null) {
      this._scheduledPulseKeys.delete(tick);
    }
    
    console.log(`🔊 Pulse scheduled: ${hz.toFixed(2)}Hz for ${time.toFixed(3)}s`);
    
    // Dispatch 32n pulse event with future scheduled time
    // ISO synth will use this time to schedule Web Audio nodes
    this._dispatchEvent(TimelineEvents.PULSE_32N, {
      time,
      hz,
      tick,
      interval: calculate32nInterval(hz)
    });
  }

  /**
   * Process segment transitions
   */
  _processSegmentTransitions(startTime, endTime) {
    // Check if we've moved to a new segment
    const currentPosition = this._getTimelinePosition();
    const newSegment = this._findSegmentAtTime(currentPosition);
    
    if (newSegment && newSegment.index !== this.currentSegmentIndex) {
      const oldIndex = this.currentSegmentIndex;
      this.currentSegmentIndex = newSegment.index;
      
      // Dispatch segment change event
      this._dispatchEvent(TimelineEvents.SEGMENT_CHANGED, {
        from: oldIndex,
        to: newSegment.index,
        segment: newSegment,
        position: currentPosition
      });
      
      // Handle transition start/end events
      if (newSegment.type === SegmentType.TRANSITION) {
        this._dispatchEvent(TimelineEvents.TRANSITION_START, {
          fromHz: newSegment.startHz,
          toHz: newSegment.endHz,
          duration: newSegment.duration_sec,
          startTime: this.startTime + newSegment.time_sec
        });
      }
    }
  }

  /**
   * Schedule initial events when timeline starts
   */
  _scheduleInitialEvents(startTime) {
    // Schedule all compiled timeline events
    for (const segment of this.compiledTimeline) {
      const segmentStartTime = startTime + segment.time_sec;
      
      if (segment.type === SegmentType.PLATEAU && segment.hz) {
        // Schedule plateau Hz event
        this._scheduleHzEvent(segment.hz, segmentStartTime);
      }
    }
  }

  /**
   * Schedule Hz change event
   */
  _scheduleHzEvent(hz, time) {
    const timeUntilEvent = time - this.audioContext.currentTime;
    
    if (timeUntilEvent > 0) {
      const timeoutId = setTimeout(() => {
        this._scheduledCallbacks.delete(timeoutId);
        
        this._dispatchEvent(TimelineEvents.HZ_CHANGED, {
          hz,
          time,
          wave_type: getWaveType(hz)
        });
        
      }, timeUntilEvent * 1000);
      
      this._scheduledCallbacks.add(timeoutId);
    }
  }

  /**
   * Cancel all scheduled events
   */
  _cancelScheduledEvents() {
    for (const timeoutId of this._scheduledCallbacks) {
      clearTimeout(timeoutId);
    }
    this._scheduledCallbacks.clear();
  }

  /**
   * Clear event timelines
   */
  _clearEventTimelines() {
    this._waveEvents.dispose();
    this._pulseEvents.dispose();
    this._segmentEvents.dispose();
    
    // Recreate clean timelines
    this._waveEvents = new Timeline({ memory: TIMELINE_CONSTANTS.MEMORY_LIMIT });
    this._pulseEvents = new Timeline({ memory: TIMELINE_CONSTANTS.MEMORY_LIMIT / 2 });
    this._segmentEvents = new Timeline({ memory: 100 });
  }

  /**
   * Start visual feedback system
   */
  _startVisualFeedback() {
    this._ensureVisualContinuity();
  }

  /**
   * Stop visual feedback system
   */
  _stopVisualFeedback() {
    if (this._visualUpdateId) {
      cancelAnimationFrame(this._visualUpdateId);
      this._visualUpdateId = null;
    }
  }

  /**
   * Visual update loop (runs independently of audio scheduling)
   */
  _visualUpdateLoop() {
    if (!this.isRunning) {
      this._visualUpdateId = null;
      return;
    }
    
    const now = performance.now();
    
    // Throttle visual updates to target FPS
    if (now - this._lastVisualUpdate >= TIMELINE_CONSTANTS.VISUAL_UPDATE_INTERVAL) {
      this._updateVisualFeedback();
      this._lastVisualUpdate = now;
    }
    
    // Continue visual loop
    this._visualUpdateId = requestAnimationFrame(this._boundVisualLoop);
  }

  /**
   * Update visual feedback
   */
  _updateVisualFeedback() {
    const currentHz = this.getCurrentHz();
    const currentWaveType = getWaveType(currentHz);
    
    // Dispatch visual Hz update
    this._dispatchEvent(TimelineEvents.HZ_VISUAL, {
      hz: currentHz,
      wave_type: currentWaveType,
      time: performance.now()
    });
    
    // Check for wave type change
    if (currentWaveType !== this._lastWaveType) {
      this._lastWaveType = currentWaveType;
      this._dispatchEvent(TimelineEvents.WAVE_TYPE_CHANGED, {
        wave_type: currentWaveType,
        hz: currentHz
      });
    }
    
    // Handle 32n pulse flash for visual metronome
    if (this._shouldFlashMetronome()) {
      this._dispatchEvent(TimelineEvents.PULSE_FLASH, {
        time: performance.now(),
        hz: currentHz
      });
    }
  }

  /**
   * Check if visual metronome should flash
   */
  _shouldFlashMetronome() {
    const currentHz = this.getCurrentHz();
    if (currentHz <= 0) return false;
    
    const pulseInterval = calculate32nInterval(currentHz);
    const position = this._getTimelinePosition();
    
    // Flash on 32n pulse boundaries
    const pulseBoundary = Math.floor(position / pulseInterval) * pulseInterval;
    const timeSincePulse = position - pulseBoundary;
    
    // Flash for 50ms after each pulse
    return timeSincePulse < 0.05;
  }

  /**
   * Ensure visual feedback continuity
   */
  _ensureVisualContinuity() {
    if (this._visualUpdateId) {
      cancelAnimationFrame(this._visualUpdateId);
    }
    
    this._visualUpdateId = requestAnimationFrame(this._boundVisualLoop);
  }

  /**
   * Dispatch timeline event to document
   */
  _dispatchEvent(eventType, detail) {
    const event = new CustomEvent(eventType, { detail });
    document.dispatchEvent(event);
  }

  /**
   * Get current timeline state
   */
  getCurrentState() {
    if (!this.isRunning) return null;
    
    const position = this._getTimelinePosition();
    const segment = this._findSegmentAtTime(position);
    const currentHz = this.getCurrentHz();
    
    return {
      position,
      segment,
      hz: currentHz,
      wave_type: getWaveType(currentHz),
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      segmentIndex: this.currentSegmentIndex
    };
  }

  /**
   * Clean up timeline and dispose resources
   */
  dispose() {
    this.stop();
    
    this._stateTimeline.dispose();
    this._waveEvents.dispose();
    this._pulseEvents.dispose();
    this._segmentEvents.dispose();
    
    this._eventMemoization.clear();
    
    return this;
  }
}

// Export classes and constants
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    JMTimeline,
    TimelineEvents,
    SegmentType,
    TIMELINE_CONSTANTS,
    calculateTimelineBPM,
    calculate32nInterval,
    getWaveType,
    validateHz
  };
} else if (typeof window !== 'undefined') {
  window.JMTimeline = JMTimeline;
  window.TimelineEvents = TimelineEvents;
  window.SegmentType = SegmentType;
  window.TIMELINE_CONSTANTS = TIMELINE_CONSTANTS;
  window.calculateTimelineBPM = calculateTimelineBPM;
  window.calculate32nInterval = calculate32nInterval;
  window.getWaveType = getWaveType;
  window.validateHz = validateHz;
}