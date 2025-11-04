# JourneyMap Timeline System Documentation

## Overview

The JourneyMap Timeline System is a modular, sample-accurate timing engine built for audio applications. It consists of 4 core files that work together to provide precise scheduling, state management, and synth integration.

**Architecture**: Inspired by Tone.js Transport but rebuilt for our specific needs with two-band scheduling (Wave Band + 32n Band).

## File Structure & Responsibilities

### 1. `timeline_main.js` - Base Timeline Class
**Source**: Direct adaptation from Tone.js Timeline
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
- Memory management with configurable limits (default: 1000 events)

---

### 2. `timeline_transport.js` - State Management
**Source**: Direct adaptation from Tone.js StateTimeline  
**Purpose**: Track transport states (started/stopped/paused) over time with sample accuracy

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
- Sample-accurate state transitions for synth lifecycle management

---

### 3. `timeline_jm.js` - Main Timeline Engine
**Source**: Custom implementation for JourneyMap (formerly `timeline_journeymap.js`)
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
**Purpose**: Base classes for synths to easily consume timeline data via document events

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
onHzChanged(hz, time, waveType) // Override: Hz value changed
getCurrentHz()                  // Get current Hz value
startWaveTracking()             // Begin Hz monitoring
stopWaveTracking()              // Stop Hz monitoring
```

**`PulseBandListener`** (32n Band Specialist):
```javascript
onPulse32n(time, hz, interval, pulseCount) // Override: 32n pulse triggered
startPulseTracking()                       // Begin pulse monitoring
stopPulseTracking()                        // Stop pulse monitoring
calculateNextPulse(hz)                     // Predict next pulse time
```

**`DualBandListener`** (Both Bands):
- Combines WaveBandListener + PulseBandListener
- For synths that need both continuous Hz and discrete pulses

#### Integration Patterns:
```javascript
// Wave Band Synth (Binaural, Carrier)
class BinauralSynth extends WaveBandListener {
  onHzChanged(hz, time, waveType) {
    this.oscillator.frequency.linearRampToValueAtTime(hz, time);
  }
}

// Pulse Band Synth (ISO, Percussion)
class ISOSynth extends PulseBandListener {
  onPulse32n(time, hz, interval, pulseCount) {
    this.generatePulse(time, hz);
  }
}

// Dual Band Synth (Complex)
class HybridSynth extends DualBandListener {
  onHzChanged(hz, time, waveType) { /* continuous */ }
  onPulse32n(time, hz, interval, pulseCount) { /* rhythmic */ }
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
Audio Scheduler (32ms ticker, 100ms lookahead)
      ↓
_processWaveBandEvents() → getCurrentHz() → timeline.hz.changed
      ↓  
_processPulseBandEvents() → _schedulePulseCallback() → timeline.pulse.32n
      ↓
Document Events → Event Listeners → Synth Integration
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

### ISO Synth Connection:
```javascript
// ISO synth listens to 32n pulse events
class ISOSynth extends PulseBandListener {
  onPulse32n(time, hz, interval, pulseCount) {
    this.generatePulse(time, hz);
  }
}
```

**Memory-Safe Pattern:**
ISO synth uses bound methods to prevent memory leaks from anonymous functions:
- `_boundDisconnectEnvelope` - Single reusable method for envelope cleanup
- `_boundOscillatorEnded` - Single reusable handler for all oscillator events  
- `_boundHandlePulseEvent` - Reusable pulse event handler
- WeakMap stores per-oscillator cleanup data without creating new functions

**Result:** No new functions created per pulse, prevents compiled code accumulation.

### Timeline Lifecycle:
```javascript
// Play button pressed
await initializeTimeline();  // Create JMTimeline instance
timeline.start();            // Begin pulse generation
// → 32n pulses → ISO synth pulse generation

// Stop button pressed  
timeline.stop();             // Stop pulse generation
isoSynth.dispose();          // Clean up audio nodes
```

## Debugging & Troubleshooting

### Console Events:
Timeline events are dispatched to document listeners. Monitor with:
```javascript
document.addEventListener('timeline.pulse.32n', (e) => console.log('Pulse:', e.detail));
document.addEventListener('timeline.hz.changed', (e) => console.log('Hz:', e.detail.hz));
```

### Common Issues:
1. **No pulses**: Check if `timeline.start()` was called
2. **Irregular pulses**: Check segment compilation and Hz values
3. **Transition problems**: Check `_getHzAtTime()` interpolation  
4. **Memory leaks**: Ensure bound methods used (not anonymous functions)
5. **Disposal issues**: Call `timeline.stop()` and synth `dispose()` on cleanup

### Performance Monitoring:
- 32n pulse events should be sample-accurate (±1ms)
- Wave Band Hz updates should be smooth during transitions
- Memory usage should stay constant (no function accumulation)
- Compiled code instances should remain stable during playback

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

## Transition-Aware Pulse Scheduling: IMPLEMENTED

### Problem Solved:
The pulse scheduling system (`_schedule32nEvents()`) now properly handles transition segments where Hz is continuously ramping. Pulse rates smoothly accelerate/decelerate during transitions using Tone.js TickParam patterns.

**Root Solution:** Implemented Tone.js `TickParam._getTicksUntilEvent()` trapezoidal integration pattern with transition-aware Hz interpolation for smooth pulse rate changes.

### Tone.js Implementation Adapted:
From Tone.js `TickParam._getTicksUntilEvent()` implementation:

```javascript
// Tone.js trapezoidal integration pattern (now implemented)
return 0.5 * (time - event.time) * (val0 + val1) + event.ticks;

// Our implementation in _getNextPulseTime():
const avgHz = 0.5 * (currentHz + futureHz);
const transitionAwareInterval = calculate32nInterval(avgHz);
```

### Implementation Complete:
The JMTimeline `_schedule32nEvents()` method now:

1. **✅ Detects Transition Segments**: `_getHzAtTime()` identifies transition vs plateau segments
2. **✅ Interpolates Hz Values**: Linear interpolation matching Web Audio ramping during transitions  
3. **✅ Dynamic Pulse Intervals**: `_getNextPulseTime()` uses trapezoidal integration for smooth rate changes
4. **✅ Preserves Web Audio Ramping**: Wave Band automation unchanged, works perfectly

### Key Methods Added:
```javascript
_getHzAtTime(time)              // Transition-aware Hz interpolation
_getNextPulseTime(currentTime, currentHz)  // Trapezoidal integration interval calculation
```

**Result:** Pulse events now properly reflect continuously changing Hz during transitions with sample-accurate timing. During a 5Hz→7.5Hz transition, pulses gradually accelerate instead of jumping between rates.