# JourneyMap Timeline System - Technical Specification

## Overview

The JourneyMap Timeline is a custom Web Audio-based scheduling system designed specifically for AuraMatrix's binaural beat applications. It replaces Tone.js Transport to avoid memory leaks while maintaining sample-accurate timing and smooth visual feedback.

## Core Architecture: Two-Band Scheduling

### Wave Band (Continuous Hz Automation)
- **Purpose**: Smooth frequency transitions between timeline segments
- **Implementation**: Web Audio `AudioParam` automation
- **Timing**: Continuous parameter changes using `linearRampToValueAtTime()`
- **Visual**: Real-time Hz display updates

### 32n Band (Discrete Pulse Events)
- **Purpose**: Rhythmic synchronization points for effects and modulation
- **Implementation**: Sample-accurate event scheduling
- **Timing**: `32n_interval = 1 / (Hz × 4)`
- **Visual**: Hz flash metronome on pulse events

## Timeline Segment Types

### 1. Plateau Segments
```javascript
{
  type: "plateau",
  hz: 8.0,              // Constant frequency
  durationSeconds: 60,   // How long to sustain
  loopable: true        // Can repeat indefinitely
}
```

### 2. Transition Segments  
```javascript
{
  type: "transition",
  startHz: 8.0,
  endHz: 12.0,
  durationSeconds: 30,
  transitionType: "linear" | "exponential" | "stepped"
}
```

## Playback Modes

### Sequential Playback (Standard)
- Play timeline segments in order from start to finish
- Automatic progression through transitions and plateaus
- Standard meditation/therapy session behavior

### Random Access Playback (Editing Mode)

#### Jump to Plateau
```javascript
timeline.jumpTo({
  segmentIndex: 3,
  behavior: "loop_plateau"  // Sustain at target Hz indefinitely
});
```

#### Jump to Transition + Loop Following Plateau
```javascript
timeline.jumpTo({
  segmentIndex: 2,          // Transition segment
  behavior: "play_through_then_loop"  // Complete transition, then loop next plateau
});
```

## Core Formula (IMMUTABLE)
```javascript
BPM = (Hz × 60) / 8
32n_interval = 1 / (Hz × 4)
```

## Learning from Tone.js Architecture

### Adopted Patterns
1. **StateTimeline**: Sample-accurate state management (play/pause/stop)
2. **Event Batching**: Process multiple events in single update cycle
3. **Timeline Memoization**: Cache computed values for performance
4. **Error Isolation**: Prevent callback failures from breaking system

### Key Improvements Over Tone.js
- **No Memory Leaks**: Direct Web Audio without wrapper overhead
- **Simplified Architecture**: Only two scheduling bands vs. complex PPQN
- **Purpose-Built**: Optimized for binaural beats, not general music
- **Visual Integration**: Timeline and visual feedback tightly coupled

## Implementation Strategy

### Phase 1: Core Timeline Engine
```javascript
class JMTimeline {
  constructor(audioContext) {
    this.audioContext = audioContext;
    this.segments = [];
    this.currentSegmentIndex = 0;
    this.playbackMode = "sequential";
    this.isRunning = false;
    
    // State management (Tone.js pattern)
    this._stateTimeline = new StateTimeline();
    this._waveEvents = new Timeline();     // Hz automation
    this._pulseEvents = new Timeline();    // 32n triggers
    
    this._lastUpdate = 0;
    this._updateInterval = null;
  }
}
```

### Phase 2: Random Access System
```javascript
// Jump to specific segment with behavior control
jumpTo(options) {
  const { segmentIndex, behavior } = options;
  
  switch(behavior) {
    case "loop_plateau":
      this._setupPlateauLoop(segmentIndex);
      break;
    case "play_through_then_loop":
      this._setupTransitionPlaythrough(segmentIndex);
      break;
  }
}
```

### Phase 3: Visual Feedback Integration
```javascript
// Ensure lights never stop blinking during any operation
updateVisualFeedback() {
  const currentTime = this.audioContext.currentTime;
  const currentHz = this.getCurrentHz(currentTime);
  
  // Update Hz display
  this.emit('hz_change', currentHz);
  
  // Handle 32n pulse flash
  if (this._shouldFlash32n(currentTime)) {
    this.emit('pulse_flash', currentTime);
  }
}
```

## Critical Success Criteria

### Visual Continuity
- **Requirement**: Hz flash metronome NEVER stops during any timeline operation
- **Implementation**: Visual updates decoupled from audio scheduling
- **Test**: Lights must blink properly during jumps, transitions, and loops

### Sample-Accurate Timing
- **Requirement**: All audio events use `AudioContext.currentTime`
- **Implementation**: No JavaScript intervals for audio timing
- **Test**: Sub-millisecond precision for binaural beat generation

### Memory Safety  
- **Requirement**: No accumulating objects or event listeners
- **Implementation**: Proper cleanup and disposal patterns
- **Test**: Timeline can run indefinitely without memory growth

## Random Access Use Cases

### Editing Environment
1. **Preview Segments**: Jump to any plateau for immediate audition
2. **Test Transitions**: Jump to transition start, hear full change
3. **Loop Sections**: Sustain specific Hz ranges for extended testing
4. **A/B Comparison**: Quickly switch between different segments

### Therapy Session Control
1. **Emergency Plateaus**: Jump to calming Hz during distress
2. **Session Extension**: Loop beneficial segments beyond planned duration
3. **Custom Progressions**: Skip segments based on real-time biofeedback
4. **Interrupt Recovery**: Resume from interruption point seamlessly

## API Design

### Timeline Control
```javascript
// Sequential playback
timeline.play();
timeline.pause();
timeline.stop();

// Random access
timeline.jumpTo({ segmentIndex: 3, behavior: "loop_plateau" });
timeline.jumpTo({ segmentIndex: 1, behavior: "play_through_then_loop" });

// Status queries
timeline.getCurrentSegment();
timeline.getCurrentHz();
timeline.getPlaybackMode();
```

### Event System
```javascript
// Visual feedback events
timeline.on('hz_change', (hz) => updateHzDisplay(hz));
timeline.on('pulse_flash', (time) => flashMetronome(time));
timeline.on('segment_change', (index) => updateProgressBar(index));

// State change events  
timeline.on('play', (time) => console.log('Timeline started'));
timeline.on('jump', ({ from, to, behavior }) => console.log('Random access'));
```

## Performance Targets

### Enterprise Audio Engine Support
- **Oscillators**: 15-20 binaural pairs + 2 noise + 6 sub oscillators
- **Event Rate**: 25Hz maximum event scheduling
- **Latency**: <10ms timeline response time
- **Memory**: Stable memory usage over 8+ hour sessions

### Visual Responsiveness
- **Update Rate**: 60fps visual feedback minimum
- **Flash Accuracy**: ±1ms metronome timing precision
- **UI Response**: <50ms for jump/play/pause operations

## Next Steps

1. **Study Tone.js**: Extract `StateTimeline`, `Clock._loop()`, and event batching patterns
2. **Build Foundation**: Implement core timeline with two-band scheduling  
3. **Add Random Access**: Implement jump functionality with behavior control
4. **Visual Integration**: Ensure uninterrupted visual feedback during all operations
5. **Performance Testing**: Validate with enterprise audio engine loads

## Success Metrics

- [ ] Visual feedback continuous during all timeline operations
- [ ] Sample-accurate Hz transitions without audio glitches  
- [ ] Random access jumps complete within 50ms
- [ ] Memory usage stable over extended sessions
- [ ] Supports 30+ simultaneous audio sources
- [ ] 32n pulse timing accuracy ±1ms
- [ ] Visual metronome never stops flashing

This timeline system will provide the foundation for AuraMatrix's advanced binaural beat applications while maintaining the precision and reliability required for therapeutic use.