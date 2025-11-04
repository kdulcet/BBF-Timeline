# JourneyMap Timeline System Documentation

## Overview

The JourneyMap Timeline System is a modular, sample-accurate timing engine built for audio applications. It consists of 4 core files that work together to provide precise scheduling, state management, and synth integration.

**Architecture**: Inspired by Tone.js Transport but rebuilt for our specific needs with two-band scheduling (Wave Band + 32n Band).

## File Structure & Responsibilities

### 1. `timeline_main.js` - Base Timeline Class
**Source**: Adapted from Tone.js Timeline
**Purpose**: Core time-ordered event storage with binary search optimization

#### Key Classes:
- **`TimelineEvent`**: Base event class, requires `time` property
- **`Timeline`**: Main container for time-ordered events

#### Key Functions:
```javascript
add(event)              // Add event in time order
get(time)              // Get event at/before time (binary search)
getAfter(time)         // Get first event after time
getBefore(time)        // Get first event before time
cancel(startTime, endTime) // Remove events in time range
dispose()              // Clean up memory
```

#### Binary Search Algorithm:
- **`_search(time)`**: O(log n) lookup using binary search
- Keeps events sorted by time for fast retrieval
- Memory management with configurable limits

---

### 2. `timeline_transport.js` - State Management
**Source**: Adapted from Tone.js StateTimeline  
**Purpose**: Track transport states (started/stopped/paused) over time

#### Key Classes:
- **`StateTimelineEvent`**: Timeline event with state property
- **`StateTimeline`**: Specialized timeline for state tracking
- **`PlaybackState`**: Constants (STOPPED, STARTED, PAUSED)

#### Key Functions:
```javascript
setStateAtTime(state, time)    // Set transport state at time
getValueAtTime(time)           // Get current state at time
getLastState(state, time)      // Find last occurrence of state
getCurrentState()              // Get current playback state
```

#### Usage in JMTimeline:
- Tracks when timeline starts/stops/pauses
- Enables proper resuming from pause points
- Sample-accurate state transitions

---

### 3. `timeline_journeymap.js` - Main Timeline Engine
**Source**: Custom implementation for JourneyMap
**Purpose**: Core scheduling engine with two-band architecture

#### Two-Band System:
1. **Wave Band**: Continuous Hz automation for smooth frequency changes
2. **32n Band**: Discrete pulse events for rhythmic synchronization

#### Key Classes:
- **`JMTimeline`**: Main timeline engine
- **`TimelineEvents`**: Event type constants
- **`SegmentType`**: Plateau vs Transition segments

#### Core Functions:

**Lifecycle:**
```javascript
start()                        // Begin timeline playback
stop()                         // Stop and reset timeline
pause()                        // Pause at current position
resume()                       // Resume from pause point
```

**Scheduling Core:**
```javascript
_scheduleWaveEvents(start, end)    // Process Wave Band (Hz automation)
_schedule32nEvents(start, end)     // Process 32n Band (pulse events)  
_schedulePulseCallback(time, hz)   // Individual pulse scheduling
```

**Segment Management:**
```javascript
_compile(segments)             // Convert input segments to timeline
getCurrentHz()                 // Get Hz at current time (interpolated)
_findSegmentAtTime(time)       // Binary search for active segment
_processSegmentTransitions()   // Handle segment boundary events
```

**Event Dispatch:**
```javascript
_dispatchEvent(type, detail)   // Send events to document listeners
```

#### Timeline Events Generated:
- `timeline.started` - Timeline begins
- `timeline.stopped` - Timeline ends  
- `timeline.paused` - Timeline paused
- `timeline.pulse.32n` - 32nd note pulse (for blinking)
- `timeline.hz.changed` - Hz value changed
- `timeline.segment.changed` - Moving between segments
- `timeline.transition.start` - Transition begins
- `timeline.transition.end` - Transition completes

#### Segment Compilation:
Input segments → Compiled timeline with:
- Absolute time positions
- Hz interpolation data for transitions
- Segment type classification
- Memory-efficient storage

---

### 4. `timeline_listeners.js` - Synth Integration
**Source**: Custom abstractions for timeline-aware synths
**Purpose**: Base classes for synths to easily consume timeline data

#### Key Classes:

**`TimelineListener`** (Base Class):
```javascript
startListening()               // Begin timeline event monitoring
stopListening()                // Stop timeline event monitoring  
onTimelineStart(detail)        // Override: timeline started
onTimelineStop(detail)         // Override: timeline stopped
onTimelinePause(detail)        // Override: timeline paused
```

**`WaveBandListener`** (Wave Band Specialist):
```javascript
onHzChanged(hz, waveType)      // Override: Hz value changed
getCurrentHz()                 // Get current Hz value
startWaveTracking()            // Begin Hz monitoring
stopWaveTracking()             // Stop Hz monitoring
```

**`PulseBandListener`** (32n Band Specialist):
```javascript
onPulse32n(hz, time, interval) // Override: 32n pulse triggered
startPulseTracking()           // Begin pulse monitoring
stopPulseTracking()            // Stop pulse monitoring
calculateNextPulse(hz)         // Predict next pulse time
```

**`DualBandListener`** (Both Bands):
- Combines WaveBandListener + PulseBandListener
- For synths that need both continuous Hz and discrete pulses

#### Integration Patterns:
```javascript
// Wave Band Synth (Binaural, Carrier)
class BinauralSynth extends WaveBandListener {
  onHzChanged(hz, waveType) {
    this.oscillator.frequency.value = hz;
  }
}

// Pulse Band Synth (ISO, Percussion)
class ISOSynth extends PulseBandListener {
  onPulse32n(hz, time, interval) {
    this.triggerNote(hz, time);
  }
}

// Dual Band Synth (Complex)
class HybridSynth extends DualBandListener {
  onHzChanged(hz) { /* continuous */ }
  onPulse32n(hz, time) { /* rhythmic */ }
}
```

---

## System Interactions

### Data Flow:
```
User Input → JMTimeline.segments → _compile() → 
Timeline Events → Document Events → Synth Listeners → Audio Output
```

### Timeline Compilation:
```
Raw Segments: [plateau1, transition1, plateau2, ...]
      ↓ _compile()
Compiled Timeline: [
  {time: 0, hz: 5.0, type: 'plateau'},
  {time: 3.0, hz: 5.0→7.5, type: 'transition'}, 
  {time: 8.0, hz: 7.5, type: 'plateau'}
]
```

### Event Scheduling:
```
Audio Scheduler (32ms lookahead)
      ↓
_scheduleWaveEvents() → getCurrentHz() → timeline.hz.changed
      ↓  
_schedule32nEvents() → _schedulePulseCallback() → timeline.pulse.32n
      ↓
Document Events → Event Listeners → GLSL Blinking / Synth Control
```

### State Management:
```
StateTimeline: Transport state tracking
      ↓
PlaybackState changes → timeline.started/stopped/paused events
      ↓  
TimelineListener subclasses → Auto start/stop synths
```

## Current Integration

### GLSL Blinking Connection:
```javascript
// In index.html
document.addEventListener('timeline.pulse.32n', (event) => {
  const { hz } = event.detail;
  updateGLSLHz(hz); // Trigger GPU blink (~1-4ms latency)
});
```

### Timeline Lifecycle:
```javascript
// Play button pressed
await initializeTimeline();  // Create JMTimeline instance
timeline.start();            // Begin pulse generation
// → 32n pulses → GLSL blinking

// Stop button pressed  
timeline.stop();             // Stop pulse generation
stopGLSLBlinking();         // Clear visual state
```

## Debugging & Troubleshooting

### Console Events:
All timeline events are logged. Check console for:
- `Timeline initialized with segments: [...]`
- `32n Pulse: 5.00Hz at 1.234s`
- `Hz Changed: 7.50Hz (ALPHA)`

### Common Issues:
1. **No blinking**: Check if `timeline.start()` was called
2. **Irregular blinking**: Check segment compilation and Hz values
3. **Transition problems**: Check `getCurrentHz()` interpolation
4. **Memory leaks**: Ensure `dispose()` is called on cleanup

### Performance Monitoring:
- 32n pulse events should be sample-accurate (±1ms)
- Wave Band Hz updates should be smooth during transitions
- Memory usage should stay constant with memory limits

## Tone.js Heritage

**Adapted Components:**
- `Timeline` class: Binary search, memory management, event ordering
- `StateTimeline` class: Transport state tracking methodology  
- Scheduling patterns: Lookahead scheduling, setTimeout precision
- Event-driven architecture: Document events for loose coupling

**Custom Extensions:**
- Two-band scheduling system (Wave + 32n)
- Segment compilation and Hz interpolation
- Integration abstractions for synths
- GLSL blinking integration
- JourneyMap-specific event types

**Key Differences from Tone.js:**
- No audio node creation (pure scheduling)
- Simplified to two specific bands vs full transport
- Custom segment-based timeline vs generic events
- Direct DOM event dispatch vs callback system