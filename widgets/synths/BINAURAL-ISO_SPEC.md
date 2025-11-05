# BINAURAL-ISO Combined Worklet Specification

**Version:** 1.0  
**Date:** November 5, 2025  
**Branch:** combined-worklet  
**Purpose:** Merge binaural continuous tones + ISO discrete pulses into single worklet with crossfader

---

## 1. EXECUTIVE SUMMARY

### Current State Analysis

**Four Existing Files:**
- `binaural_worklet_jm.js` - 323 lines (journey map continuous tones)
- `binaural_worklet.js` - 593 lines (reference implementation)
- `iso_synth.js` - 241 lines (old node-based approach, mostly obsolete)
- `iso_worklet.js` - 548 lines (LFO phase-wrap pulses with cosine easing + duty cycle)

**Total Lines:** ~1705 lines across 4 files

**Problem to Solve:**
Slight transition "wiggle" between ISO and binaural systems due to:
- Separate AudioWorklet processors
- Different sample boundaries
- Mild moire effect during Hz transitions

**Solution:**
Single combined worklet calculating both systems from identical segments at identical sample boundaries. Mathematical impossibility of drift.

---

## 2. REQUIREMENTS

### 2.1 Real-Time Controls (Main Thread → Worklet)

| Control | Range | Default | Purpose |
|---------|-------|---------|---------|
| **Volume** | 0.0-1.0 (normalized) | 0.3 | Master output gain |
| **Crossfader** | 0.0-1.0 | 0.5 | 0.0=pure binaural, 1.0=pure ISO |
| **Duty Cycle** | 0.5-2.0+ | 1.5 | ISO pulse duration (150% = overlap) |
| **Carrier Adjustment** | -2 to +2 octaves | 0 | Carrier frequency multiplier |
| **Width** | 0.0-1.0 | 1.0 | Stereo field width (constant-power) |

### 2.2 Timeline Integration

**MUST USE:**
- Cosine easing formula: `(1 - Math.cos(progress * Math.PI)) / 2`
- Journey map segments (plateau + transition types)
- On-demand calculation from segments (no pre-compilation)
- Single source of truth for both binaural and ISO

**Preserved from Existing Code:**
```javascript
function getHzAt(compiledSegments, timeSeconds) {
  const segment = findSegmentAt(compiledSegments, timeSeconds);
  if (!segment) return 5.0;

  if (segment.type === 'plateau') {
    return segment.hz;
  } else if (segment.type === 'transition') {
    const progress = (timeSeconds - segment.startTime) / segment.duration;
    const clampedProgress = Math.max(0, Math.min(1, progress));
    // Cosine easing: smooth S-curve from 0 to 1
    const easedProgress = (1 - Math.cos(clampedProgress * Math.PI)) / 2;
    return segment.startHz + (segment.endHz - segment.startHz) * easedProgress;
  }

  return 5.0;
}
```

### 2.3 File Size Constraints

**Target:** <500 lines per file  
**Strategy:** Abstract helper functions into separate module if needed  
**Constraint:** AudioWorklets cannot import ES6 modules (must inline or use single file)

**Acceptable Solution:**
- Single file up to 600 lines (if clean and well-documented)
- Helper functions inlined at top (compiled segments, find segment, getHzAt)
- Voice classes kept minimal

---

## 3. ARCHITECTURE DESIGN

### 3.1 Combined Processor Structure

```
BinauralISOProcessor (AudioWorkletProcessor)
├── Journey Map Data
│   ├── rawSegments[]
│   ├── compiledSegments[]
│   └── carrierFrequency
│
├── Control Parameters
│   ├── volumeGain (0.0-1.0)
│   ├── crossfade (0.0-1.0)
│   ├── dutyCycle (0.5-2.0+)
│   ├── carrierOctave (-2 to +2)
│   ├── leftPan / rightPan (width control)
│   └── currentSample (timeline position)
│
├── Binaural System (Continuous)
│   ├── leftVoiceBinaural (Voice)
│   └── rightVoiceBinaural (Voice)
│
└── ISO System (Discrete Pulses)
    ├── voices[] (pool of 8 Voice instances)
    ├── beatPhase (LFO accumulator 0-2π)
    ├── pulseId (counter)
    └── channel (alternating L/R)
```

### 3.2 Signal Flow

```
1. CALCULATE HZ
   ↓
   getHzAt(segments, currentTime) → beatHz (with cosine easing)
   
2. CALCULATE FREQUENCIES
   ↓
   Binaural L: carrier - (beatHz/2)
   Binaural R: carrier + (beatHz/2)
   ISO L: carrier - (beatHz/2) [if split enabled]
   ISO R: carrier + (beatHz/2) [if split enabled]
   
3. GENERATE AUDIO
   ↓
   Binaural: Continuous sine waves (2 voices)
   ISO: LFO phase-wrap triggers pulses (8 voice pool)
   
4. CROSSFADE MIX
   ↓
   crossfade=0.0: 100% binaural, 0% ISO
   crossfade=0.5: 50% binaural, 50% ISO
   crossfade=1.0: 0% binaural, 100% ISO
   
5. STEREO WIDTH
   ↓
   Constant-power panning for L/R separation
   
6. VOLUME + OUTPUT
   ↓
   Master gain → outputL, outputR
```

### 3.3 Crossfader Implementation

**Constant-Power Crossfade:**
```javascript
// Calculate crossfade gains (constant-power law)
const binauralGain = Math.cos(crossfade * Math.PI / 2);
const isoGain = Math.sin(crossfade * Math.PI / 2);

// Mix signals
const mixedL = (binauralL * binauralGain) + (isoL * isoGain);
const mixedR = (binauralR * binauralGain) + (isoR * isoGain);
```

**Crossfade Values:**
- 0.0: cos(0) = 1.0 (binaural), sin(0) = 0.0 (ISO)
- 0.5: cos(π/4) = 0.707 (binaural), sin(π/4) = 0.707 (ISO)
- 1.0: cos(π/2) = 0.0 (binaural), sin(π/2) = 1.0 (ISO)

### 3.4 Carrier Octave Adjustment

**Formula:**
```javascript
const carrierMultiplier = Math.pow(2, carrierOctave);
const actualCarrier = baseCarrier * carrierMultiplier;
```

**Range Examples:**
- -2 octaves: × 0.25 (110Hz → 27.5Hz)
- -1 octave: × 0.5 (110Hz → 55Hz)
- 0 octaves: × 1.0 (110Hz → 110Hz) [default]
- +1 octave: × 2.0 (110Hz → 220Hz)
- +2 octaves: × 4.0 (110Hz → 440Hz)

---

## 4. FILE STRUCTURE PLAN

### 4.1 New File: `binaural_iso_worklet.js`

**Estimated Size:** ~550 lines

**Section Breakdown:**
```
Lines 1-80:    Header documentation + constants
Lines 81-200:  Helper functions (compileSegments, findSegmentAt, getHzAt, etc.)
Lines 201-280: Voice class (shared by both systems)
Lines 281-320: AdsrEnvelope class (ISO only)
Lines 321-550: BinauralISOProcessor class
               - Constructor + message handlers (80 lines)
               - process() method (150 lines)
                 * Hz calculation
                 * Binaural continuous generation
                 * ISO LFO phase-wrap triggering
                 * Crossfade mixing
                 * Width control
                 * Output
```

### 4.2 Code Reuse from Existing Files

**From `iso_worklet.js` (548 lines):**
- ✅ Helper functions: compileSegments, findSegmentAt, getHzAt (with cosine easing)
- ✅ LFO phase-wrap triggering system (beatPhase, omega calculation)
- ✅ Duty cycle system (DEFAULT_DUTY_CYCLE, runtime adjustable)
- ✅ Voice class with ADSR envelope
- ✅ Stereo width constant-power panning
- ✅ 8-voice pool management

**From `binaural_worklet_jm.js` (323 lines):**
- ✅ Continuous binaural voice generation
- ✅ carrier ± (beatHz/2) frequency calculation
- ✅ Per-sample Hz calculation architecture
- ✅ Journey map loading + compiled segments

**New Code Required:**
- ⚠️ Crossfader mixing logic (~20 lines)
- ⚠️ Carrier octave adjustment (~10 lines)
- ⚠️ Message handlers for new controls (~30 lines)
- ⚠️ Combined signal flow (~40 lines)

**TOTAL NEW CODE:** ~100 lines  
**TOTAL REUSED CODE:** ~450 lines  
**ESTIMATED TOTAL:** ~550 lines ✅

---

## 5. MESSAGE PROTOCOL

### 5.1 Main Thread → Worklet

```javascript
// Load journey map (once at start)
{
  type: 'loadJourneyMap',
  segments: [...],
  carrierFrequency: 110
}

// Start/stop playback
{ type: 'start' }
{ type: 'stop' }

// Volume control (0.0-1.0 normalized)
{
  type: 'setVolume',
  gain: 0.5
}

// Crossfader (0.0=binaural, 1.0=ISO)
{
  type: 'setCrossfade',
  value: 0.5
}

// Duty cycle (ISO pulse duration)
{
  type: 'setDutyCycle',
  dutyCycle: 1.5
}

// Carrier octave adjustment (-2 to +2)
{
  type: 'setCarrierOctave',
  octave: 0
}

// Stereo width (constant-power)
{
  type: 'setWidth',
  panL: -1.0,
  panR: 1.0
}
```

### 5.2 Worklet → Main Thread

```javascript
// Initialization
{ type: 'initialized', voiceCount: 10 }

// Journey map loaded
{
  type: 'journeyMapLoaded',
  segmentCount: 5,
  totalDurationSeconds: 13.0
}

// Playback state
{ type: 'started' }
{ type: 'stopped' }
{ type: 'completed' }

// Optional: Status updates
{
  type: 'status',
  currentTime: 5.3,
  currentHz: 7.5,
  activePulses: 2
}
```

---

## 6. IMPLEMENTATION STRATEGY

### 6.1 Phase 1: Core Merge (Priority)

**Goal:** Get both systems running in single worklet

1. Create `binaural_iso_worklet.js`
2. Copy helper functions from `iso_worklet.js` (cosine easing preserved)
3. Copy Voice + AdsrEnvelope from `iso_worklet.js`
4. Copy binaural continuous generation from `binaural_worklet_jm.js`
5. Wire both systems to same Hz calculation
6. Test: Both systems should work independently (crossfade=0.0 and crossfade=1.0)

### 6.2 Phase 2: Crossfader (Critical)

**Goal:** Smooth mixing between binaural and ISO

1. Implement constant-power crossfade formula
2. Add setCrossfade message handler
3. Mix binaural + ISO signals in process()
4. Test: Verify no volume dips at crossfade=0.5
5. Verify smooth transitions from 0.0 → 1.0

### 6.3 Phase 3: Controls (Polish)

**Goal:** All runtime controls functional

1. Carrier octave adjustment (Math.pow(2, octave))
2. Duty cycle control (already exists in ISO code)
3. Volume control (already exists in both)
4. Width control (already exists in both)
5. Test: Verify orthogonal control (no interference)

### 6.4 Phase 4: Testing (Validation)

**Critical Tests:**
- ✅ Crossfade=0.0: Only binaural, no pulses
- ✅ Crossfade=1.0: Only ISO, no continuous tone
- ✅ Crossfade=0.5: Both audible, no volume dip
- ✅ Transition wiggle: Should be eliminated (same sample boundaries)
- ✅ Duty cycle 0.5-2.0: Full range functional
- ✅ Carrier octave -2 to +2: Frequency changes correct
- ✅ Width 0-100%: Stereo field adjusts smoothly
- ✅ Volume 0-100%: No clicks or artifacts

**Performance Tests:**
- CPU usage vs separate worklets
- Memory allocation stability
- No voice pool exhaustion at high Hz
- Long-duration playback (>1 minute)

---

## 7. ABSTRACTION CONSIDERATIONS

### 7.1 Helper Functions Module (If Needed)

**Problem:** If file exceeds 600 lines, need abstraction  
**Constraint:** AudioWorklets cannot import ES6 modules

**Solution Options:**

**Option A: Keep Inline (RECOMMENDED)**
- Helper functions at top of file (~120 lines)
- No import complexity
- Single self-contained file
- Easier debugging

**Option B: Build-Time Concatenation**
- Separate `jm_worklet_helper.js` file
- Build script concatenates into single output
- More modular development
- Requires build step

**Option C: Shared Message Channel**
- Helper calculations in main thread
- Post messages to worklet
- REJECTED: Too much latency for per-sample calculations

**DECISION:** Use Option A (inline) for simplicity. If file grows beyond 600 lines, revisit Option B.

### 7.2 Voice Class Optimization

**Current:** Separate Voice + AdsrEnvelope classes  
**Size:** ~120 lines combined

**If Size Critical:**
- Merge ADSR into Voice class (save ~30 lines)
- Remove unused envelope stages (sustain is just value=1.0)
- Inline omega calculation (save ~5 lines)

**NOT RECOMMENDED UNLESS NECESSARY:** Current structure is clean and maintainable.

---

## 8. MIGRATION PATH

### 8.1 From Current State

**Preserve:**
- ✅ `iso_worklet.js` on lfo-event branch (production fallback)
- ✅ `binaural_worklet_jm.js` on lfo-event branch (production fallback)

**Create New:**
- ✅ `binaural_iso_worklet.js` on combined-worklet branch (experimental)

**Update:**
- ⚠️ `index.html` - add crossfader slider, carrier octave control
- ⚠️ UI connections - wire new controls to worklet messages

### 8.2 Rollback Plan

**If Combined Worklet Has Issues:**
1. Switch back to lfo-event branch
2. Use separate `iso_worklet.js` + `binaural_worklet_jm.js`
3. Accept slight transition wiggle as production metric

**Decision Criteria:**
- Combined worklet MUST eliminate transition wiggle
- Combined worklet MUST NOT increase CPU usage >20%
- Combined worklet MUST support all real-time controls
- If any fail: Keep lfo-event as production

---

## 9. SUCCESS METRICS

### 9.1 Primary Goal

**Eliminate Transition Wiggle:**
- ❌ Current: Slight wiggle during transitions (separate worklets)
- ✅ Target: Zero wiggle (same sample boundaries, same calculations)

**Test:** Long transition (e.g., 2Hz → 15Hz over 5 seconds)
- Listen for any drift or phase wobble
- Compare against lfo-event baseline
- If combined worklet is cleaner: SUCCESS

### 9.2 Secondary Goals

**Performance:**
- CPU usage < 5% on modern hardware
- No voice pool exhaustion at 25Hz
- Memory stable over 5+ minute playback

**Controls:**
- All 5 real-time controls functional
- No clicks when adjusting parameters
- Crossfader smooth from 0.0 → 1.0

**Code Quality:**
- File size < 600 lines
- Clear section documentation
- Preserves cosine easing timeline
- Maintainable for future enhancements

---

## 10. IMPLEMENTATION CHECKLIST

### Pre-Implementation
- [x] Review existing files (iso_worklet.js, binaural_worklet_jm.js)
- [x] Confirm cosine easing formula preserved
- [x] Confirm duty cycle system understood
- [x] Write specification document (this file)
- [ ] Review spec with user for approval

### Phase 1: Core Merge
- [ ] Create `binaural_iso_worklet.js`
- [ ] Copy helper functions (compileSegments, findSegmentAt, getHzAt)
- [ ] Copy Voice + AdsrEnvelope classes
- [ ] Implement BinauralISOProcessor constructor
- [ ] Add journey map loading message handler
- [ ] Implement binaural continuous generation
- [ ] Implement ISO LFO phase-wrap triggering
- [ ] Test: Both systems working independently

### Phase 2: Crossfader
- [ ] Implement constant-power crossfade formula
- [ ] Add setCrossfade message handler
- [ ] Mix binaural + ISO signals in process()
- [ ] Test: No volume dips, smooth transitions

### Phase 3: Controls
- [ ] Implement carrier octave adjustment
- [ ] Verify duty cycle control works
- [ ] Verify volume control works
- [ ] Verify width control works
- [ ] Test: All controls orthogonal (no interference)

### Phase 4: Integration
- [ ] Update index.html with new UI controls
- [ ] Wire crossfader slider to worklet
- [ ] Wire carrier octave control to worklet
- [ ] Add visual feedback for crossfader position
- [ ] Test: Full system integration

### Phase 5: Validation
- [ ] Test crossfade extremes (0.0, 1.0)
- [ ] Test crossfade midpoint (0.5)
- [ ] Test transition wiggle elimination
- [ ] Test duty cycle range (0.5-2.0)
- [ ] Test carrier octave range (-2 to +2)
- [ ] Test width range (0-100%)
- [ ] Performance testing (CPU, memory)
- [ ] Long-duration stability test (5+ minutes)

### Completion
- [ ] Document any deviations from spec
- [ ] Commit to combined-worklet branch
- [ ] Compare against lfo-event baseline
- [ ] User acceptance testing
- [ ] Decision: Merge or keep lfo-event as production

---

## 11. CODE TEMPLATES

### 11.1 Crossfader Formula

```javascript
// In process() method, after generating binaural and ISO signals:

// Calculate constant-power crossfade gains
const crossfadeAngle = this.crossfade * Math.PI / 2;
const binauralGain = Math.cos(crossfadeAngle);  // 1.0 → 0.0
const isoGain = Math.sin(crossfadeAngle);        // 0.0 → 1.0

// Mix signals (before width control)
const mixedL = (binauralLeftSample * binauralGain) + (isoLeftSample * isoGain);
const mixedR = (binauralRightSample * binauralGain) + (isoRightSample * isoGain);
```

### 11.2 Carrier Octave Adjustment

```javascript
// In constructor:
this.carrierOctave = 0;  // -2 to +2

// In message handler:
} else if (event.data.type === 'setCarrierOctave') {
  this.carrierOctave = Math.max(-2, Math.min(2, event.data.octave));
}

// In process() before frequency calculations:
const carrierMultiplier = Math.pow(2, this.carrierOctave);
const actualCarrier = this.carrierFrequency * carrierMultiplier;

// Use actualCarrier for both binaural and ISO frequency calculations
```

### 11.3 Message Handler Template

```javascript
this.port.onmessage = (event) => {
  if (event.data.type === 'loadJourneyMap') {
    // ... existing code ...
    
  } else if (event.data.type === 'start') {
    // ... existing code ...
    
  } else if (event.data.type === 'stop') {
    // ... existing code ...
    
  } else if (event.data.type === 'setVolume') {
    this.volumeGain = event.data.gain;
    
  } else if (event.data.type === 'setCrossfade') {
    this.crossfade = Math.max(0, Math.min(1, event.data.value));
    
  } else if (event.data.type === 'setDutyCycle') {
    this.dutyCycle = event.data.dutyCycle;
    
  } else if (event.data.type === 'setCarrierOctave') {
    this.carrierOctave = Math.max(-2, Math.min(2, event.data.octave));
    
  } else if (event.data.type === 'setWidth') {
    this.leftPan = event.data.panL;
    this.rightPan = event.data.panR;
  }
};
```

---

## 12. NOTES & CONSIDERATIONS

### 12.1 Why This Solves the Wiggle

**Root Cause of Wiggle:**
- ISO and binaural in separate AudioWorklet processors
- Browser schedules process() calls independently
- Sample boundary alignment not guaranteed
- During transitions: Hz changing, slight timing differences compound

**How Combined Worklet Fixes:**
- Single process() call for both systems
- Identical sample boundaries (same `i` loop)
- Identical Hz calculation (`getHzAt()` called once)
- Both systems use result from single calculation
- Mathematical impossibility of drift

**Expected Result:**
- Plateaus: Already perfect (constant Hz)
- Transitions: Should now be perfect (same calculation, same moment)

### 12.2 Duty Cycle System

**Already Solved in iso_worklet.js:**
- DEFAULT_DUTY_CYCLE = 1.5 (150% overlap)
- Runtime adjustable via setDutyCycle message
- Full documentation at line 84-91
- **PRESERVE AS-IS** in combined worklet

### 12.3 Cosine Easing

**Already Solved in iso_worklet.js:**
- Line 147: `const easedProgress = (1 - Math.cos(clampedProgress * Math.PI)) / 2;`
- Smooth S-curve transitions
- **PRESERVE AS-IS** in combined worklet

### 12.4 Performance Expectations

**Current (Separate Worklets):**
- ISO: ~2-3% CPU (8 voices, LFO triggering)
- Binaural: ~1-2% CPU (2 continuous voices)
- Total: ~3-5% CPU

**Combined Worklet:**
- Single process() call overhead
- Same voice count (8 ISO + 2 binaural = 10 total)
- Expected: ~4-6% CPU (slight increase acceptable)
- If >8% CPU: Investigate optimization

---

## 13. GLOSSARY

**Binaural Beats:** Two slightly different frequencies (one per ear) creating perceived beat  
**Carrier Frequency:** Base tone (e.g., 110Hz) before beat offset applied  
**Constant-Power Panning:** Panning law that maintains perceived loudness  
**Cosine Easing:** Smooth S-curve interpolation using cosine function  
**Crossfader:** Control mixing between two audio sources (binaural ↔ ISO)  
**Duty Cycle:** Pulse duration relative to interval (>1.0 = overlap)  
**ISO (Isochronic):** Discrete pulses at regular intervals  
**Journey Map:** Timeline specification with plateau and transition segments  
**LFO:** Low Frequency Oscillator (used for pulse rate control)  
**Octave:** Frequency doubling (or halving): 110Hz → 220Hz (+1 octave)  
**Phase Wrap:** When LFO phase crosses 2π, trigger new pulse  
**Render Quantum:** 128 samples per process() call (Web Audio API constant)  
**Width:** Stereo field separation (0% = mono, 100% = full stereo)  

---

## 14. REFERENCES

**Existing Production Code:**
- `iso_worklet.js` (lfo-event branch) - LFO phase-wrap with cosine easing + duty cycle
- `binaural_worklet_jm.js` (lfo-event branch) - Continuous binaural with journey map
- `timeline_jm.js` - Timeline engine with cosine easing transitions

**Key Commits:**
- "Baseline: Cosine easing + duty cycle from lfo-event branch" (combined-worklet)
- "LFO phase-wrap triggering system" (lfo-event)

**Documentation:**
- `TIMELINE_SPEC.md` - Timeline architecture
- `WIDGET_DEVELOPMENT_GUIDE.md` - Widget patterns
- `JM_API_SPEC.md` - Journey map format

---

**END OF SPECIFICATION**

Ready to implement when approved.
