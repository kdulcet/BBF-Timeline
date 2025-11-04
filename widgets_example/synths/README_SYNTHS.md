# SYNTH ARCHITECTURE REFERENCE

**Status**: Reference documentation for all synth implementations  
**Last Updated**: October 21, 2025  
**Purpose**: Blueprint for building consistent, reliable audio engines

---

## 📖 **OVERVIEW**

`binaural_synth.js` and `isochronic_synth.js` are the **CROWNING ACHIEVEMENTS** of the Auramatrix audio system. They represent working, battle-tested implementations of the synth architecture and serve as the **MODEL FOR ALL FUTURE SYNTHS**.

These synths are:
- ✅ **Bug-free** (as far as we can tell)
- ✅ **Reliably working** in production
- ✅ **Well-documented** with Tone.js integration details
- ✅ **Event-driven** with clean MVC separation
- ✅ **Consistent** in API and architecture

---

## 🏗️ **CORE ARCHITECTURE**

### **MVC Pattern (MODEL Layer)**

All synths follow strict MODEL-only architecture:
- **NO DOM ACCESS** - Zero querySelector, zero HTML interaction
- **EVENT-DRIVEN** - Listens for widget/preset/journeymap events
- **STATE STORAGE** - Arrays store parameters before nodes exist
- **PURE AUDIO** - Only Tone.js and Web Audio API

```
┌──────────────────────────────────────────────────────────┐
│                     SYNTH LAYER (MODEL)                  │
│                                                          │
│  - Tone.js audio graph (oscillators, gains, panners)    │
│  - State arrays (volumes, octaves, widths)              │
│  - Event listeners (preset, journeymap, transport)      │
│  - Public API (setters, getters, scheduling)            │
└──────────────────────────────────────────────────────────┘
         ▲                                        │
         │ Events                                 │ API Calls
         │                                        ▼
┌──────────────────────────────────────────────────────────┐
│                   WIDGET LAYER (VIEW)                    │
│                                                          │
│  - DOM interaction (faders, buttons, selectors)         │
│  - User input handling (drag, click, keyboard)          │
│  - Fire events to synth (preset loaded, value changed)  │
└──────────────────────────────────────────────────────────┘
```

---

## 🎚️ **TWO-STAGE GAIN ARCHITECTURE**

**CRITICAL PATTERN** - All synths use two-stage volume control:

```
┌─────────────┐     ┌───────────────┐     ┌──────────────┐     ┌─────────────┐
│ Oscillators │────▶│ Stage 1: Fader│────▶│ Stage 2: ISO │────▶│ Master Gain │
│ (L/R pairs) │     │ (voice volume)│     │ (crossfade)  │     │ (headroom)  │
└─────────────┘     └───────────────┘     └──────────────┘     └─────────────┘
                           -70 to 0dB          -∞ to 0dB           0.5 (-6dB)
```

### **Why Two Stages?**

1. **Stage 1 (Voice Fader)**: User's main volume control per voice
   - Range: -70dB (silent) to 0dB (full)
   - Set by: User dragging fader, preset loading
   - Purpose: Individual voice mix balance

2. **Stage 2 (ISO Crossfade)**: Binaural/Isochronic blend
   - Range: -∞dB (silent) to 0dB (full presence)
   - Set by: ISO fader position in preset
   - Purpose: Crossfade between binaural (continuous) and isochronic (rhythmic)

3. **Master Gain**: Headroom for mixing 5 voices
   - Fixed: 0.5 linear = -6dB (binaural), 0.7 = -3dB (isochronic)
   - Purpose: Prevent clipping when all voices at full volume

---

## 🎵 **TONE.JS INTEGRATION PATTERNS**

### **Audio Nodes Used**

#### **Tone.Oscillator** (Binaural Synth)
```javascript
const leftOsc = new Tone.Oscillator(0, "sine");
const rightOsc = new Tone.Oscillator(0, "sine");

// Characteristics:
// - Continuous playback (start once, run until stop)
// - Frequency automation via .setValueAtTime() and .linearRampToValueAtTime()
// - Must be started explicitly on Transport.on('start')
// - Cannot be restarted after stop (requires disposal and recreation)
```

#### **Tone.Synth** (Isochronic Synth)
```javascript
const synth = new Tone.Synth({
  oscillator: { type: 'sine' },
  envelope: {
    attack: 0.005,   // Fast attack (5ms)
    decay: 0.00,     // No decay
    sustain: 1.0,    // Full sustain
    release: 0.005   // Fast release (5ms)
  }
});

// Characteristics:
// - Triggered playback (note on/off events)
// - Envelope shapes each note
// - Used with Tone.Loop for rhythmic patterns
// - Can be retriggered repeatedly without recreation
```

#### **Tone.Panner** (Stereo Positioning)
```javascript
const pannerL = new Tone.Panner(-1.0); // Full left
const pannerR = new Tone.Panner(1.0);  // Full right

// Characteristics:
// - Range: -1 (left) to +1 (right)
// - Direct property assignment: panner.pan.value = -0.5
// - Used for stereo width control (width=0 → mono, width=1 → full stereo)
```

#### **Tone.Gain** (Volume Control)
```javascript
const gain = new Tone.Gain(volumeDb, "decibels");

// Set volume smoothly:
gain.gain.rampTo(newVolumeDb, 0.05, "+0", "decibels");
//               ↑value     ↑time  ↑when  ↑units
//               -70 to 0   50ms   now    dB (logarithmic)

// Characteristics:
// - Supports dB units (logarithmic, matches human perception)
// - .rampTo() creates smooth transitions (no clicks/pops)
// - time: 0.05s = 50ms (fast enough to feel responsive, slow enough to be smooth)
// - startTime: "+0" = start ramp immediately
```

#### **Tone.Loop** (Rhythmic Scheduling)
```javascript
const loop = new Tone.Loop((time) => {
  synth.triggerAttackRelease(frequency, duration, time);
}, '16n'); // Interval: 16th note

loop.start(0); // Start from Transport.seconds

// Characteristics:
// - Automatically synced to Transport BPM
// - Musical time notation: '16n' (16th), '8n' (8th), '4n' (quarter)
// - Callback receives precise time for scheduling
// - Can be stopped and restarted without disposal
```

### **Frequency Automation**

#### **Binaural: Continuous Automation**
```javascript
// First segment: Set start frequency (no ramp)
leftOsc.frequency.setValueAtTime(startFreq, startTime);

// Subsequent segments: Ramp to end frequency
leftOsc.frequency.linearRampToValueAtTime(endFreq, endTime);

// Creates smooth automation curve over timeline
// Used for: Journeymap frequency changes
```

#### **Isochronic: Per-Trigger Calculation**
```javascript
// Loop callback recalculates frequency dynamically
const loop = new Tone.Loop((time) => {
  const currentHz = window.BinauralSynth.getCurrentBinauralBeat();
  const frequency = calculateFrequency(currentHz, octave, mood);
  
  synth.triggerAttackRelease(frequency, duration, time);
}, '16n');

// Frequencies update automatically on each trigger
// Used for: Rhythmic pulses that track binaural changes
```

---

## 🔄 **EVENT-DRIVEN ARCHITECTURE**

### **Event Flow**

```
User Action (Widget Layer)
    ↓
Custom Event Fired
    ↓
Synth Listener Catches Event
    ↓
Synth Updates Internal State
    ↓
Tone.js Nodes Respond
    ↓
Audio Output Changes
```

### **Events Used**

#### **1. `binauralPresetChanged`**
```javascript
window.addEventListener('binauralPresetChanged', (event) => {
  const presetData = event.detail?.presetData;
  // Apply: volume, octave, width, crossfade, dutycycle
});
```
**Fired by**: `binaural_presets.js` when user selects preset  
**Caught by**: Both binaural_synth and isochronic_synth  
**Purpose**: Apply preset parameters to audio nodes

#### **2. `journeymapRestart`**
```javascript
window.addEventListener('journeymapRestart', (event) => {
  const timeline = event.detail?.timeline;
  // Re-schedule frequency automation
});
```
**Fired by**: `journeymap_widget.js` when user drags journeymap or changes octaves  
**Caught by**: `binaural_synth.js` (schedules automation), `isochronic_synth.js` (restarts loops)  
**Purpose**: Update timeline playback with new parameters

#### **3. `transportPlay` / `transportStop`**
```javascript
window.addEventListener('transportPlay', async () => {
  await play(); // Initialize nodes, start audio
});
```
**Fired by**: `transport_widget.js` when user presses play/stop  
**Caught by**: Both synths  
**Purpose**: Control playback state

#### **4. `Transport.on('start')` (Tone.js Native)**
```javascript
Tone.Transport.on('start', () => {
  leftOscs.forEach(osc => osc.start()); // Start oscillators
});
```
**Fired by**: Tone.js when Transport.start() called  
**Caught by**: `binaural_synth.js` (oscillators need explicit start)  
**Purpose**: Tie oscillator lifecycle to Transport state

---

## 📦 **STATE MANAGEMENT PATTERN**

### **State Before Nodes Exist**

Synths can receive events BEFORE audio nodes are created (e.g., preset loaded during page initialization). State arrays store values for later application:

```javascript
// State arrays (exist immediately at module load)
let voiceVolumes = [-70, -70, -70, -70, -70];
let voiceOctaveOffsets = [0, 0, 0, 0, 0];
let voiceWidths = [1.0, 1.0, 1.0, 1.0, 1.0];

// Pending preset data
let pendingPresetData = null;

// Event arrives BEFORE nodes exist
window.addEventListener('binauralPresetChanged', (event) => {
  if (!nodesInitialized) {
    pendingPresetData = event.detail.presetData; // Store for later
    return;
  }
  _applyPresetToVoices(event.detail.presetData);
});

// Nodes created on first play
async function _ensureNodes() {
  // Create oscillators, panners, gains...
  
  // Apply stored state to new nodes
  for (let i = 0; i < 5; i++) {
    voiceGains[i] = new Tone.Gain(voiceVolumes[i], "decibels"); // Use stored value
    pannersL[i] = new Tone.Panner(-voiceWidths[i]); // Use stored value
  }
  
  // Apply pending preset
  if (pendingPresetData) {
    _applyPresetToVoices(pendingPresetData);
    pendingPresetData = null;
  }
}
```

**Why This Matters**:
- Events can fire during page load (before user presses play)
- Presets must be ready when audio starts
- No race conditions or "preset not applied" bugs

---

## 🎛️ **API PATTERNS**

### **Public API Structure**

Every synth exports a consistent set of functions:

#### **Lifecycle**
```javascript
export async function initializeNodes() // Create Tone.js graph
export async function play()            // Start playback (isochronic only)
export function stop()                  // Stop and dispose nodes
export function getIsPlaying()          // Check playback state (binaural only)
```

#### **Global Parameters** (Shared State)
```javascript
export function setCarrierFrequency(hz)     // Root key (e.g., 196Hz = G3)
export function getCarrierFrequency()
export function setMoodSemitones(array)     // [1,4,7,11,14] = Radiance
export function getMoodSemitones()
export function setBinauralBeat(hz)         // Binaural beat distance (binaural only)
export function getBinauralBeat()
export function getCurrentBinauralBeat()    // Read actual beat from oscillators
```

#### **Per-Voice Parameters**
```javascript
export function setVoiceOctaveOffset(index, offset)  // -2 to +2
export function getVoiceOctaveOffsets()
export function setVoiceWidth(index, width)          // 0.0 to 1.0
export function getVoiceWidth(index)
export function setVoiceVolume(index, db)            // Stage 1 gain
export function setCrossfadeGain(index, db)          // Stage 2 gain
export function setPulseLength(index, ratio)         // 0.2 to 0.6 (isochronic only)
```

#### **Scheduling** (Binaural Only)
```javascript
export function scheduleVoiceFrequencies(
  voiceFrequencies, // [{voiceIndex, leftFreq, rightFreq, leftEnd, rightEnd}, ...]
  time,             // Start time (Transport seconds)
  duration,         // Segment duration (seconds)
  envelopeType,     // 'linear' or 'exponential'
  isFirstSegment    // true = setValueAtTime, false = rampTo
)
```

### **Global Exposure**

Key functions exposed on `window` for cross-widget communication:

```javascript
// Binaural
window.BinauralSynth.setBinauralBeat()
window.BinauralSynth.getBinauralBeat()
window.BinauralSynth.getCurrentBinauralBeat() // ← Used by isochronic
window.BinauralSynth.setCarrierFrequency()
window.BinauralSynth.getCarrierFrequency()

// Isochronic
window.IsochronicSynth.setCarrierFrequency()
window.IsochronicSynth.getCarrierFrequency()
window.IsochronicSynth.setMoodSemitones()
window.IsochronicSynth.getMoodSemitones()
```

**Why Global Exposure?**  
Isochronic synth needs to read binaural beat value dynamically without importing the module. This avoids circular dependencies and keeps synths decoupled.

---

## 🔍 **BINAURAL VS ISOCHRONIC: KEY DIFFERENCES**

| Aspect | Binaural Synth | Isochronic Synth |
|--------|----------------|------------------|
| **Audio Node** | `Tone.Oscillator` | `Tone.Synth` |
| **Playback** | Continuous (start once) | Triggered (loop callbacks) |
| **Frequency Control** | Automated ramping | Per-trigger calculation |
| **Stereo** | L/R offset (binaural beat) | L/R ping-pong (timing offset) |
| **Timing** | Transport automation curves | Tone.Loop with 16n interval |
| **Disposal** | Must dispose on stop | Preserved across stop/start |
| **Use Case** | Smooth frequency journeys | Rhythmic pulsing |
| **Core API** | `scheduleVoiceFrequencies()` | Loop callback (internal) |

---

## 📐 **JUST INTONATION SYSTEM**

Both synths use `window.Scales` for harmonic frequency calculation:

```javascript
// Initialize scales system
scalesSystem = new window.Scales();
scalesSystem.setScale('just');            // Just intonation (pure ratios)
scalesSystem.setBaseFrequency(196.00);    // Root key (G3)

// Calculate frequency for mood semitone
const semitone = 7; // Example: 7th semitone in scale
const baseFrequency = scalesSystem.getFrequency(semitone - 1, 0);
// Returns: 294Hz (perfect fifth above 196Hz in just intonation)

// Apply octave offset
const octaveOffset = 1; // One octave up
const frequency = baseFrequency * Math.pow(2, octaveOffset);
// Returns: 588Hz (294Hz × 2)

// Apply binaural beat offset
const binauralBeat = 4.0; // 4Hz alpha wave
const leftFreq = frequency - binauralBeat / 2;   // 586Hz
const rightFreq = frequency + binauralBeat / 2;  // 590Hz
```

**Mood Semitone Arrays**:
```javascript
const moods = {
  'Radiance': [1, 4, 7, 11, 14],  // Major-ish, uplifting
  'Depth': [1, 3, 7, 10, 14],     // Minor-ish, introspective
  'Stillness': [1, 5, 7, 12, 14]  // Open, meditative
};
```

---

## 🚀 **ADDING A NEW SYNTH**

Use binaural/isochronic as templates. Follow this checklist:

### **1. File Structure**
```
widgets/
  synths/
    your_synth.js          ← MODEL (pure audio)
  js/
    your_widget.js         ← VIEW (UI interaction)
  presets/
    your_presets.js        ← CONTROLLER (preset I/O)
  panels/
    your_panel.html        ← HTML template
  styles/
    your_synth.css         ← Pure CSS styles
```

### **2. Module Header**
```javascript
// ============================================================================
// YOUR_SYNTH - Brief Description
// ============================================================================
// Pure audio MODEL - no DOM access, event-driven architecture
//
// ARCHITECTURE:
// - Describe voice structure
// - Explain unique features
// - List Tone.js nodes used
//
// TONE.JS INTEGRATION:
// - Document which Tone.js classes/methods used
// - Explain timing/scheduling approach
// ============================================================================
```

### **3. State Arrays**
```javascript
// Voice parameters (set by presets, controlled by widgets)
let voiceVolumes = [-70, -70, -70, -70, -70];
let voiceOctaveOffsets = [0, 0, 0, 0, 0];
// ... add synth-specific params

// Tone.js nodes (created on play, disposed on stop)
let ToneLib = null;
let nodes = [];
let nodesInitialized = false;
```

### **4. Event Listeners** (Set up immediately)
```javascript
_setupTransportListener();
_setupPresetListener();
// ... add synth-specific listeners

function _setupTransportListener() {
  window.addEventListener('transportPlay', async () => {
    await play();
  });
  
  window.addEventListener('transportStop', () => {
    stop();
  });
}
```

### **5. Audio Node Creation**
```javascript
async function _ensureNodes() {
  if (nodesInitialized) return;
  
  // Get Tone.js
  if (!ToneLib) {
    if (!window.Tone) {
      console.error('Tone.js not available');
      return false;
    }
    ToneLib = window.Tone;
  }
  const Tone = ToneLib;
  
  // Create Tone.js audio graph
  for (let i = 0; i < voiceCount; i++) {
    // Create nodes...
    // Use stored state arrays for initial values
    // Connect signal chain
    // Store references
  }
  
  // Master output
  masterGain = new Tone.Gain(headroom);
  // Connect all voices to master
  masterGain.toDestination();
  
  nodesInitialized = true;
  
  // Apply pending preset data
  if (pendingPresetData) {
    _applyPresetToVoices(pendingPresetData);
    pendingPresetData = null;
  }
}
```

### **6. Public API**
```javascript
// Lifecycle
export async function initializeNodes() { ... }
export function stop() { ... }

// Global parameters
export function setCarrierFrequency(hz) { ... }
export function getCarrierFrequency() { ... }

// Per-voice parameters
export function setVoiceVolume(index, db) {
  voiceVolumes[index] = db; // Store in state array
  
  if (!nodesInitialized) return; // Nodes don't exist yet
  
  try {
    // Apply to Tone.js node with smooth ramping
    voiceGains[index].gain.rampTo(db, 0.05, "+0", "decibels");
  } catch (e) {
    console.warn(`Error setting volume:`, e);
  }
}

// Global exposure
if (typeof window !== 'undefined') {
  window.YourSynth = window.YourSynth || {};
  window.YourSynth.setCarrierFrequency = setCarrierFrequency;
  // ... expose key functions
}
```

### **7. Documentation Comments**
- **Section headers**: Clear boundaries between code sections
- **Tone.js integration**: Document WHICH nodes and WHY
- **Signal flow**: ASCII diagrams of audio routing
- **Timing**: Explain scheduling approach
- **Gotchas**: Call out non-obvious behavior

---

## ⚠️ **COMMON GOTCHAS**

### **1. Oscillators Cannot Restart**
```javascript
// ❌ WRONG
oscillator.start();
oscillator.stop();
oscillator.start(); // ERROR: Cannot start a stopped oscillator

// ✅ CORRECT
oscillator.start();
oscillator.stop();
oscillator.dispose(); // Clean up
oscillator = new Tone.Oscillator(...); // Create new one
oscillator.start();
```

### **2. Loops Can Restart (But Synths Cannot)**
```javascript
// ✅ CORRECT for Tone.Loop
loop.start();
loop.stop();
loop.start(); // Works fine

// ❌ WRONG for Tone.Synth (no need to recreate, but can't "start")
synth.triggerAttackRelease(...); // Trigger notes, don't "start" synth
```

### **3. Musical Time Depends on BPM**
```javascript
// At 120 BPM:
// '4n' = 0.5s (quarter note)
// '8n' = 0.25s (eighth note)
// '16n' = 0.125s (sixteenth note)

// At 240 BPM:
// '4n' = 0.25s (twice as fast)

// Always use musical time for Transport-synced events
const duration = Tone.Time('16n').toSeconds(); // Convert to seconds if needed
```

### **4. Volume Units Matter**
```javascript
// ❌ WRONG - Linear doesn't match perception
gain.gain.value = 0.5; // Sounds much quieter than -6dB

// ✅ CORRECT - Decibels match human hearing
gain.gain.rampTo(-6, 0.05, "+0", "decibels");
```

### **5. Event Timing Race Conditions**
```javascript
// Problem: Preset event fires before nodes exist
window.addEventListener('binauralPresetChanged', (event) => {
  _applyPresetToVoices(event.detail.presetData); // Nodes don't exist yet!
});

// Solution: Store pending data, apply after node creation
if (!nodesInitialized) {
  pendingPresetData = event.detail.presetData;
  return;
}
```

---

## 📚 **FURTHER READING**

- **Tone.js Documentation**: https://tonejs.github.io/docs/
- **Tone.js API Reference**: `docs/tone.js/API_REFERENCE.md`
- **Binaural Tone.js Guide**: `docs/tone.js/BINAURAL_REFERENCE.md`
- **Project Structure**: `docs/PROJECT_STRUCTURE.md`
- **Architecture Addendum**: `docs/STRUCTURE_ADDENDUM.md`

---

## 🎯 **QUALITY CHECKLIST**

Before considering a synth "complete", verify:

- [ ] Pure MODEL (no DOM access, querySelector, etc.)
- [ ] Event-driven (listens for preset/journeymap/transport)
- [ ] State arrays (values stored before nodes exist)
- [ ] Two-stage gain (voice fader + crossfade)
- [ ] Tone.js integration documented
- [ ] Signal flow diagram in comments
- [ ] Section headers with clear boundaries
- [ ] Consistent API (matches binaural/isochronic patterns)
- [ ] Global exposure (window.YourSynth.keyFunctions)
- [ ] Error handling (try/catch for Tone.js calls)
- [ ] Pending preset data handling
- [ ] Smooth parameter changes (.rampTo, not direct assignment)
- [ ] Proper disposal (nodes, oscillators, loops)
- [ ] No console noise (minimal logging, no debug spam)

---

**Last Updated**: October 21, 2025  
**Maintained By**: Auramatrix Development Team  
**Reference Files**: `binaural_synth.js`, `isochronic_synth.js`
