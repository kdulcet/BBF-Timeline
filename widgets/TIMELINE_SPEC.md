# JourneyMap Timeline System - Complete Technical Specification

## Executive Summary

The JourneyMap Timeline System is a purpose-built Web Audio scheduling engine designed specifically for AuraMatrix's binaural beat applications. This system replaces Tone.js Transport to eliminate memory leaks while maintaining sample-accurate timing, smooth visual feedback, and enterprise-scale performance.

**Key Innovation**: Two-band scheduling architecture that separates continuous Hz automation from discrete pulse events, optimized for binaural beat therapy applications.

---

## Architecture Overview

### Core Design Pattern
```
[Type-In Widget] → [JM Timeline Engine] → [Audio Synths]
      ↓                    ↓                   ↓
   User Input      Sample-Accurate        Audio Output
   (Manual Hz)       Scheduling       (Binaural + ISO)
```

### Two-Band Scheduling System

**Wave Band (Continuous Hz Automation)**
- **Purpose**: Smooth frequency transitions between timeline segments
- **Implementation**: Web Audio `AudioParam.linearRampToValueAtTime()`
- **Timing**: Continuous parameter changes using native Web Audio automation
- **Visual**: Real-time Hz display updates via `requestAnimationFrame`

**32n Band (Discrete Pulse Events)**
- **Purpose**: Rhythmic synchronization points for effects and modulation
- **Implementation**: Sample-accurate event scheduling with `AudioContext.currentTime`
- **Timing**: `32n_interval = 1 / (Hz × 4)` - derived from core BPM formula
- **Visual**: Hz flash metronome synchronized to pulse events

---

## Core Formula & Data Structures

### Immutable BPM Calculation
```javascript
/**
 * AuraMatrix Core Formula - DO NOT MODIFY
 * This is the fundamental relationship of the entire system
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

/**
 * 32nd Note Pulse Calculation
 * Derived from BPM for rhythmic synchronization
 */
function calculate32nInterval(hz) {
  return 1 / (hz * 4); // 32nd note timing interval
}
```

### Timeline Segment Types

**Plateau Segments (Static Hz)**
```javascript
{
  type: "plateau",
  hz: 8.0,              // Constant frequency
  durationSeconds: 60,   // How long to sustain
  loopable: true        // Can repeat indefinitely
}
```

**Transition Segments (Hz Ramping)**
```javascript
{
  type: "transition",
  startHz: 8.0,
  endHz: 12.0,
  durationSeconds: 30,
  transitionType: "linear" | "exponential" | "stepped"
}
```

### Timeline Event Format
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

## Playback Modes & Random Access

### Sequential Playback (Standard Mode)
- Play timeline segments in chronological order
- Automatic progression through transitions and plateaus
- Standard meditation/therapy session behavior

### Random Access Playback (Editing Mode)

**Jump to Plateau**
```javascript
timeline.jumpTo({
  segmentIndex: 3,
  behavior: "loop_plateau"  // Sustain at target Hz indefinitely
});
```

**Jump to Transition + Loop Following Plateau**
```javascript
timeline.jumpTo({
  segmentIndex: 2,          // Transition segment
  behavior: "play_through_then_loop"  // Complete transition, then loop next plateau
});
```

**Use Cases:**
- **Editing Environment**: Preview segments, test transitions, A/B comparison
- **Therapy Session Control**: Emergency plateaus, session extension, custom progressions
- **Interrupt Recovery**: Resume from interruption point seamlessly

---

## Architecture Decisions from Tone.js Analysis

### Event Processing Model: Hybrid Approach
**Decision**: Background audio scheduling + real-time visual updates

**Tone.js Pattern Adapted:**
```javascript
// Background loop for audio events (adapted from Clock._loop())
_audioSchedulingLoop() {
    const startTime = this._lastUpdate;
    const endTime = this.audioContext.currentTime;
    
    if (startTime !== endTime) {
        // Process wave events (Hz automation)
        this._waveEvents.forEachBetween(startTime, endTime, (event) => {
            this._scheduleHzTransition(event);
        });
        
        // Process pulse events (32n triggers)
        this._schedulePulseEvents(startTime, endTime);
    }
    
    this._lastUpdate = endTime;
}

// Visual updates independent of audio scheduling
_visualUpdateLoop() {
    if (this.isRunning) {
        const currentHz = this.getCurrentHz(this.audioContext.currentTime);
        this.emit('hz_change', currentHz);
        
        if (this._shouldFlash32n()) {
            this.emit('pulse_flash');
        }
        
        requestAnimationFrame(() => this._visualUpdateLoop());
    }
}
```

### State Management: Separate Timelines
**Decision**: Multiple specialized timelines (Tone.js approach)

**Implementation:**
```javascript
class JMTimeline {
    constructor(audioContext) {
        this._stateTimeline = new StateTimeline();     // Transport state (play/pause/stop)
        this._waveEvents = new Timeline();             // Hz automation events  
        this._pulseEvents = new Timeline();            // 32n pulse events
        this._segmentEvents = new Timeline();          // Segment transitions
        this._visualEvents = new Timeline();           // Visual feedback events
        
        // Memory management
        this._lastUpdate = 0;
        this._eventMemoization = new Map();
    }
}
```

### Hz Automation Method: Hybrid Implementation
**Decision**: AudioParam for audio + JavaScript callbacks for visual

**Audio Automation (Sample-Accurate):**
```javascript
// Use native Web Audio automation for smooth transitions
_scheduleHzTransition(event) {
    if (event.type === 'plateau') {
        // Immediate frequency change
        this.oscillator.frequency.setValueAtTime(event.hz, event.time);
    } else if (event.type === 'transition') {
        // Smooth frequency ramp
        this.oscillator.frequency.linearRampToValueAtTime(
            event.endHz, 
            event.time + event.duration
        );
    }
}
```

**Visual Updates (Real-Time):**
```javascript
// JavaScript callbacks for display updates
_updateVisualFeedback() {
    const currentHz = this._interpolateCurrentHz(this.audioContext.currentTime);
    const waveType = this._getWaveType(currentHz);
    
    document.dispatchEvent(new CustomEvent('timeline.hz.visual', {
        detail: { hz: currentHz, waveType, time: performance.now() }
    }));
}
```

---

## Core Tone.js Patterns Adopted

### 1. Timeline.forEachBetween() Pattern
```javascript
// Process events only within active time ranges
forEachBetween(startTime, endTime, callback) {
    let lowerBound = this._binarySearch(startTime);
    let upperBound = this._binarySearch(endTime);
    
    if (lowerBound !== -1 && upperBound !== -1) {
        // Inclusive of startTime, exclusive of endTime: [startTime, endTime)
        this._iterateRange(callback, lowerBound, upperBound);
    }
}
```

### 2. StateTimeline for Transport Control
```javascript
class StateTimeline {
    getValueAtTime(time) {
        const event = this._binarySearch(time);
        return event ? event.state : this._initial;
    }
    
    setStateAtTime(state, time) {
        this.add({ state, time });
        return this;
    }
}
```

### 3. Memory Management & Disposal
```javascript
// Prevent memory leaks during long sessions
dispose() {
    this._stateTimeline.dispose();
    this._waveEvents.dispose();
    this._pulseEvents.dispose();
    this._segmentEvents.dispose();
    this._visualEvents.dispose();
    
    // Clear memoization caches
    this._eventMemoization.clear();
    
    return this;
}
```

### 4. Error Isolation
```javascript
// Prevent callback failures from breaking system
_safeCallback(callback, ...args) {
    try {
        callback(...args);
    } catch (error) {
        console.error('Timeline callback error:', error);
        // Continue processing other events
    }
}
```

---

## Implementation Strategy

### Phase 1: Core Timeline Engine
```javascript
class JMTimeline {
    constructor(audioContext, segments = []) {
        this.audioContext = audioContext;
        this.segments = segments;
        this.compiledTimeline = this._compile(segments);
        this.playbackMode = "sequential";
        this.isRunning = false;
        
        // Tone.js-inspired architecture
        this._stateTimeline = new StateTimeline("stopped");
        this._waveEvents = new Timeline({ memory: 1000 });
        this._pulseEvents = new Timeline({ memory: 500 });
        this._segmentEvents = new Timeline({ memory: 100 });
        
        // Performance optimization
        this._lastUpdate = 0;
        this._eventMemoization = new Map();
        this._visualUpdateId = null;
        
        this._setupEventListeners();
    }
    
    // Core timeline compilation
    _compile(segments) {
        const timeline = [];
        let cursor = 0;
        
        for (const segment of segments) {
            timeline.push({
                time_sec: cursor,
                hz: segment.hz || null,
                duration_sec: segment.durationSeconds || (segment.duration_min * 60),
                type: segment.type
            });
            cursor += (segment.durationSeconds || (segment.duration_min * 60));
        }
        
        return timeline;
    }
}
```

### Phase 2: Random Access System
```javascript
// Jump to specific segment with behavior control
jumpTo(options) {
    const { segmentIndex, behavior } = options;
    
    // Clean current scheduling
    this._cancelAllEvents();
    
    // Update state timeline
    const jumpTime = this.audioContext.currentTime;
    this._stateTimeline.setStateAtTime("stopped", jumpTime);
    
    // Set new timeline position
    const segment = this.segments[segmentIndex];
    
    switch(behavior) {
        case "loop_plateau":
            this._setupPlateauLoop(segment, jumpTime);
            break;
        case "play_through_then_loop":
            this._setupTransitionPlaythrough(segmentIndex, jumpTime);
            break;
    }
    
    // Emit jump event
    this.emit('jump', { 
        from: this.currentSegmentIndex, 
        to: segmentIndex, 
        behavior, 
        time: jumpTime 
    });
    
    // Ensure visual feedback continues
    this._ensureVisualContinuity();
}
```

### Phase 3: Visual Feedback Integration
```javascript
// Guarantee uninterrupted visual feedback
_ensureVisualContinuity() {
    if (this._visualUpdateId) {
        cancelAnimationFrame(this._visualUpdateId);
    }
    
    const updateLoop = () => {
        if (this.isRunning) {
            const currentTime = this.audioContext.currentTime;
            const currentHz = this.getCurrentHz(currentTime);
            
            // Update Hz display
            this.emit('hz_change', currentHz);
            
            // Handle 32n pulse flash
            if (this._shouldFlash32n(currentTime)) {
                this.emit('pulse_flash', currentTime);
            }
            
            // Update segment progress
            this._updateSegmentProgress(currentTime);
            
            this._visualUpdateId = requestAnimationFrame(updateLoop);
        }
    };
    
    this._visualUpdateId = requestAnimationFrame(updateLoop);
}
```

---

## API Surface & Event System

### Timeline Control API
```javascript
// Sequential playback
timeline.play();          // Start timeline from current position
timeline.pause();         // Pause timeline, maintain position
timeline.stop();          // Stop timeline, reset position

// Random access
timeline.jumpTo({ segmentIndex: 3, behavior: "loop_plateau" });
timeline.jumpTo({ segmentIndex: 1, behavior: "play_through_then_loop" });

// Real-time editing
timeline.updateSegmentHz(segmentIndex, newHz);     // Change Hz during playback
timeline.updateSegmentDuration(segmentIndex, newDuration);  // Change duration

// Status queries
timeline.getCurrentSegment();    // Current segment info
timeline.getCurrentHz();         // Current Hz value
timeline.getPlaybackMode();      // "sequential" | "random_access"
timeline.getPosition();          // Timeline position in seconds
```

### Event System
```javascript
// Visual feedback events (60fps updates)
timeline.on('hz_change', (hz) => updateHzDisplay(hz));
timeline.on('pulse_flash', (time) => flashMetronome(time));
timeline.on('segment_change', (segment) => updateProgressBar(segment));
timeline.on('wave_type_change', (waveType) => updateBrainwaveDisplay(waveType));

// State change events (sample-accurate)
timeline.on('play', (time) => console.log('Timeline started at', time));
timeline.on('pause', (time) => console.log('Timeline paused at', time));
timeline.on('stop', (time) => console.log('Timeline stopped at', time));

// Random access events
timeline.on('jump', ({ from, to, behavior }) => console.log('Jumped from', from, 'to', to));

// Error events
timeline.on('error', (error) => console.error('Timeline error:', error));
```

### Timeline Event Types
```javascript
const TIMELINE_EVENTS = {
    // Transport control
    STARTED: 'timeline.started',
    PAUSED: 'timeline.paused', 
    STOPPED: 'timeline.stopped',
    
    // Hz automation
    HZ_CHANGED: 'timeline.hz.changed',
    WAVE_TYPE_CHANGED: 'timeline.wave_type.changed',
    
    // Segment management
    SEGMENT_CHANGED: 'timeline.segment.changed',
    TRANSITION_START: 'timeline.transition.start',
    TRANSITION_END: 'timeline.transition.end',
    
    // Random access
    JUMP: 'timeline.jump',
    
    // 32n pulse events
    PULSE_32N: 'timeline.pulse.32n',
    
    // Visual feedback
    HZ_VISUAL: 'timeline.hz.visual',
    PULSE_FLASH: 'timeline.pulse.flash'
};
```

---

## Synth Integration Pattern

### Binaural Synth Integration
```javascript
class BinauralSynth {
    constructor(audioContext) {
        this.audioContext = audioContext;
        this.setupTimelineListeners();
    }

    setupTimelineListeners() {
        // Listen for Hz changes (plateau segments)
        document.addEventListener('timeline.hz.changed', (event) => {
            const { hz, time } = event.detail;
            this.scheduleFrequencyChange(hz, time);
        });

        // Listen for transitions (smooth ramps)
        document.addEventListener('timeline.transition.start', (event) => {
            const { fromHz, toHz, duration, startTime } = event.detail;
            this.scheduleFrequencyRamp(fromHz, toHz, startTime, duration);
        });

        // Transport control
        document.addEventListener('timeline.started', () => this.start());
        document.addEventListener('timeline.stopped', () => this.stop());
    }

    scheduleFrequencyChange(hz, time) {
        // Sample-accurate frequency scheduling
        this.leftOsc.frequency.setValueAtTime(440 + hz/2, time);
        this.rightOsc.frequency.setValueAtTime(440 - hz/2, time);
    }

    scheduleFrequencyRamp(fromHz, toHz, startTime, duration) {
        // Smooth binaural beat transitions
        this.leftOsc.frequency.setValueAtTime(440 + fromHz/2, startTime);
        this.leftOsc.frequency.linearRampToValueAtTime(440 + toHz/2, startTime + duration);
        
        this.rightOsc.frequency.setValueAtTime(440 - fromHz/2, startTime);
        this.rightOsc.frequency.linearRampToValueAtTime(440 - toHz/2, startTime + duration);
    }
}
```

### ISO Synth Integration  
```javascript
class ISOSynth {
    setupTimelineListeners() {
        // Listen for 32n pulse events
        document.addEventListener('timeline.pulse.32n', (event) => {
            const { time, hz } = event.detail;
            this.triggerISOPulse(time);
        });

        // Listen for Hz changes to update pulse rate
        document.addEventListener('timeline.hz.changed', (event) => {
            const { hz, time } = event.detail;
            this.updatePulseRate(hz, time);
        });
    }

    updatePulseRate(hz, time) {
        // ISO pulse interval = 1/Hz seconds
        const pulseInterval = 1.0 / hz;
        this.schedulePulseRate(pulseInterval, time);
    }
}
```

---

## Performance Targets & Optimization

### Enterprise Audio Engine Support
- **Oscillators**: 15-20 binaural pairs + 2 noise + 6 sub oscillators
- **Event Rate**: 25Hz maximum event scheduling without performance degradation
- **Timeline Response**: <10ms for all timeline operations (play/pause/jump)
- **Memory Stability**: 8+ hour sessions without memory growth

### Visual Responsiveness Guarantees
- **Update Rate**: 60fps visual feedback minimum (16.67ms intervals)
- **Flash Accuracy**: ±1ms metronome timing precision  
- **UI Response**: <50ms for all user interactions
- **Visual Continuity**: Hz flash metronome NEVER stops during ANY timeline operation

### Performance Optimizations from Tone.js

**Event Memoization**
```javascript
// Cache expensive calculations
_memoizeEventCalculation(time, hz) {
    const key = `${Math.round(time * 1000)}_${hz}`;
    if (!this._eventMemoization.has(key)) {
        const result = this._calculateExpensiveEvent(time, hz);
        this._eventMemoization.set(key, result);
    }
    return this._eventMemoization.get(key);
}
```

**Batch Processing**
```javascript
// Process multiple events in single update cycle
_processBatchedEvents(startTime, endTime) {
    const events = [];
    
    // Collect all events in time window
    this._waveEvents.forEachBetween(startTime, endTime, (e) => events.push(e));
    this._pulseEvents.forEachBetween(startTime, endTime, (e) => events.push(e));
    
    // Sort by time and process in order
    events.sort((a, b) => a.time - b.time);
    events.forEach(event => this._safeCallback(event.callback, event));
}
```

**Timeline Memory Limits**
```javascript
// Prevent unlimited timeline growth
const timelineOptions = {
    memory: 1000,         // Keep last 1000 events maximum
    increasing: true      // Optimize for chronological addition
};
```

---

## Critical Success Criteria

### Visual Continuity (PRIMARY REQUIREMENT)
- **Requirement**: Hz flash metronome NEVER stops during any timeline operation
- **Implementation**: Separate visual timeline from audio scheduling timeline  
- **Test Strategy**: Visual updates must continue during play/pause/stop/jump operations
- **Fallback**: If audio scheduling fails, visual feedback continues independently

### Sample-Accurate Timing
- **Requirement**: Sub-millisecond precision for binaural beat generation
- **Implementation**: All audio events use `AudioContext.currentTime` scheduling
- **Test Strategy**: Measure actual vs expected timing for Hz transitions
- **Tolerance**: ±1ms maximum deviation from scheduled times

### Memory Safety
- **Requirement**: Timeline can run indefinitely without memory growth
- **Implementation**: Timeline memory limits, proper disposal patterns, event memoization cleanup
- **Test Strategy**: Monitor memory usage during 8+ hour sessions  
- **Target**: <1MB memory growth per hour of operation

### Random Access Performance
- **Requirement**: Jump operations complete within 50ms
- **Implementation**: Pre-compiled timeline segments, efficient event cancellation
- **Test Strategy**: Measure jump latency across different timeline sizes
- **Scaling**: Performance must not degrade with timeline length

---

## Implementation Phases

### Phase 1: Foundation (Week 1-2)
**Deliverables:**
- [ ] Implement `Timeline` and `StateTimeline` base classes
- [ ] Build core two-band scheduling engine
- [ ] Add visual feedback decoupling system
- [ ] Create basic event dispatch mechanism

**Success Criteria:**
- Visual metronome continues flashing during all operations
- Basic Hz automation working with sample-accurate timing
- Timeline starts/stops without memory leaks

### Phase 2: Advanced Features (Week 3-4)  
**Deliverables:**
- [ ] Random access jump functionality with behavior control
- [ ] Event memoization and performance optimization
- [ ] Memory management and disposal patterns
- [ ] Complete API surface implementation

**Success Criteria:**
- Jump operations complete within 50ms
- Memory usage stable over extended sessions
- All timeline events dispatched correctly

### Phase 3: Integration & Testing (Week 5-6)
**Deliverables:**
- [ ] Integration with existing binaural synth system
- [ ] Type-in widget timeline communication
- [ ] Performance testing with enterprise audio loads
- [ ] Documentation and examples

**Success Criteria:**
- Supports 30+ simultaneous audio sources
- Timeline integrates seamlessly with existing synths
- Performance targets met under full load

---

## Success Metrics Checklist

**Visual System:**
- [ ] Visual feedback continuous during all timeline operations
- [ ] Hz display updates at 60fps minimum
- [ ] 32n pulse flash timing accuracy ±1ms
- [ ] Visual metronome never stops flashing

**Audio System:**
- [ ] Sample-accurate Hz transitions without glitches
- [ ] Sub-millisecond precision for binaural beat generation
- [ ] Smooth transitions between timeline segments
- [ ] Audio scheduling independent of visual updates

**Performance System:**
- [ ] Random access jumps complete within 50ms
- [ ] Memory usage stable over 8+ hour sessions  
- [ ] Supports 15-20 binaural oscs + 2 noise + 6 sub oscs
- [ ] 25Hz event scheduling without audio dropouts

**Integration System:**
- [ ] Seamless integration with existing synth architecture
- [ ] Type-in widget real-time timeline updates
- [ ] Event dispatch system working across all synth types
- [ ] Manual edit flags properly set and handled

---

This comprehensive specification provides the complete architectural foundation for building a robust, sample-accurate timeline system that learns from Tone.js's proven patterns while avoiding its complexity and memory issues, specifically optimized for AuraMatrix's binaural beat therapy applications.