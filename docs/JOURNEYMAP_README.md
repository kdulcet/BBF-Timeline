# Journeymap Architecture

## Overview
Journeymap is the **timeline orchestration system** for Auramatrix. It schedules BPM changes (transport layer) and Hz frequency changes (binaural layer) over time to create "journey" experiences.

## Core Principle
**journeymap_presets.js manages the timeline MAP.** It speaks to two systems:
1. **Transport** - Handles BPM/timing via `Tone.Transport` (DIRECT)
2. **binaural_presets.js** - Receives Hz maps, formats and schedules to synth

**CORE TECHNOLOGY**: `BPM = (Hz * 60) / 8`
- **Binaural Hz drives transport BPM** - this is HOW THE APP WORKS
- Journey JSON contains Hz values, BPM is CALCULATED from Hz
- This formula is the CORE TECHNOLOGY, not a hack

**CRITICAL FLOW**:
```
journeymap_presets: "Hey y'all here's the current map"
  - Calculates BPM from Hz: (Hz * 60) / 8
  - Schedules BPM to Transport
  - Passes Hz map to binaural_presets
                ↓
binaural_presets: "I TALK TO SYNTHS AND WIDGETS MOSTLY"
  - Formats Hz data
  - Schedules to synth
  - Manages IsResume
  - Notifies widgets
                ↓
binaural_synth: "Dumb oscillators go brrr"
```

**journeymap does NOT talk to synth directly. EVER.**

---

## Architecture Tiers

### Top Tier (Timeline System)
```
┌─────────────────────────────────────────────┐
│    JOURNEYMAP_PRESETS (Controller)          │
│                                             │
│  Responsibilities:                          │
│  - Load journey JSON files                  │
│  - Schedule BPM changes → Transport         │
│  - Schedule Hz changes → binaural_presets   │
│  - Pre-calculate entire timeline            │
│  - Manage IsResume for journeymap           │
└─────────────────────────────────────────────┘
         │                           │
         │ BPM map                   │ Hz map
         ▼                           ▼
┌─────────────────┐         ┌─────────────────┐
│   TRANSPORT     │         │ BINAURAL_PRESETS│
│  (Tone.Transport)│         │   (Controller)  │
│                 │         │                 │
│ - Start audio   │         │ - Format Hz data│
│ - BPM timing    │         │ - Call synth    │
│ - Transport.now │         │ - Manage IsResume│
└─────────────────┘         └─────────────────┘
```

### Synth/Control Panel/MVC Tier
```
┌──────────────────────────────────────────────────────────┐
│                    BINAURAL SYSTEM                       │
└──────────────────────────────────────────────────────────┘
         
    VIEW                CONTROLLER              MODEL
┌──────────────┐   ┌──────────────────┐   ┌──────────────┐
│binaural_panel│   │ binaural_presets │   │binaural_synth│
│binaural_widget│   │                  │   │              │
│              │   │ Responsibilities: │   │Responsibilities│
│Responsibilities│   │ - Load presets  │   │ - 5x2 oscs   │
│- Display UI  │◄─►│ - Format Hz map  │──►│ - Set freqs  │
│- Fader drag  │   │ - Call synth API │   │ - Start/stop │
│- Read screen │   │ - Manage IsResume│   │ - Just intone│
│- manuallyAdj │   │ - Notify widgets │   │              │
└──────────────┘   └──────────────────┘   └──────────────┘
```

---

## Data Flow: Loading a Journey

### Step 1: User clicks journey preset
```
User → journeymap_panel.js → journeymap_widget.js
```

### Step 2: Journeymap loads timeline
```javascript
// journeymap_widget.js
loadJourney('presets/journeys/example.json')
  ↓
Parse JSON: { segments: [...] }
  ↓
journeymap_presets.js → playJourneyTimeline()
```

### Step 3: Journeymap calculates BPM and passes map to binaural_presets
```javascript
// journeymap_presets.js
playJourneyTimeline(timeline) {
  // Pre-calculate all segments
  let currentTime = 0
  timeline.segments.forEach(segment => {
    // CORE TECHNOLOGY: Calculate BPM from Hz
    const bpm = (segment.hz * 60) / 8  // Hz drives BPM!
    
    // Schedule BPM → Transport (direct)
    Tone.Transport.schedule(() => {
      Tone.Transport.bpm.value = bpm
    }, currentTime)
    
    // Pass Hz map to binaural_presets (NOT synth!)
    // journeymap says: "Hey binaural_presets, here's the current map"
    // binaural_presets does ALL formatting and scheduling to synth
    Tone.Transport.schedule((time) => {
      binaural_presets.applyJourneySegment(segment, time, duration)
    }, currentTime)
    
    currentTime += duration
  })
  
  // START
  Tone.Transport.start()
  binaural_presets.startSynth() // binaural_presets owns synth communication
}
```

### Step 4: binaural_presets formats and schedules to synth
```javascript
// binaural_presets.js → applyJourneySegment()
applyJourneySegment(segment, time, duration) {
  // PRESETTER'S JOB: Format Hz data for synth
  const voiceFreqs = segment.frequencies.map((hz, index) => ({
    leftFreq: carrierFreq + scaleOffset - (hz/2),
    rightFreq: carrierFreq + scaleOffset + (hz/2)
  }))
  
  // PRESETTER'S JOB: Schedule to synth
  binaural_synth.scheduleVoiceFrequencies(voiceFreqs, time, duration)
}
```

### Step 5: Synth just plays
```javascript
// binaural_synth.js
scheduleVoiceFrequencies(voiceFreqs, time, duration) {
  // Dumb synth - just schedule ramps
  voiceFreqs.forEach((freq, i) => {
    leftOscs[i].frequency.linearRampToValueAtTime(freq.leftFreq, time + duration)
    rightOscs[i].frequency.linearRampToValueAtTime(freq.rightFreq, time + duration)
  })
}
```

---

## Data Flow: Manual Adjustments (IsResume)

### Scenario: User drags fader during journey playback

```
User drags fader
  ↓
binaural_widget.js detects drag
  ↓
widget.dataset.manuallyAdjusted = 'true'
  ↓
binaural_presets.notifyManualAdjustment(voiceIndex)
  ↓
binaural_presets.js → IsResume[voiceIndex] = true
  ↓
binaural_synth.setVoiceVolume(voiceIndex, newVolume)

ALSO notify journeymap_presets:
  ↓
journeymap_presets.js → journeyIsResume[voiceIndex] = true
  ↓
**CRITICAL**: THE MAP IS RECALCULATED AND REBROADCASTED
  ↓
journeymap_presets.recalculateMap()
  - Transitions inherit from plateaus
  - If plateau changes, transitions change
  - Entire map recalculated
  ↓
binaural_presets.updateFromNewMap(recalculatedMap)
  - Check IsResume flags
  - Apply only non-manually-adjusted voices
```

### Next segment loads from timeline:
```javascript
// binaural_presets.js
scheduleBinauralSegment(segment, time, duration) {
  segment.frequencies.forEach((hz, index) => {
    if (IsResume[index]) {
      // SKIP - user manually adjusted, don't overwrite
      return
    }
    // Apply preset Hz
    scheduleVoiceFrequency(index, hz, time, duration)
  })
}
```

### User clicks STOP then PLAY:
```javascript
// binaural_presets.js → clearManualAdjustments()
IsResume = [false, false, false, false, false]
// Fresh start - all preset values apply again
```

---

## Key Architecture Rules

### ✅ DO
- **journeymap_presets** schedules BPM to Transport (DIRECT)
- **journeymap_presets** passes Hz maps to binaural_presets ("here's the current map")
- **journeymap_presets** recalculates map when manual adjustments happen (transitions inherit from plateaus!)
- **binaural_presets** does ALL formatting and scheduling to synth
- **binaural_presets** manages IsResume for binaural controls
- **binaural_presets** is the ONLY one who talks to synth
- **Transport** handles all timing via `Tone.Transport`
- **Widgets** read screen OR read preset (IsResume decides)
- **Synth** is dumb - just oscillators and frequency setters

### ❌ DON'T
- journeymap does NOT talk to synth directly - EVER - ALWAYS through binaural_presets
- journeymap does NOT format Hz data - that's binaural_presets' job
- journeymap does NOT schedule frequencies - it passes maps to binaural_presets
- Transport does NOT schedule frequencies - only BPM
- Synth does NOT manage IsResume - Controllers do
- Widgets do NOT call synth directly - always through binaural_presets

---

## IsResume Flag System

### Purpose
Track which UI elements have been manually adjusted so journeymap doesn't overwrite user changes.

### Ownership
- **binaural_presets.js** owns IsResume state for binaural controls
- **journeymap_presets.js** owns IsResume state for journey segments
- **Widgets** SET the flag via `binaural_presets.notifyManualAdjustment()`
- **Widgets** READ the flag via `getManualAdjustments()` or `resumePlayback` event
- **Both Controllers** CHECK the flag before applying preset/segment data

### Lifecycle
```
LOAD PRESET → IsResume = [false, false, false, false, false]
  ↓
USER DRAGS FADER → IsResume[voiceIndex] = true
  ↓
NEXT TIMELINE SEGMENT → Skip voices where IsResume[i] === true
  ↓
STOP + PLAY → clearManualAdjustments() → IsResume = [false × 5]
```

---

## Timeline Map System

### Map Calculation and Broadcasting
- **journeymap_presets** calculates the full journey map upfront
- **Transitions inherit values from plateaus** - if plateau changes, transitions change!
- **On manual adjustment**: Map is RECALCULATED and REBROADCASTED to binaural_presets
- **binaural_presets** receives map, checks IsResume, applies to synth

### Why Map-Based?
- **Precision** - All timing calculated upfront, not in real-time loops
- **Performance** - No interval monitoring, Tone.js handles scheduling
- **Reactivity** - Manual adjustments trigger immediate recalculation
- **Simplicity** - No manual time tracking or drift correction

### What Gets Pre-calculated?
1. **BPM changes** - Scheduled to `Tone.Transport.bpm` (journeymap does this directly)
2. **Hz maps** - Passed to binaural_presets (binaural_presets schedules to synth)
3. **Segment timing** - Accumulated durations for each segment start time
4. **Transition values** - Inherited from surrounding plateaus

### What Triggers Recalculation?
- **Manual adjustment during playback** - Plateau change → transitions recalc → rebroadcast map
- **User changes plateau Hz** - Transitions update to match
- **STOP + PLAY** - Fresh map calculation with IsResume cleared

---

## Files in Journeymap Ecosystem

### Core Files
- **`widgets/presets/journeymap_presets.js`** - Timeline loader and scheduler (Controller)
- **`widgets/js/journeymap_widget.js`** - UI controls and journey selector (View)
- **`widgets/panels/journeymap_panel.html`** - Panel HTML structure
- **`presets/journeys/*.json`** - Journey timeline data files

### Related Systems
- **`widgets/synths/binaural_synth.js`** - Synth Model (receives Hz data)
- **`widgets/presets/binaural_presets.js`** - Binaural Controller (formats Hz data)
- **Tone.Transport** - BPM/timing layer (handles when things happen)

---

## Journey JSON Format

**CORE TECHNOLOGY**: Journey JSON contains Hz values, BPM is **CALCULATED** using `(Hz * 60) / 8`

```json
{
  "name": "Example Journey",
  "description": "A 10-minute journey through frequency ranges",
  "totalDuration": 600,
  "segments": [
    {
      "start": 0,
      "duration": 120,
      "hz": 4.0,              // ← Hz value (BPM calculated from this!)
      "frequencies": [4.0, 4.0, 4.0, 4.0, 4.0],
      "volumes": [-12, -12, -12, -12, -12],
      "transition": "linear"
      // BPM = (4.0 * 60) / 8 = 30 BPM (calculated automatically)
    },
    {
      "start": 120,
      "duration": 180,
      "hz": 10.0,             // ← Hz value
      "frequencies": [10.0, 10.0, 10.0, 10.0, 10.0],
      "volumes": [-6, -6, -6, -6, -6],
      "transition": "exponential"
      // BPM = (10.0 * 60) / 8 = 75 BPM (calculated automatically)
    }
  ]
}
```

**Note**: Do NOT store BPM in JSON - it's calculated from Hz. Binaural Hz drives transport BPM.

---

## Future Enhancements

### Planned
- [ ] User-created journey editor UI
- [ ] Save custom journeys to localStorage
- [ ] Journey visualization timeline display
- [ ] Crossfade between binaural presets within journey

### Out of Scope
- Real-time monitoring (timeline is pre-calculated)
- Manual loop system (Tone.Transport handles loops)
- Playback rate control (belongs in transport, not synth)
