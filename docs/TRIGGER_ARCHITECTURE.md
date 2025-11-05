# Audio-Triggered Pulse Synchronization Architecture

## CONCEPT OVERVIEW

**Problem**: Keep ISO pulses synchronized with binaural beat frequency without pre-calculation or drift.

**Solution**: Use the binaural synth's L-R difference as a **timing reference signal** to trigger ISO pulses at exact zero-crossings/peaks.

---

## SIGNAL FLOW ARCHITECTURE

```
┌─────────────────────────────────────────────────────────────┐
│                    BINAURAL SYNTH                            │
│  (Master Timeline - Continuous Tone Generator)               │
└──────────────┬──────────────────────────────┬────────────────┘
               │                              │
               │ Left: carrier - (hz/2)       │ Right: carrier + (hz/2)
               │                              │
               ├──────────────────────────────┤
               │      TO AUDIO OUTPUT         │
               │   (What User Hears)          │
               └──────────────────────────────┘
                              │
                              │ (Tap point)
                              ▼
                    ┌─────────────────────┐
                    │  TIMING EXTRACTOR   │
                    │   L - R = Diff      │
                    └─────────────────────┘
                              │
                    Pure sine @ beatHz
                    (e.g., 5Hz sine wave)
                              │
                              ▼
                    ┌─────────────────────┐
                    │   PEAK DETECTOR     │
                    │ - Find zero-cross   │
                    │ - Or find peak      │
                    │ - Hysteresis        │
                    └─────────────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │   GATE/COOLDOWN     │
                    │ - Period/2 lockout  │
                    │ - Prevent retrigger │
                    └─────────────────────┘
                              │
                        TRIGGER EVENT
                              │
                              ▼
                    ┌─────────────────────┐
                    │ CONSOLE LOG (Phase 1)│
                    │  Future: ISO Trigger │
                    └─────────────────────┘
```

---

## PHASE 1: NON-DESTRUCTIVE PROOF OF CONCEPT

**Goal**: Add trigger detection WITHOUT breaking existing audio.

**Changes**:
1. Modify binaural_worklet_jm.js to calculate L-R difference
2. Add zero-crossing detection with cooldown
3. Log trigger events to console
4. Verify trigger rate matches beat Hz

**No Impact**:
- ✅ ISO worklet continues working with segment-based calculation
- ✅ Binaural audio output unchanged
- ✅ All existing functionality preserved

---

## IMPLEMENTATION STATUS

### Phase 1: Trigger Detection (IN PROGRESS)
- [ ] Add L-R difference calculation to binaural worklet
- [ ] Implement zero-crossing detector
- [ ] Add adaptive cooldown (period/2)
- [ ] Console logging of trigger events
- [ ] Test with constant Hz
- [ ] Test with transitions (2Hz→15Hz)

### Phase 2: ISO Integration (FUTURE)
- [ ] Add message passing from binaural to ISO worklet
- [ ] ISO listens for trigger events
- [ ] Dual mode: segment-based OR trigger-based
- [ ] A/B testing between modes

### Phase 3: Migration (FUTURE)
- [ ] Performance comparison
- [ ] Accuracy testing
- [ ] Decision: keep which system?
- [ ] Remove deprecated code

---

## MATHEMATICAL FOUNDATION

### Timing Reference Signal

**Binaural Output**:
- Left channel: `sin(2π * (carrier - beatHz/2) * t)`
- Right channel: `sin(2π * (carrier + beatHz/2) * t)`

**Difference Signal (L - R)**:
```
L - R = sin(2π * (carrier - beatHz/2) * t) - sin(2π * (carrier + beatHz/2) * t)
```

**Result**: Pure beatHz component (after subtraction, the carrier frequencies cancel out in the difference).

**At narrow widths**: The binaural output already modulates at beat frequency.
**At full width**: L-R difference gives clean beat frequency sine wave.

---

## TRIGGER DETECTION ALGORITHM

### Zero-Crossing Detection (Phase 1)

```javascript
let lastDiff = 0;
let cooldownCounter = 0;

for (let i = 0; i < blockSize; i++) {
  const diff = outputL[i] - outputR[i];
  
  // Cooldown active?
  if (cooldownCounter > 0) {
    cooldownCounter--;
    lastDiff = diff;
    continue;
  }
  
  // Rising edge zero-crossing?
  if (lastDiff < 0 && diff >= 0) {
    // TRIGGER DETECTED
    console.log(`🎯 Trigger @ sample ${this.currentSample + i}, beatHz=${this.currentBeatHz}`);
    
    // Cooldown = half the beat period
    const beatPeriodSamples = sampleRate / this.currentBeatHz;
    cooldownCounter = Math.floor(beatPeriodSamples / 2);
  }
  
  lastDiff = diff;
}
```

### Cooldown Calculation

**Current beat frequency**: Read from journey map segments
**Beat period**: `sampleRate / beatHz` samples
**Cooldown**: `beatPeriod / 2` samples (wait for next peak)

**Example**: 5Hz beat @ 48kHz
- Period = 48000 / 5 = 9600 samples (200ms)
- Cooldown = 4800 samples (100ms)
- Allows triggers at both positive and negative peaks

---

## CONSOLE OUTPUT FORMAT

```
🎯 Trigger @ sample 48000, beatHz=5.00, cooldown=4800 (100.00ms)
🎯 Trigger @ sample 57600, beatHz=5.00, cooldown=4800 (100.00ms)
🎯 Trigger @ sample 67200, beatHz=7.50, cooldown=3200 (66.67ms) [TRANSITION]
🎯 Trigger @ sample 73600, beatHz=10.00, cooldown=2400 (50.00ms)
```

**Fields**:
- Sample number (absolute position)
- Current beat Hz from journey map
- Cooldown period (samples and ms)
- Transition marker when Hz is changing

---

## ADVANTAGES OF THIS APPROACH

### 1. **Perfect Synchronization**
- ISO pulses triggered by **actual binaural output**
- Not calculated predictions, but real-time detection
- Impossible for them to drift apart

### 2. **Adaptive to Transitions**
- As binaural smoothly transitions 2Hz→15Hz, trigger rate adapts automatically
- Cooldown period scales with current beat frequency
- No pre-calculation of transition math needed

### 3. **Sample-Accurate Triggering**
- Trigger detected at exact zero-crossing sample
- No scheduling latency
- Future: Pulse spawns in same `process()` call

### 4. **Non-Destructive**
- Existing ISO worklet continues working
- Can A/B test both systems
- Easy rollback if issues occur

---

## NEXT STEPS

1. ✅ Document architecture (this file)
2. ⏳ Modify binaural_worklet_jm.js to add trigger detection
3. ⏳ Test with constant Hz (verify trigger rate)
4. ⏳ Test with transitions (verify adaptive cooldown)
5. ⏳ Analyze console logs for accuracy
6. ⏳ Decision: proceed to Phase 2 or adjust algorithm

---

## QUESTIONS RESOLVED

**Q1: Zero-crossing or Peak detection?**
- **A**: Zero-crossing (rising edge) for Phase 1
- Simpler, sample-accurate, no filtering needed

**Q2: What about carrier frequency interference?**
- **A**: L-R subtraction naturally cancels carrier
- Pure beat frequency remains

**Q3: Cooldown calculation method?**
- **A**: Adaptive (half current period)
- Gets current Hz from journey map every 128 samples

**Q4: Impact on existing audio?**
- **A**: Zero impact
- Only adding calculation, no audio path changes
- ISO continues using segment-based system
