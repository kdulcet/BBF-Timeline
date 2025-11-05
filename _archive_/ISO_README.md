# ISO Pulse Synthesis System

## Overview
A custom Web Audio API synthesis system that generates **pulsed sine waves** synchronized with the timeline visual blinks. Each pulse is a fresh sine wave starting from zero phase, with precise envelope control.

## Core Concept
- **One pulse per visual blink** - synchronized with `timeline.pulse.32n` events
- **Pulse duration determined by Hz-band frequency** at pulse start time
- **Fresh sine wave generation** for each pulse (no continuous oscillation)
- **Custom Web Audio implementation** (not using Tone.js due to envelope limitations)

## Mathematical Foundation

### Pulse Timing Formula
```
Hz-band frequency → Pulse characteristics:
- Period = 1000ms / Hz
- Pulse Duration = Period / 2
- Examples:
  - 2Hz → 500ms period → 250ms pulse
  - 5Hz → 200ms period → 100ms pulse
  - 10Hz → 100ms period → 50ms pulse
```

### Envelope Parameters
```
Attack:  1ms  (0% → 100% amplitude)
Sustain: 100% (hold at full amplitude) 
Release: 5ms  (100% → 0% amplitude)

Total envelope overhead: 6ms
Effective sustain time: Pulse Duration - 6ms
```

## Architecture Requirements

### 1. Pulse Generation System
- **Event-driven**: Responds to `timeline.pulse.32n` events
- **Fresh sine waves**: Each pulse creates new OscillatorNode starting at 0° phase
- **Frequency sampling**: Uses Hz-band value at exact pulse trigger time
- **One-shot design**: Each pulse is independent, no continuous oscillation

### 2. Envelope System
```javascript
// Custom ADSR envelope using Web Audio API
const envelope = audioContext.createGain();
const now = audioContext.currentTime;

// 1ms attack
envelope.gain.setValueAtTime(0, now);
envelope.gain.linearRampToValueAtTime(1.0, now + 0.001);

// Sustain (duration - attack - release)
const sustainTime = pulseDuration - 0.001 - 0.005;
envelope.gain.setValueAtTime(1.0, now + 0.001 + sustainTime);

// 5ms release
envelope.gain.linearRampToValueAtTime(0, now + pulseDuration);
```

### 3. Synchronization
- **Visual sync**: Pulse audio starts exactly when visual blink triggers
- **Sample-accurate timing**: Uses Web Audio `currentTime` for precision
- **Hz-band sampling**: Frequency determined by timeline state at pulse moment

## Technical Challenges Identified

### Issue 1: Tone.js Memory Management Failure
**Problem**: Tone.js envelope system fails to garbage collect during arpeggios and rapid pulse generation, causing memory leaks that crash the browser with continuous use.

**Solution**: Direct Web Audio API implementation with **proper disposal patterns**:
- `createOscillator()` for fresh sine generation per pulse
- `createGain()` for manual envelope control  
- `AudioParam` automation for precise timing
- **Critical**: Proper node cleanup and disconnection

### Issue 2: Phase Coherence
**Problem**: Each pulse must start at 0° phase for consistent attack characteristics.

**Solution**: Create new `OscillatorNode` for each pulse instead of modulating existing oscillator.

### Issue 3: Pulse Duration Calculation
**Problem**: Pulse length must reflect Hz-band frequency at trigger time, not current real-time frequency.

**Solution**: Sample Hz-band value in pulse event listener, calculate duration immediately.

### Issue 4: **CRITICAL** - Web Audio Memory Management
**Problem**: OscillatorNodes and GainNodes accumulate without proper disposal, causing memory leaks and eventual browser crashes during extended use.

**Web Audio Disposal Pattern (MDN Standard)**:
```javascript
// 1. Stop OscillatorNode (automatically triggers 'ended' event)
oscillator.stop(audioContext.currentTime + pulseDuration);

// 2. Listen for 'ended' event for cleanup
oscillator.addEventListener('ended', () => {
  // 3. Disconnect all connections
  oscillator.disconnect();
  envelope.disconnect();
  
  // 4. Clear references for garbage collection
  oscillator = null;
  envelope = null;
});
```

**Key Requirements**:
- **Never reuse OscillatorNode** - create fresh instance per pulse
- **Always call .stop()** on OscillatorNode with precise timing  
- **Always call .disconnect()** on all nodes after use
- **Always nullify references** to enable garbage collection
- **Use 'ended' event** for proper cleanup timing

## Implementation Strategy

### Phase 1: Basic Pulse Engine with Proper Disposal
1. Create `ISOPulseEngine` class with memory management
2. Implement `timeline.pulse.32n` event listener
3. Generate single sine pulse with **mandatory cleanup**
4. Test synchronization with visual blinks
5. **Memory leak testing** during extended operation

### Phase 2: Dynamic Pulse Duration
1. Integrate Hz-band frequency sampling
2. Calculate pulse duration: `(1000ms / Hz) / 2`
3. Adjust envelope sustain time dynamically
4. Validate mathematical accuracy
5. **Stress test** rapid pulse generation without memory accumulation

### Phase 3: Performance & Memory Optimization
1. **No object pooling** - fresh nodes ensure clean state
2. **Rigorous disposal** of all completed pulse nodes
3. Memory usage monitoring and leak detection
4. CPU usage optimization without compromising cleanup
5. Integration with existing timeline system
6. **Extended runtime testing** (30+ minutes continuous operation)

## Integration Points

### Timeline System
- **Event source**: `timeline.pulse.32n` events provide trigger timing
- **Frequency source**: Hz-band automation provides pulse frequency
- **Synchronization**: Visual blinks and audio pulses triggered simultaneously

### Existing Audio Infrastructure
- **Web Audio Context**: Shared with existing audio systems
- **Output routing**: Connects to main audio output chain
- **Volume control**: Integrates with existing gain structure

## Success Criteria
1. **Timing precision**: Audio pulses start within 1ms of visual blinks
2. **Frequency accuracy**: Pulse frequency matches Hz-band value at trigger time
3. **Envelope consistency**: 1ms attack + 5ms release maintained across all pulse durations
4. **Phase coherence**: Each pulse starts at 0° sine wave phase
5. **Performance**: System handles rapid pulse rates (up to 20Hz) without audio dropouts

## File Structure
```
widgets/synths/
├── ISO_README.md           (this document)
├── iso_pulse_engine.js     (main pulse generation + memory management)
├── iso_envelope.js         (custom envelope system + disposal)
├── iso_integration.js      (timeline integration)
├── iso_cleanup.js          (memory management utilities)
└── iso_constants.js        (mathematical constants)
```

## **CRITICAL** Memory Management Implementation

### Pulse Generation with Cleanup
```javascript
class ISOPulseEngine {
  generatePulse(frequency, duration) {
    // Create fresh nodes (never reuse)
    const oscillator = this.audioContext.createOscillator();
    const envelope = this.audioContext.createGain();
    
    // Configure pulse
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
    
    // Connect nodes
    oscillator.connect(envelope);
    envelope.connect(this.audioContext.destination);
    
    // Set envelope with proper timing
    this.setupEnvelope(envelope, duration);
    
    // **CRITICAL**: Setup cleanup before starting
    oscillator.addEventListener('ended', () => {
      oscillator.disconnect();
      envelope.disconnect();
      // Explicit null for garbage collection
      oscillator = null;
      envelope = null;
    });
    
    // Start and schedule stop
    oscillator.start(this.audioContext.currentTime);
    oscillator.stop(this.audioContext.currentTime + duration);
  }
}
```

### Envelope System with Disposal
```javascript
setupEnvelope(envelope, pulseDuration) {
  const now = this.audioContext.currentTime;
  const attackTime = 0.001;  // 1ms
  const releaseTime = 0.005; // 5ms
  const sustainTime = pulseDuration - attackTime - releaseTime;
  
  // ADSR with precise timing
  envelope.gain.setValueAtTime(0, now);
  envelope.gain.linearRampToValueAtTime(1.0, now + attackTime);
  envelope.gain.setValueAtTime(1.0, now + attackTime + sustainTime);
  envelope.gain.linearRampToValueAtTime(0, now + pulseDuration);
}
```

## Development Notes
- **No Tone.js dependency** for core pulse generation (prevents memory leaks)
- **Web Audio API direct** with mandatory disposal patterns
- **Event-driven architecture** matches existing timeline pattern
- **Fresh node generation** ensures consistent phase and clean memory state
- **Mathematical precision** for pulse duration calculations
- **Zero memory accumulation** during extended operation
- **MDN-compliant disposal patterns** following Web Audio examples