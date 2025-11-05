/**
 * JMTimeline - Minimal Play/Stop Timeline Engine
 * 
 * PURPOSE:
 * Dual-band scheduling system for binaural beat synthesis.
 * - Wave Band: Continuous Hz automation via Web Audio
 * - Pulse Band: Discrete 32n pulse events for ISO synth
 * 
 * CURRENT SCOPE: Play/Stop only (no pause, no seeking)
 */

/**
 * Constants
 */
const TIMELINE_CONSTANTS = {
  HZ_MIN: 0.5,
  HZ_MAX: 25.0,
  AUDIO_LOOKAHEAD: 0.1,  // 100ms lookahead
  MEMORY_LIMIT: 1000,
  TICKER_INTERVAL: 32     // 32ms ticker
};

/**
 * Segment types
 */
const SegmentType = {
  PLATEAU: 'plateau',
  TRANSITION: 'transition'
};

/**
 * Event types
 */
const TimelineEvents = {
  STARTED: 'timeline.started',
  STOPPED: 'timeline.stopped',
  HZ_CHANGED: 'timeline.hz.changed',
  PULSE_32N: 'timeline.pulse.32n',
  SEGMENT_CHANGED: 'timeline.segment.changed',
  TRANSITION_START: 'timeline.transition.start',
  TRANSITION_END: 'timeline.transition.end'
};

/**
 * Helper functions
 */
function getWaveType(hz) {
  if (hz >= 0.5 && hz <= 4) return "DELTA";
  if (hz > 4 && hz <= 8) return "THETA";
  if (hz > 8 && hz <= 12) return "ALPHA";
  if (hz > 12 && hz <= 15) return "SMR";
  if (hz > 15 && hz <= 25) return "BETA";
  return "UNKNOWN";
}

function calculate32nInterval(hz) {
  return .5 / hz;
}

/**
 * JMTimeline - Main timeline engine
 */
class JMTimeline {
  constructor(audioContext, segments = []) {
    this.audioContext = audioContext;
    this.segments = segments;
    this.compiledTimeline = this._compile(segments);
    this.isRunning = false;
    
    // Timing
    this.startTime = null;
    this.currentSegmentIndex = 0;
    
    // Event storage
    this._waveEvents = new Timeline({ memory: TIMELINE_CONSTANTS.MEMORY_LIMIT, increasing: true });
    this._pulseEvents = new Timeline({ memory: TIMELINE_CONSTANTS.MEMORY_LIMIT / 2, increasing: true });
    this._segmentEvents = new Timeline({ memory: 100, increasing: true });
    
    // Virtual Hz parameter for Web Audio automation
    this._virtualHzParam = this._createVirtualHzParam();
    
    // Pulse scheduling state
    this._scheduledPulseKeys = new Set();
    this._nextPulseTime = null;
    this._lastScheduledPulseTime = 0;
    
    // Ticker
    this._tickerId = null;
    this._tickerLookahead = TIMELINE_CONSTANTS.AUDIO_LOOKAHEAD;
  }

  /**
   * Create virtual Hz parameter for automation
   */
  _createVirtualHzParam() {
    const constantSource = this.audioContext.createConstantSource();
    constantSource.start();
    return constantSource.offset;
  }

  /**
   * Compile segments into timeline
   */
  _compile(segments) {
    const compiled = [];
    let absoluteTime = 0;

    console.log('🔧 COMPILING SEGMENTS:', segments);

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      
      if (seg.type === 'plateau') {
        compiled.push({
          time: absoluteTime,
          hz: seg.hz,
          type: 'plateau',
          duration: seg.durationSeconds,
          index: i
        });
        absoluteTime += seg.durationSeconds;
        console.log(`Segment ${i}: PLATEAU hz=${seg.hz}, duration=${seg.durationSeconds}`);
        
      } else if (seg.type === 'transition') {
        // Transition segments already have startHz and endHz in the input
        compiled.push({
          time: absoluteTime,
          startHz: seg.startHz,
          endHz: seg.endHz,
          type: 'transition',
          duration: seg.durationSeconds,
          index: i
        });
        absoluteTime += seg.durationSeconds;
        console.log(`Segment ${i}: TRANSITION startHz=${seg.startHz}, endHz=${seg.endHz}, duration=${seg.durationSeconds}`);
      }
    }

    console.log('✅ COMPILED TIMELINE:', compiled);
    return compiled;
  }

  /**
   * Get Hz at specific timeline position (with interpolation for transitions)
   */
  _getHzAtTime(timelinePos) {
    const segment = this._findSegmentAtTime(timelinePos);
    if (!segment) return this.compiledTimeline[0]?.hz || 5.0;

    if (segment.type === 'plateau') {
      return segment.hz;
    } else if (segment.type === 'transition') {
      const progress = (timelinePos - segment.time) / segment.duration;
      return segment.startHz + (segment.endHz - segment.startHz) * progress;
    }

    return 5.0;
  }

  /**
   * Find segment at timeline position
   */
  _findSegmentAtTime(timelinePos) {
    for (let i = this.compiledTimeline.length - 1; i >= 0; i--) {
      if (timelinePos >= this.compiledTimeline[i].time) {
        return this.compiledTimeline[i];
      }
    }
    return this.compiledTimeline[0] || null;
  }

  /**
   * Calculate next pulse time using transition-aware interpolation
   */
  _getNextPulseTime(currentTime, currentHz) {
    const interval = calculate32nInterval(currentHz);
    const nextTime = currentTime + interval;
    
    // Check if we'll cross into a new segment
    const currentTimelinePos = currentTime - this.startTime;
    const nextTimelinePos = nextTime - this.startTime;
    const futureHz = this._getHzAtTime(nextTimelinePos);
    
    // Trapezoidal integration if Hz changes
    if (Math.abs(futureHz - currentHz) > 0.01) {
      const avgHz = 0.5 * (currentHz + futureHz);
      return currentTime + calculate32nInterval(avgHz);
    }
    
    return nextTime;
  }

  /**
   * Send journey map segments to AudioWorklet for on-demand calculation
   * 
   * @param {AudioWorkletNode} workletNode - The worklet node to send segments to
   * @param {number} carrierFrequency - Carrier frequency in Hz (default: 110)
   * @param {number} checkGranularity - Check granularity in samples (default: 128)
   */
  sendSegmentsToWorklet(workletNode, carrierFrequency = 110, checkGranularity = 128) {
    if (!workletNode || !workletNode.port) {
      console.error('[JMTimeline] Invalid worklet node');
      return;
    }
    
    // Send raw segments for on-demand calculation
    workletNode.port.postMessage({
      type: 'loadJourneyMap',
      segments: this.segments,
      carrierFrequency: carrierFrequency,
      checkGranularity: checkGranularity
    });
    
    console.log(`[JMTimeline] Sent ${this.segments.length} segments to worklet (${this.getTotalDuration().toFixed(2)}s total, check every ${checkGranularity} samples)`);
  }

  // ============================================================================
  // TRANSPORT CONTROL
  // ============================================================================

  /**
   * Start timeline playback
   */
  start() {
    if (this.isRunning) return;
    
    const startTime = this.audioContext.currentTime;
    this.startTime = startTime;
    this.currentSegmentIndex = 0;
    this.isRunning = true;
    
    // Clear pulse tracking
    this._scheduledPulseKeys.clear();
    this._nextPulseTime = startTime;
    
    // Schedule automation
    this._scheduleWaveBandAutomation();
    this._initializePulseBandScheduling();
    
    // Start ticker
    this._startAudioScheduling();
    
    // Dispatch event
    this._dispatchEvent(TimelineEvents.STARTED, { startTime });
  }

  /**
   * Stop timeline playback
   */
  stop() {
    if (!this.isRunning) return;
    
    const stopTime = this.audioContext.currentTime;
    this.isRunning = false;
    this.startTime = null;
    this.currentSegmentIndex = 0;
    
    // Stop ticker
    this._stopAudioScheduling();
    
    // Clear state
    this._scheduledPulseKeys.clear();
    this._clearEventTimelines();
    
    // Dispatch event
    this._dispatchEvent(TimelineEvents.STOPPED, { stopTime });
  }

  // ============================================================================
  // AUDIO SCHEDULING
  // ============================================================================

  /**
   * Start audio scheduling ticker
   */
  _startAudioScheduling() {
    if (this._tickerId) return;
    
    const tick = () => {
      if (!this.isRunning) return;
      
      const currentTime = this.audioContext.currentTime;
      const scheduleUntil = currentTime + this._tickerLookahead;
      
      // Schedule pulse events
      this._processPulseBandEvents(scheduleUntil);
      
      // Continue ticker
      this._tickerId = setTimeout(tick, TIMELINE_CONSTANTS.TICKER_INTERVAL);
    };
    
    tick();
  }

  /**
   * Stop audio scheduling ticker
   */
  _stopAudioScheduling() {
    if (this._tickerId) {
      clearTimeout(this._tickerId);
      this._tickerId = null;
    }
  }

  // ============================================================================
  // WAVE BAND (Hz Automation)
  // ============================================================================

  /**
   * Schedule Wave Band Hz automation
   */
  _scheduleWaveBandAutomation() {
    const startTime = this.startTime;
    const param = this._virtualHzParam;
    
    // Cancel existing automation
    param.cancelScheduledValues(startTime);
    
    for (const segment of this.compiledTimeline) {
      const segmentStartTime = startTime + segment.time;
      
      if (segment.type === 'plateau') {
        // Schedule plateau Hz
        param.setValueAtTime(segment.hz, segmentStartTime);
        
        // Dispatch Hz event for plateau (no ramp)
        this._dispatchHzEvent({
          type: 'plateau',
          hz: segment.hz,
          time: segmentStartTime
        });
        
      } else if (segment.type === 'transition') {
        // Schedule transition start
        param.setValueAtTime(segment.startHz, segmentStartTime);
        
        // Schedule transition end
        const transitionEndTime = segmentStartTime + segment.duration;
        param.linearRampToValueAtTime(segment.endHz, transitionEndTime);
        
        // Dispatch Hz event for transition WITH RAMP DATA
        this._dispatchHzEvent({
          type: 'transition',
          startHz: segment.startHz,
          endHz: segment.endHz,
          startTime: segmentStartTime,
          endTime: transitionEndTime,
          duration: segment.duration
        });
      }
      
      // Store for segment tracking
      this._segmentEvents.add({ time: segmentStartTime, segment, index: segment.index });
    }
  }
  
  /**
   * Dispatch Hz changed event
   * @private
   * @param {Object} eventData - Event data containing type, hz/frequencies, and time info
   */
  _dispatchHzEvent(eventData) {
    this._dispatchEvent(TimelineEvents.HZ_CHANGED, eventData);
  }

  // ============================================================================
  // PULSE BAND (32n Events)
  // ============================================================================

  /**
   * Initialize pulse scheduling
   */
  _initializePulseBandScheduling() {
    this._nextPulseTime = this.startTime;
    this._lastScheduledPulseTime = 0;
  }

  /**
   * Process pulse band events
   */
  _processPulseBandEvents(scheduleUntil) {
    if (!this.isRunning) return;
    
    const totalDuration = this.getTotalDuration();
    
    while (this._nextPulseTime < scheduleUntil) {
      const timelinePos = this._nextPulseTime - this.startTime;
      
      // Check if past timeline end
      if (timelinePos > totalDuration) {
        break;
      }
      
      // Get current Hz
      const currentHz = this._getHzAtTime(timelinePos);
      
      // Schedule this pulse
      this._schedulePulseCallback(this._nextPulseTime, currentHz);
      
      // Calculate next pulse time
      this._nextPulseTime = this._getNextPulseTime(this._nextPulseTime, currentHz);
    }
  }

  /**
   * Schedule individual pulse callback
   */
  _schedulePulseCallback(scheduleTime, hz) {
    const pulseKey = `${scheduleTime.toFixed(6)}`;
    if (this._scheduledPulseKeys.has(pulseKey)) return;
    
    this._scheduledPulseKeys.add(pulseKey);
    
    const delay = Math.max(0, (scheduleTime - this.audioContext.currentTime) * 1000);
    const interval = calculate32nInterval(hz);
    
    setTimeout(() => {
      if (!this.isRunning) return;
      
      this._dispatchEvent(TimelineEvents.PULSE_32N, {
        time: scheduleTime,
        hz: hz,
        interval: interval,
        pulseCount: this._scheduledPulseKeys.size
      });
    }, delay);
  }

  // ============================================================================
  // UTILITIES
  // ============================================================================

  /**
   * Get total timeline duration
   */
  getTotalDuration() {
    if (this.compiledTimeline.length === 0) return 0;
    const last = this.compiledTimeline[this.compiledTimeline.length - 1];
    return last.time + last.duration;
  }

  /**
   * Get current Hz
   */
  getCurrentHz() {
    if (!this.isRunning) return this.compiledTimeline[0]?.hz || 5.0;
    const timelinePos = this.audioContext.currentTime - this.startTime;
    return this._getHzAtTime(timelinePos);
  }

  /**
   * Dispatch event
   */
  _dispatchEvent(eventType, detail = {}) {
    const event = new CustomEvent(eventType, { detail });
    document.dispatchEvent(event);
  }

  /**
   * Clear event timelines
   */
  _clearEventTimelines() {
    this._waveEvents = new Timeline({ memory: TIMELINE_CONSTANTS.MEMORY_LIMIT, increasing: true });
    this._pulseEvents = new Timeline({ memory: TIMELINE_CONSTANTS.MEMORY_LIMIT / 2, increasing: true });
    this._segmentEvents = new Timeline({ memory: 100, increasing: true });
  }

  /**
   * Dispose timeline
   */
  dispose() {
    this.stop();
    this._clearEventTimelines();
    this._virtualHzParam.value = 0;
  }
}
