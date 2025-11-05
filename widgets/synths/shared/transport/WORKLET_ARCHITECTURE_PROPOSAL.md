# Worklet-Based Timeline Architecture Proposal

## Problem Statement

Current architecture has **dual scheduling systems fighting each other**:
- `timeline_jm.js` calculates pulse times using trapezoidal integration
- Hz automation runs independently via Web Audio automation
- These drift apart due to different timing precision

**Result**: Hz and pulse events get badly out of sync.

## Proposed Solution

**Send journey map structure to worklets, let them calculate everything sample-accurately.**

---

## New Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ MAIN THREAD (index.html + timeline_jm.js)                   │
│                                                               │
│ • Store journey map structure (segments array)               │
│ • Handle UI, user jumps to different positions              │
│ • Send segment data + start position to worklets            │
│ • Receive status updates from worklets                      │
└────────────────┬────────────────────────────────────────────┘
                 │
                 │ postMessage({ 
                 │   type: 'loadJourneyMap',
                 │   segments: [...],
                 │   startPosition: 0
                 │ })
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ AUDIO RENDERING THREAD (Worklets)                           │
│                                                               │
│ • Receive journey map segments                               │
│ • Calculate Hz values per-sample                             │
│ • Calculate pulse trigger times sample-accurately           │
│ • Generate audio output                                      │
│ • Can restart from any segment position                     │
└─────────────────────────────────────────────────────────────┘
```

---

## Journey Map Format (Sent to Worklet)

```javascript
{
  type: 'loadJourneyMap',
  segments: [
    {
      type: 'plateau',
      hz: 2.0,
      durationSeconds: 180,    // 3 minutes
      index: 0
    },
    {
      type: 'transition',
      startHz: 2.0,
      endHz: 15.0,
      durationSeconds: 180,    // 3 minutes
      index: 1
    },
    {
      type: 'plateau',
      hz: 15.0,
      durationSeconds: 900,    // 15 minutes
      index: 2
    },
    {
      type: 'transition',
      startHz: 15.0,
      endHz: 5.0,
      durationSeconds: 180,    // 3 minutes
      index: 3
    },
    {
      type: 'plateau',
      hz: 5.0,
      durationSeconds: 180,    // 3 minutes
      index: 4
    }
  ],
  sampleRate: 48000,
  carrierFrequency: 110,
  startPositionSeconds: 0      // Jump-to capability
}
```

---

## Worklet Responsibilities

### 1. **Hz Calculation (Per-Sample)**

```javascript
getHzAtSample(samplePosition) {
  const timelineSeconds = samplePosition / this.sampleRate;
  const segment = this.findSegmentAt(timelineSeconds);
  
  if (segment.type === 'plateau') {
    return segment.hz;
  }
  
  if (segment.type === 'transition') {
    const segmentProgress = (timelineSeconds - segment.startTime) / segment.duration;
    return segment.startHz + (segment.endHz - segment.startHz) * segmentProgress;
  }
}
```

### 2. **Pulse Triggering (Sample-Accurate)**

```javascript
process(inputs, outputs, parameters) {
  // CONFIGURABLE: Check granularity (128, 64, 32, or 1 sample)
  // Adjust this.pulseCheckInterval if audio interruptions occur
  const checkInterval = this.pulseCheckInterval; // Default: 128
  
  for (let i = 0; i < 128; i += checkInterval) {
    const currentSample = this.currentSample + i;
    
    // Should we trigger a pulse?
    if (currentSample >= this.nextPulseSample) {
      this.triggerPulse(currentSample);
      
      // Calculate next pulse using current Hz
      const currentHz = this.getHzAtSample(currentSample);
      const interval32n = (0.5 / currentHz) * this.sampleRate;
      this.nextPulseSample = currentSample + Math.round(interval32n);
    }
    
    // Generate audio for this sample...
  }
  
  this.currentSample += 128;
}
```

**Note on Check Granularity**:
- Default: Check every 128 samples (full quantum)
- If pulse interruptions occur (e.g., 25Hz purr getting cut off), reduce to 64, 32, or even 1
- Lower values = more CPU, but more responsive triggering
- Trigger precision is always 1-sample accurate regardless of check interval

### 3. **Random Access (Jump to Position)**

```javascript
{
  type: 'seek',
  positionSeconds: 180  // Jump to 3:00 (start of plateau 2)
}

// Worklet handles:
handleSeek(positionSeconds) {
  this.currentSample = Math.round(positionSeconds * this.sampleRate);
  const currentHz = this.getHzAtSample(this.currentSample);
  const interval32n = (0.5 / currentHz) * this.sampleRate;
  this.nextPulseSample = this.currentSample + Math.round(interval32n);
  
  // Reset all voices (fade out quickly to avoid clicks)
  this.voices.forEach(v => v.quickRelease());
}
```

---

## Benefits

### 1. **Single Source of Truth**
- Worklet calculates BOTH Hz and pulses from same segment data
- No drift between Hz automation and pulse timing
- Sample-accurate synchronization guaranteed

### 2. **Perfect Alignment**
- Minute-aligned segments (180s, 900s) = simpler math
- No accumulated floating-point error
- Clean transition boundaries

### 3. **Random Access**
- Click on plateau 2 → worklet recalculates from that point
- No need to rebuild entire schedule
- Instant response

### 4. **Memory Efficient**
- Store 5 segments instead of 300 pre-calculated pulses
- Journey map: ~500 bytes
- Pre-calculated schedule: ~20KB

### 5. **Dynamic Updates**
- User changes plateau 2 Hz → send new segment data
- Worklet recalculates on the fly
- No timeline restart required (unless desired)

---

## File Structure Proposal

```
widgets/synths/shared/
├── transport/
│   ├── timeline_jm.js              (NEW: Simplified - stores segments, handles UI)
│   ├── jm_worklet_helper.js        (NEW: Helper functions for worklet Hz calculation)
│   └── WORKLET_ARCHITECTURE_PROPOSAL.md  (This file)
└── ...
```

### Option A: `transport/jm_worklet_helper.js`
**Rationale**: Timeline is part of transport mechanism, helper preprocesses for worklets

### Option B: `shared/jm_worklet_helper.js`
**Rationale**: Worklets are synths, this is a synth function

**Recommendation**: **Option A (transport/)** - The journey map IS the transport system, and this helper enables worklet integration.

---

## Implementation Plan

### Phase 1: Create Helper Functions
- `jm_worklet_helper.js` with pure functions for Hz calculation
- Can be imported by worklets (or copied inline)
- Unit testable

### Phase 2: Update ISO Worklet
- Receive journey map via postMessage
- Calculate pulses on-demand instead of pre-schedule
- Calculate Hz per-sample for frequency split

### Phase 3: Simplify timeline_jm.js
- Remove `compileForWorklet()` method
- Remove pulse scheduling logic
- Keep segment storage and UI layer

### Phase 4: Add Random Access
- UI for clicking on segments
- Send seek messages to worklets
- Test glitch-free position changes

---

## Open Questions

1. **Should worklets share helper code?**
   - Option A: Copy helper functions into each worklet (self-contained)
   - Option B: Import helper module (requires module support in worklets)
   - **Recommendation**: Copy inline for now (simpler, more portable)

2. **How to handle worklet initialization?**
   ```javascript
   // Send journey map immediately after worklet loads
   await audioContext.audioWorklet.addModule('iso_worklet.js');
   const workletNode = new AudioWorkletNode(audioContext, 'iso-pulse-processor');
   workletNode.port.postMessage({
     type: 'loadJourneyMap',
     segments: timeline.segments,
     sampleRate: audioContext.sampleRate,
     carrierFrequency: 110,
     startPositionSeconds: 0
   });
   ```

3. **Emit pulse events back to main thread?**
   - For UI updates, blinking, etc.?
   - **Recommendation**: YES, send `{ type: 'pulse', samplePosition, hz }` back
   - Main thread can update UI without affecting audio timing

4. **Memory for long sessions?**
   - 30-minute journey = 5 segments ≈ 500 bytes
   - MUCH smaller than pre-calculated schedule
   - **No concerns**

---

## Pattern Match: Tone.js TickParam

This is similar to Tone.js automation:
- Store curve points (plateau/transition segments)
- Calculate values on-demand during rendering
- No pre-calculated schedules

We're applying the same pattern to pulse timing.

---

## Next Steps

**YOU DECIDE**:
1. Should I create `jm_worklet_helper.js` with the helper functions?
2. Should I prototype this in `iso_worklet.js` alongside current system?
3. Any changes to the journey map format before we commit?

**Your constraints met**:
- ✅ Journey maps in minutes (180s segments)
- ✅ Transitions on minute boundaries
- ✅ Worklets pre-calculate from journey map
- ✅ Interruptible (random access via seek messages)
- ✅ Updates possible (send new segment data)
- ✅ Super accurate (sample-level precision)

---

## Expected Outcome

**Hz and pulses will NEVER drift apart** because they're calculated from the same segment data in the same audio frame.

**Random access works** because worklet can recalculate state from any starting position.

**Timeline becomes simple** - just stores segments and passes them to worklets.
