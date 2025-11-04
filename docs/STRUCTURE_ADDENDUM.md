# Transport/Widget/Preset/Synth Architecture Addendum

**Status**: Architectural clarification for PROJECT_STRUCTURE.md  
**Date**: October 16-21, 2025  
**Updated**: October 21, 2025 (Post-journeymap extraction)  
**Purpose**: Define clean MVC separation between Transport, Widget, Preset, and Synth layers

---

## ✅ IMPLEMENTATION STATUS (October 2025)

### **Completed Refactorings**:
- ✅ **Journeymap Widget Extraction** (October 21, 2025)
  - Extracted 3 focused modules from 1,278-line monolith
  - journeymap_timeline.js (242 lines)
  - journeymap_onclick.js (98 lines) 
  - journeymap_ui.js (503 lines - GENERIC, reusable!)
  - Main widget: 617 lines (52% reduction)
  - **Bonus**: Fixed glowy highlight animation during extraction!

### **Active Architecture**:
- ✅ IsResume flag system (binaural_presets.js)
- ✅ IsResumeJM flag system (journeymap_presets.js)
- ✅ MVC separation (Model/View/Controller per widget)
- ✅ Preset loading BEFORE play button (not during)
- ✅ Module extraction pattern established (comment → extract → test → commit)

---

## 🚨 CRITICAL CLARIFICATION: TWO ARCHITECTURAL LEVELS

### **SYNTH ECOSYSTEM (Control Panel Level)**
**All synths in the control panel share ONE IsResume flag.**

- **IsResume** - Generic flag for ANY synth widget in the control panel
  - Tracks if user adjusted ANY control in the active synth (volumes, octaves, widths, fx, etc.)
  - Lives in the synth's preset controller (e.g., `binaural_presets.js`, `future_synth_presets.js`)
  - ALL synths use the same `IsResume` naming convention
  - **DO NOT RENAME** to `IsResumeBinaural` or synth-specific names

**Current synth example**: `binaural_presets.js` owns `IsResume` for binaural synth controls

### **JOURNEYMAP LEVEL (Timeline Level - Above Synths)**
**Journeymap exists ABOVE the synth ecosystem.**

- **IsResumeJM** - Separate flag for journeymap timeline
  - Tracks if user edited journey timeline (segments, Hz progression, durations)
  - Lives in `journeymap_presets.js`
  - Journeymap is NOT a synth, it's a **timing widget** that provides Hz/timeline to synths
  - Journeymap talks to synths through Hz data and Tone.Transport timeline

**Hierarchy**:
```
Journeymap (timing/Hz source)
    ↓ provides Hz timeline
Synth Ecosystem (audio generation)
    ↓ uses IsResume flag
Control Panel Widgets (volumes, widths, etc.)
```

---

## 🎯 THE CORE PROBLEM

Current code has preset loading **tangled into** the play button flow. This creates:
- Preset loads happening DURING playback initialization
- Duplicate resume logic in synth AND widget layers
- Transport calling preset loaders instead of just starting audio
- Confusion about what happens when and where
- Unclear relationship between journeymap (timing) and synth ecosystem (audio)

---

## ✅ THE CORRECT ARCHITECTURE

### **Play Button Workflow (What SHOULD Happen)**

```
USER PRESSES PLAY
    ↓
1. Timeline starts (Tone.Transport.start())
2. Audio fades up (synths already initialized)
3. Sound plays (everything already knows what to do)
```

**That's it.** No preset loading. No state checking. Just **GO**.

---

### **Navigation Safeguard (Preventing Preset Auto-Load During Playback)**

**The Problem**: "9 Presetters Everywhere" Architecture
- Multiple panels have preset systems (binaural, noise, sub, journeymap, etc.)
- User navigates between panels while audio is playing
- Each panel's preset controller tries to auto-load default preset on initialization
- Result: Audio resets/changes unexpectedly during navigation

**The Solution**: Track Initial Load vs Navigation
```javascript
// In binaural_synth.js - Export playing state
let isPlaying = false; // Set true on start(), false on stop()

export function getIsPlaying() {
  return isPlaying;
}

// In binaural_presets.js - Check before auto-loading
const { getIsPlaying } = await import('../synths/binaural_synth.js');
const isCurrentlyPlaying = getIsPlaying();

// Track if preset has EVER been loaded (initial load vs navigation)
const isInitialLoad = !window.binauralPresetHasBeenLoaded;

// Only skip auto-load if: (1) audio playing AND (2) preset already loaded before
const shouldSkipLoad = isCurrentlyPlaying && !isInitialLoad;

if (!shouldSkipLoad) {
  // Load default preset (Deepflora)
  await loadAndApplyBinauralPreset(defaultPreset);
  window.binauralPresetHasBeenLoaded = true; // Mark as loaded
}
```

**Why This Works**:
- **Initial page load**: `isInitialLoad = true` → Always loads preset (even if audio playing from elsewhere)
- **Navigation during silence**: `isPlaying = false` → Loads preset (safe to initialize)
- **Navigation during playback**: `isPlaying = true AND isInitialLoad = false` → **Skips preset auto-load** ✅

**Pattern for All Preset Controllers**:
1. Export `getIsPlaying()` from synth (tracks `Tone.Transport.state`)
2. Check `getIsPlaying()` in preset controller initialization
3. Use `window.<widget>PresetHasBeenLoaded` flag to track first load
4. Only skip auto-load if BOTH: audio playing AND preset was loaded before
5. This preserves initial page load behavior while preventing navigation resets

---

## 🧬 THE MVC PATTERN (How Everything is Ready Before Play)

### **MODEL: `<name>_synth.js`** (Pure Audio Engine)
- **Location**: `/widgets/synths/`
- **Responsibility**: Generate sound when told to
- **State**: Holds current audio parameters (frequencies, volumes, widths)
- **Does NOT**:
  - Load presets
  - Check UI state
  - Make decisions about what to play

**Example API**:
```javascript
// In binaural_synth.js
export function setVoiceVolume(voiceIndex, volumeDb) { /* set audio */ }
export function setVoiceWidth(voiceIndex, widthValue) { /* set stereo */ }
export function setVoiceOctaveOffset(voiceIndex, octave) { /* set pitch */ }
export function start() { /* start oscillators */ }
export function stop() { /* stop oscillators */ }
export function getIsPlaying() { return isPlaying; } /* for navigation safeguard */
```

### **VIEW: `<name>_widget.js` + `<name>_panel.html`** (UI Layer)
- **Location**: `/widgets/js/` and `/widgets/panels/`
- **Responsibility**: User interaction, visual feedback
- **Monitors**: Faders, knobs, controls
- **Sets Flags**: `element.dataset.manuallyAdjusted = 'true'` when user touches control
- **Calls Synth**: When user moves fader → immediately call `setVoiceVolume()` on synth
- **Does NOT**:
  - Load presets (that's Controller's job)
  - Decide whether to apply preset values (Controller decides)
  - Manage IsResume flag (Controller owns it)

**Example Flow**:
```javascript
// In binaural_widget.js - fader mouse event
fader.addEventListener('mousedown', (e) => {
  const volumeDb = calculateVolumeFromPosition(e);
  
  // 1. Mark as manually adjusted
  fader.dataset.manuallyAdjusted = 'true';
  
  // 2. Tell Controller user made a change
  if (window.BinauralPresets?.notifyManualAdjustment) {
    window.BinauralPresets.notifyManualAdjustment('volume', voiceIndex);
  }
  
  // 3. Update synth immediately
  setVoiceVolume(voiceIndex, volumeDb);
});
```

### **CONTROLLER: `<name>_presets.js`** (State & Preset Management)
- **Location**: `/widgets/presets/`
- **Responsibility**: Preset I/O, state tracking, IsResume flag
- **Owns**: `IsResume` flag (GENERIC - same name for ALL synths)
- **Monitors**: Watches for `manuallyAdjusted` flags set by Widget
- **Updates Synth**: When preset loaded → calls synth functions to apply values
- **Decides**: Should preset values be applied or should screen values be preserved?
- **Coordinates**: May request Hz timeline from journeymap (which exists above synth level)

**Example API**:
```javascript
// In binaural_presets.js (or any_synth_presets.js)
let IsResume = false; // GENERIC FLAG - same name for ALL synths

export async function loadPreset(presetName) {
  const presetData = await fetchPreset(presetName);
  
  // PRESET LOAD = FRESH STATE
  // Reset IsResume flag - we're loading a new preset
  IsResume = false;
  
  // Clear ALL manuallyAdjusted flags on widgets
  clearAllManuallyAdjustedFlags();
  
  // Get Hz timeline from journeymap (higher level)
  const hzTimeline = await getHzTimelineFromJourneymap(presetName);
  
  // Apply ALL preset values to synth (volumes, octaves, widths)
  applyVolumes(presetData);
  applyWidths(presetData);
  applyOctaves(presetData);
  
  // Send Hz timeline to synth for scheduling
  if (hzTimeline) {
    applySynthHzTimeline(hzTimeline);
  }
  
  // Update Widget UI to match preset
  window.dispatchEvent(new CustomEvent('binauralPresetLoaded', {
    detail: { presetData }
  }));
  
  console.log(`✅ Preset "${presetName}" loaded - IsResume = false (fresh state)`);
}

function clearAllManuallyAdjustedFlags() {
  // Reset ALL controls to non-manual state
  document.querySelectorAll('.voice-fader').forEach(fader => {
    delete fader.dataset.manuallyAdjusted;
  });
  document.querySelectorAll('.width-control').forEach(control => {
    delete control.dataset.manuallyAdjusted;
  });
  // Add other controls as needed
}

async function getHzTimelineFromJourneymap(presetName) {
  // Ask journeymap (higher level) for Hz data
  if (window.JourneymapPresets?.getTimelineForPreset) {
    return await window.JourneymapPresets.getTimelineForPreset(presetName);
  }
  return null;
}

export function notifyManualAdjustment(controlType, voiceIndex) {
  // Widget tells us user touched a control
  IsResume = true; // Now we're in resume mode
  console.log(`🎛️ IsResume = true (${controlType} ${voiceIndex} adjusted)`);
}

export function getIsResumeState() {
  // Synth/Transport can query current state
  return IsResume;
}

// NAVIGATION SAFEGUARD: Check before auto-loading preset
export async function initializeWithSafeguard() {
  const { getIsPlaying } = await import('../synths/binaural_synth.js');
  const isCurrentlyPlaying = getIsPlaying();
  const isInitialLoad = !window.binauralPresetHasBeenLoaded;
  
  // Skip auto-load ONLY if: audio playing AND preset already loaded before
  if (!isCurrentlyPlaying || isInitialLoad) {
    await loadPreset('Deepflora'); // Default preset
    window.binauralPresetHasBeenLoaded = true;
  } else {
    console.log('🛑 Navigation safeguard: Preserving current audio state');
  }
}
```

### **TRANSPORT: Journeymap Timeline** (Playback Orchestration)
- **Location**: `/widgets/presets/journeymap_presets.js`
- **Responsibility**: Start/stop Tone.Transport, schedule timeline events
- **Assumes**: Synths are ALREADY INITIALIZED and READY
- **Does NOT**:
  - Load presets during play
  - Check IsResume state
  - Worry about widget state

**Example Flow**:
```javascript
// In journeymap_presets.js - playJourneyTimeline()
export async function playJourneyTimeline(timeline, playbackFactor = 1) {
  // Synths should already be ready from preset load or widget adjustments
  // Just schedule the timeline and start transport
  
  await startBinauralSynth(); // Starts oscillators (doesn't load data)
  await scheduleTimelineToSynths(timeline, playbackFactor);
  
  // GO
  if (window.Tone?.Transport) {
    window.Tone.Transport.start();
  }
  
  return true;
}
```

---

## � BINAURAL ↔ JOURNEYMAP COORDINATION

**Critical**: `binaural_synth.js` needs Hz progression from journeymap to schedule frequency changes over time.

### **Hz Data Flow**:
```
1. User selects preset "Alpha Meditation" in binaural dropdown
    ↓
2. binaural_widget.js: Sees preset_nav button click
    ↓
3. binaural_widget.js: Tells binaural_presets.js to load preset
    ↓
4. binaural_presets.js: Loads preset JSON (volumes, octaves, widths)
    ↓
5. binaural_presets.js: Asks journeymap_presets.js "What's the Hz timeline for 'Alpha Meditation'?"
    ↓
6. journeymap_presets.js: Returns Hz timeline (segments with plateaus/transitions)
    ↓
7. binaural_presets.js: Sends Hz timeline to binaural_synth.js
    ↓
8. binaural_synth.js: Schedules Hz changes on Tone.Transport timeline
    ↓
9. READY: Synth knows volumes/octaves/widths AND Hz progression over time
```

### **API Between Preset Controllers**:
```javascript
// In journeymap_presets.js
export function getTimelineForPreset(presetName) {
  // Load journeymap preset with same name
  const journeyData = await fetchJourneyPreset(presetName);
  
  // Convert to Hz timeline format synth expects
  return convertJourneyToBinauralTimeline(journeyData);
}

// In binaural_presets.js
async function getHzTimelineFromJourneymap(presetName) {
  if (window.JourneymapPresets?.getTimelineForPreset) {
    return await window.JourneymapPresets.getTimelineForPreset(presetName);
  }
  return null; // Fallback if journeymap not available
}
```

**Why This Matters**: 
- Binaural synth handles VOICE CHARACTERISTICS (volume, octave, width)
- Journeymap handles FREQUENCY PROGRESSION (Hz over time)
- They coordinate through their preset controllers, not directly

---

## �📊 STATE FLOW DIAGRAM

### **Scenario 1: Fresh Preset Load (IsResumeBinaural = false)**
```
1. User selects preset from dropdown (e.g., "Alpha Meditation")
    ↓
2. Widget: Detects preset_nav button click
    ↓
3. Widget: Calls binaural_presets.loadPreset('Alpha Meditation')
    ↓
4. binaural_presets: Sets IsResumeBinaural = false (RESET)
    ↓
5. binaural_presets: Clears ALL manuallyAdjusted flags on widgets
    ↓
6. binaural_presets: Fetches binaural preset JSON (volumes, octaves, widths)
    ↓
7. binaural_presets: Asks journeymap_presets for Hz timeline
    ↓
8. journeymap_presets: Returns Hz timeline (plateau/transition segments)
    ↓
9. binaural_presets: Calls synth setters (setVoiceVolume, setVoiceWidth, etc.)
    ↓
10. binaural_presets: Sends Hz timeline to synth for Tone.Transport scheduling
    ↓
11. binaural_presets: Fires 'binauralPresetLoaded' event
    ↓
12. Widget: Hears event, updates fader positions to match preset
    ↓
13. READY: Synth has volumes/octaves/widths/Hz timeline, Widget shows correct positions
    ↓
14. User presses play → Transport just starts, everything already knows what to do
```

### **Scenario 2: User Adjusts Fader (IsResumeBinaural = true)**
```
1. User drags volume fader up
    ↓
2. Widget: Sets fader.dataset.manuallyAdjusted = 'true'
    ↓
3. Widget: Calls binaural_presets.notifyManualAdjustment('volume', 0)
    ↓
4. binaural_presets: Sets IsResumeBinaural = true
    ↓
5. Widget: Calls setVoiceVolume(0, newVolumeDb) on synth
    ↓
6. READY: Synth has new volume, Widget shows new position, Controller knows to preserve it
    ↓
7. User presses play → Transport just starts, synth uses current screen values
```

### **Scenario 3: User Loads New Preset While IsResumeBinaural = true**
```
1. IsResumeBinaural = true (user had adjusted faders previously)
    ↓
2. User selects DIFFERENT preset from dropdown
    ↓
3. Widget: Calls binaural_presets.loadPreset('Different Preset')
    ↓
4. binaural_presets: RESETS IsResumeBinaural = false (preset load = fresh state)
    ↓
5. binaural_presets: Clears ALL manuallyAdjusted flags (clean slate)
    ↓
6. binaural_presets: Loads new preset fully (all values applied)
    ↓
7. Widget: Updates UI to match new preset
    ↓
8. READY: New preset loaded completely, previous adjustments discarded
```

**RULE**: Preset load ALWAYS resets IsResume to false. Loading a preset means "give me this exact preset, forget my adjustments."

---

## 🔧 CURRENT CODE VIOLATIONS OF THIS PATTERN

### **Problem 1: Preset Loading During Play**
- **File**: `journeymap_presets.js` line 267
- **Issue**: `playJourneyTimeline()` calls `loadBinauralPreset()` during play
- **Fix**: Preset should be loaded BEFORE play button is pressed

### **Problem 2: Duplicate Resume Checking**
- **File 1**: `binaural_synth.js` line 739 - checks `isVoiceManuallyAdjusted()`
- **File 2**: `binaural_widget.js` line 427 - checks `fader.dataset.manuallyAdjusted`
- **Issue**: Same logic in two places (Model and View)
- **Fix**: Controller should be the ONLY place checking IsResume

### **Problem 3: Widget Listening to Preset Events**
- **File**: `binaural_widget.js` lines 156-167
- **Issue**: Widget listens to `binauralPresetLoaded` and updates faders itself
- **Current**: Works, but creates tight coupling between Widget and Controller
- **Better**: Controller should directly call Widget API to update UI

### **Problem 4: IsResume Logic in Wrong Layer**
- **Current**: Logic scattered across synth (checking), widget (filtering), preset (monitoring)
- **Should Be**: Controller owns IsResume, Widget sets flags, Synth just receives values

---

## 📋 SUGGESTED CHANGES TO PROJECT_STRUCTURE.md

### **Section to Add: "Widget MVC Pattern"**
Add after "🧬 WIDGET DNA PATTERN" section:

```markdown
## 🎭 WIDGET MVC PATTERN

Every audio widget follows a strict Model-View-Controller separation:

### **Model: `<name>_synth.js`** (Pure Audio Engine)
- Generates sound when parameters are set
- Exposes setter functions: `setVoiceVolume()`, `setVoiceWidth()`, etc.
- Exposes control functions: `start()`, `stop()`
- Does NOT load presets or check UI state
- Located in `/widgets/synths/`

### **View: `<name>_widget.js` + `<name>_panel.html`** (UI Layer)
- Handles user interaction with controls
- Sets `element.dataset.manuallyAdjusted = 'true'` when user touches control
- Immediately calls Model setters when user adjusts controls
- Notifies Controller of manual adjustments
- Located in `/widgets/js/` and `/widgets/panels/`

### **Controller: `<name>_presets.js`** (State & Preset Management)
- Owns the `IsResume` flag (tracks if user has made manual adjustments)
- Loads presets and decides whether to apply them (based on IsResume)
- Calls Model setters to apply preset values
- Fires events to update View when presets load
- Exports `getIsResumeState()` for Transport to query
- Located in `/widgets/presets/`

### **Transport: Journeymap Timeline** (Playback Orchestration)
- Starts/stops Tone.Transport
- Schedules timeline events (Hz changes over time)
- Assumes all synths are ALREADY INITIALIZED before play
- Does NOT load presets during playback
- Located in `/widgets/presets/journeymap_presets.js`
```

### **Section to Add: "IsResume Architecture"**
Add after Widget MVC Pattern section:

```markdown
## 🔄 IsResume Architecture

**IsResume** is a flag that tracks whether the user has manually adjusted any controls in the synth ecosystem. It determines whether preset data should be applied or screen values should be preserved.

### **Two Separate Flags at Different Architectural Levels**

1. **`IsResume`** - GENERIC flag for ALL synths in control panel
   - Location: In each synth's preset controller (e.g., `binaural_presets.js`)
   - Tracks: User adjustments to synth voice controls (volumes, octaves, widths, fx)
   - Scope: Control panel level - each synth gets one IsResume flag
   - **ALWAYS named `IsResume`** - never rename to synth-specific names

2. **`IsResumeJM`** - Separate flag for journeymap timeline
   - Location: `journeymap_presets.js` ONLY
   - Tracks: User edits to timeline segments (Hz progression, durations, transitions)
   - Scope: Timeline level - exists ABOVE synth ecosystem
   - Special name because journeymap is a timing widget, not a synth

### **Why Separate Flags?**
- Journeymap edits (timeline/Hz changes) are independent from synth control adjustments
- User can edit journeymap without affecting synth resume state, and vice versa
- Journeymap provides Hz data TO synths, but doesn't live in control panel with them

### **Logic**
```javascript
// In binaural_presets.js (or any_synth_presets.js)
let IsResume = false; // GENERIC - same name for ALL synths

export function notifyManualAdjustment(controlType, voiceIndex) {
  IsResume = true; // User touched a control
  console.log('🎛️ IsResume = true');
}

export function getIsResumeState() {
  return IsResume; // Transport/Synth can query state
}

export async function loadPreset(presetName) {
  // PRESET LOAD = RESET IsResume
  IsResume = false;
  clearAllManuallyAdjustedFlags();
  
  // Fetch preset data
  const presetData = await fetchPreset(presetName);
  
  // Get Hz timeline from journeymap (higher level)
  const hzTimeline = await getHzTimelineFromJourneymap(presetName);
  
  // Apply ALL preset values to Model
  applyAllPresetValues(presetData);
  
  // Send Hz timeline to synth
  if (hzTimeline) {
    applySynthHzTimeline(hzTimeline);
  }
  
  console.log(`✅ Preset loaded - IsResume = false`);
}

// In journeymap_presets.js (HIGHER LEVEL)
let IsResumeJM = false; // Separate flag for timeline edits

export function notifyJourneymapEdit(segmentIndex, editType) {
  IsResumeJM = true; // User edited timeline
  console.log('🗺️ IsResumeJM = true');
}
```

### **Integration Points**
- **Widget → Controller**: Widget calls `notifyManualAdjustment()` when user touches control
- **Controller → Model**: Controller calls Model setters to apply preset values
- **Controller → View**: Controller fires events for View to update UI
- **Controller → Journeymap**: Synth preset controller requests Hz timeline from journeymap
- **Transport queries Controller**: Transport can check `getIsResumeState()` if needed

### **Critical Rule: Preset Load Resets IsResume**
```javascript
// ALWAYS reset on preset load
function loadPreset(presetName) {
  IsResume = false; // Fresh preset = fresh state (GENERIC NAME)
  clearAllManuallyAdjustedFlags(); // Clear widget flags
  // ... load preset data
}
```

### **Benefits**
- Single `IsResume` name for ALL synths (consistency, no naming confusion)
- Separate `IsResumeJM` for journeymap (different architectural level)
- Clean separation between timeline (journeymap) and audio (synths)
- Extensible to all future synths using same `IsResume` convention
- No duplicate checking logic
- Preset load behavior is predictable (always fresh)
```

### **Section to Modify: "Development Workflow"**
Update the "Adding New Widgets" section:

**Current**:
```markdown
### **Adding New Widgets**
1. Create the consolidated widget structure:
   - `widgets/js/<name>_widget.js` (controller)
   - `widgets/panels/<name>_panel.html` (HTML structure)  
   ...
```

**Should Be**:
```markdown
### **Adding New Widgets**
1. Create the MVC structure:
   - **Model**: `widgets/synths/<name>_synth.js` (pure audio, setter API)
   - **View**: `widgets/panels/<name>_panel.html` + `widgets/js/<name>_widget.js` (UI, event handlers)
   - **Controller**: `widgets/presets/<name>_presets.js` (preset I/O, IsResume flag)
   - **Styles**: `widgets/styles/<name>.css` (pure CSS, no JS manipulation)
   - **Spec**: `src/<name>_spec.js` (validation, if needed)

2. Implement IsResume architecture in Controller:
   - Declare `let IsResume = false;` flag (GENERIC - same for all synths)
   - Export `notifyManualAdjustment()` for Widget to call (sets flag to true)
   - Export `getIsResumeState()` for Transport to query
   - RESET IsResume to false in `loadPreset()` (preset load = fresh state)
   - Clear all `manuallyAdjusted` flags on widgets in `loadPreset()`
   - If journeymap coordination needed: Request Hz timeline via `getTimelineFromJourneymap()`

3. Widget must call Controller on user interaction:
   - Set `element.dataset.manuallyAdjusted = 'true'`
   - Call `Controller.notifyManualAdjustment(type, index)`
   - Call Model setter immediately (e.g., `setVoiceVolume()`)

4. Register widget in specs system
5. Test: Load preset (IsResume=false), adjust fader (IsResume=true), press play (values preserved)
```

---

## 🚨 CRITICAL RULES FOR ALL SYNTHS

1. **Transport does NOT load presets** - Presets are loaded BEFORE play button
2. **IsResume is GENERIC** - ALL synths use `IsResume` (not synth-specific names)
3. **IsResumeJM is separate** - Journeymap gets its own flag (exists above synth level)
4. **Preset load RESETS IsResume** - Loading preset = `IsResume = false`, clear all `manuallyAdjusted` flags
5. **Widget sets flags, Controller reads them** - `manuallyAdjusted` set by View, IsResume calculated by Controller
6. **Model is dumb audio** - Synth doesn't know about presets or UI state
7. **Play button = GO, not LOAD** - Everything is ready before Transport.start()
8. **Journeymap provides Hz** - Synth controllers request Hz timeline from journeymap (higher level)
9. **Two architectural levels**: Journeymap (timing) ABOVE synth ecosystem (audio)
10. **Navigation safeguard** - Model exports `getIsPlaying()`, Controller checks before auto-loading preset
11. **Initial load vs navigation** - Use `window.<widget>PresetHasBeenLoaded` flag to distinguish first load from panel navigation

---

## 📝 TODO: Code Cleanup Needed

1. **Remove preset loading from `playJourneyTimeline()`** - It should assume synths are ready
2. **Remove duplicate resume checks from `binaural_synth.js`** - Let Controller handle it
3. **Consolidate IsResume logic in `binaural_presets.js`** - Single source of truth, named `IsResume` (GENERIC)
4. **Add journeymap IsResume** - Implement `IsResumeJM` in `journeymap_presets.js` with same pattern
5. **Implement preset load reset logic** - `loadPreset()` must reset IsResume and clear flags
6. **Add journeymap ↔ synth coordination** - `getTimelineForPreset()` API for Hz data requests
7. **Remove orphaned functions**: `checkForManualFaderAdjustments()` in synth, `wasPlaying` flag
8. **Test volume/octave persistence** - Ensure refactor doesn't break existing behavior
9. **Test preset load reset** - Verify adjustments are cleared when new preset loads

## ✅ COMPLETED FEATURES

1. ✅ **Navigation safeguard implemented** - `getIsPlaying()` export + `window.binauralPresetHasBeenLoaded` flag
2. ✅ **Initial load vs navigation logic** - Preset auto-loads on first page load, skips during navigation if audio playing
3. ✅ **Binaural preset system** - Full MVC separation with IsResume flag

---

## 🎭 EXAMPLE: Complete Preset Load Flow

```javascript
// User clicks preset "Alpha Meditation" in binaural dropdown

// 1. WIDGET DETECTS (binaural_widget.js)
presetDropdown.addEventListener('change', async (e) => {
  const presetName = e.target.value;
  await window.BinauralPresets.loadPreset(presetName);
});

// 2. CONTROLLER LOADS (binaural_presets.js)
let IsResume = false; // GENERIC FLAG - same for all synths

export async function loadPreset(presetName) {
  console.log(`Loading preset: ${presetName}`);
  
  // RESET IsResume - preset load = fresh state
  IsResume = false;
  
  // Clear all manual adjustment flags
  document.querySelectorAll('.voice-fader, .width-control').forEach(el => {
    delete el.dataset.manuallyAdjusted;
  });
  
  // Fetch binaural preset (volumes, octaves, widths)
  const binauralData = await fetch(`./presets/binaural/${presetName}.json`).then(r => r.json());
  
  // Ask journeymap (higher level) for Hz timeline
  const hzTimeline = await window.JourneymapPresets?.getTimelineForPreset(presetName);
  
  // Apply to synth
  Object.keys(binauralData.voices).forEach((voiceKey, index) => {
    const voice = binauralData.voices[voiceKey];
    setVoiceVolume(index, voice.volume);
    setVoiceOctaveOffset(index, voice.oct);
    setVoiceWidth(parseInt(voiceKey), voice.stereoWidth);
  });
  
  // Send Hz timeline to synth for scheduling
  if (hzTimeline) {
    scheduleHzTimeline(hzTimeline);
  }
  
  // Tell widget to update UI
  window.dispatchEvent(new CustomEvent('binauralPresetLoaded', {
    detail: { presetData: binauralData }
  }));
  
  console.log(`✅ Preset loaded - IsResume = false`);
}

// 3. WIDGET UPDATES UI (binaural_widget.js)
window.addEventListener('binauralPresetLoaded', (event) => {
  const { presetData } = event.detail;
  updateFaderPositions(presetData); // No need to check manuallyAdjusted, flags are cleared
});

// 4. READY TO PLAY
// User presses play → Transport just starts, synth already has all data
```

---

**Next Steps**: Review with human, get approval, then implement clean separation in code.
