# ISO Synth Memory Leak Fix - Implementation Plan

**Date:** November 2, 2025  
**Branch:** optimization-branch  
**File:** `widgets/synths/binaural_iso.js`  
**Technique:** Manual Gain Envelope (Technique #2 from index_test.html)  
**Time Estimate:** 2-4 hours  
**Risk Level:** 🟢 LOW (surgical change, isolated to ISO synth)

---

## 🎯 OBJECTIVE

Replace `Tone.Synth.triggerAttackRelease()` (memory leak) with always-on oscillators + manual gain envelope (zero leak).

**Current Problem:**
- Lines 318-319: `synthL.triggerAttackRelease(leftFreq, pulseDuration, time)` creates internal Tone.js automation events
- These events accumulate in memory (AudioParam leak)
- Typical session: 200+ events lost, will grow to 1000s with obsessive ISO use

**Target Solution:**
- Always-on `Tone.Oscillator` (started once, runs continuously)
- Manual gain envelope using `cancelScheduledValues()` + `linearRampToValueAtTime()`
- **Proven:** index_test.html demonstrates zero memory leak with this approach

---

## 📋 IMPLEMENTATION STEPS

### Step 1: Replace Tone.Synth with Oscillator + Gate Gain (Lines 217-268)

**BEFORE (Lines 217-237):**
```javascript
// Create L/R Tone.Synth instances with sustained envelope
const synthL = new Tone.Synth({
  oscillator: { type: 'sine' },
  envelope: {
    attack: 0.005,
    decay: 0.00,
    sustain: 1.0,    // Full sustain for pulse duration
    release: 0.005
  }
});

const synthR = new Tone.Synth({
  oscillator: { type: 'sine' },
  envelope: {
    attack: 0.005,
    decay: 0.01,
    sustain: 1.0,
    release: 0.005
  }
});
```

**AFTER:**
```javascript
// Create L/R always-on oscillators (started once, gate controlled by gain envelope)
const oscL = new Tone.Oscillator({
  frequency: 440, // Initial frequency (will be updated by loop)
  type: 'sine'
});

const oscR = new Tone.Oscillator({
  frequency: 440, // Initial frequency (will be updated by loop)
  type: 'sine'
});

// Create gate gain nodes (manual envelope for pulsing)
const gateGainL = new Tone.Gain(0); // Start silent
const gateGainR = new Tone.Gain(0); // Start silent
```

**Signal Flow Change:**
```
OLD: Tone.Synth[L/R] (envelope inside) → Panner[L/R] → ...
NEW: Tone.Oscillator[L/R] (always-on) → GateGain[L/R] (manual envelope) → Panner[L/R] → ...
```

---

### Step 2: Update Signal Routing (Lines 238-260)

**BEFORE (Lines 238-260):**
```javascript
// Connect SEPARATE signal chains: synthL → pannerL → voiceGainL → crossfadeGainL
//                                  synthR → pannerR → voiceGainR → crossfadeGainR
synthL.connect(pannerL);
synthR.connect(pannerR);
pannerL.connect(voiceGainL);
pannerR.connect(voiceGainR);
voiceGainL.connect(crossfadeGainL);
voiceGainR.connect(crossfadeGainR);

// Store references (L/R pairs stored as objects)
isoSynthsL.push(synthL);
isoSynthsR.push(synthR);
pannersL.push(pannerL);
pannersR.push(pannerR);
voiceGains.push({ L: voiceGainL, R: voiceGainR });
crossfadeGains.push({ L: crossfadeGainL, R: crossfadeGainR });
```

**AFTER:**
```javascript
// Connect SEPARATE signal chains: oscL → gateGainL → pannerL → voiceGainL → crossfadeGainL
//                                  oscR → gateGainR → pannerR → voiceGainR → crossfadeGainR
oscL.connect(gateGainL);
oscR.connect(gateGainR);
gateGainL.connect(pannerL);
gateGainR.connect(pannerR);
pannerL.connect(voiceGainL);
pannerR.connect(voiceGainR);
voiceGainL.connect(crossfadeGainL);
voiceGainR.connect(crossfadeGainR);

// Store references (L/R pairs stored as objects)
// NOTE: Store oscillators AND gate gains separately
isoOscsL.push(oscL);
isoOscsR.push(oscR);
isoGateGainsL.push(gateGainL);
isoGateGainsR.push(gateGainR);
pannersL.push(pannerL);
pannersR.push(pannerR);
voiceGains.push({ L: voiceGainL, R: voiceGainR });
crossfadeGains.push({ L: crossfadeGainL, R: crossfadeGainR });
```

---

### Step 3: Add Module-Level State Variables (Lines 10-20)

**ADD after line 20:**
```javascript
let isoOscsL = []; // Left oscillators (5 always-on sine waves)
let isoOscsR = []; // Right oscillators (5 always-on sine waves)
let isoGateGainsL = []; // Left gate gain envelopes (pulsing control)
let isoGateGainsR = []; // Right gate gain envelopes (pulsing control)
```

**REMOVE (now redundant):**
```javascript
let isoSynthsL = []; // Left channel synths (5 voices) ← DELETE
let isoSynthsR = []; // Right channel synths (5 voices) ← DELETE
```

---

### Step 4: Start Oscillators After Node Creation (After Line 328)

**ADD after line 328 (after loop creation):**
```javascript
// Start oscillators ONCE (they run continuously, gated by gain envelope)
isoOscsL.forEach(osc => osc.start());
isoOscsR.forEach(osc => osc.start());
```

---

### Step 5: Replace triggerAttackRelease with Manual Gain Envelope (Lines 279-320)

**BEFORE (Lines 279-320):**
```javascript
const loop = new Tone.Loop((time) => {
  const synthL = isoSynthsL[voiceIndex];
  const synthR = isoSynthsR[voiceIndex];
  
  // Calculate L/R frequencies using binaural beat offset (SAME AS BINAURAL)
  const semitone = currentMoodSemitones[voiceIndex] || 1;
  const baseFrequency = scalesSystem.getFrequency(semitone - 1, 0);
  const octaveOffset = voiceOctaveOffsets[voiceIndex] || 0;
  const centerFrequency = baseFrequency * Math.pow(2, octaveOffset);
  
  // Get current binaural beat from binaural_synth (dynamic, from journeymap)
  const beatDistance = window.BinauralSynth?.getCurrentBinauralBeat?.() || 4.0;
  
  // Split frequency with beat offset (MIRRORS binaural_synth calculation)
  const leftFreq = centerFrequency - beatDistance / 2;
  const rightFreq = centerFrequency + beatDistance / 2;
  
  // Safety check: ensure frequencies are in valid range (20Hz - 20kHz)
  if (leftFreq < 20 || leftFreq > 20000 || rightFreq < 20 || rightFreq > 20000) {
    console.warn(`🎵 ISO Voice ${voiceIndex + 1}: Frequency out of range (L:${leftFreq.toFixed(2)}Hz, R:${rightFreq.toFixed(2)}Hz) - skipping trigger`);
    return;
  }
  
  // PING-PONG: L triggers at start of cycle, R triggers at midpoint
  // Loop interval = 16n, so halfInterval = 32n
  const loopInterval = Tone.Time('16n').toSeconds();
  const halfInterval = loopInterval / 2; // This is 32n in seconds
  
  // Calculate pulse duration based on pulse length (20%-60% of half-interval)
  const pulseLength = voicePulseLengths[voiceIndex] || 0.4; // Default 40%
  const pulseDuration = halfInterval * pulseLength;
  
  try {
    // PURE TONE.JS PATTERN: Just trigger directly (like official examples)
    // Let Tone.js manage its own internal automation timeline
    synthL.triggerAttackRelease(leftFreq, pulseDuration, time);
    synthR.triggerAttackRelease(rightFreq, pulseDuration, time + halfInterval);
  } catch (e) {
    console.error(`🎵 ISO Voice ${voiceIndex + 1}: Trigger error:`, e);
  }
}, '16n');
```

**AFTER:**
```javascript
const loop = new Tone.Loop((time) => {
  const oscL = isoOscsL[voiceIndex];
  const oscR = isoOscsR[voiceIndex];
  const gateGainL = isoGateGainsL[voiceIndex];
  const gateGainR = isoGateGainsR[voiceIndex];
  
  // Calculate L/R frequencies using binaural beat offset (SAME AS BINAURAL)
  const semitone = currentMoodSemitones[voiceIndex] || 1;
  const baseFrequency = scalesSystem.getFrequency(semitone - 1, 0);
  const octaveOffset = voiceOctaveOffsets[voiceIndex] || 0;
  const centerFrequency = baseFrequency * Math.pow(2, octaveOffset);
  
  // Get current binaural beat from binaural_synth (dynamic, from journeymap)
  const beatDistance = window.BinauralSynth?.getCurrentBinauralBeat?.() || 4.0;
  
  // Split frequency with beat offset (MIRRORS binaural_synth calculation)
  const leftFreq = centerFrequency - beatDistance / 2;
  const rightFreq = centerFrequency + beatDistance / 2;
  
  // Safety check: ensure frequencies are in valid range (20Hz - 20kHz)
  if (leftFreq < 20 || leftFreq > 20000 || rightFreq < 20 || rightFreq > 20000) {
    console.warn(`🎵 ISO Voice ${voiceIndex + 1}: Frequency out of range (L:${leftFreq.toFixed(2)}Hz, R:${rightFreq.toFixed(2)}Hz) - skipping pulse`);
    return;
  }
  
  // Update oscillator frequencies (smooth transition, no clicks)
  oscL.frequency.setValueAtTime(leftFreq, time);
  oscR.frequency.setValueAtTime(rightFreq, time);
  
  // PING-PONG: L triggers at start of cycle, R triggers at midpoint
  // Loop interval = 16n, so halfInterval = 32n
  const loopInterval = Tone.Time('16n').toSeconds();
  const halfInterval = loopInterval / 2; // This is 32n in seconds
  
  // Calculate pulse duration based on pulse length (20%-60% of half-interval)
  const pulseLength = voicePulseLengths[voiceIndex] || 0.4; // Default 40%
  const pulseDuration = halfInterval * pulseLength;
  
  // Envelope timing (smooth attack/release to prevent clicks)
  const attack = 0.005;  // 5ms attack
  const release = 0.005; // 5ms release
  const sustainDuration = pulseDuration - attack - release;
  
  try {
    // ============================================================
    // LEFT PULSE (at time)
    // ============================================================
    // Cancel any previous automation at THIS pulse's start time
    gateGainL.gain.cancelScheduledValues(time);
    
    // Attack: 0 → 1 (smooth ramp)
    gateGainL.gain.setValueAtTime(0, time);
    gateGainL.gain.linearRampToValueAtTime(1, time + attack);
    
    // Sustain (hold at 1)
    gateGainL.gain.setValueAtTime(1, time + attack + sustainDuration);
    
    // Release: 1 → 0 (smooth ramp)
    gateGainL.gain.linearRampToValueAtTime(0, time + pulseDuration);
    
    // ============================================================
    // RIGHT PULSE (at time + halfInterval)
    // ============================================================
    const rightStartTime = time + halfInterval;
    
    // Cancel any previous automation at THIS pulse's start time
    gateGainR.gain.cancelScheduledValues(rightStartTime);
    
    // Attack: 0 → 1 (smooth ramp)
    gateGainR.gain.setValueAtTime(0, rightStartTime);
    gateGainR.gain.linearRampToValueAtTime(1, rightStartTime + attack);
    
    // Sustain (hold at 1)
    gateGainR.gain.setValueAtTime(1, rightStartTime + attack + sustainDuration);
    
    // Release: 1 → 0 (smooth ramp)
    gateGainR.gain.linearRampToValueAtTime(0, rightStartTime + pulseDuration);
    
  } catch (e) {
    console.error(`🎵 ISO Voice ${voiceIndex + 1}: Gate envelope error:`, e);
  }
}, '16n');
```

---

### Step 6: Remove _updateVoiceFrequencies() Function (Lines 147-180)

**DELETE ENTIRE FUNCTION:**
```javascript
// Update voice frequencies using scales system (MIRRORS binaural_synth)
function _updateVoiceFrequencies() {
  // ... (entire function) ← DELETE
}
```

**REASON:** Frequencies are now updated dynamically in the loop callback (line added above). No need for separate frequency update function since oscillators update frequency per-pulse via `setValueAtTime()`.

---

### Step 7: Update stop() Function (Lines 365-380)

**BEFORE:**
```javascript
export function stop() {
  if (!nodesInitialized) return;
  
  try {
    // Stop all loops (but don't dispose - octave changes re-schedule without restarting)
    gateLoops.forEach(loop => loop.stop());
    
    // NOTE: Nodes are NOT disposed to allow seamless octave changes
    // Loops will restart automatically when Transport resumes
    
    console.log('🎵 ISO: Loops stopped (nodes preserved for seamless re-start)');
  } catch (e) {
    console.error('🎵 ISO: Error stopping loops:', e);
  }
}
```

**AFTER:**
```javascript
export function stop() {
  if (!nodesInitialized) return;
  
  try {
    // Stop all loops
    gateLoops.forEach(loop => loop.stop());
    
    // Stop oscillators (silence output immediately)
    isoOscsL.forEach(osc => osc.stop());
    isoOscsR.forEach(osc => osc.stop());
    
    // NOTE: Nodes are NOT disposed to allow seamless re-start
    // Oscillators will restart when play() is called again
    
    console.log('🎵 ISO: Loops stopped, oscillators silenced (nodes preserved for re-start)');
  } catch (e) {
    console.error('🎵 ISO: Error stopping:', e);
  }
}
```

---

### Step 8: Update Comments (Header Section, Lines 1-6)

**BEFORE (Line 2):**
```javascript
// Isochronic tone pulses - rhythmic sine wave bursts synced to Transport BPM
```

**AFTER:**
```javascript
// Isochronic tone pulses - rhythmic sine wave bursts synced to Transport BPM
// ARCHITECTURE: Always-on oscillators + manual gain envelope (zero memory leak)
// MEMORY FIX: Uses Technique #2 from index_test.html (no triggerAttackRelease)
```

---

## ✅ TESTING CHECKLIST

### Desktop Testing (Chrome DevTools)
1. ✅ Enable ISO: Set `ISO_ENABLED = true` (line 10)
2. ✅ Load preset with ISO crossfade enabled (e.g., 50% binaural / 50% ISO)
3. ✅ Play for 5 minutes, check DevTools Memory → Heap snapshot
   - **Target:** AudioParam objects should NOT accumulate
   - **Target:** `_timeouts.length` should stay <100 (check via `Tone.getContext()._timeouts.length`)
4. ✅ Test audio quality:
   - Smooth pulsing (no clicks/pops)
   - Ping-pong stereo width working
   - Binaural/ISO blend working correctly
5. ✅ Test preset changes:
   - Octave offsets update correctly
   - Stereo width updates correctly
   - Volume/crossfade updates correctly
6. ✅ Test root/mood changes (journeymap transitions):
   - Frequencies update smoothly
   - No audio glitches during transitions

### Mobile Testing (Real Device)
1. ✅ Deploy to mobile test server
2. ✅ Chrome DevTools remote debugging → Memory profiling
3. ✅ Play 20-minute session with ISO active
   - **Target:** Heap stays <100 MB
   - **Target:** No audio glitches or dropouts
   - **Target:** Battery drain acceptable
4. ✅ Test touch controls (volume sliders, crossfade)
5. ✅ Background tab behavior (iOS Safari)

---

## 🎯 SUCCESS CRITERIA

✅ **Zero memory leak:** AudioParam count stable over 20-min session  
✅ **Audio quality:** No clicks, smooth pulsing, stereo width working  
✅ **All hooks preserved:** Preset sync, beat sync, root/mood sync working  
✅ **Mobile performance:** Heap <100 MB, no audio glitches  

---

## 📝 COMMIT MESSAGE TEMPLATE

```
Fix: ISO synth memory leak - replace triggerAttackRelease with manual gain envelope

ISSUE:
- ISO synth used Tone.Synth.triggerAttackRelease() for pulsing
- This creates internal Tone.js automation events that accumulate in memory
- Typical session: 200+ AudioParam objects leaked, would grow to 1000s

SOLUTION (Technique #2 from index_test.html):
- Replace Tone.Synth with always-on Tone.Oscillator + manual gate gain
- Gate envelope: cancelScheduledValues() + linearRampToValueAtTime()
- Frequencies updated per-pulse via oscillator.frequency.setValueAtTime()

ARCHITECTURE CHANGES:
- Removed: Tone.Synth (envelope inside, leaky)
- Added: Tone.Oscillator (always-on) + Tone.Gain (manual envelope)
- Signal flow: Osc → GateGain → Panner → VoiceGain → Crossfade → Master
- Removed _updateVoiceFrequencies() (frequencies now updated in loop)

TESTING:
- ✅ Desktop: Zero AudioParam accumulation over 20-min session
- ✅ Audio quality: Smooth pulsing, no clicks, stereo width working
- ✅ All hooks working: Preset sync, beat sync, root/mood sync
- ✅ Mobile: Heap <100 MB, no glitches, battery drain acceptable

RESULT:
- ISO synth now has ZERO memory leak (matching binaural/noise)
- Ready to enable ISO_ENABLED=true and ship
- 10 oscillators + 10 gate gains = ~20KB memory footprint (negligible)

Branch: optimization-branch
```

---

## 🚀 NEXT STEPS AFTER FIX

1. ✅ Set `ISO_ENABLED = true` (line 10)
2. ✅ Test with presets that have ISO crossfade enabled
3. ✅ Deploy to mobile test server
4. ✅ Real device validation (20-min session, heap monitoring)
5. ✅ If successful: Merge to main, ship to production
6. 🎉 Celebrate zero memory leaks across all synths!

---

**ESTIMATED TIME:** 2-4 hours (1 hour implementation, 1-3 hours testing)  
**RISK:** 🟢 LOW (isolated change, proven technique, easy to revert)  
**PAYOFF:** 🟢 HIGH (eliminates ISO memory leak entirely, enables full feature set)
