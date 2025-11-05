/**
 * ============================================================================
 * JOURNEY MAP WORKLET HELPER
 * ============================================================================
 * 
 * PURPOSE:
 * Pure functions for AudioWorklets to calculate Hz values and pulse timing
 * from journey map segment data. Enables sample-accurate synchronization
 * between Hz automation and pulse triggering.
 * 
 * ARCHITECTURE:
 * - Main thread stores journey map segments
 * - Main thread sends segments to worklet via postMessage
 * - Worklet uses these helpers to calculate Hz and pulses sample-accurately
 * - Single source of truth: segment data
 * - No drift between Hz and pulse timing
 * 
 * PULSE CHECK GRANULARITY:
 * - Pulse trigger checks happen every N samples (configurable in worklet)
 * - Default: 128 samples (AudioWorklet process quantum)
 * - If audio interruptions occur, reduce to 64, 32, or even 1 (per-sample)
 * - Lower values = more CPU usage, higher precision
 * - Trigger precision is always 1-sample accurate regardless of check interval
 * 
 * USAGE IN WORKLETS:
 * Copy these functions directly into your worklet file, or use as reference.
 * AudioWorklets cannot import external modules, so inline copying is required.
 * 
 * DESIGN PRINCIPLES:
 * - Pure functions (no side effects)
 * - Sample-accurate calculations
 * - Minute-aligned segment boundaries
 * - Linear interpolation for transitions
 * - Trapezoidal integration for pulse timing
 * 
 * ============================================================================
 */

/**
 * Journey Map Segment Structure:
 * 
 * PLATEAU:
 * {
 *   type: 'plateau',
 *   hz: 5.0,
 *   durationSeconds: 180,
 *   index: 0
 * }
 * 
 * TRANSITION:
 * {
 *   type: 'transition',
 *   startHz: 5.0,
 *   endHz: 15.0,
 *   durationSeconds: 180,
 *   index: 1
 * }
 */

/**
 * ============================================================================
 * SEGMENT COMPILATION
 * ============================================================================
 */

/**
 * Compile journey map segments with absolute time positions
 * 
 * @param {Array} segments - Raw segment array from main thread
 * @returns {Array} Compiled segments with absolute timing
 * 
 * @example
 * const compiled = compileSegments([
 *   { type: 'plateau', hz: 2.0, durationSeconds: 180 },
 *   { type: 'transition', startHz: 2.0, endHz: 15.0, durationSeconds: 180 }
 * ]);
 * // Returns:
 * // [
 * //   { type: 'plateau', hz: 2.0, duration: 180, startTime: 0, endTime: 180 },
 * //   { type: 'transition', startHz: 2.0, endHz: 15.0, duration: 180, startTime: 180, endTime: 360 }
 * // ]
 */
function compileSegments(segments) {
  const compiled = [];
  let absoluteTime = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const startTime = absoluteTime;
    const endTime = absoluteTime + seg.durationSeconds;

    if (seg.type === 'plateau') {
      compiled.push({
        type: 'plateau',
        hz: seg.hz,
        duration: seg.durationSeconds,
        startTime: startTime,
        endTime: endTime,
        index: i
      });
    } else if (seg.type === 'transition') {
      compiled.push({
        type: 'transition',
        startHz: seg.startHz,
        endHz: seg.endHz,
        duration: seg.durationSeconds,
        startTime: startTime,
        endTime: endTime,
        index: i
      });
    }

    absoluteTime = endTime;
  }

  return compiled;
}

/**
 * Get total duration of journey map
 * 
 * @param {Array} compiledSegments - Compiled segment array
 * @returns {number} Total duration in seconds
 */
function getTotalDuration(compiledSegments) {
  if (compiledSegments.length === 0) return 0;
  const lastSegment = compiledSegments[compiledSegments.length - 1];
  return lastSegment.endTime;
}

/**
 * ============================================================================
 * SEGMENT LOOKUP
 * ============================================================================
 */

/**
 * Find segment at specific timeline position
 * Uses binary search for O(log n) performance
 * 
 * @param {Array} compiledSegments - Compiled segment array
 * @param {number} timeSeconds - Timeline position in seconds
 * @returns {Object|null} Segment at that position, or null if not found
 * 
 * @example
 * const segment = findSegmentAt(compiled, 190); // Returns transition segment
 */
function findSegmentAt(compiledSegments, timeSeconds) {
  if (compiledSegments.length === 0) return null;
  
  // Binary search
  let left = 0;
  let right = compiledSegments.length - 1;
  
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const seg = compiledSegments[mid];
    
    if (timeSeconds >= seg.startTime && timeSeconds < seg.endTime) {
      return seg;
    } else if (timeSeconds < seg.startTime) {
      right = mid - 1;
    } else {
      left = mid + 1;
    }
  }
  
  // If we're past the end, return the last segment
  if (timeSeconds >= compiledSegments[compiledSegments.length - 1].endTime) {
    return compiledSegments[compiledSegments.length - 1];
  }
  
  return null;
}

/**
 * ============================================================================
 * HZ CALCULATION
 * ============================================================================
 */

/**
 * Get Hz value at specific timeline position
 * 
 * - Plateau: Returns constant Hz
 * - Transition: Linear interpolation between startHz and endHz
 * 
 * @param {Array} compiledSegments - Compiled segment array
 * @param {number} timeSeconds - Timeline position in seconds
 * @returns {number} Hz value at that position
 * 
 * @example
 * // Plateau segment at 5Hz
 * getHzAt(compiled, 90) // Returns 5.0
 * 
 * // Transition from 2Hz to 15Hz over 180s
 * getHzAt(compiled, 270) // Returns 8.5 (halfway through transition)
 */
function getHzAt(compiledSegments, timeSeconds) {
  const segment = findSegmentAt(compiledSegments, timeSeconds);
  if (!segment) return 5.0; // Default fallback
  
  if (segment.type === 'plateau') {
    return segment.hz;
  }
  
  if (segment.type === 'transition') {
    const elapsed = timeSeconds - segment.startTime;
    const progress = elapsed / segment.duration;
    const clampedProgress = Math.max(0, Math.min(1, progress));
    return segment.startHz + (segment.endHz - segment.startHz) * clampedProgress;
  }
  
  return 5.0; // Fallback
}

/**
 * Get Hz value at specific sample position
 * 
 * @param {Array} compiledSegments - Compiled segment array
 * @param {number} samplePosition - Sample position (e.g., 48000 = 1 second at 48kHz)
 * @param {number} sampleRate - Sample rate (e.g., 48000)
 * @returns {number} Hz value at that sample
 * 
 * @example
 * getHzAtSample(compiled, 48000, 48000) // Hz at 1 second
 */
function getHzAtSample(compiledSegments, samplePosition, sampleRate) {
  const timeSeconds = samplePosition / sampleRate;
  return getHzAt(compiledSegments, timeSeconds);
}

/**
 * ============================================================================
 * PULSE TIMING CALCULATION
 * ============================================================================
 */

/**
 * Calculate 32nd note interval from Hz
 * 
 * 32nd note = 1/32 of a beat
 * At 1 Hz: 1 beat per second → 32nd note = 1/32 second = 0.03125s
 * At 2 Hz: 2 beats per second → 32nd note = 1/64 second = 0.015625s
 * 
 * Formula: interval = (1 / hz) / 32 = 0.5 / hz
 * 
 * @param {number} hz - Frequency in Hz
 * @returns {number} Interval in seconds
 * 
 * @example
 * calculate32nInterval(4.0) // Returns 0.125 (125ms)
 */
function calculate32nInterval(hz) {
  return 0.5 / hz;
}

/**
 * Calculate next pulse time using transition-aware trapezoidal integration
 * 
 * If Hz is changing (transition), we use the average Hz between current
 * and next positions to calculate the interval. This matches the Tone.js
 * TickParam pattern for smooth pulse rate changes.
 * 
 * @param {Array} compiledSegments - Compiled segment array
 * @param {number} currentTimeSeconds - Current timeline position in seconds
 * @param {number} currentHz - Current Hz value
 * @returns {number} Next pulse time in seconds
 * 
 * @example
 * // During plateau (constant Hz)
 * getNextPulseTime(compiled, 1.0, 5.0) // Returns 1.1 (interval = 0.1s at 5Hz)
 * 
 * // During transition (changing Hz)
 * getNextPulseTime(compiled, 180.5, 2.5) // Uses average Hz for smooth acceleration
 */
function getNextPulseTime(compiledSegments, currentTimeSeconds, currentHz) {
  const interval = calculate32nInterval(currentHz);
  const nextTime = currentTimeSeconds + interval;
  
  // Check if we'll cross into a different Hz value
  const futureHz = getHzAt(compiledSegments, nextTime);
  
  // If Hz is changing significantly, use trapezoidal integration
  const hzDiff = Math.abs(futureHz - currentHz);
  if (hzDiff > 0.01) {
    const avgHz = 0.5 * (currentHz + futureHz);
    return currentTimeSeconds + calculate32nInterval(avgHz);
  }
  
  return nextTime;
}

/**
 * Calculate next pulse sample position
 * 
 * @param {Array} compiledSegments - Compiled segment array
 * @param {number} currentSample - Current sample position
 * @param {number} sampleRate - Sample rate
 * @returns {number} Next pulse sample position
 * 
 * @example
 * getNextPulseSample(compiled, 0, 48000) // First pulse sample
 */
function getNextPulseSample(compiledSegments, currentSample, sampleRate) {
  const currentTime = currentSample / sampleRate;
  const currentHz = getHzAt(compiledSegments, currentTime);
  const nextTime = getNextPulseTime(compiledSegments, currentTime, currentHz);
  return Math.round(nextTime * sampleRate);
}

/**
 * ============================================================================
 * PULSE DURATION CALCULATION
 * ============================================================================
 */

/**
 * Calculate pulse duration based on Hz
 * 
 * Uses duty cycle to determine pulse length relative to pulse interval.
 * Default duty cycle: 0.8 (80% of interval)
 * 
 * @param {number} hz - Current Hz value
 * @param {number} dutyCycle - Duty cycle (0.0 to 1.0), default 0.8
 * @returns {number} Pulse duration in seconds
 * 
 * @example
 * calculatePulseDuration(4.0, 0.8) // Returns 0.1 (100ms at 4Hz)
 */
function calculatePulseDuration(hz, dutyCycle = 0.8) {
  const interval = calculate32nInterval(hz);
  return interval * dutyCycle;
}

/**
 * Calculate pulse duration in samples
 * 
 * @param {number} hz - Current Hz value
 * @param {number} sampleRate - Sample rate
 * @param {number} dutyCycle - Duty cycle (0.0 to 1.0), default 0.8
 * @returns {number} Pulse duration in samples
 * 
 * @example
 * calculatePulseDurationSamples(4.0, 48000, 0.8) // Returns 4800 samples (100ms)
 */
function calculatePulseDurationSamples(hz, sampleRate, dutyCycle = 0.8) {
  const durationSeconds = calculatePulseDuration(hz, dutyCycle);
  return Math.round(durationSeconds * sampleRate);
}

/**
 * ============================================================================
 * SEEK / RANDOM ACCESS
 * ============================================================================
 */

/**
 * Calculate initial state when seeking to a specific position
 * 
 * Returns all the information a worklet needs to start playback from
 * an arbitrary position in the journey map.
 * 
 * @param {Array} compiledSegments - Compiled segment array
 * @param {number} targetTimeSeconds - Position to seek to (in seconds)
 * @param {number} sampleRate - Sample rate
 * @returns {Object} Initial state for worklet
 * 
 * @example
 * const state = seekTo(compiled, 180, 48000);
 * // Returns:
 * // {
 * //   currentSample: 8640000,
 * //   currentHz: 2.0,
 * //   nextPulseSample: 8664000,
 * //   segment: { type: 'transition', ... }
 * // }
 */
function seekTo(compiledSegments, targetTimeSeconds, sampleRate) {
  const currentSample = Math.round(targetTimeSeconds * sampleRate);
  const currentHz = getHzAt(compiledSegments, targetTimeSeconds);
  const nextPulseSample = getNextPulseSample(compiledSegments, currentSample, sampleRate);
  const segment = findSegmentAt(compiledSegments, targetTimeSeconds);
  
  return {
    currentSample,
    currentHz,
    nextPulseSample,
    segment,
    targetTimeSeconds
  };
}

/**
 * ============================================================================
 * VALIDATION & DIAGNOSTICS
 * ============================================================================
 */

/**
 * Validate journey map segments
 * 
 * @param {Array} segments - Raw segment array
 * @returns {Object} Validation result { valid: boolean, errors: Array }
 */
function validateSegments(segments) {
  const errors = [];
  
  if (!Array.isArray(segments)) {
    return { valid: false, errors: ['Segments must be an array'] };
  }
  
  if (segments.length === 0) {
    return { valid: false, errors: ['Segments array is empty'] };
  }
  
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    
    if (!seg.type) {
      errors.push(`Segment ${i}: Missing type`);
    }
    
    if (seg.type === 'plateau') {
      if (typeof seg.hz !== 'number' || seg.hz <= 0) {
        errors.push(`Segment ${i}: Invalid hz value`);
      }
    }
    
    if (seg.type === 'transition') {
      if (typeof seg.startHz !== 'number' || seg.startHz <= 0) {
        errors.push(`Segment ${i}: Invalid startHz value`);
      }
      if (typeof seg.endHz !== 'number' || seg.endHz <= 0) {
        errors.push(`Segment ${i}: Invalid endHz value`);
      }
    }
    
    if (typeof seg.durationSeconds !== 'number' || seg.durationSeconds <= 0) {
      errors.push(`Segment ${i}: Invalid durationSeconds value`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * ============================================================================
 * EXPORTS (for non-worklet environments)
 * ============================================================================
 * 
 * Note: AudioWorklets cannot use module imports, so these exports are only
 * useful if this file is loaded in a main thread context for testing.
 * 
 * For worklet usage, copy the functions you need directly into the worklet.
 */

// Only export if we're in a module environment
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    // Compilation
    compileSegments,
    getTotalDuration,
    
    // Lookup
    findSegmentAt,
    
    // Hz calculation
    getHzAt,
    getHzAtSample,
    
    // Pulse timing
    calculate32nInterval,
    getNextPulseTime,
    getNextPulseSample,
    
    // Pulse duration
    calculatePulseDuration,
    calculatePulseDurationSamples,
    
    // Random access
    seekTo,
    
    // Validation
    validateSegments
  };
}

/**
 * ============================================================================
 * USAGE EXAMPLES
 * ============================================================================
 * 
 * EXAMPLE 1: Basic Hz lookup
 * -------------------------
 * const segments = [
 *   { type: 'plateau', hz: 5.0, durationSeconds: 180 },
 *   { type: 'transition', startHz: 5.0, endHz: 15.0, durationSeconds: 180 }
 * ];
 * const compiled = compileSegments(segments);
 * const hz = getHzAt(compiled, 90); // Returns 5.0 (middle of plateau)
 * 
 * 
 * EXAMPLE 2: Pulse timing in worklet
 * ----------------------------------
 * // In worklet's process() method:
 * for (let i = 0; i < 128; i++) {
 *   const currentSample = this.currentSample + i;
 *   
 *   if (currentSample >= this.nextPulseSample) {
 *     // Trigger pulse
 *     this.triggerPulse(currentSample);
 *     
 *     // Calculate next pulse
 *     this.nextPulseSample = getNextPulseSample(
 *       this.compiledSegments,
 *       currentSample,
 *       this.sampleRate
 *     );
 *   }
 *   
 *   // Generate audio...
 * }
 * 
 * 
 * EXAMPLE 3: Seeking to position
 * ------------------------------
 * // User clicks "Jump to plateau 2"
 * const state = seekTo(compiled, 360, 48000); // Jump to 6:00
 * workletNode.port.postMessage({
 *   type: 'seek',
 *   ...state
 * });
 * 
 * ============================================================================
 */
