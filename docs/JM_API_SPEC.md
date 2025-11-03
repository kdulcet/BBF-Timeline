# Journey Map API Specification
**Widget → Timeline → Synth Communication Protocol**

## Overview

This document defines the **API surface** for Journey Map timeline communication with audio synths. The POC implementation uses **type-in controls** instead of presetters, but maintains the same **timeline → synth** communication pattern for seamless integration.

---

## Architecture Pattern

```
[Type-In Widget] → [Hz Timeline] → [Audio Synths]
      ↓               ↓              ↓
   User Input    Sample-Accurate   Audio Output
   (Manual Hz)     Scheduling      (ISO + Binaural)
```

**Key Principle**: Timeline acts as **central dispatcher** - synths listen for timeline events, not direct widget communication.

---

## Core Data Structures

### 1. Journey Segment Format
```javascript
// INPUT: User configuration
{
  type: "plateau",        // "plateau" | "transition"
  hz: 10.5,              // Target frequency (null for transitions)
  duration_min: 10       // Duration in minutes
}
```

### 2. Compiled Timeline Format
```javascript
// OUTPUT: Executable timeline
{
  time_sec: 0,           // Start time (seconds from timeline start)
  hz: 10.5,             // Target Hz (null for transition segments)
  duration_sec: 600,     // Duration in seconds
  type: "plateau"        // "plateau" | "transition"
}
```

### 3. Timeline Event Format
```javascript
// RUNTIME: Real-time events dispatched to synths
{
  type: "hz.changed",    // Event type
  hz: 10.5,             // Current Hz value
  time: 1234.567,       // AudioContext.currentTime
  segment: "plateau",    // Current segment type
  wave_type: "ALPHA"     // Brainwave band classification
}
```

---

## BPM Calculation (CORE FORMULA)

```javascript
/**
 * Convert Hz to BPM using AuraMatrix core formula
 * CRITICAL: This is the engine's fundamental relationship
 * DO NOT MODIFY without understanding system-wide impact
 */
function calculateTimelineBPM(hz) {
  // Formula: BPM = (Hz × 60) / 8
  // Examples:
  //   5Hz   → 37.5 BPM
  //   10Hz  → 75 BPM  
  //   15Hz  → 112.5 BPM
  //   25Hz  → 187.5 BPM
  
  return (hz * 60) / 8; // NO ROUNDING - maintain precision
}
```

**Usage**: Timeline converts user Hz input to BPM for transport synchronization.

---

## Brainwave Band Classification

```javascript
/**
 * Classify Hz frequency into brainwave bands
 * Used for visual feedback and synth behavior
 */
function getWaveType(hz) {
  if (hz >= 0.5 && hz <= 4)   return "DELTA";   // Deep sleep
  if (hz > 4 && hz <= 8)      return "THETA";   // Meditation
  if (hz > 8 && hz <= 12)     return "ALPHA";   // Relaxed awareness
  if (hz > 12 && hz <= 15)    return "SMR";     // Sensorimotor rhythm
  if (hz > 15 && hz <= 25)    return "BETA";    // Active focus
  return "UNKNOWN";
}
```

**Valid Range**: 0.5Hz - 25Hz (system-wide constraint)

---

## Timeline API Surface

### Core Timeline Interface
```javascript
class HzTimeline {
  /**
   * Initialize timeline with journey segments
   * @param {Array} segments - Journey segment definitions
   */
  constructor(segments) {
    this.segments = segments;
    this.compiledTimeline = this.compile(segments);
    this.isRunning = false;
    this.startTime = null;
  }

  /**
   * Compile user segments into executable timeline
   * @param {Array} segments - Raw journey segments
   * @returns {Array} - Compiled timeline events
   */
  compile(segments) {
    const timeline = [];
    let cursor = 0;

    for (const segment of segments) {
      timeline.push({
        time_sec: cursor,
        hz: segment.hz || null,
        duration_sec: segment.duration_min * 60,
        type: segment.type
      });
      cursor += segment.duration_min * 60;
    }

    return timeline;
  }

  /**
   * Start timeline playback
   * Begins dispatching events to registered synths
   */
  start() {
    this.isRunning = true;
    this.startTime = this.audioContext.currentTime;
    this.scheduleEvents();
    this.dispatch('timeline.started', { startTime: this.startTime });
  }

  /**
   * Stop timeline playback
   * Cancels scheduled events, notifies synths
   */
  stop() {
    this.isRunning = false;
    this.cancelScheduledEvents();
    this.dispatch('timeline.stopped', { stopTime: this.audioContext.currentTime });
  }

  /**
   * Update Hz value for specific segment (real-time editing)
   * @param {number} segmentIndex - Segment to update
   * @param {number} newHz - New frequency value
   */
  updateSegmentHz(segmentIndex, newHz) {
    // Validate Hz range
    if (newHz < 0.5 || newHz > 25) {
      throw new Error(`Hz ${newHz} outside valid range (0.5-25Hz)`);
    }

    // Update compiled timeline
    this.compiledTimeline[segmentIndex].hz = newHz;

    // Dispatch real-time update if running
    if (this.isRunning) {
      this.dispatch('timeline.hz.changed', {
        hz: newHz,
        segmentIndex,
        time: this.audioContext.currentTime,
        wave_type: getWaveType(newHz)
      });
    }

    // Set manual edit flag for integration
    window.IsResumeJM = true;
  }

  /**
   * Get current timeline state
   * @returns {Object} - Current segment and position info
   */
  getCurrentState() {
    if (!this.isRunning) return null;

    const elapsed = this.audioContext.currentTime - this.startTime;
    const currentSegment = this.findSegmentAtTime(elapsed);

    return {
      position: elapsed,
      segment: currentSegment,
      hz: currentSegment?.hz || 0,
      wave_type: getWaveType(currentSegment?.hz || 0)
    };
  }
}
```

### Event Dispatch System
```javascript
/**
 * Timeline Event Types
 * All synths listen for these events via document.addEventListener()
 */
const TIMELINE_EVENTS = {
  STARTED: 'timeline.started',
  STOPPED: 'timeline.stopped',
  HZ_CHANGED: 'timeline.hz.changed',
  SEGMENT_CHANGED: 'timeline.segment.changed',
  TRANSITION_START: 'timeline.transition.start',
  TRANSITION_END: 'timeline.transition.end'
};

/**
 * Event payload format
 */
const EVENT_PAYLOADS = {
  'timeline.hz.changed': {
    hz: 10.5,                    // New frequency
    time: 1234.567,              // AudioContext.currentTime
    segmentIndex: 0,             // Segment that changed
    wave_type: "ALPHA"           // Brainwave classification
  },
  
  'timeline.segment.changed': {
    segment: {                   // New current segment
      time_sec: 0,
      hz: 10.5,
      duration_sec: 600,
      type: "plateau"
    },
    position: 123.45,            // Timeline position (seconds)
    wave_type: "ALPHA"           // Brainwave classification
  },
  
  'timeline.transition.start': {
    fromHz: 10.5,               // Starting frequency
    toHz: 15.0,                 // Target frequency
    duration: 300,              // Transition duration (seconds)
    startTime: 1234.567         // AudioContext.currentTime
  }
};
```

---

## Synth Integration Pattern

### Synth Event Listeners
```javascript
/**
 * Example: Binaural Synth Timeline Integration
 */
class BinauralSynth {
  constructor(audioContext) {
    this.audioContext = audioContext;
    this.setupTimelineListeners();
  }

  setupTimelineListeners() {
    // Listen for Hz changes
    document.addEventListener('timeline.hz.changed', (event) => {
      const { hz, time } = event.detail;
      this.scheduleFrequencyChange(hz, time);
    });

    // Listen for transitions
    document.addEventListener('timeline.transition.start', (event) => {
      const { fromHz, toHz, duration, startTime } = event.detail;
      this.scheduleFrequencyRamp(fromHz, toHz, startTime, duration);
    });

    // Listen for timeline start/stop
    document.addEventListener('timeline.started', () => {
      this.start();
    });

    document.addEventListener('timeline.stopped', () => {
      this.stop();
    });
  }

  /**
   * Schedule immediate frequency change (plateau segments)
   */
  scheduleFrequencyChange(hz, time) {
    // Cancel pending automation
    this.cancelScheduledValues(time);
    
    // Set new frequency immediately (no ramp)
    this.setCarrierFrequency(hz, time);
    
    console.log(`Binaural synth Hz: ${hz} at time ${time}`);
  }

  /**
   * Schedule smooth frequency ramp (transition segments)
   */
  scheduleFrequencyRamp(fromHz, toHz, startTime, duration) {
    // Cancel pending automation
    this.cancelScheduledValues(startTime);
    
    // Set initial frequency
    this.setCarrierFrequency(fromHz, startTime);
    
    // Ramp to target frequency
    this.rampCarrierFrequency(toHz, startTime + duration);
    
    console.log(`Binaural ramp: ${fromHz}Hz → ${toHz}Hz over ${duration}s`);
  }
}

/**
 * Example: ISO Synth Timeline Integration
 */
class ISOSynth {
  setupTimelineListeners() {
    // ISO synth responds to same events but updates pulse rate
    document.addEventListener('timeline.hz.changed', (event) => {
      const { hz, time } = event.detail;
      this.updatePulseRate(hz, time);
    });

    document.addEventListener('timeline.transition.start', (event) => {
      const { fromHz, toHz, duration, startTime } = event.detail;
      this.rampPulseRate(fromHz, toHz, startTime, duration);
    });
  }

  updatePulseRate(hz, time) {
    // ISO pulse interval = 1/Hz seconds
    const pulseInterval = 1.0 / hz;
    this.schedulePulseRate(pulseInterval, time);
    
    console.log(`ISO pulse rate: ${hz}Hz (${pulseInterval}s interval) at time ${time}`);
  }
}
```

---

## Integration Flags & State

### Manual Edit Tracking
```javascript
/**
 * Global state flag for preset integration
 * Set when user manually edits timeline (type-ins, drags)
 * Checked when loading presets (preserve vs overwrite)
 */
window.IsResumeJM = false; // Default: no manual edits

// Set to true when:
// - User types new Hz value
// - User modifies segment duration
// - User adds/removes segments

// Used by preset system to decide:
// - Load new preset (overwrite timeline)
// - Keep current edits (ignore preset timeline)
```

### Timeline Validation
```javascript
/**
 * Validate timeline data before compilation
 */
function validateTimeline(segments) {
  const errors = [];

  for (const [index, segment] of segments.entries()) {
    // Check required fields
    if (!segment.type) {
      errors.push(`Segment ${index}: Missing type`);
    }

    // Validate Hz range (plateaus only)
    if (segment.type === 'plateau') {
      if (!segment.hz || segment.hz < 0.5 || segment.hz > 25) {
        errors.push(`Segment ${index}: Hz ${segment.hz} outside valid range (0.5-25Hz)`);
      }
    }

    // Validate duration
    if (!segment.duration_min || segment.duration_min <= 0) {
      errors.push(`Segment ${index}: Invalid duration ${segment.duration_min}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
```

---

## Sample-Accurate Scheduling

### Web Audio API Integration
```javascript
/**
 * Schedule events using AudioContext.currentTime for sample accuracy
 */
class SampleAccurateScheduler {
  constructor(audioContext) {
    this.audioContext = audioContext;
    this.scheduledEvents = [];
    this.lookAhead = 0.1; // 100ms lookahead
  }

  /**
   * Schedule timeline events with sample-accurate timing
   */
  scheduleTimeline(compiledTimeline, startTime) {
    for (const event of compiledTimeline) {
      const eventTime = startTime + event.time_sec;

      if (event.type === 'plateau') {
        this.scheduleHzChange(event.hz, eventTime);
      } else if (event.type === 'transition') {
        this.scheduleTransition(event, eventTime);
      }
    }
  }

  /**
   * Schedule immediate Hz change (plateau start)
   */
  scheduleHzChange(hz, time) {
    const scheduledEvent = {
      type: 'hz_change',
      time,
      hz,
      callback: () => {
        document.dispatchEvent(new CustomEvent('timeline.hz.changed', {
          detail: { hz, time, wave_type: getWaveType(hz) }
        }));
      }
    };

    this.scheduledEvents.push(scheduledEvent);
    this.scheduleCallback(scheduledEvent);
  }

  /**
   * Schedule callback using Web Audio API timing
   */
  scheduleCallback(event) {
    const timeUntilEvent = event.time - this.audioContext.currentTime;
    
    if (timeUntilEvent > 0) {
      setTimeout(() => {
        event.callback();
      }, timeUntilEvent * 1000);
    } else {
      // Event is in the past, execute immediately
      event.callback();
    }
  }
}
```

---

## Type-In Widget Integration

### Widget → Timeline Communication
```javascript
/**
 * Type-In Widget for Hz values
 * Replaces preset system with direct user input
 */
class HzTypeInWidget {
  constructor(timeline) {
    this.timeline = timeline;
    this.setupEventListeners();
  }

  setupEventListeners() {
    // Hz input fields
    document.getElementById('beta-hz-input').addEventListener('input', (event) => {
      const hz = parseFloat(event.target.value);
      if (this.validateHz(hz)) {
        this.updateTimelineHz('beta', hz);
      }
    });

    document.getElementById('alpha-hz-input').addEventListener('input', (event) => {
      const hz = parseFloat(event.target.value);
      if (this.validateHz(hz)) {
        this.updateTimelineHz('alpha', hz);
      }
    });

    // Duration input fields
    document.getElementById('beta-duration-input').addEventListener('input', (event) => {
      const duration = parseInt(event.target.value);
      if (duration > 0) {
        this.updateTimelineDuration('beta', duration);
      }
    });
  }

  updateTimelineHz(segmentName, hz) {
    const segmentIndex = this.getSegmentIndex(segmentName);
    
    try {
      this.timeline.updateSegmentHz(segmentIndex, hz);
      this.updateVisualFeedback(segmentName, hz);
      
      // Flag manual edit
      window.IsResumeJM = true;
      
    } catch (error) {
      console.error(`Failed to update ${segmentName} Hz:`, error);
      this.showValidationError(segmentName, error.message);
    }
  }

  validateHz(hz) {
    return !isNaN(hz) && hz >= 0.5 && hz <= 25;
  }

  updateVisualFeedback(segmentName, hz) {
    // Update display elements
    document.getElementById(`${segmentName}-hz`).textContent = `${hz}hz`;
    
    // Update brainwave classification
    const waveType = getWaveType(hz);
    document.getElementById(`${segmentName}-wave-type`).textContent = waveType;
  }
}
```

---

## Testing & Validation

### Timeline Event Testing
```javascript
/**
 * Test timeline events are dispatched correctly
 */
function testTimelineEvents() {
  const timeline = new HzTimeline([
    { type: 'plateau', hz: 10, duration_min: 1 },
    { type: 'transition', duration_min: 0.5 },
    { type: 'plateau', hz: 15, duration_min: 1 }
  ]);

  // Listen for events
  const events = [];
  document.addEventListener('timeline.hz.changed', (e) => {
    events.push({ type: 'hz_changed', detail: e.detail });
  });

  timeline.start();

  // Verify events are dispatched
  setTimeout(() => {
    console.assert(events.length > 0, 'No timeline events dispatched');
    console.assert(events[0].detail.hz === 10, 'Incorrect initial Hz');
  }, 100);
}
```

### Sample Accuracy Validation
```javascript
/**
 * Validate sample-accurate timing
 */
function validateSampleAccuracy(targetHz, tolerance = 0.1) {
  const timeline = new HzTimeline([
    { type: 'plateau', hz: targetHz, duration_min: 1 }
  ]);

  const actualIntervals = [];
  let lastEventTime = null;

  document.addEventListener('timeline.hz.changed', (event) => {
    const currentTime = event.detail.time;
    if (lastEventTime !== null) {
      const interval = currentTime - lastEventTime;
      actualIntervals.push(interval);
    }
    lastEventTime = currentTime;
  });

  timeline.start();

  // After test period, verify timing accuracy
  setTimeout(() => {
    const expectedInterval = 1.0 / targetHz;
    const avgActualInterval = actualIntervals.reduce((a, b) => a + b, 0) / actualIntervals.length;
    const error = Math.abs(avgActualInterval - expectedInterval);

    console.assert(error < tolerance, `Timing error ${error}s exceeds tolerance ${tolerance}s`);
    console.log(`✅ Sample accuracy test: ${targetHz}Hz within ${tolerance}s tolerance`);
  }, 5000);
}
```

---

## Migration Checklist

**✅ Data Compatibility:**
- [ ] Parse existing journey presets (`presets/journeys/*.json`)
- [ ] Output compiled timeline format
- [ ] Handle plateau and transition segments

**✅ BPM Integration:**
- [ ] Use exact formula: `BPM = (Hz × 60) / 8`
- [ ] No rounding (maintain precision)
- [ ] Validate against existing calculations

**✅ Event System:**
- [ ] Dispatch standard timeline events
- [ ] Include all required payload fields
- [ ] Maintain event timing accuracy

**✅ State Management:**
- [ ] Set `IsResumeJM` flag on manual edits
- [ ] Validate Hz range (0.5-25Hz)
- [ ] Handle edge cases gracefully

**✅ Synth Integration:**
- [ ] Test with binaural synth
- [ ] Test with ISO synth
- [ ] Verify sample-accurate scheduling
- [ ] Confirm zero memory leaks

---

This specification provides the **complete API surface** for timeline communication, ensuring your POC can seamlessly integrate with existing synths while providing the foundation for the full Web Audio migration.