# AuraMatrix Audio Rewrite

**Raw Web Audio API implementation with Hz-driven timeline**

## Purpose
Proof-of-concept rebuild using native Web Audio API (no Tone.js) with sample-accurate Hz-driven timeline. This validates the core architecture before migrating features from the main AuraMatrix app.

## POC Scope

### Phase 1: Timeline + Type-In UI (CURRENT)
- Custom Hz timeline (5Hz → 15Hz → 5Hz with transitions)
- Type-in fields for Hz values (carrier frequency)
- Journey Map segments (Beta, SMR, Alpha with durations/transitions)
- Console API for testing

### Phase 2: ISO Synth + Crossfader
- ISO pulse synth (OscillatorNode + gate GainNode)
- Crossfader (fade in/out during transitions)
- ISO pulses sync to timeline Hz rate
- Sample-accurate pulsing validation

### Phase 3: Binaural Synth Integration
- Binaural synth (5 oscillators, raw Web Audio)
- Preset loading from JSON
- Timeline drives carrier frequency
- Memory leak testing (30+ min sessions)

### Phase 4: Integration Planning
- Merge strategy back to main app
- Timeline API design
- Deprecation plan for Tone.Transport

## Test Cases

**Timeline**:
- Type "7.83Hz" → timeline updates to 7.83Hz
- 5Hz → 15Hz transition over 15s (smooth ramp)
- Sample-accurate timing verification

**ISO Synth**:
- 5Hz timeline → 200ms pulse intervals
- 15Hz timeline → 66.67ms pulse intervals
- Crossfader volume automation during transitions

**Binaural Synth**:
- Load preset → 5 oscillators at correct frequencies
- Timeline drives carrier with binaural beat offset
- Zero memory leaks (DevTools AudioParam monitoring)

## Architecture

**Core Primitives**:
- `AudioContext.currentTime` - sample-accurate clock
- `OscillatorNode` - tone generation
- `GainNode` - amplitude control
- `StereoPannerNode` - spatial positioning
- `AudioParam` automation - sample-accurate scheduling

**No Dependencies**: Pure Web Audio API, no abstractions, zero memory leaks.

## Success Criteria
✅ Sample-accurate Hz-driven timeline (validated at 5Hz, 15Hz, 25Hz)
✅ ISO pulsing tighter than Tone.js implementation
✅ Zero AudioParam accumulation (30+ min test)
✅ Smooth frequency transitions (no clicks)
✅ Deployment-ready (web platform, no build targets)

---

**Status**: Phase 1 in progress
**Branch**: main (clean slate)
**Target**: 5-7 days for full POC
