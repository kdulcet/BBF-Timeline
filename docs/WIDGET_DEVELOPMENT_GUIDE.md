# 🧬 WIDGET DEVELOPMENT GUIDE

**Purpose**: Comprehensive guide for building new widgets following proven patterns  
**Date**: October 21, 2025  
**Based On**: Successful journeymap extraction & binaural widget patterns

---

## 🎯 WHEN TO USE THIS GUIDE

Building a new widget? Start here. This guide walks you through:
- MVC architecture setup
- File structure and naming
- IsResume flag implementation
- Generic preset controller usage
- Module extraction patterns
- Testing workflow

---

## 📋 QUICK START CHECKLIST

### **Phase 1: File Structure** (5 files minimum)
```
□ audio/synths/<name>_synth.js       - MODEL (pure audio)
□ widgets/js/<name>_widget.js        - VIEW (UI orchestration)
□ widgets/presets/<name>_presets.js  - CONTROLLER (state management)
□ widgets/panels/<name>_panel.html   - VIEW (HTML template)
□ widgets/styles/<name>.css          - VIEW (styling)
```

### **Phase 2: MVC Implementation**
```
□ Model: Export setters + start/stop controls
□ View: Handle user input, set manuallyAdjusted flags
□ Controller: Implement IsResume flag, preset I/O
□ Import journeymap_ui.js for preset system (REUSE!)
```

### **Phase 3: Testing**
```
□ Test preset loading (IsResume = false)
□ Test manual adjustment (IsResume = true)
□ Test preset preservation (IsResume blocks overwrite)
□ Test play button (uses screen values)
□ Test save modal (uses journeymap_ui.js)
```

---

## 🧬 MVC ARCHITECTURE PATTERN

### **MODEL LAYER** (`audio/synths/<name>_synth.js`)

**Responsibilities**:
- Pure audio generation (Tone.js)
- Expose setter methods
- Expose start/stop controls
- Store state in module-level variables (persists across playback)

**Does NOT**:
- Load presets
- Check UI state
- Handle user interaction

**Example Structure**:
```javascript
// ============================================================================
// <NAME> SYNTH - MODEL LAYER (Pure Audio)
// ============================================================================
// MVC ROLE: Audio generation engine with setter API
// DEPENDENCIES: Tone.js
// STATE: Module-level variables (persist across playback cycles)
// ============================================================================

import * as Tone from "../../audio/tone.js/Tone.js";

// ==============================================
// MODULE-LEVEL STATE (Persists across playback)
// ==============================================
let voiceVolumes = [0.5, 0.5, 0.5, 0.5, 0.5]; // 5-voice default
let voiceWidths = [1.0, 1.0, 1.0, 1.0, 1.0]; // Full stereo
let currentNoiseType = 'pink'; // Default noise type

// Tone.js nodes (destroyed/recreated on each playback)
let noiseGenerators = [];
let filters = [];
let panners = [];

// ==============================================
// AUDIO ENGINE INITIALIZATION
// ==============================================
export function initNoiseEngine() {
  // Create Tone.js nodes using stored state values
  for (let i = 0; i < 5; i++) {
    const noise = new Tone.Noise(currentNoiseType);
    const filter = new Tone.Filter(800, "lowpass");
    const panner = new Tone.Panner(voiceWidths[i]); // Use stored width!
    
    noise.connect(filter).connect(panner).toDestination();
    
    noiseGenerators.push(noise);
    filters.push(filter);
    panners.push(panner);
  }
}

// ==============================================
// SETTER API (Called by Controller and View)
// ==============================================
export function setVoiceVolume(voiceIndex, volume) {
  voiceVolumes[voiceIndex] = volume; // Store in module state
  if (noiseGenerators[voiceIndex]) {
    noiseGenerators[voiceIndex].volume.value = Tone.gainToDb(volume);
  }
}

export function setVoiceWidth(voiceIndex, width) {
  voiceWidths[voiceIndex] = width; // Store in module state
  if (panners[voiceIndex]) {
    panners[voiceIndex].pan.value = width;
  }
}

export function setNoiseType(type) {
  currentNoiseType = type; // Store in module state
  // Update all generators (requires recreation)
  noiseGenerators.forEach((gen, i) => {
    gen.type = type;
  });
}

// ==============================================
// PLAYBACK CONTROLS
// ==============================================
export function start() {
  noiseGenerators.forEach(gen => gen.start());
}

export function stop() {
  noiseGenerators.forEach(gen => gen.stop());
}

// ==============================================
// CLEANUP (Important for mobile performance)
// ==============================================
export function dispose() {
  noiseGenerators.forEach(gen => gen.dispose());
  filters.forEach(f => f.dispose());
  panners.forEach(p => p.dispose());
  noiseGenerators = [];
  filters = [];
  panners = [];
}
```

---

### **CONTROLLER LAYER** (`widgets/presets/<name>_presets.js`)

**Responsibilities**:
- Preset I/O (load/save JSON files)
- IsResume flag management
- Calling Model setters to apply preset values
- Firing events for View to update UI

**Does NOT**:
- Manipulate DOM directly
- Generate audio
- Handle user interaction (View's job)

**Example Structure**:
```javascript
// ============================================================================
// <NAME> PRESETS - CONTROLLER LAYER
// ============================================================================
// MVC ROLE: Preset I/O and state management
// OWNS: IsResume flag (tracks manual adjustments)
// DELEGATES TO: Model setters, View event handlers
// ============================================================================

import { setVoiceVolume, setVoiceWidth, setNoiseType } from "../../audio/synths/noise_synth.js";
import { createPresetController } from "../js/journeymap_ui.js"; // REUSE!

// ==============================================
// ISRESUME FLAG - Tracks Manual Adjustments
// ==============================================
let IsResume = false; // false = apply preset, true = preserve screen values

export function getIsResumeState() {
  return IsResume;
}

export function notifyManualAdjustment() {
  IsResume = true;
  console.log('Manual adjustment detected - IsResume = true');
}

// ==============================================
// PRESET LOADING
// ==============================================
export async function loadNoisePreset(presetName) {
  // Reset IsResume flag (fresh preset load)
  IsResume = false;
  
  // Clear all manuallyAdjusted flags in DOM
  document.querySelectorAll('[data-manually-adjusted]').forEach(el => {
    delete el.dataset.manuallyAdjusted;
  });
  
  // Load preset JSON
  const preset = await fetch(`/presets/noise/${presetName}.json`).then(r => r.json());
  
  // Apply values via Model setters
  preset.payload.voices.forEach((voice, i) => {
    setVoiceVolume(i, voice.volume);
    setVoiceWidth(i, voice.width);
  });
  
  setNoiseType(preset.payload.noiseType);
  
  // Fire event for View to update UI
  document.dispatchEvent(new CustomEvent('noisePresetLoaded', {
    detail: { preset }
  }));
  
  console.log(`Loaded preset: ${presetName} - IsResume = false`);
}

// ==============================================
// GENERIC PRESET CONTROLLER (REUSE!)
// ==============================================
export async function initNoisePresets() {
  // Wire up journeymap_ui.js generic controller
  await createPresetController({
    presetDisplay: document.getElementById('noise-preset-selector'),
    presetPrev: document.getElementById('noise-preset-prev'),
    presetNext: document.getElementById('noise-preset-next'),
    journeySequence: document.querySelector('.noise-controls'),
    saveBtn: document.getElementById('noise-save-preset'),
    revertBtn: document.getElementById('noise-revert-preset'),
    saveModal: document.getElementById('noise-save-modal'),
    modalSaveNew: document.getElementById('noise-modal-save-new'),
    modalOverwrite: document.getElementById('noise-modal-overwrite'),
    modalBack: document.getElementById('noise-modal-back'),
    presetNameInput: document.getElementById('noise-preset-name'),
    nameCount: document.getElementById('noise-name-count'),
    renderPreset: async (name) => await loadNoisePreset(name),
    getCurrentPresetData: () => currentNoisePresetData,
    getCurrentPresetFilename: () => currentNoisePresetFilename,
  });
}
```

---

### **VIEW LAYER** (`widgets/js/<name>_widget.js`)

**Responsibilities**:
- Handle user interaction (sliders, buttons)
- Set manuallyAdjusted flags on elements
- Call Controller.notifyManualAdjustment()
- Call Model setters immediately
- Update UI in response to Controller events

**Does NOT**:
- Load presets (Controller's job)
- Generate audio (Model's job)
- Manage IsResume flag (Controller's job)

**Example Structure**:
```javascript
// ============================================================================
// <NAME> WIDGET - VIEW LAYER
// ============================================================================
// MVC ROLE: User interaction and visual feedback
// DELEGATES TO: Controller.notifyManualAdjustment(), Model setters
// LISTENS FOR: Controller events (presetLoaded, etc.)
// ============================================================================

import { setVoiceVolume, setVoiceWidth } from "../../audio/synths/noise_synth.js";
import { notifyManualAdjustment } from "../presets/noise_presets.js";

// ==============================================
// VOLUME SLIDER HANDLERS
// ==============================================
export function initNoiseWidget() {
  const volumeSliders = document.querySelectorAll('.noise-volume-slider');
  
  volumeSliders.forEach((slider, i) => {
    slider.addEventListener('input', (e) => {
      const volume = parseFloat(e.target.value);
      
      // Set manuallyAdjusted flag
      e.target.dataset.manuallyAdjusted = 'true';
      
      // Notify Controller (sets IsResume = true)
      notifyManualAdjustment();
      
      // Call Model setter immediately (live feedback)
      setVoiceVolume(i, volume);
    });
  });
  
  // Similar handlers for width sliders, noise type selector, etc.
}

// ==============================================
// LISTEN FOR PRESET LOADS (Update UI)
// ==============================================
document.addEventListener('noisePresetLoaded', (e) => {
  const preset = e.detail.preset;
  
  // Update UI to match preset values
  preset.payload.voices.forEach((voice, i) => {
    const volumeSlider = document.getElementById(`noise-volume-${i}`);
    if (volumeSlider) {
      volumeSlider.value = voice.volume;
      // Don't set manuallyAdjusted flag (preset load, not user action)
    }
  });
});
```

---

## 🔄 ISRESUME FLAG WORKFLOW

### **Normal Preset Load**:
```
1. User clicks preset "Pink Dreams"
2. Controller: loadNoisePreset('Pink Dreams')
3. Controller: IsResume = false (reset flag)
4. Controller: Clear all manuallyAdjusted flags
5. Controller: Call Model setters (apply preset values)
6. Controller: Fire 'noisePresetLoaded' event
7. View: Update UI sliders to match preset
8. Result: Fresh preset loaded, ready for playback
```

### **Manual Adjustment**:
```
1. User drutes volume slider
2. View: slider.dataset.manuallyAdjusted = 'true'
3. View: notifyManualAdjustment()
4. Controller: IsResume = true
5. View: Call Model setter (live feedback)
6. Result: Manual adjustment tracked, preserved across preset loads
```

### **Preset Load with IsResume = true**:
```
1. User clicks different preset "Brown Dreams"
2. Controller: Check IsResume flag (true)
3. Controller: Skip applying preset values (preserve screen)
4. Controller: Console log "Preserving manual adjustments"
5. Result: User's tweaks preserved, preset ignored
```

---

## 🎨 GENERIC PRESET CONTROLLER (HUGE WIN!)

**Problem Solved**: Every widget needs save modal, preset navigation, input validation, file I/O.

**Solution**: Use `journeymap_ui.js` generic controller (extracted Oct 21, 2025).

### **Benefits**:
- ✅ Save modal UI (save new, overwrite, back buttons)
- ✅ Preset navigation (prev/next)
- ✅ Input validation (character counter)
- ✅ IndexedDB persistence (save before file dialog)
- ✅ Native file dialog integration
- ✅ Button flash animations
- ✅ Last-saved preset restoration

### **Usage Pattern**:
```javascript
import { createPresetController } from "../js/journeymap_ui.js";

await createPresetController({
  // Required: DOM element references
  presetDisplay: document.getElementById('<widget>-preset-selector'),
  presetPrev: document.getElementById('<widget>-preset-prev'),
  presetNext: document.getElementById('<widget>-preset-next'),
  journeySequence: document.querySelector('.<widget>-controls'),
  
  // Optional: Save modal elements
  saveBtn: document.getElementById('<widget>-save-preset'),
  revertBtn: document.getElementById('<widget>-revert-preset'),
  saveModal: document.getElementById('<widget>-save-modal'),
  modalSaveNew: document.getElementById('<widget>-modal-save-new'),
  modalOverwrite: document.getElementById('<widget>-modal-overwrite'),
  modalBack: document.getElementById('<widget>-modal-back'),
  presetNameInput: document.getElementById('<widget>-preset-name'),
  nameCount: document.getElementById('<widget>-name-count'),
  
  // Required: Callbacks (widget-specific logic)
  renderPreset: async (name) => await load<Widget>Preset(name),
  getCurrentPresetData: () => current<Widget>PresetData,
  getCurrentPresetFilename: () => current<Widget>PresetFilename,
});
```

**That's it!** Preset system done. No custom save modal, no navigation logic, no file I/O code. Just wire up the callbacks and go!

---

## 📏 MODULE EXTRACTION PATTERN

### **When to Extract**:
- Widget file exceeds 600 lines
- Feature can be isolated (click handler, rendering, UI)
- Feature is reusable across widgets

### **Extraction Workflow**:
1. **Comment Enhancement** - Document architecture first
2. **Module Creation** - Extract into focused file
3. **ES6 Imports/Exports** - Clean dependencies
4. **Function Call Updates** - Pass parameters explicitly
5. **Testing** - Verify zero functional changes
6. **Commit** - Detailed message with metrics

### **Example: Timeline Rendering Extraction**:
```javascript
// BEFORE: All in widget file (1,278 lines)
function darkenHex(hex, amt) { /* ... */ }
function getWaveType(hz) { /* ... */ }
function attachDragHz(elem, segment, box) { /* ... */ }
// ... 200 more lines of rendering logic

// AFTER: Extracted to journeymap_timeline.js (242 lines)
import { darkenHex, getWaveType, attachDragHz } from "./journeymap_timeline.js";

// Widget file now just orchestrates:
attachDragHz(freq, segment, box, label, idx, firstPlateauIdx, lastPlateauIdx);
```

**Result**: Main widget reduced from 1,278 → 617 lines (-52%)

---

## ✅ TESTING WORKFLOW

### **Phase 1: Unit Testing (Model)**:
```javascript
// Test Model setters (no UI, no presets)
setVoiceVolume(0, 0.8);
console.assert(voiceVolumes[0] === 0.8, "Volume not stored");

start();
console.assert(noiseGenerators[0].state === "started", "Not playing");
```

### **Phase 2: Integration Testing (Controller)**:
```javascript
// Test preset loading
await loadNoisePreset('Pink Dreams');
console.assert(IsResume === false, "IsResume not reset");
console.assert(voiceVolumes[0] === 0.5, "Preset not applied");

// Test manual adjustment
notifyManualAdjustment();
console.assert(IsResume === true, "IsResume not set");
```

### **Phase 3: UI Testing (View)**:
```javascript
// Test slider interaction
const slider = document.getElementById('noise-volume-0');
slider.value = 0.7;
slider.dispatchEvent(new Event('input'));
console.assert(slider.dataset.manuallyAdjusted === 'true', "Flag not set");
console.assert(IsResume === true, "Controller not notified");
```

### **Phase 4: Playback Testing (Full Stack)**:
```javascript
// Test complete workflow
await loadNoisePreset('Brown Dreams'); // Preset loads
slider.value = 0.9; // User adjusts
slider.dispatchEvent(new Event('input'));
await loadNoisePreset('White Focus'); // Different preset
console.assert(slider.value === 0.9, "Manual adjustment not preserved");
```

---

## 🚫 ANTIPATTERNS TO AVOID

### **1. Hardcoding Initial Values in Node Creation**:
```javascript
// ❌ WRONG - values reset every playback
const panner = new Tone.Panner(1.0);

// ✅ RIGHT - uses stored state
const panner = new Tone.Panner(voiceWidths[i]);
```

### **2. Clearing State After First Use**:
```javascript
// ❌ WRONG - state lost after first playback
if (pendingPresetData) {
  applyPreset(pendingPresetData);
  pendingPresetData = null; // Values won't persist!
}

// ✅ RIGHT - state persists in module variables
voiceWidths[i] = widthValue; // Stored permanently
```

### **3. Checking IsResume During Playback**:
```javascript
// ❌ WRONG - IsResume has nothing to do with playback
function handlePlay() {
  if (!IsResume) {
    loadPresetValues(); // NO! Too late!
  }
  Transport.start();
}

// ✅ RIGHT - IsResume only for preset load decisions
function loadPreset(name) {
  if (IsResume) {
    console.log("Preserving screen values");
    return;
  }
  applyPresetValues();
}
```

### **4. Mixing MVC Layers**:
```javascript
// ❌ WRONG - Model checking UI state
export function start() {
  const slider = document.getElementById('volume'); // NO!
  this.volume = slider.value; // Model shouldn't touch DOM!
  this.generator.start();
}

// ✅ RIGHT - Controller passes values to Model
function handlePlay() {
  const volume = getVolumeFromSlider(); // View gets value
  setVoiceVolume(0, volume); // Controller calls Model
  start(); // Model just plays
}
```

---

## 🎯 SUCCESS CRITERIA

Your widget is ready when:
- ✅ MVC separation clean (no layer mixing)
- ✅ IsResume flag working (manual adjustments preserved)
- ✅ Generic preset controller integrated (saves time!)
- ✅ Module-level state persists across playback
- ✅ Widget file under 600 lines (extract if larger)
- ✅ All features tested (preset load, manual adjust, playback)
- ✅ Documentation complete (comments explain architecture)

---

## 📚 REFERENCE IMPLEMENTATIONS

**Study These Widgets**:
1. **journeymap_widget.js** (617 lines) - POST-extraction, clean orchestration
2. **binaural_widget.js** - 5-voice synth pattern
3. **journeymap_timeline.js** (242 lines) - Rendering extraction pattern
4. **journeymap_onclick.js** (98 lines) - Feature extraction pattern
5. **journeymap_ui.js** (503 lines) - Generic controller pattern ⭐

**Read These Docs**:
1. **PROJECT_STRUCTURE.md** - Overall architecture
2. **STRUCTURE_ADDENDUM.md** - MVC details
3. **REFACTOR_SESSION_OCT21_2025.md** - Extraction case study

---

**Last Updated**: October 21, 2025  
**Pattern Proven By**: Successful journeymap extraction (-52% size reduction)  
**Next Application**: Noise synth widget (tonight!) 🚀
