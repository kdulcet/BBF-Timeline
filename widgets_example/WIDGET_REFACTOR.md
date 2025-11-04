# Widget Refactor Plan - Three-Phase Extraction

## Overview
Extract shared UI logic from `binaural_widget.js` (881 lines) into reusable modules following the existing `ui_controls.js` pattern.

## Goals
- ✅ Create reusable UI primitives in `src/` directory
- ✅ Reduce `binaural_widget.js` from 881 → ~550 lines
- ✅ Enable code reuse for future widgets (noise, sub, etc.)
- ✅ Maintain MVC architecture clarity
- ✅ Keep all functionality working

---

## Pre-Refactor Backups Created
- `widgets/js/binaural_widget.js.bak` (881 lines - original before cleanup)
- Additional `.bak` files will be created before each phase

---

## Phase 1: Extract Key & Mood Mappings (~30 min)

### Files Created:
**`src/key_and_mood.js`** (~150 lines total)

```javascript
// CRITICAL: This file contains music theory mappings
// Root key frequencies (C3-B3 + 432Hz special tuning)
// Mood semitone intervals (Radiance, Depth, Stillness)
// Scales.js integration for tuning systems
```

### What Moves:
1. **From `binaural_widget.js`**:
   - `getRootKeyFrequency()` function (~10 lines)
   - `getMoodSemitones()` function (~8 lines)
   - Frequency map constant (~4 lines)
   - Mood semitone map constant (~4 lines)

2. **From `audio/scales.js`**:
   - Entire `Scales` class (~130 lines)
   - Just Intonation ratios
   - 12-TET ratios
   - Frequency calculation methods

### New Structure:
```javascript
// src/key_and_mood.js
export const ROOTKEY_FREQUENCIES = { 'C': 130.81, ... };
export const MOOD_SEMITONES = { 'Radiance': [1,4,7,11,14], ... };
export function getRootKeyFrequency(rootKey) { ... }
export function getMoodSemitones(mood) { ... }
export class Scales { ... } // Migrated from audio/scales.js
```

### Files Modified:
- `widgets/js/binaural_widget.js` - Add import, remove functions
- `widgets/synths/binaural_synth.js` - Update scales.js import path
- `widgets/synths/isochronic_synth.js` - Update scales.js import path

### Testing After Phase 1:
- [ ] Root key selector still works (changes carrier frequency)
- [ ] Mood selector still works (changes semitone intervals)
- [ ] No console errors on widget load
- [ ] Preset loading preserves root key & mood

**Lines Removed from binaural_widget.js**: ~26 lines
**New binaural_widget.js size**: ~855 lines

---

## Phase 2: Extract Linear Controls (Faders & Sliders) (~45 min)

### Files Created:
**`src/ui_linear_controls.js`** (~200 lines total)

```javascript
// ============================================================================
// UI LINEAR CONTROLS - Shared fader and slider primitives
// ============================================================================
// TERMINOLOGY (CRITICAL - avoid confusion):
// - FADER = VERTICAL control (up/down movement, typically volume)
// - SLIDER = HORIZONTAL control (left/right movement, typically parameters)
// ============================================================================
```

### What Moves:
1. **Vertical Fader Logic** (~80 lines):
   - `initVerticalFader()` - Generic vertical fader with drag
   - `dbToFaderPos()` - dB to percentage conversion
   - `faderPosToDb()` - Percentage to dB conversion
   - Handle constraint logic (5-95% range)
   - Mouse drag interaction patterns

2. **Horizontal Slider Logic** (~80 lines):
   - `initHorizontalSlider()` - Generic horizontal slider with drag
   - `constrainSliderPercent()` - Edge constraint (5-95% range)
   - Click-to-set functionality
   - Drag interaction patterns

3. **Shared Helpers** (~40 lines):
   - Manual adjustment flag handling
   - Common event listener patterns
   - Presetter notification helpers

### Generic API Design:

#### Vertical Fader:
```javascript
export function initVerticalFader(container, options) {
    // options: {
    //   initial: 50,           // Initial position %
    //   floor: -70,            // Silence floor in dB
    //   constraintMargin: 0,   // Handle margin (default 0 for 0-85% mapping)
    //   onManualChange: (db, percent) => {},
    //   onPresetChange: (db, percent) => {}
    // }
    // Returns: {
    //   setDb(db),
    //   getDb(),
    //   setPercent(percent),
    //   getPercent(),
    //   markManual(),
    //   destroy()
    // }
}
```

#### Horizontal Slider:
```javascript
export function initHorizontalSlider(container, options) {
    // options: {
    //   initial: 50,           // Initial position %
    //   min: 0,                // Min value
    //   max: 100,              // Max value
    //   constraintMargin: 5,   // Edge margin (default 5 for 5-95% range)
    //   onManualChange: (value, percent) => {},
    //   onPresetChange: (value, percent) => {}
    // }
    // Returns: {
    //   setValue(val),
    //   getValue(),
    //   setPercent(percent),
    //   getPercent(),
    //   markManual(),
    //   destroy()
    // }
}
```

### Files Modified:
- `widgets/js/binaural_widget.js` - Refactor volume faders to use `initVerticalFader()`
- `widgets/js/binaural_widget.js` - Refactor width/length/ISO to use `initHorizontalSlider()`

### What Stays Widget-Specific:
- Voice-to-synth mapping (`setVoiceVolume()`, `setVoiceWidth()`, etc.)
- Binaural-specific crossfade logic (power curve, makeup gain)
- ISO duty cycle range mapping (0.2-0.7)
- Journey map restart events

### Testing After Phase 2:
- [ ] Volume faders respond to mouse drag
- [ ] Volume faders convert dB correctly
- [ ] Width sliders constrain handle position
- [ ] Length sliders map to duty cycle (0.2-0.7)
- [ ] ISO crossfade applies makeup gain
- [ ] Manual adjustment flags preserved on preset load
- [ ] All 5 voices independently controllable

**Lines Removed from binaural_widget.js**: ~150 lines
**New binaural_widget.js size**: ~705 lines

---

## Phase 3: Split Widget Into Core + Controls (~30 min)

### Files Created:
**`widgets/js/binaural_widget_controls.js`** (~300 lines)

```javascript
// Octave, width, length, and ISO control initialization
// Separated from core widget for clarity and file size
```

### What Moves:
1. **From `binaural_widget.js`**:
   - `initOctaveControls()` (~50 lines)
   - `updateVoiceOctave()` (~25 lines)
   - `updateOctaveControlDisplay()` (~20 lines)
   - `initWidthControls()` (~60 lines)
   - `updateWidthPosition()` (~25 lines)
   - `initLengthControls()` (~60 lines)
   - `updateLengthPosition()` (~25 lines)
   - `initIsoControls()` (~60 lines)
   - `updateIsoPosition()` (~40 lines)
   - `initBinauralContentNavigation()` (~35 lines)

### New Structure:

#### `binaural_widget_controls.js`:
```javascript
import { initHorizontalSlider } from '../../src/ui_linear_controls.js';
import { setVoiceOctaveOffset, setVoiceWidth } from '../synths/binaural_synth.js';
// ... other imports

export function initOctaveControls() { ... }
export function initWidthControls() { ... }
export function initLengthControls() { ... }
export function initIsoControls() { ... }
export function initBinauralContentNavigation() { ... }

// Private helpers
function updateVoiceOctave() { ... }
function updateWidthPosition() { ... }
function updateLengthPosition() { ... }
function updateIsoPosition() { ... }
function updateOctaveControlDisplay() { ... }
```

#### `binaural_widget.js` (final ~405 lines):
```javascript
import { getRootKeyFrequency, getMoodSemitones } from '../../src/key_and_mood.js';
import { initVerticalFader } from '../../src/ui_linear_controls.js';
import {
    initOctaveControls,
    initWidthControls,
    initLengthControls,
    initIsoControls,
    initBinauralContentNavigation
} from './binaural_widget_controls.js';

// Core widget initialization
// Volume faders (using initVerticalFader)
// Preset application
// Root key & mood selectors
```

### Files Modified:
- `widgets/js/binaural_widget.js` - Import controls, remove ~300 lines
- Create `widgets/js/binaural_widget_controls.js` - New file

### Testing After Phase 3:
- [ ] All controls initialize on panel load
- [ ] Octave buttons change voice pitch
- [ ] Width sliders adjust stereo width
- [ ] Length sliders change pulse duration
- [ ] ISO sliders crossfade binaural/isochronic
- [ ] Content navigation pages work (1-5)
- [ ] No circular import issues
- [ ] All imports resolve correctly

**Lines Removed from binaural_widget.js**: ~300 lines
**Final binaural_widget.js size**: ~405 lines ✅

---

## Final File Structure

```
src/
├── ui_controls.js (184 lines) - EXISTING: Selectors
├── key_and_mood.js (150 lines) - NEW: Music theory + scales
└── ui_linear_controls.js (200 lines) - NEW: Faders & sliders

widgets/js/
├── binaural_widget.js (405 lines) - REFACTORED: Core widget
└── binaural_widget_controls.js (300 lines) - NEW: Control initialization

widgets/js/ (backups)
├── binaural_widget.js.bak (881 lines) - Original pre-cleanup
└── binaural_widget.js.phase0.bak (881 lines) - Pre-refactor cleaned version
```

---

## Risk Mitigation

### Before Each Phase:
- [x] Create `.bak` file of current state
- [ ] Commit working state before changes
- [ ] Document what's moving and why

### After Each Phase:
- [ ] Run full test checklist
- [ ] Check for import errors in console
- [ ] Verify all widget functionality
- [ ] Commit successful phase

### Rollback Plan:
If any phase fails:
1. `git reset --hard HEAD` (revert to last commit)
2. Restore from `.bak` file if needed
3. Review refactor plan
4. Adjust and retry

---

## Success Criteria

### Code Quality:
- ✅ No file over 500 lines (target met: 405, 300, 200, 150)
- ✅ Clear separation of concerns
- ✅ Reusable primitives in `src/`
- ✅ Widget-specific logic in `widgets/js/`

### Functionality:
- ✅ All controls work identically to before refactor
- ✅ No console errors
- ✅ Preset loading/saving unchanged
- ✅ Manual adjustment flags preserved

### Architecture:
- ✅ MVC pattern maintained
- ✅ Import paths logical and consistent
- ✅ Future widgets can reuse `src/` modules
- ✅ Clear documentation in each file

---

## Post-Refactor Documentation

After completing all phases:
- [ ] Update `docs/PROJECT_STRUCTURE.md` with new file organization
- [ ] Document `src/` module APIs for future widget developers
- [ ] Add comments explaining FADER vs SLIDER terminology
- [ ] Update widget development guide

---

## Estimated Time
- **Phase 1**: 30 minutes (extract key & mood)
- **Phase 2**: 45 minutes (extract linear controls)
- **Phase 3**: 30 minutes (split widget file)
- **Testing**: 15 minutes (comprehensive verification)

**Total**: ~2 hours

---

## Notes
- **CRITICAL**: FADER = vertical, SLIDER = horizontal (document everywhere!)
- Scales.js migration into key_and_mood.js consolidates music theory
- `ui_linear_controls.js` name clarifies "linear" = 1D controls (vs rotary/2D)
- Manual adjustment flags are widget-specific, NOT in generic controls
- Crossfade logic stays in widget (too specific to binaural/ISO relationship)

---

**Ready to begin Phase 1 after commit.**
