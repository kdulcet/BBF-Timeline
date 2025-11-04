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
  MEMORY_LIMIT: 1000,    // Max events to keep in memory
  
  // Tone.js-style transition segmentation
  // Controls smoothness vs performance during Hz transitions
  TRANSITION_SEGMENTS_PER_SECOND: 10  // 10 segments/sec like Tone.js
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
    
    // Tone.js-style Hz parameter system with native Web Audio ramping
    this._virtualHzParam = this._createVirtualHzParam();
    // Removed _preCalculatedHz - now using Web Audio native ramping
    this._hzCurveSegments = [];        // linear segments for smooth transitions
    this._tickBasedPulses = new Map(); // tick -> pulse mapping
    this._ppq = 48;                    // Pulses Per Quarter (32n = PPQ/8 = 6 ticks)
    this._totalTicks = 0;              // Total timeline length in ticks
    
    // Prevent duplicate pulse scheduling
    this._scheduledPulseKeys = new Set(); // Track already-scheduled pulse keys
    
    this._setupEventListeners();
  }

  /**
   * Create virtual Hz parameter using Web Audio's native ramping (Tone.js style)
   */
  _createVirtualHzParam() {
    // Create a ConstantSourceNode as our virtual Hz parameter
    const constantSource = this.audioContext.createConstantSource();
    constantSource.offset.value = 2.0; // Default starting Hz
    constantSource.start(0); // Start immediately
    
    // Return the offset AudioParam for ramping
    return constantSource.offset;
  }

  /**
   * Get current Hz from virtual parameter (sample-accurate)
   */
  getCurrentHz() {
    if (!this.isRunning) return 0;
    
    // Get sample-accurate Hz from Web Audio parameter
    const currentTime = this.audioContext.currentTime;
    return this._virtualHzParam.value;
  }

  /**
   * Schedule Hz ramp using native Web Audio (Tone.js pattern)
   */
  _scheduleHzRamp(fromHz, toHz, startTime, duration) {
    // Set starting value
    this._virtualHzParam.setValueAtTime(fromHz, startTime);
    
    // Schedule linear ramp to end value
    this._virtualHzParam.linearRampToValueAtTime(toHz, startTime + duration);
    
    console.log(`Scheduled Hz ramp: ${fromHz}Hz → ${toHz}Hz over ${duration}s starting at ${startTime.toFixed(3)}s`);
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
   * Schedule native Web Audio Hz ramps for all timeline segments (Tone.js approach)
   */
  _scheduleNativeHzRamps() {
    let currentHz = 2.0; // Default starting Hz
    
    // Clear any existing automation
    this._virtualHzParam.cancelScheduledValues(0);
    
    for (const segment of this.compiledTimeline) {
      const segmentStartTime = this.startTime + segment.time_sec;
      
      if (segment.type === SegmentType.PLATEAU) {
        // Plateau: set fixed Hz value
        currentHz = segment.hz;
        this._virtualHzParam.setValueAtTime(currentHz, segmentStartTime);
        
        console.log(`Scheduled plateau: ${currentHz}Hz at ${segmentStartTime.toFixed(3)}s for ${segment.duration_sec}s`);
        
      } else if (segment.type === SegmentType.TRANSITION) {
        // Transition: schedule linear ramp from startHz to endHz
        this._virtualHzParam.setValueAtTime(segment.startHz, segmentStartTime);
        this._virtualHzParam.linearRampToValueAtTime(
          segment.endHz, 
          segmentStartTime + segment.duration_sec
        );
        
        currentHz = segment.endHz;
        console.log(`Scheduled transition: ${segment.startHz}Hz → ${segment.endHz}Hz over ${segment.duration_sec}s starting at ${segmentStartTime.toFixed(3)}s`);
      }
    }
    
    console.log(`Scheduled native Web Audio Hz automation for entire timeline`);
  }



  /**
   * Schedule pulse events based on timeline segments (fixed intervals per segment)
   * This creates stable pulse scheduling without depending on Web Audio parameter
   */
  _scheduleDynamicPulses() {
    this._tickBasedPulses.clear();
    this._scheduledPulseKeys.clear();
    
    let pulseIndex = 0;
    
    // Schedule pulses for each timeline segment
    for (const segment of this.compiledTimeline) {
      if (segment.type === SegmentType.PLATEAU) {
        // Plateau: fixed Hz, regular pulse intervals
        const pulseInterval = calculate32nInterval(segment.hz);
        let segmentTime = segment.time_sec;
        const segmentEnd = segment.time_sec + segment.duration_sec;
        
        while (segmentTime < segmentEnd) {
          const pulseKey = `${segmentTime.toFixed(6)}_${pulseIndex}`;
          
          if (!this._scheduledPulseKeys.has(pulseKey)) {
            this._tickBasedPulses.set(pulseKey, {
              time: segmentTime,
              hz: segment.hz,
              absoluteTime: this.startTime + segmentTime,
              pulseIndex: pulseIndex
            });
            
            this._scheduledPulseKeys.add(pulseKey);
            pulseIndex++;
          }
          
          segmentTime += pulseInterval;
        }
        
      } else if (segment.type === SegmentType.TRANSITION) {
        // Transition: variable Hz, schedule pulses at regular time intervals
        const TRANSITION_PULSE_RESOLUTION = 0.025; // 25ms resolution for transitions
        let segmentTime = segment.time_sec;
        const segmentEnd = segment.time_sec + segment.duration_sec;
        
        while (segmentTime < segmentEnd) {
          // Calculate Hz at this point in transition (linear interpolation)
          const progress = (segmentTime - segment.time_sec) / segment.duration_sec;
          const hz = segment.startHz + (progress * (segment.endHz - segment.startHz));
          
          if (hz > 0) {
            const pulseKey = `${segmentTime.toFixed(6)}_${pulseIndex}`;
            
            if (!this._scheduledPulseKeys.has(pulseKey)) {
              this._tickBasedPulses.set(pulseKey, {
                time: segmentTime,
                hz: hz,
                absoluteTime: this.startTime + segmentTime,
                pulseIndex: pulseIndex
              });
              
              this._scheduledPulseKeys.add(pulseKey);
              pulseIndex++;
            }
          }
          
          segmentTime += TRANSITION_PULSE_RESOLUTION;
        }
      }
    }
    
    console.log(`Scheduled ${this._tickBasedPulses.size} fixed pulses for all timeline segments`);
  }

  /**
   * Convert ticks to seconds (assuming 120 BPM base)
   */
  _ticksToSeconds(ticks) {
    const bpm = 120; // Base BPM for tick calculation
    const beatsPerSecond = bpm / 60;
    const ticksPerSecond = beatsPerSecond * this._ppq;
    return ticks / ticksPerSecond;
  }

  /**
   * Get current Hz at specific time using Web Audio parameter (sample-accurate!)
   */
  _getHzAtTime(time) {
    // Use sample-accurate Web Audio parameter value
    return this.getCurrentHz();
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
      
      // Clear scheduled pulse tracking
      this._scheduledPulseKeys.clear();
      
      // Schedule native Web Audio Hz ramps and dynamic pulses (Tone.js approach)
      console.log(`Scheduling native Web Audio Hz automation...`);
      this._scheduleNativeHzRamps();
      this._scheduleDynamicPulses();
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
   */
  getTotalDuration() {
    if (this.compiledTimeline.length === 0) return 0;
    
    const lastSegment = this.compiledTimeline[this.compiledTimeline.length - 1];
    return lastSegment.time_sec + lastSegment.duration_sec;
  }

  /**
   * Get current Hz value at given time (Tone.js approach - no real-time interpolation!)
   */
  getCurrentHz(time = null) {
    if (!this.isRunning) return 0;
    
    // Use sample-accurate Web Audio parameter value!
    return this._virtualHzParam.value;
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
   * Schedule Wave Band events (pre-calculated Hz segments only)
   */
  _scheduleWaveEvents(startTime, endTime) {
    // DISABLED: Old real-time Hz interpolation system
    // Now using pre-calculated Hz curve segments only
    
    // Only update _currentHz for visual display (not for audio timing)
    // Throttle Hz notifications to reduce console spam
    const displayHz = this.getCurrentHz();
    if (Math.abs(displayHz - this._currentHz) > 0.2) { // Increased threshold to reduce noise
      const previousHz = this._currentHz;
      this._currentHz = displayHz;
      
      // Only dispatch if this is a significant change (not micro-adjustments)
      if (Math.abs(displayHz - previousHz) > 0.15) {
        this._dispatchEvent(TimelineEvents.HZ_CHANGED, {
          hz: displayHz,
          time: this.audioContext.currentTime,
          wave_type: getWaveType(displayHz)
        });
      }
    }
  }

  /**
   * Schedule 32n Band events (pre-calculated fixed intervals)  
   */
  _schedule32nEvents(startTime, endTime) {
    const timelineStartTime = this.startTime;
    const relativeStartTime = startTime - timelineStartTime;
    const relativeEndTime = endTime - timelineStartTime;
    const lookaheadEnd = relativeEndTime + TIMELINE_CONSTANTS.AUDIO_LOOKAHEAD;
    
    // Schedule pre-calculated pulses within time window (prevent duplicates)
    for (const [pulseKey, pulseData] of this._tickBasedPulses) {
      if (pulseData.time >= relativeStartTime && pulseData.time <= lookaheadEnd) {
        const absolutePulseTime = timelineStartTime + pulseData.time;
        
        // Only schedule future pulses that haven't been scheduled already
        if (absolutePulseTime > this.audioContext.currentTime && !this._scheduledPulseKeys.has(pulseKey)) {
          this._scheduledPulseKeys.add(pulseKey); // Mark as scheduled
          this._schedulePulseCallback(absolutePulseTime, pulseData.hz, pulseKey);
        }
      }
    }
  }

  /**
   * Schedule individual pulse callback (tick-based)
   */
  _schedulePulseCallback(time, hz, tick = null) {
    const timeUntilPulse = time - this.audioContext.currentTime;
    
    if (timeUntilPulse > 0) {
      const timeoutId = setTimeout(() => {
        this._scheduledCallbacks.delete(timeoutId);
        
        // Remove from scheduled tracking (allow re-scheduling if needed)
        if (tick !== null) {
          this._scheduledPulseKeys.delete(tick);
        }
        
        // Dispatch 32n pulse event with tick information
        this._dispatchEvent(TimelineEvents.PULSE_32N, {
          time,
          hz,
          tick,
          interval: calculate32nInterval(hz),
          // Include tick-based timing info for debugging
          tickTime: tick ? this._ticksToSeconds(tick) : null
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