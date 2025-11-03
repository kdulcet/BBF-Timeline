/**
 * JMTimeline - JourneyMap Timeline Engine
 * Core two-band scheduling system for AuraMatrix binaural beat applications
 * 
 * Wave Band: Continuous Hz automation using AudioParam
 * 32n Band: Discrete pulse events for rhythmic synchronization
 */

/**
 * Core Formula Constants (IMMUTABLE)
 */
const TIMELINE_CONSTANTS = {
  // BPM = (Hz × 60) / 8
  BPM_MULTIPLIER: 60 / 8,
  
  // 32n interval = 1 / (Hz × 4) 
  PULSE_32N_MULTIPLIER: 4,
  
  // Hz validation range
  HZ_MIN: 0.5,
  HZ_MAX: 25.0,
  
  // Visual update rate
  VISUAL_UPDATE_FPS: 60,
  VISUAL_UPDATE_INTERVAL: 1000 / 60, // ~16.67ms
  
  // Performance constants
  AUDIO_LOOKAHEAD: 0.1, // 100ms audio scheduling lookahead
  MEMORY_LIMIT: 1000     // Max events to keep in memory
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
    
    // Tone.js-inspired timeline management
    this._stateTimeline = new StateTimeline(PlaybackState.STOPPED, {
      memory: 100,
      increasing: true
    });
    
    // Wave Band: Hz automation events
    this._waveEvents = new Timeline({
      memory: TIMELINE_CONSTANTS.MEMORY_LIMIT,
      increasing: true
    });
    
    // 32n Band: Discrete pulse events  
    this._pulseEvents = new Timeline({
      memory: TIMELINE_CONSTANTS.MEMORY_LIMIT / 2,
      increasing: true
    });
    
    // Segment transition events
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
    
    this._setupEventListeners();
  }

  /**
   * Compile user segments into executable timeline
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
   * Setup internal event listeners and scheduling
   */
  _setupEventListeners() {
    // Bind context for callbacks
    this._boundAudioLoop = this._audioSchedulingLoop.bind(this);
    this._boundVisualLoop = this._visualUpdateLoop.bind(this);
    
    // Setup audio scheduling interval (background processing)
    this._audioSchedulingInterval = null;
  }

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
   * Get current Hz value at given time
   */
  getCurrentHz(time = null) {
    if (!this.isRunning) return 0;
    
    const position = this._getTimelinePosition(time);
    const segment = this._findSegmentAtTime(position);
    
    if (!segment) return 0;
    
    if (segment.type === SegmentType.PLATEAU) {
      return segment.hz || 0;
    } else if (segment.type === SegmentType.TRANSITION) {
      // Interpolate Hz during transition
      const segmentProgress = (position - segment.time_sec) / segment.duration_sec;
      const clampedProgress = Math.max(0, Math.min(1, segmentProgress));
      
      return segment.startHz + (segment.endHz - segment.startHz) * clampedProgress;
    }
    
    return 0;
  }

  /**
   * Find timeline segment at given time position
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

  /**
   * Start audio scheduling background loop
   */
  _startAudioScheduling() {
    if (this._audioSchedulingInterval) {
      clearInterval(this._audioSchedulingInterval);
    }
    
    // Start background audio scheduling (similar to Tone.js Clock._loop)
    this._audioSchedulingInterval = setInterval(this._boundAudioLoop, 25); // 40Hz scheduling rate
  }

  /**
   * Stop audio scheduling background loop
   */
  _stopAudioScheduling() {
    if (this._audioSchedulingInterval) {
      clearInterval(this._audioSchedulingInterval);
      this._audioSchedulingInterval = null;
    }
  }

  /**
   * Audio scheduling loop (background processing)
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
    this._scheduleWaveEvents(startTime, endTime);
    
    // Process 32n Band events (pulse triggers)
    this._schedule32nEvents(startTime, endTime);
    
    // Process segment transitions
    this._processSegmentTransitions(startTime, endTime);
  }

  /**
   * Schedule Wave Band events (continuous Hz automation)
   */
  _scheduleWaveEvents(startTime, endTime) {
    // Wave events are handled through getCurrentHz() interpolation
    // This allows for smooth real-time Hz queries without discrete events
    
    const currentHz = this.getCurrentHz();
    if (currentHz !== this._currentHz) {
      this._currentHz = currentHz;
      
      // Dispatch Hz change event for synths
      this._dispatchEvent(TimelineEvents.HZ_CHANGED, {
        hz: currentHz,
        time: this.audioContext.currentTime,
        wave_type: getWaveType(currentHz)
      });
    }
  }

  /**
   * Schedule 32n Band events (discrete pulse events)  
   */
  _schedule32nEvents(startTime, endTime) {
    const currentHz = this.getCurrentHz();
    if (currentHz <= 0) return;
    
    const pulseInterval = calculate32nInterval(currentHz);
    const timelineStartTime = this.startTime;
    
    // Find next pulse time
    const relativeStartTime = startTime - timelineStartTime;
    const relativeEndTime = endTime - timelineStartTime;
    
    let nextPulseTime = Math.ceil(relativeStartTime / pulseInterval) * pulseInterval;
    
    while (nextPulseTime < relativeEndTime + TIMELINE_CONSTANTS.AUDIO_LOOKAHEAD) {
      const absolutePulseTime = timelineStartTime + nextPulseTime;
      
      if (absolutePulseTime > this.audioContext.currentTime) {
        this._schedulePulseCallback(absolutePulseTime, currentHz);
      }
      
      nextPulseTime += pulseInterval;
    }
  }

  /**
   * Schedule individual pulse callback
   */
  _schedulePulseCallback(time, hz) {
    const timeUntilPulse = time - this.audioContext.currentTime;
    
    if (timeUntilPulse > 0) {
      const timeoutId = setTimeout(() => {
        this._scheduledCallbacks.delete(timeoutId);
        
        // Dispatch 32n pulse event
        this._dispatchEvent(TimelineEvents.PULSE_32N, {
          time,
          hz,
          interval: calculate32nInterval(hz)
        });
        
      }, timeUntilPulse * 1000);
      
      this._scheduledCallbacks.add(timeoutId);
    }
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