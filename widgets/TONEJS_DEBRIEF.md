# Tone.js Architecture Debrief - JourneyMap Timeline Implementation

## Executive Summary

After analyzing Tone.js's core scheduling architecture (`Clock.ts`, `TickSource.ts`, `StateTimeline.ts`, `Timeline.ts`), we have extracted key patterns to answer the implementation questions from `JM_TIMELINE_README.md`. This debrief provides concrete architectural decisions for the JourneyMap Timeline system.

## Architecture Decision Answers

### Question 1: Event Processing Model
**DECISION: Hybrid Approach - Background Scheduling + Real-time Visual Updates**

**Tone.js Pattern Analysis:**
```typescript
// Clock._loop() - Background processing pattern
private _loop(): void {
    const startTime = this._lastUpdate;
    const endTime = this.now();
    this._lastUpdate = endTime;
    
    if (startTime !== endTime) {
        // Process state changes
        this._state.forEachBetween(startTime, endTime, (e) => {
            // Handle start/stop/pause events
        });
        
        // Process tick callbacks
        this._tickSource.forEachTickBetween(startTime, endTime, (time, ticks) => {
            this.callback(time, ticks);  // Audio events
        });
    }
}
```

**JourneyMap Implementation:**
- **Background Loop**: Audio event scheduling (binaural oscs, 32n pulses)
- **Real-time Updates**: Visual feedback (Hz display, metronome flash)
- **Decoupled Systems**: Audio timing uses `AudioContext.currentTime`, visuals use `requestAnimationFrame`

### Question 2: State Management
**DECISION: Separate Timelines for Different Event Types (Tone.js Approach)**

**Tone.js Pattern Analysis:**
```typescript
class TickSource {
    private _state: StateTimeline = new StateTimeline();           // Play/pause/stop
    private _tickOffset: Timeline<TickSourceOffsetEvent>;          // Tick positioning
    private _ticksAtTime: Timeline<TickSourceTicksAtTimeEvent>;    // Memoized tick values
    private _secondsAtTime: Timeline<TickSourceSecondsAtTimeEvent>; // Memoized time values
}
```

**JourneyMap Implementation:**
```javascript
class JMTimeline {
    constructor(audioContext) {
        this._stateTimeline = new StateTimeline();     // Transport state
        this._waveEvents = new Timeline();             // Hz automation events  
        this._pulseEvents = new Timeline();            // 32n pulse events
        this._segmentEvents = new Timeline();          // Segment transitions
        this._visualEvents = new Timeline();           // Visual feedback events
    }
}
```

**Benefits:**
- **Memory Efficiency**: Each timeline manages its own memory limits
- **Query Performance**: Binary search within event-type-specific arrays
- **Event Isolation**: Audio events don't interfere with visual events
- **Memoization**: Cache expensive calculations per timeline

### Question 3: Hz Automation Method
**DECISION: Hybrid - AudioParam for Audio + JavaScript Callbacks for Visual**

**Tone.js Pattern Analysis:**
```typescript
// TickSignal uses AudioParam automation for smooth frequency changes
class TickSignal extends Signal {
    // Integrates timing functions for tempo calculations
    // Uses linearRampToValueAtTime() and exponentialRampToValueAtTime()
    // Approximates complex curves with multiple linear segments
}
```

**JourneyMap Implementation:**
- **Audio Hz Changes**: `AudioParam.linearRampToValueAtTime()` for oscillator frequency
- **Visual Hz Updates**: JavaScript callbacks for display updates
- **32n Pulse Timing**: Calculated from current Hz, scheduled with `AudioContext.currentTime`

## Core Tone.js Patterns to Adopt

### 1. Timeline.forEachBetween() Pattern
```typescript
// Process events only within active time ranges
forEachBetween(startTime: number, endTime: number, callback: (event: GenericEvent) => void): this {
    let lowerBound = this._search(startTime);
    let upperBound = this._search(endTime);
    
    if (lowerBound !== -1 && upperBound !== -1) {
        // Inclusive of startTime, exclusive of endTime: [startTime, endTime)
        if (this._timeline[lowerBound].time !== startTime) {
            lowerBound += 1;
        }
        if (this._timeline[upperBound].time === endTime) {
            upperBound -= 1;
        }
        this._iterate(callback, lowerBound, upperBound);
    }
}
```

**JourneyMap Usage:**
- Process Hz transitions only during active playback ranges
- Batch visual updates for efficiency
- Isolate events by time windows

### 2. StateTimeline Pattern for Transport Control
```typescript
class StateTimeline extends Timeline {
    getValueAtTime(time: Seconds): PlaybackState {
        const event = this.get(time);
        return event ? event.state : this._initial;
    }
    
    setStateAtTime(state: PlaybackState, time: Seconds): this {
        this.add({ state, time });
        return this;
    }
}
```

**JourneyMap Usage:**
- Sample-accurate play/pause/stop scheduling
- Query timeline state at any point in time
- Handle random access jumps with proper state transitions

### 3. Binary Search Timeline Performance
```typescript
// O(log n) event lookup in sorted timeline
protected _search(time: number): number {
    // Binary search implementation for fast event retrieval
    // Handles edge cases: empty timeline, time before first event, time after last event
}
```

**JourneyMap Usage:**
- Fast event queries during high-frequency updates (60fps visuals)
- Efficient timeline navigation for random access jumps
- Performance scaling for long meditation sessions

### 4. Memory Management with Disposal Patterns
```typescript
dispose(): this {
    super.dispose();
    this._timeline = [];
    // Clean up all references
    return this;
}
```

**JourneyMap Usage:**
- Prevent memory accumulation during long sessions
- Clean timeline disposal for random access jumps
- Avoid the Tone.js envelope disposal problem

## JourneyMap-Specific Adaptations

### 1. Two-Band Scheduling Implementation
```javascript
class JMTimeline {
    // Wave Band: Continuous Hz automation
    _scheduleWaveEvents(startTime, endTime) {
        this._waveEvents.forEachBetween(startTime, endTime, (event) => {
            // Use AudioParam automation for smooth transitions
            this._scheduleHzTransition(event);
        });
    }
    
    // 32n Band: Discrete pulse events
    _schedulePulseEvents(startTime, endTime) {
        const currentHz = this.getCurrentHz(startTime);
        const pulseInterval = 1 / (currentHz * 4);  // 32n calculation
        
        // Schedule discrete pulse callbacks
        let nextPulse = Math.ceil(startTime / pulseInterval) * pulseInterval;
        while (nextPulse < endTime) {
            this.audioContext.setTimeout(() => {
                this.emit('pulse', nextPulse);
            }, (nextPulse - this.audioContext.currentTime) * 1000);
            
            nextPulse += pulseInterval;
        }
    }
}
```

### 2. Random Access Jump Implementation
```javascript
jumpTo(options) {
    const { segmentIndex, behavior } = options;
    
    // Clean current scheduling
    this._cancelAllEvents();
    
    // Set new timeline position
    const segment = this.segments[segmentIndex];
    const jumpTime = this.audioContext.currentTime;
    
    switch(behavior) {
        case "loop_plateau":
            this._setupPlateauLoop(segment, jumpTime);
            break;
        case "play_through_then_loop": 
            this._setupTransitionPlaythrough(segmentIndex, jumpTime);
            break;
    }
    
    // Ensure visual feedback continues
    this._updateVisualFeedback();
}
```

### 3. Visual Feedback Decoupling
```javascript
// Visual updates independent of audio scheduling
_visualUpdateLoop() {
    const updateVisuals = () => {
        if (this.isRunning) {
            const currentHz = this.getCurrentHz(this.audioContext.currentTime);
            
            // Update Hz display
            this.emit('hz_change', currentHz);
            
            // Check for 32n pulse flash
            if (this._shouldFlash32n()) {
                this.emit('pulse_flash');
            }
            
            requestAnimationFrame(updateVisuals);
        }
    };
    requestAnimationFrame(updateVisuals);
}
```

## Performance Optimizations from Tone.js

### 1. Event Memoization
```javascript
// Cache expensive calculations
_getTicksAtTime: new Map(),  // Memoize tick calculations  
_getSecondsAtTime: new Map(), // Memoize time calculations
_lastUpdate: 0,              // Track last processing time
```

### 2. Batch Processing
```javascript
// Process events in batches, not individually
_loop() {
    const startTime = this._lastUpdate;
    const endTime = this.audioContext.currentTime;
    
    // Process all events in this time window at once
    this._processEventBatch(startTime, endTime);
    
    this._lastUpdate = endTime;
}
```

### 3. Timeline Memory Limits
```javascript
// Prevent unlimited timeline growth
const timelineOptions = {
    memory: 1000,  // Keep last 1000 events
    increasing: true  // Optimize for chronological addition
};
```

## Critical Implementation Notes

### 1. Visual Continuity Guarantee
- **Requirement**: Hz flash metronome NEVER stops
- **Solution**: Separate visual timeline from audio timeline
- **Pattern**: `requestAnimationFrame` for visuals, `AudioContext.currentTime` for audio

### 2. Sample-Accurate Scheduling
- **Requirement**: Sub-millisecond precision for binaural beats
- **Solution**: Use Web Audio native scheduling, not JavaScript timers
- **Pattern**: `AudioParam.setValueAtTime()` and `linearRampToValueAtTime()`

### 3. Memory Safety
- **Requirement**: Long sessions without memory growth
- **Solution**: Timeline memory limits + proper disposal
- **Pattern**: Tone.js dispose() pattern with timeline cleanup

## Implementation Priority

### Phase 1: Foundation
1. Implement `Timeline` and `StateTimeline` classes
2. Build basic two-band scheduling
3. Add visual feedback decoupling

### Phase 2: Advanced Features  
1. Random access jump functionality
2. Event memoization and performance optimization
3. Memory management and disposal patterns

### Phase 3: Integration
1. Connect with existing binaural synth system
2. Add Tone.js selective imports for pads
3. Performance testing with enterprise audio loads

This debrief provides the architectural foundation for building a robust, sample-accurate timeline system that learns from Tone.js's proven patterns while avoiding its complexity and memory issues.