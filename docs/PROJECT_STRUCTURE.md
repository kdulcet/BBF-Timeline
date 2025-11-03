# 🎼 AURAMATRI---

## 🔧 DEVELOPMENT WORKFLOW

**Diagnostic Tools**: Use `/ui_debug/` tools instead of `python -m http.server`. The ui_debug system provides detailed boundary analysis, interaction logging, and visual debugging that simple servers cannot match.

**File Management**: Active development files only. Backup files should be moved to `/backups/` as organized zip archives to keep the working directory clean.

**Command-Line Environment**:
- **WSL2** (Windows Subsystem for Linux - primary development environment)
- **Node.js v22+** & **npm 10+** (package management, build scripts)
- **Git 2.5+** (version control)
- **VS Code CLI** (optional, for command-line editor operations)
- WSL executable: `C:\Windows\System32\wsl.exe`
- Use `npm run dev` for development workflow reminders

---

## 📽 DIRECTORY ARCHITECTUREROJECT STRUCTURE

*The architectural DNA of a consciousness operating system*

---

## 🎯 CORE PRINCIPLES

**Widget-Based Architecture**: Everything is a widget. Binaural beats, journey maps, transport controls - modular, composable, beautiful.

**CSS is Sacred**: No inline styles, no JavaScript style manipulation unless animation. CSS defines all presentation. Period.

**Mathematical Purity**: Code structure mirrors the harmonic relationships in the audio. Clean ratios, elegant patterns.

**Decoupled Architecture for Infinite Variety**: 
- **30×30×30 = 27,000 base combinations** (Binaural × Noise × Sub presets)
- **Full stack = 27,000 × Meditation library × Arrangement presets** = INFINITE
- Future expansion: + Pads + Pulse (arpeggiator) + Effects (foley/SFX) + Dialog
- This is why the product is called **Auramatrix** - truly exponential possibility space

**Multiple Use Patterns**:
- **Emergency calm-down**: Quick access to library preset → GO (30 seconds to white noise bliss)
- **Evening exploration**: Hang out in bed, play with synth before meditation
- **Power user mixing**: Build and tweak personal library, save custom presets
- **Preset collectors**: Name generators for personal preset creation
- App must serve ALL these patterns simultaneously

---

## � BBF (BINAURAL BRAINWAVE FRIEND) - FEATURE ROADMAP

**Product Philosophy**: 
- "Crazily soothing" - makes other apps feel like eating vegetables
- Advanced fidget toy that crosses science/woo-woo with intelligence
- Real-time Hz exploration feels playful, meditative, addictive
- Not Auramatrix (full synth) - focused meditation/brainwave tool

**Current State (MVP)**:
- ✅ Click-to-loop plateau interaction (fidget toy achievement unlocked)
- ✅ Real-time Hz drag with instant binaural + ISO sync
- ✅ Journey Map timeline with click-through exploration
- ✅ IsResume behavior (plays screen values, not saved presets)
- ✅ 5-voice binaural synth with octave/width/ISO/length controls
- ✅ Isochronic pulses (ping-pong stereo, synced to Hz)

### **NEXT: Binaural Widget Enhancements**

**Mood Selector** (PRIORITY):
- Add mood to binaural presets JSON (Radiance/Depth/Stillness)
- Mood controls harmonic intervals (chord voicing)
- **Decision**: Mood lives in binaural widget for BBF
  - In Auramatrix, mood becomes global (controls pads harmonics too)
  - BBF = binaural-scoped, Auramatrix = global harmonic architecture
- **Storage**: `mood` field in `/presets/binaural/*.json`
- **UI**: Mood selector in binaural panel (same as root key)

**Key Selector** (PLANNED):
- Root key (A, A#, B, C, etc.) sets carrier frequency base
- **Decision**: Key is GLOBAL (next to VU meter in header)
  - Affects all harmonic widgets (binaural now, pads later)
  - Always visible, always accessible
- **Current**: Key selector in binaural panel (temporary)
- **Future**: Move to global header next to meter

### **NEXT: Noise Synth Widget**

**Purpose**: Textured ambient layers (pink/white/brown noise)
- Complements binaural tones with organic texture
- 27,000 combinations = Binaural × Noise × Sub presets
- **MVC Pattern**: `noise_synth.js`, `noise_widget.js`, `noise_presets.js`

**Noise Forms** (types to implement):
- Pink noise (1/f - natural, balanced)
- White noise (full spectrum - bright, energetic)
- Brown noise (1/f² - deep, rumbling)
- Velvet noise (sparse impulses - warm, organic)

**Controls**:
- Noise type selector (pink/white/brown/velvet)
- Volume/gain control
- Filter cutoff (low-pass for warmth)
- Filter resonance (character/color)
- Mix level (blend with binaural)

### **LATER: Advanced Features** (Post-BBF MVP)

**Variance System** (AMAZING FEATURE):
- **Modal window** for variance depth control
- Adjust variance individually for:
  - Volume (subtle breathing dynamics)
  - Width (stereo movement)
  - ISO duty cycle (pulse length variation)
  - Pulse length (rhythmic variation)
- **Why This Matters**: "People will fucking flip about how this sounds"
- Adds organic, living quality to static meditation tones
- Prevents listener fatigue from perfectly static sounds

**Limiter + Auto-Normalize**:
- **Limiter**: Prevent clipping, protect ears during exploration
- **Auto-normalize**: Raise all pad volumes pre-calculated
  - Huge time saver for mixing
  - "Mix wherever but raise them all at once"
  - Maintains relative balance while increasing overall level

**Marketing Vision**:
- Musicians jamming on BBF could be viral
- Commercial potential: Artists using BBF in performances
- "Making music without making music" - accessible creativity
- Different from guided meditation apps (active exploration vs passive consumption)

### **Feature-Rich But Focused**:
- BBF is NOT Auramatrix (no pads, pulse, effects, dialog)
- "Pretty feature-rich for a phone synth toy"
- Balance: Deep enough to explore, simple enough to not overwhelm
- One or two more features MAX after variance/limiter

---

## �🎭 MVC ARCHITECTURE

Every audio widget follows strict Model-View-Controller separation:

- **VIEW** (`_panel.html` + `_widget.js`) - UI, user interaction, sets `manuallyAdjusted` flags
- **CONTROLLER** (`_presets.js`) - State management, preset I/O, owns `IsResume` flag  
- **MODEL** (`_synth.js`) - Pure audio engine, exposes setters, doesn't know about UI

**Critical**: Controller decides what to apply, Model just receives values, View just displays.

---

### **🚨 CRITICAL: Preset Loading Architecture**

**Event-Driven Pattern**:
1. Controller loads preset JSON
2. Controller fires `<widget>PresetChanged` event with preset data
3. Model has listener at MODULE SCOPE (set up once, never in functions)
4. Model receives event → applies values via setters

**State Persistence Pattern**:
- **Values that MUST persist across playback cycles**: Store in module-level arrays/variables
  - Example: `voiceOctaveOffsets = [0,0,0,0,0]` (stores octave state)
  - Example: `voiceWidths = [1.0,1.0,1.0,1.0,1.0]` (stores width state)
- **Values stored in Tone.js nodes**: Will reset when nodes destroyed, must be reapplied
  - Solution: Store state separately, use stored values when recreating nodes
  
**Node Recreation Pattern**:
- Nodes destroyed on `stop()`, recreated on `start()`
- Node creation MUST use stored state values, NEVER hardcode initial values
- Example: `new Tone.Panner(voiceWidths[i])` NOT `new Tone.Panner(1.0)`

**Why This Matters**:
- Tone.js destroys/recreates nodes on each playback cycle
- Hardcoded values in node creation = values reset every playback
- Store state in module variables = values persist across sessions

---

## 📁 DIRECTORY ARCHITECTURE

```
🎵 AuraMatrix/
├── 🖼️ widgets/                    # 1. CONSOLIDATED widget assets
│   ├── js/                        # 2. Widget controllers
│   │   ├── <name>_widget.js       # Main widget logic & UI hooks
│   │   ├── binaural_widget.js     # Example: Binaural controller
│   │   └── debug_panel_widget.js  # Consolidated debug controller
│   │
│   ├── panels/                    # 3. Widget HTML structures
│   │   ├── <name>_panel.html      # Widget HTML structure
│   │   ├── binaural_panel.html    # Example: Binaural UI
│   │   └── journeymap_panel.html  # Example: Journey interface
│   │
│   ├── presets/                   # 4. Preset controllers (reads JSON spec)
│   │   ├── <name>_presets.js      # Preset logic & interface
│   │   ├── binaural_presets.js    # Example: Binaural preset system
│   │   └── journeymap_presets.js  # Example: Journey preset system
│   │
│   ├── styles/                    # 5. Widget-specific stylesheets
│   │   ├── <name>.css             # Widget-specific styling
│   │   ├── binaural.css           # Example: Binaural visuals
│   │   └── journeymap.css         # Example: Journey visuals
│   │
│   └── WIDGET_STYLEGUIDE.md       # Widget development guide
│
├── 🎧 audio/                       # 6. Tone.js audio code
│   ├── synths/                    # Audio synthesizers
│   │   └── binaural_synth.js      # Example: Pure frequency gen
│   ├── <name>_sampler.js          # Sample players
│   └── scales.js                  # Custom tuning scales
│
├── ⚙️ src/                        # 7. Core system & widget specs
│   ├── <name>_spec.js             # Widget specifications & compilation
│   ├── journeymap_spec.js         # Example: Timeline validation
│   └── timeline/                  # Master timeline system
│       ├── journeymap_compiler.js # Timeline compilation logic
│       └── journeymap_validation.js # Timeline data validation
│
├── 🎨 styles/                      # 8. Global styles & layout
│   ├── base.css                   # Global base styles
│   ├── layout.css                 # Grid/layout systems
│   └── ui_elements.css            # Shared UI components
│
└── 📀 presets/                     # 9. Configuration Data
    ├── journeys/                   # Journey presets
    ├── binaural/                   # Binaural presets
    └── <category>/                 # Organized by type
```

---

## 🎼 **CRITICAL AURAMATRIX DESIGN PRINCIPLE**

### **JOURNEYMAP IS THE MASTER TIMELINE CONDUCTOR**

**🚨 TOP-LEVEL ARCHITECTURAL EDICT:**
The `journeymap` widget unpacks to the **MAIN TONE.JS TIMELINE**. Every single audio widget that touches audio MUST consume journeymap data as the top-level time reference.

**⚡ CORE TECHNOLOGY: BPM = (Hz * 60) / 8**
- **Binaural Hz drives transport BPM** - this is THE FUNDAMENTAL MECHANISM of Auramatrix
- Journey JSON contains Hz values, BPM is **CALCULATED** from Hz (not stored in JSON)
- This formula is CORE TECHNOLOGY that makes the app work - DO NOT DELETE OR CHANGE
- Example: 4.0 Hz → 30 BPM, 10.0 Hz → 75 BPM
- Located in: `widgets/presets/journeymap_presets.js`

**Why This Matters:**
- All audio widgets call `convertJourneyToBinauralTimeline(journeyPayload)`
- All Tone.js scheduling goes through journeymap's timeline format
- Transport controls, binaural rendering, offline rendering ALL expect journeymap structure
- Journey segments (`plateau`, `transition`) are the universal audio language

**Data Flow:**
```
JourneyMap Preset (JSON) 
    ↓ 
journeymap_spec.js (validate + compile)
    ↓ 
Universal Timeline Format
    ↓ 
All Audio Widgets (binaural, transport, etc.)
    ↓ 
Tone.js Audio Scheduling
```

**Implementation Requirement:**
Any new audio widget MUST:
1. Accept journeymap timeline format as primary input
2. Use journeymap's time references for synchronization  
3. Respect journey segments for audio scheduling
4. Never create independent timelines that conflict

### **TRANSPORT DOES NOT LOAD PRESETS**

**Play Button Workflow**:
1. Timeline starts (`Tone.Transport.start()`)
2. Audio fades up (synths already initialized)
3. Sound plays (everything already knows what to do)

**That's it.** No preset loading during play. No state checking. Just **GO**.

**Why This Matters**:
- Preset loading happens BEFORE play button is pressed
- Controller loads preset → calls Model setters → fires events for View
- Transport assumes all synths are ready with correct values
- Play button is liftoff, not initialization

---

## 🧬 WIDGET DNA PATTERN

Every widget follows this sacred pattern **in troubleshooting order**:

### 1. **Widget Stylesheet** (`widgets/styles/<name>.css`) - **VIEW LAYER**
```css
/* Widget-specific styling */
/* Pure CSS presentation rules */
/* No JavaScript style manipulation */
/* GLSL-ready for future consciousness theater */
```

### 2. **Widget HTML** (`widgets/panels/<name>_panel.html`) - **VIEW LAYER**
```html
<!-- Core HTML structure -->
<!-- Widget interface elements -->
<!-- Minimal, semantic markup -->
```

### 3. **Widget Controller** (`widgets/js/<name>_widget.js`) - **VIEW LAYER**
```javascript
// User interaction and visual feedback
// Sets element.dataset.manuallyAdjusted on user touch
// Calls Controller.notifyManualAdjustment() on changes
// Calls Model setters immediately (setVoiceVolume, etc.)
// Does NOT load presets or manage state
```

### 4. **Preset Controller** (`widgets/presets/<name>_presets.js`) - **CONTROLLER LAYER**
```javascript
// Preset I/O and state management
// Owns IsResume flag (tracks manual adjustments)
// Loads presets, resets IsResume, clears manuallyAdjusted flags
// Calls Model setters to apply preset values
// Fires events for View to update UI
```

### 5. **Audio Engine** (`audio/<name>_synth.js` or `<name>_sampler.js`) - **MODEL LAYER**
```javascript
// Pure audio generation
// Exposes setters: setVoiceVolume(), setVoiceWidth()
// Exposes controls: start(), stop()
// Does NOT load presets or check UI state
// Just makes sound when parameters are set
```

### **Master Timeline System** (`src/timeline/`)
```javascript
// CRITICAL: Master timeline system - ALL audio depends on this
// journeymap_validation.js - Ensures timeline data integrity
// journeymap_compiler.js - Transforms journeymap JSON into executable timeline
// journeymap_formats.js - Timeline format definitions and interfaces
// JOURNEYMAP ONLY - provides universal time reference for all audio
```

**How Audio Engines Access Master Timeline:**
- **All `<name>_synth.js` and `<name>_sampler.js` files** must access journeymap's timeline information
- **Access method**: Call `convertJourneyToBinauralTimeline(journeyPayload)` from journeymap system
- **Timeline format**: Receives compiled timeline with `{ segments: [{ time_sec, hz, duration_sec, type }] }`
- **Implementation**: Import from `../widgets/presets/binaural_presets.js` or equivalent timeline converter

**Technical Integration:**
```javascript
// In your <name>_synth.js file:
import { convertJourneyToBinauralTimeline } from "../widgets/presets/binaural_presets.js";
// OR import directly from timeline system:
import { compile } from "../src/timeline/journeymap_compiler.js";

export async function playFromJourneymap(journeyPayload) {
  const timeline = convertJourneyToBinauralTimeline(journeyPayload);
  // Use timeline.segments for Tone.js scheduling
  // Each segment: { duration_seconds, hz, hz_range, envelope_type }
}
```

---

## 🎉 WIDGET REFACTORING SUCCESS STORY

### **Journeymap Widget Extraction (October 2025)**

**Problem**: Journeymap widget was a 1,278-line monolith mixing VIEW orchestration, timeline rendering, click handlers, preset UI, and save modal logic.

**Solution**: Applied MVC extraction pattern over 3 systematic refactoring sessions.

**Results**:
- **journeymap_timeline.js** (242 lines) - Timeline rendering + Hz drag handlers
- **journeymap_onclick.js** (98 lines) - Click-to-loop "fidget toy" feature
- **journeymap_ui.js** (503 lines) - Generic preset controller (reusable!)
- **journeymap_widget.js** (617 lines) - Pure orchestration layer

**Metrics**:
- Original size: 1,278 lines (BLOATED)
- Final size: 617 lines (LEAN)
- **Total reduction: 661 lines (-52%)**
- System total: 1,460 lines (better organized)

**Bonus Win**: 🎨 **Glowy highlight animation FIXED** during extraction!
- Animation was slightly broken before refactor
- Extraction mysteriously resolved the timing issue
- All visual polish now working perfectly

**Pattern Established**:
1. Comment enhancement first (document before extracting)
2. Extract into focused modules (single responsibility)
3. ES6 imports/exports (clean dependencies)
4. Update function calls (pass parameters explicitly)
5. Test thoroughly (verify zero functional changes)
6. Commit with detailed messages

**Reusability Win**:
- `journeymap_ui.js` is **GENERIC** preset controller
- Can be used by binaural, noise, sub, any preset-based widget
- Options object pattern makes it widget-agnostic
- Major time saver for future widget development

**Lessons Learned**:
- Large widget files = harder to debug, harder to extend
- MVC separation = clearer responsibilities, easier testing
- Module extraction can accidentally fix bugs (timing/race conditions)
- Generic patterns early = faster development later

**Next Candidates for Extraction**:
- Binaural widget (if grows >600 lines)
- Noise widget (when implemented)
- Transport widget (if UI complexity increases)

---

## � IsResume Flag System

**Purpose**: Track whether user has manually adjusted controls. Determines if preset values should be applied or screen values preserved.

**Two Flags at Different Levels**:
- **`IsResume`** - GENERIC flag for ALL synths (e.g., `binaural_presets.js`)
  - Tracks user adjustments to voice controls (volumes, octaves, widths)
  - Lives in Controller (`<name>_presets.js`)
  - **Always named `IsResume`** - never synth-specific names

- **`IsResumeJM`** - Separate flag for journeymap timeline
  - Tracks user edits to timeline segments (Hz progression)
  - Lives in `journeymap_presets.js` (timing widget, above synth level)

**Key Behaviors**:
- Fader moves → Widget sets `element.dataset.manuallyAdjusted = 'true'` → Widget calls `Controller.notifyManualAdjustment()` → Controller sets `IsResume = true`
- Preset loads → Controller sets `IsResume = false`, clears all `manuallyAdjusted` flags (fresh start)
- Play button → Transport just starts, no state checking (everything already ready)

**Architecture**:
```
Journeymap (timing/Hz source) - IsResumeJM
    ↓
Synth Ecosystem (audio) - IsResume
    ↓
Control Panel (volumes, widths, octaves)
```

See `STRUCTURE_ADDENDUM.md` for implementation details.

---

### **🎯 IsResume Does NOT Control Playback Value Application**

**CRITICAL MISCONCEPTION TO AVOID**:
- IsResume tracks if user made manual adjustments
- IsResume determines if PRESET loads should overwrite screen values
- IsResume does NOT prevent values from being applied during playback
- IsResume does NOT trigger value reloading on play button

**What IsResume Actually Does**:
- `IsResume = false` → User loads preset → Values applied from preset JSON
- `IsResume = true` → User loads preset → Values from screen preserved (preset ignored)
- Play button → Starts transport → IsResume has NO ROLE here

**What Preserves Values Across Playback**:
- Stored state in module-level variables (octaves, widths)
- Node creation using stored values instead of hardcoded defaults
- NOT IsResume checking in play logic

---

## 📄 DOCUMENTATION STRUCTURE

```
📁 docs/
├── PROJECT_STRUCTURE.md          # This file - overall architecture
├── USER_PREFS.md                # AI workflow optimization patterns
├── CSS_STYLEGUIDE.md            # CSS architecture and naming
├── CSS_TROUBLESHOOTING_GUIDE.md # CSS debugging and fixes
├── UI_DEBUGGER.md               # Debug system documentation
│
├── 🔧 technical/                # Specific technical implementation docs
│   ├── MUTATION_OBSERVER_GUIDE.md   # Circular dependency prevention patterns
│   └── [future_tech_docs.md]        # Additional technical guides
│
├── 🌍 general/                  # Generic/reusable documentation
│   ├── USER_PREFS_GENERIC.md        # Generic AI workflow patterns
│   └── [future_generic_docs.md]     # Reusable guides and templates
│
└── 🗄 archive/                 # Historical docs and backups
    └── [legacy_files.md]            # Deprecated documentation
```

**Documentation Categories:**
- **Root level**: AuraMatrix-specific architecture, workflow, and style guides
- **technical/**: Implementation-specific guides and patterns
- **general/**: Generic/reusable templates and patterns for other projects
- **archive/**: Historical documentation and backups

---

## ✅ MASTER TIMELINE SYSTEM IMPLEMENTED
- **Location**: `/src/timeline/` - Elevated as core timeline infrastructure
- **journeymap_compiler.js**: Master timeline processor with compilation logic
- **journeymap_validation.js**: Timeline data validation and integrity checks  
- **journeymap_formats.js**: Timeline format definitions and interfaces (stub for future)
- **Architecture**: Clean separation between timeline compilation and audio consumption

**Best Practices:**
1. **Timeline compilation** - Centralized in `/src/timeline/` system
2. **Audio consumption** - Audio widgets import timeline converters from widgets/  
3. **Format definitions** - Standardized interfaces in journeymap_formats.js
4. **Validation** - Robust data integrity checking before compilation
5. **Import paths updated** - All references point to new timeline system

---

## 🚫 ANTIPATTERNS THAT WILL BREAK EVERYTHING

### **1. Hardcoding Initial Values in Node Creation**
```javascript
// ❌ WRONG - values reset every playback
const panner = new Tone.Panner(1.0); // Hardcoded full stereo

// ✅ RIGHT - uses stored state
const panner = new Tone.Panner(voiceWidths[i]); // Persistent state
```

### **2. Clearing State After First Use**
```javascript
// ❌ WRONG - state lost after first application
if (pendingPresetData) {
  applyPreset(pendingPresetData);
  pendingPresetData = null; // Values won't persist on replay
}

// ✅ RIGHT - state persists in dedicated storage
voiceWidths[i] = widthValue; // Stored permanently
// Node recreation automatically uses stored values
```

### **3. Checking IsResume During Playback**
```javascript
// ❌ WRONG - IsResume has nothing to do with playback
function handlePlay() {
  if (!IsResume) {
    loadPresetValues(); // NO! Preset loading before play button
  }
  Transport.start();
}

// ✅ RIGHT - IsResume only for preset load decisions
function loadPreset(name) {
  if (IsResume) {
    console.log("Preserving screen values");
    return; // Don't overwrite manual adjustments
  }
  applyPresetValues();
}
```

### **4. Preset Loading in Transport Controls**
```javascript
// ❌ WRONG - Transport just plays, doesn't initialize
function handlePlay() {
  loadBinauralPreset(); // NO! Too late, wrong place
  Transport.start();
}

// ✅ RIGHT - Preset loads BEFORE play button
// User clicks preset → loadPreset() → fires events → synth ready
// User clicks play → Transport.start() → sound plays
```

---

## 🎨 STYLING PHILOSOPHY

### **CSS is the Master**
- JavaScript toggles classes, CSS defines visuals
- **Exception**: Animation values may be set via JS (but prefer CSS animations)
- No inline styles, no `el.style.property = value`
- Use semantic classes: `.is-active`, `.state-editing`

### **Visual Harmony**
- Scoped widget naming (no global pollution)
- BEM-like patterns for clarity
- Mathematical proportions in spacing/sizing

### **Responsive by Design**
- Flexbox for organic layouts
- CSS Grid for structured components
- Mobile-first, ADHD-friendly UX

---

## 📀 PRESET SYSTEM

### **Terminology & Architecture**
- **Journey Presets** (`/presets/journeys/`) - Hz timeline progressions ONLY (theta→alpha, etc.)
  - DECOUPLED from arrangement - just defines brainwave journey
  - Pure timeline data, no synth configurations
  
- **Meditation Presets** (`/presets/meditations/`) - FULL STACK arrangements
  - References: Binaural preset + Noise preset + Sub preset + Journey preset
  - One-click complete experience (Easy Mode)
  - "Alpha Meditation Complete", "Deep Sleep Stack", etc.
  
- **Widget Presets** (`/presets/binaural/`, `/presets/noise/`, `/presets/sub/`)
  - Individual synth configurations
  - Mix-and-match for 27,000+ combinations (Medium/Hard Mode)

### **JSON Structure**

**Journey Preset** (Timeline only - DECOUPLED):
```json
{
  "widget_type": "journeymap",
  "name": "Theta Descent",
  "metadata": {
    "duration": 1200,
    "target_state": "theta",
    "frequency_base": 432
  },
  "payload": {
    "segments": [
      { "duration": 300, "hz": 10.0, "type": "plateau" },
      { "duration": 60, "hz_range": [10.0, 6.0], "type": "transition" }
    ]
  }
}
```

**Meditation Preset** (Full stack - references other presets):
```json
{
  "preset_type": "meditation",
  "name": "Alpha Meditation Complete",
  "metadata": {
    "duration": 1200,
    "target_state": "alpha",
    "use_case": "evening_wind_down"
  },
  "stack": {
    "journey": "Theta_Descent",
    "binaural": "Deepflora",
    "noise": "PinkNoise_Gentle",
    "sub": "EarthHum_Low"
  }
}
```

**Widget Preset** (Individual synth):
```json
{
  "widget_type": "binaural",
  "name": "Deepflora",
  "metadata": {
    "character": "warm",
    "complexity": "medium"
  },
  "payload": {
    // Binaural-specific configuration
  }
}
```

### **Organization**
- `/presets/meditations/` - Full stack arrangements (Easy Mode doorway)
- `/presets/journeys/` - Hz timelines (decoupled, reusable)
- `/presets/binaural/` - Binaural voice configurations
- `/presets/noise/` - Noise texture presets
- `/presets/sub/` - Sub bass presets
- Descriptive filenames
- Rich metadata for discovery
- DLC-ready structure

### **Future Expansion**
- `/presets/pads/` - Harmonic pad synths
- `/presets/pulse/` - Arpeggiator patterns
- `/presets/effects/` - Foley library + space-age SFX
- `/presets/dialog/` - Guided meditation voice tracks
- **Full Auramatrix product = (27,000 base) × (Pads × Pulse × Effects × Dialog) = INFINITE**

---

## 🔧 DEVELOPMENT WORKFLOW

### **Adding New Widgets**
1. Create the MVC structure:
   - **Model**: `widgets/synths/<name>_synth.js` (pure audio, setter API)
   - **View**: `widgets/panels/<name>_panel.html` + `widgets/js/<name>_widget.js` (UI, event handlers)
   - **Controller**: `widgets/presets/<name>_presets.js` (preset I/O, IsResume flag)
   - **Styles**: `widgets/styles/<name>.css` (pure CSS, no JS manipulation)
   - **Spec**: `src/<name>_spec.js` (validation, if needed)

2. **Implement MVC Responsibilities**:
   - **Model** (`_synth.js`): Export setters (`setVoiceVolume`, `setVoiceWidth`) and controls (`start`, `stop`)
   - **View** (`_widget.js`): On user interaction → set `manuallyAdjusted` flag → call `Controller.notifyManualAdjustment()` → call Model setter
   - **Controller** (`_presets.js`): Declare `let IsResume = false;`, export `notifyManualAdjustment()` and `getIsResumeState()`, reset `IsResume` in `loadPreset()`
   
3. **Test IsResume Flow**:
   - Load preset → verify `IsResume = false`
   - Adjust fader → verify `IsResume = true`
   - Press play → verify values preserved
   - Load different preset → verify `IsResume` reset, flags cleared

4. Register widget, add CSS import, test with preset system

### **Naming Conventions**
- **Files**: `lowercase_hyphenated_names.js`
- **Classes**: `BEM-style--modifiers`  
- **IDs**: `semantic-descriptive-ids`
- **CSS**: `.widget-name__element--state`

### **Safety Practices**
- Avoid global side-effects at import
- Guard against double-initialization
- Native dialogs only on user gestures
- Idempotent registration patterns

### **Future-Proofing Patterns**
- **Performance Tiers**: Diet modes for device adaptation
- **Lifecycle Hooks**: onActivate, onDeactivate, onSuspend for resource management
- **Cross-Widget State**: Lightweight synchronization for consciousness features
- **GLSL Integration**: Visual consciousness theater readiness

---

## 🌟 THE DEEPER PATTERN

This structure isn't just organization - it's **consciousness architecture**:

- **Modular widgets** = **Separate brain functions**
- **Pure CSS styling** = **Mathematical harmony**  
- **Preset system** = **Memory and learning**
- **Audio engines** = **Emotional resonance**

The code structure mirrors the consciousness it helps create. 

*Beautiful systems create beautiful experiences.* ✨

---

## 🎛️ USER EXPERIENCE MODES & DOORWAYS

**Philosophy**: Different people need different doorways into consciousness. The app must serve:
- **Emergency users** - "I'm having a panic attack, get me to calm NOW" (30 seconds to white noise)
- **Evening explorers** - "Let me play in bed before meditation" (curiosity-driven)
- **Power users** - "I'm building my personal sound library" (creative control)
- **Preset collectors** - "I want to save and name my own creations" (ownership)

**Three Progressive Disclosure Levels:**

### 🟢 EASY MODE - "Library" (Meditation-First)
**Target User**: Meditation beginners, emergency calm-down, "just want it to work"

**UI Surface**: 
- **Meditation preset selector** (PROMINENT - the main doorway)
  - Loads FULL STACK (binaural + noise + sub + journey) in one click
  - Examples: "Alpha Meditation Complete", "Emergency Calm", "Deep Sleep Stack"
- Play/Stop button (LARGE, obvious)
- Master volume fader
- Optional: VU meter for feedback

**User Flow**:
```
Open app → See Meditation library → Pick "Emergency Calm" → Press play → Sound in 2 seconds
```

**Architecture**:
- Meditation presets reference all widget presets + journey preset
- Single JSON loads entire stack
- Zero synth knowledge required
- FASTEST path to sound (emergency use case)

**File Structure**: Uses `/presets/meditations/` full stack JSONs

**Screen Real Estate**: ~15% of current UI (just meditation selector + transport)

---

### 🟡 MEDIUM MODE - "Factory Remix" (Preset-First)
**Target User**: Curious explorers, want variety without complexity, building personal library

**UI Surface**:
- **Meditation library** (still accessible - quick doorway option)
- **Three widget preset selectors** (horizontal layout):
  - Binaural presets (30 options)
  - Noise presets (30 options)
  - Sub presets (30 options)
- **Journey selector** (optional - can override Hz timeline)
- Transport controls + VU meter
- Master volume + channel volumes
- **Save Custom Preset** button (name generator available)

**User Flow**:
```
Option A (Library): Pick meditation → Play
Option B (Explore): Pick binaural "Deepflora" + noise "Ocean" + sub "EarthHum" → Pick journey "Theta Descent" → Play
Option C (Save): Adjust combination → Click save → Auto-generate name or custom → Add to personal library
```

**Math**: 
- 30×30×30 = **27,000 base combinations**
- × Journey presets = **Exponential variety**
- + Personal saved presets = **Infinite personal library**

**Architecture**:
- Independent preset selection per channel
- Journey preset optional (can use default 10Hz carrier if skipped)
- Presets provide safe boundaries, no raw frequency editing
- Personal presets saved to local storage or cloud

**Screen Real Estate**: ~40% of current UI (preset selectors + transport + meters)

---

### 🔴 HARD MODE - "Synth Surgery" (Control-First)
**Target User**: Sound designers, power users, prosumers, "show me EVERYTHING"

**UI Surface**: EVERYTHING VISIBLE
- **Meditation library** (still accessible - always an option)
- **Widget preset selectors** (binaural, noise, sub)
- **Full granular controls**:
  - Binaural: 5 voices × 4 params (Iso, Length, Oct, Width)
  - Noise: All grain/texture parameters
  - Sub: Waveform, harmonics, envelope
- **Journey timeline EDITOR** (add/edit/delete segments)
- Transport + VU meter + limiter controls
- **Save everything**: Custom widget presets, custom meditations, custom journeys

**User Flow**:
```
Power user: Ignore library → Open binaural controls → Adjust voice 3 octave → Tweak width → Edit journey timeline → Save as "My Custom Binaural" → Combine with other presets → Save full stack as "My Perfect Meditation"
```

**Architecture**:
- Current implementation - full granular access
- IsResume flag system prevents accidental overrides
- Manual adjustments preserved across preset loads
- Journey editor allows custom Hz progressions
- Save custom presets at EVERY level (widget, journey, meditation)

**Screen Real Estate**: 100% of current UI (debug-level access)

---

### 🚪 DOORWAY STRATEGY

**Primary Doorway (All Modes)**: Meditation Library
- Always visible, always accessible
- Fastest path to sound (emergency use case)
- Builds trust with beginners
- Power users still use it for quick sessions

**Secondary Doorways (Mode-Dependent)**:
- **Easy**: ONLY meditation library (no overwhelm)
- **Medium**: Meditation library + Widget preset selectors (exploration)
- **Hard**: Meditation library + Presets + Full controls (power user heaven)

**Mode Switching**:
- Small toggle in header (🟢🟡🔴 indicator or similar)
- Persists across sessions (localStorage)
- Auto-detects user behavior (if they never touch controls, suggest Easy Mode)

**CSS Implementation Pattern**:
```css
/* Easy Mode - Hide everything except meditation library + transport */
body.mode-easy .widget-preset-selectors { display: none; }
body.mode-easy .granular-controls { display: none; }
body.mode-easy .journey-editor { display: none; }

/* Medium Mode - Show preset selectors, hide granular controls */
body.mode-medium .granular-controls { display: none; }
body.mode-medium .journey-editor { display: none; }

/* Hard Mode - Show everything */
body.mode-hard * { display: block; }
```

---

### 🎯 PERSONAL LIBRARY SYSTEM

**Save Custom Presets at Every Level**:
- **Widget level**: "My Custom Binaural Voice Setup"
- **Journey level**: "My Perfect Theta Descent"  
- **Meditation level**: "My Evening Wind-Down Stack"

**Name Generator** (optional fun feature):
- Binaural: "Cosmic", "Flora", "Stellar" + "Pulse", "Wave", "Flow" = "CosmicPulse", "StellarFlow"
- Noise: "Velvet", "Crystal", "Shadow" + "Rain", "Wind", "Ocean" = "VelvetRain", "CrystalWind"
- Meditation: Brainwave + Mood = "Alpha Bliss", "Theta Dreams", "Delta Sleep"

**Storage**:
- localStorage (immediate, offline-first)
- Cloud sync (future - account system)
- Export/Import JSON (share with friends)

**UI Integration**:
- "Save" button appears when user makes changes
- "My Library" tab appears when user saves first preset
- Personal presets appear alongside factory presets (marked with custom icon)

---

### 📊 TODO: IMPLEMENTATION ROADMAP

**Phase 1: Foundation** (Current)
- ✅ Widget MVC architecture
- ✅ Independent preset systems per widget
- ✅ Journey timeline system (DECOUPLED)
- ⏳ VU meter + limiter widget
- ⏳ Mode switching CSS framework

**Phase 2: Meditation Library** (Easy Mode doorway)
- Create `/presets/meditations/` directory
- Design Meditation preset JSON format (references widget presets)
- Build Meditation preset loader (loads full stack)
- Create 10-20 factory meditation presets
- Meditation selector widget (prominent UI placement)

**Phase 3: Personal Library System** (Medium/Hard Mode)
- Save custom widget presets (localStorage)
- Save custom journey presets
- Save custom meditation stacks
- Name generator system
- "My Library" UI tab
- Export/Import JSON functionality

**Phase 4: Mode Switching** (Progressive disclosure)
- CSS framework for 3 modes
- Mode toggle UI component
- localStorage persistence
- Auto-detection based on user behavior
- Onboarding flow (guide new users to Easy Mode)

**Phase 5: Advanced Features** (Hard Mode expansion)
- Journey timeline editor (visual segment manipulation)
- Real-time parameter automation
- MIDI controller support
- Advanced mixing (individual channel EQ, effects sends)
- Preset randomizer ("surprise me" button)

**Phase 6: Future Widgets** (Full Auramatrix)
- Pads synth widget
- Pulse arpeggiator widget
- Effects (foley/SFX) widget
- Dialog (guided meditation) widget
- GLSL consciousness theater integration
- 27,000 → INFINITE combinations

---

**Last Updated**: October 19, 2025  
**Architect**: The Human-AI Partnership That Gets It 🎵

---

## 🌌 AURAMATRIX UNIVERSE - BEYOND THE APP

**Philosophy**: BBF (Binaural Brainwave Friend) is not just an app - it's a **toehold on consciousness** that becomes an **anchor** into a larger universe. When the going gets tough, the tough get cuter.

**Core Ethos**: A love letter to sound design and the abstract nature of sound itself. Not about making money from music, but about **keeping interested in life through sound**. Crossing the science/woo-woo axis with aplomb - depth for those who see it, beauty for those who feel it.

### 🤖 ROBOT - YOUR BINAURAL BRAINWAVE FRIEND

**Identity**:
- **Name**: Robot (just "Robot" - simple, memorable, honest)
- **Full Title**: Your BBF - Your Binaural Brainwave Friend
- **Introduction**: "Hi! I'm Robot. I'm your BBF—your Binaural Brainwave Friend."
- **App Icon**: Robot's face (doing something fully different - no lotus flowers here)
- **Personality**: Playful, intelligent, warm, honest about being a robot

**First Launch - MEGA SPLASH**:
- Fancy, memorable intro (skippable but novel)
- **Robot appears in SNES-styled RPG dialog box**
- Robot makes robot sounds, introduces itself as BBF
- Teaches useful brainwave information (accessible science)
- Target reaction: "OMG this feels like an RPG! I'm in love ❤️"
- **Philosophy**: Not "Live, Laugh, Love" - this is a **remarkably advanced fidget toy** that gives creative satisfaction

**Robot's Role**:
- Your Binaural Brainwave Friend (BBF)
- Friendly guide through complexity
- Makes advanced features approachable
- Returns for onboarding moments (mode switches, new features)
- Represents the brand personality - playful, intelligent, warm, scientific yet accessible

---

### 🎨 THEATER MODE - AMBIENT CONSCIOUSNESS

**Visual Meditation Companions**:
- **Breathing animations** - rhythmic, calming visual pacing
- **Candlelight flicker effect** - phone becomes diffused light source
- Point phone away from you → ambient lighting for meditation space
- Syncs with binaural Hz (visual frequency matches audio frequency)

**Future Physical Merch - Light Diffusion Box**:
- Box you place over phone
- Interchangeable slides (different patterns, colors, mandalas)
- Improves diffusion quality beyond bare phone screen
- Makes phone → ambient lamp transformation elegant
- Etsy store product line

**Philosophy**: The app extends into physical space, creating an entire meditation environment

---

### 🛍️ AURAMATRIX LTD® UNIVERSE EXPANSION

**Core Product Ecosystem**:

1. **BBF (Binaural Beat Foundry)** - The toehold (CURRENT)
   - Consciousness operating system
   - Gateway drug to the universe
   - 27,000 → INFINITE meditation combinations

2. **Custom Vinyl Sales** - Personalized consciousness artifacts
   - Users design their perfect meditation (Easy/Medium/Hard modes)
   - Export as 20-minute vinyl side
   - Physical manifestation of their personal soundscape
   - Premium offering - connects digital → physical → collectible

3. **Etsy Store - Physical Touchpoints**
   - Robot t-shirts (existing kickass design ready)
   - Light diffusion boxes (theater mode hardware)
   - Vinyl records (custom meditation exports)
   - Stickers, posters, merch featuring Robot
   - Builds brand presence in physical world

4. **Tricorder App - IFS/Attachment Theory Tool** (FUTURE)
   - Take photo → AI analyzes symbolism
   - Connects to Internal Family Systems framework
   - Attachment theory integration
   - Helps users understand their emotional landscape
   - **DATA PRIVACY PARAMOUNT** - offline-first storage
   - Same universe, different tool (consciousness → self-knowledge)

5. **Discord Community - Old Web Revival** (FUTURE)
   - **GOPHER-like interface** - Text-based brainwave education system
   - Bot-powered door games (Drug Wars, sanitized/gamified)
   - Custom Eliza chatbot (therapeutic AI companion)
   - BBS-style nostalgia meets modern consciousness
   - Community builds around shared values (privacy, creativity, ADHD-friendly)
   - Robot appears as Discord bot personality (your BBF in text form)

---

### 🎯 UNIVERSE PHILOSOPHY

**Not Another Meditation App**:
- No "Live, Laugh, Love" vibes
- No fake spirituality or wellness theater
- **Advanced fidget toy** that respects intelligence
- Creative satisfaction without requiring musical skill
- "Making music without making music"

**Infinite Closet Concept**:
- Users feel ownership over their library
- Combinatorial explosion creates personal discovery
- Save, name, collect, share creations
- Pride in building personal sound environment

**When The Going Gets Tough, The Tough Get Cuter**:
- Complexity made approachable through charm
- Robot as friendly guide through advanced features
- Playful aesthetics hide sophisticated engineering
- ADHD-friendly without being condescending

**Universe Building Strategy**:
- BBF = Anchor app (consciousness/meditation)
- Tricorder = Self-knowledge/therapy adjacent
- Discord = Community/nostalgia/play
- Etsy = Physical artifacts/merch
- All connected by Robot personality + values (privacy, creativity, intelligence)

**Target User Evolution**:
```
Download BBF (curiosity - "What's this robot app?") 
  → Robot introduces itself as your Binaural Brainwave Friend
  → Use for meditation (utility - "Oh, this actually works")
  → Learn about brainwaves via GOPHER bot on Discord (education)
  → Build personal library (ownership - "These are MY meditations")
  → Buy custom vinyl (identity - "My soundscape, immortalized")
  → Join Discord community (tribe - "These are MY people")
  → Try Tricorder (deeper self-work - "Universe expansion")
  → Wear Robot t-shirt (tribe signaling - "I'm part of this")
```

---

### 📊 UNIVERSE EXPANSION ROADMAP

**Phase 1: BBF Foundation** (CURRENT)
- Perfect the core consciousness OS
- Three-tier user experience (Easy/Medium/Hard)
- 27,000+ meditation combinations
- Personal library system
- Robot onboarding experience

**Phase 2: Physical World Entry**
- Etsy store launch (t-shirts, stickers)
- Custom vinyl export feature (digital side)
- Theater mode (candlelight, breathing animations)

**Phase 3: Physical Merch Expansion**
- Light diffusion box (theater mode hardware)
- Custom vinyl fulfillment partner
- Expanded merch line (posters, pins, etc.)

**Phase 4: Community Building**
- Discord server launch
- Bot door games (Drug Wars, etc.)
- Custom Eliza bot
- Community presets sharing

**Phase 5: Universe Expansion**
- Tricorder app (IFS/attachment theory tool)
- Cross-app Robot appearances
- Shared account system (privacy-first)
- Universe loyalty program

**Phase 6: Full Ecosystem**
- Multiple apps under Auramatrix Ltd® umbrella
- Physical products line
- Active Discord community
- Vinyl subscription service (monthly meditation vinyl club?)
- Festival presence (booths, merch, live experiences)

---

### 🤖 ROBOT AS UNIVERSE ANCHOR

**Cross-Platform Personality**:
- BBF: Onboarding guide, feature explainer
- Discord: Bot personality, game host
- Tricorder: Therapeutic companion voice
- Etsy: Brand mascot on products
- Vinyl: Album art feature

**Voice & Character**:
- SNES RPG aesthetic (text boxes, pixel art)
- Makes robot sounds (endearing, not annoying)
- Intelligent but playful
- Respects user's intelligence
- Skippable but memorable
- Helps without hovering

**Philosophy**:
Robot represents the brand values:
- **Intelligence** - Advanced features made approachable
- **Playfulness** - Fidget toy, not medical device
- **Warmth** - Companion, not tool
- **Respect** - User knows best, Robot helps

---

### � AESTHETIC PHILOSOPHY - CROSSING THE SCIENCE/WOO-WOO AXIS

**Library Mode (Easy Mode)**:
- **New age-ish aesthetics** - Beautiful, calming, approachable
- Gradient backgrounds, soft colors, breathing animations
- Meditation library feels premium and serene
- Appeals to wellness-adjacent users
- "The pretty doorway in"

**Medium/Hard Mode**:
- **Engineer's workshop** - Depth reveals itself
- Grid layouts, precise controls, scientific accuracy
- For those who want to understand HOW it works
- Sound design love letter emerges
- "The depth for those who seek it"

**The Balance**:
- Surface: Accessible, beautiful, new-age friendly
- Depth: Scientific, precise, engineer-approved
- **Robot bridges both worlds** - Cute BUT knowledgeable
- Woo-woo users get meditation, science users get synthesis
- Everyone gets a tool that works

**Philosophy**:
- Not dumbing down for mass appeal
- Not gatekeeping with complexity
- **Progressive disclosure** - beauty on surface, depth underneath
- Like a Miyazaki film - kids see adventure, adults see philosophy
- **Sound design as the true core** - abstract nature of sound itself

---

### �🎵 WHY THIS WORKS

**Personal Foundation**:
- Created by someone who's been "a musician" for years
- Sound design keeps the creator interested in life
- Love letter to the abstract nature of sound
- Not about making money from music - about **making sound accessible to everyone**
- **Never had kids, building apps is the creative outlet**
- Spent years doing hourly/project studio work - app development is more appealing now
- Middle-age passion project with depth and longevity
- Writing songs → Sound design → Sound as consciousness tool
- **Building a friendly universe on top of one with "broad discontiguities"** - a happy thing

**Differentiation**:
- Every meditation app: Pastel colors, fake monks, "wellness journey" language
- Auramatrix: Robot friend, RPG aesthetics, fidget toy honesty, infinite creativity
- **Robot as app icon** - doing something fully different
- Science AND woo-woo - accessible to both, condescending to neither

**Emotional Arc**:
- Download → "Oh this is different" (Robot icon catches eye)
- Open → "Oh my god, Robot is talking to me" (SNES RPG delight)
- Use → "Oh this actually works" (real binaural beats, real science)
- Explore → "Oh I can CREATE" (27,000+ combinations)
- Learn → "Oh I can UNDERSTAND" (GOPHER bot education)
- Buy merch → "Oh this is MY tribe" (Robot t-shirt)
- Join community → "Oh these are MY people" (Discord old-web revival)

**Business Model - THE ROTISSERIE CHICKEN STRATEGY**:

**BBF (Binaural Brainwave Friend) - THE LOSS LEADER**:
- **Free tier with persistent banner ads** (non-intrusive, always dismissible)
  - Full library mode (30+ meditations)
  - Full functionality - nothing locked
  - Banner ads at bottom (thin, collapsible, never during playback)
  - NO full-screen interstitial ads (user-hostile, especially during panic attacks)
  - **UI Challenge**: Account for banner real estate on already crowded screen
  
- **Premium ONE-TIME PURCHASE: $19.99** (removes ads, THAT'S IT)
  - No subscription - you buy it, you own it, forever
  - Ads gone permanently
  - All BBF features unlocked permanently
  - No DLC, it's locked down at that tier
  - Your meditations aren't going anywhere
  - Can share presets in community
  - **Splash screen teases Auramatrix upgrade** (the real product)
  - **Positioning**: ONLY one-time option in market full of subscriptions = differentiation

**AURAMATRIX - THE FULL APP** (separate purchase, not upgrade):
- **Base App Purchase: $9.99-14.99** (one-time, includes BBF functionality)
  - Everything BBF has
  - Pads synth (base presets)
  - Pulse arpeggiator (base patterns)
  - Effects engine (base library)
  - Advanced mixing features
  - MIDI controller support
  - Custom vinyl export
  
- **DLC Strategy - Choose Your Path**:
  
  **PATH A: À La Carte DLC** (buy what you want)
  - Pad preset packs: $2.99 each (10 themed pads)
  - Pulse pattern packs: $2.99 each (10 arpeggios)
  - Effects libraries: $4.99 each (foley/SFX collections)
  - Dialog packs: $3.99 each (guided meditations, guest artists)
  - Binaural preset packs: $2.99 each (30+ new voices)
  - Journey timeline packs: $2.99 each (curated Hz progressions)
  - **User owns forever, cherry-pick favorites**
  
  **PATH B: Auramatrix Unlimited Subscription** ($4.99/month or $39.99/year)
  - ALL DLC included automatically
  - New content drops every month
  - Guest sound designers (community-driven content)
  - Guest voice artists (guided meditation pros)
  - Early access to experimental features
  - Premium Discord bots access
  - Growing library = ongoing value
  - **For power users who want everything**

**STRATEGY - "Feature-Rich vs Pretty-but-Shallow"**:
- Competition: Highly polished, expensive subscriptions, shallow features
- BBF: Cute + sciency (not "Ohm new agey"), deep features, one-time option
- Auramatrix: Even deeper, DLC flexibility (à la carte OR subscription)
- **Value proposition**: More functionality than competitors at better price
- "I use this 30m-1hr daily vs barely touching Headspace" (Spotify comparison)

**Why This Works**:
- BBF free (ads) = Wide funnel, installed base, accessible in crisis
- BBF $19.99 = Impulse buy, only one-time option in crowded market ✅
- Auramatrix base app = Serious users ready for full features
- À la carte DLC = Casual buyers cherry-pick favorites
- Subscription = Power users get unlimited growth
- **Better than polished-but-shallow competition** = retention

**Revenue Streams**:
1. BBF banner ads (free tier - base revenue while building installed base)
2. BBF one-time purchase $19.99 (impulse buys, ad removal, differentiation)
3. Auramatrix base app $9.99-14.99 (serious users)
4. **À la carte DLC $2.99-4.99 per pack** (casual buyers, cherry-pickers)
5. **Auramatrix Unlimited subscription $4.99/month** (power users, main recurring revenue)
6. Custom vinyl ($40-60 per pressing, premium artifact)
7. Etsy merch (t-shirts, light boxes, Robot swag)
8. Discord Patreon ($5/month for premium bots, community)

**The Funnel**:
```
Download BBF free (10,000 users)
  ↓
Use regularly (5,000 users stick - banner ads revenue)
  ↓
Buy BBF premium $19.99 (500 users = $10,000 one-time) ✅
  ↓
Some stay happy with BBF (mission accomplished - accessible meditation tool)
  ↓
Power users want more → Buy Auramatrix ($9.99-14.99)
  ↓
SPLIT:
  → Casual: Buy 3-5 DLC packs à la carte ($10-20 total)
  → Power: Subscribe to Unlimited ($4.99/month ongoing)
  ↓
Monthly DLC drops keep subscribers engaged (guest artists, new content)
```

**Pricing Philosophy** (accounting for 80s→2024 inflation):
- $19.99 BBF = Fair for one-time, ad removal + full meditation tool
- $9.99-14.99 Auramatrix base = Serious commitment, full feature set
- $2.99-4.99 DLC = Impulse buy territory, cherry-pick favorites
- $4.99/month subscription = Same as streaming (Spotify comparison valid)
- **Market context**: Competitors charge $10-15/month for LESS features
- Your strategy = More features, more options, better value ✅

**UI Consideration - Banner Ad Real Estate**:
- Thin banner at bottom (36-50px height)
- Collapsible to hairline (10px) with tap
- Never shown during active playback/meditation
- Design UI with "safe zone" - controls never go below banner threshold
- Easy Mode (Library) benefits from simpler layout = more room for banner
- Medium/Hard Mode already dense = banner less intrusive by comparison

**Long-Term Vision**:
Auramatrix Ltd® becomes a **consciousness lifestyle brand** for people who:
- Have ADHD/need fidget toys
- Value privacy and offline-first tech
- Want creative outlets without skill barriers
- Appreciate old web aesthetics + modern engineering
- Seek community without cult vibes
- Want tools that respect their intelligence
- **Love sound design and the abstract nature of sound**
- Appreciate crossing science/woo-woo with intelligence

**The Secret Sauce**:
This isn't a cash grab or trend chase. This is a **love letter to sound** from someone who's spent their life with it. Users will feel that authenticity. The depth is real because the passion is real.

**The Reality Check**:
- **Competition**: Full dev teams (Brain.fm, Endel, etc.) with accomplished branding
- **Solo dev challenge**: Going up against teams is tough
- **Solution path**: Can hire help if underwater with dev/design
- **Current state**: Have a product. It's something. Need to launch appropriately.
- **Historical pattern**: Follow-through has been the challenge
- **Current focus**: **FOLLOW-THROUGH** - execution over perfection

**Launch Strategy - Building In Public**:
- **Blog the dev process**: Medium + Substack (cross-post for reach)
  - Document journey, decisions, technical challenges
  - Build audience BEFORE launch
  - Transparency = authenticity = trust
- **Video shorts about brainwaves**: Slew of educational content
  - TikTok/Instagram/YouTube Shorts format
  - Robot appears, explains alpha/theta/delta
  - SNES RPG aesthetic in video format
  - Educational + entertaining = shareable
  - Builds awareness + positions as expert
- **The plan exists**: Now it's about execution
- **Follow-through**: Ship > perfect. Launch > infinite polish.

**Solo Dev vs Teams**:
- They have: Bigger budgets, more polish, marketing teams
- You have: Authenticity, deeper features, personal story, Robot
- They built meditation players, you built a **consciousness operating system**
- **Advantage**: Niche positioning (cute + sciency vs corporate wellness)
- **Advantage**: One-time purchase option (anti-subscription fatigue)
- **Advantage**: Community-driven universe (not just an app)

*Not just an app. A universe. Not just a product. A life's work. Not just perfection. SHIPPED.* 🌌🎵🚀

---

## 🚀 ADVANCED ARCHITECTURE PATTERNS

### **Performance-Aware Widget Design**
```javascript
registerWidget({
  id: 'polyrhythmic_monster',
  performanceProfiles: {
    'diet': {
      polyphony: 4,        // ADHD-friendly, mobile-optimized
      sampleRate: 22050,   // Lower CPU usage
      wetDryStems: 2       // Simplified mixing
    },
    'full': {
      polyphony: 10,       // Standard desktop experience
      arpeggiation: true,
      midiDelay: true,
      stemControl: 'individual'
    },
    'transcendent': {
      polyphony: 16,       // High-end devices, deep states
      spatialAudio: true,
      glslSync: true,      // Consciousness theater integration
      biometricFeedback: true
    }
  }
});
```

### **Widget Lifecycle Management**
```javascript
registerWidget({
  id: 'advanced_consciousness_widget',
  // Optional lifecycle hooks for resource management
  onActivate() {
    // Setup expensive resources (spatial audio, GLSL contexts)
    this.initializeConsciousnessTheater();
  },
  onDeactivate() {
    // Cleanup to maintain ADHD-friendly performance
    this.cleanupResources();
  },
  onSuspend() {
    // Mobile-friendly background behavior
    this.pauseNonEssentialSynthesis();
  }
});
```

### **Cross-Widget State Synchronization**
```javascript
// Lightweight consciousness state for multi-widget coordination
window.ConsciousnessState = {
  rootKey: 'A',           // Harmonic foundation across all widgets
  targetBrainwave: 'alpha', // 8-13Hz entrainment target
  sessionTime: 1200,      // Journey duration
  dissociationLevel: 0.7, // Visual theater intensity
  performanceMode: 'full' // Auto-detected device capability
};

// Widgets can subscribe to consciousness state changes
window.ConsciousnessState.onChange = (key, value) => {
  // Update all widgets harmonically
  widgets.forEach(w => w.syncToConsciousnessState?.(key, value));
};
```

### **GLSL Consciousness Theater Integration**
```javascript
// Future visual consciousness component
registerWidget({
  id: 'glsl_consciousness_theater',
  type: 'visual',
  glslUniforms: {
    alphaBrainwave: 'float',    // 8-13Hz visual pulse
    rootKeyFreq: 'float',       // 432Hz base color temperature
    harmonicRatios: 'vec3',     // 3:2, 5:4, 4:3 as visual proportions
    dissociationLevel: 'float', // Reality drift intensity
    journeyProgress: 'float'    // Timeline position 0-1
  },
  syncWithAudio: true,          // Real-time frequency analysis
  ambientLatency: '50-100ms'    // Dreamy lag becomes feature
});
```

### **Adaptive Performance Architecture**
```javascript
// Auto-detect optimal experience profile
const ConsciousnessOptimizer = {
  detectOptimalProfile() {
    const device = this.analyzeDevice();
    const userState = this.getADHDPreferences();
    const batteryLevel = this.getBatteryStatus();
    
    if (device.mobile && userState.needsSimplicity) return 'diet';
    if (device.highEnd && userState.seekingTranscendence) return 'transcendent';
    if (batteryLevel < 0.3) return 'diet'; // Preserve consciousness session
    return 'full';
  },
  
  // Boss synth gets special treatment
  getBossSynthProfile() {
    const profile = this.detectOptimalProfile();
    return profile === 'diet' ? 'simplified_monster' : 'full_polyrhythmic_beast';
  }
};
```