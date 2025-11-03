# Web Audio API Documentation Mirror
**Location**: `D:\Web Projects\AuraMatrix\AudioRewrite\webaudio\`

## 📚 DOCUMENTATION REPOSITORIES

### ✅ MDN Web Audio Content (`mdn-content/`)
**Complete MDN Web Audio API documentation**
- Location: `mdn-content/files/en-us/web/api/web_audio_api/`
- Key paths:
  - `mdn-content/files/en-us/web/api/audiocontext/`
  - `mdn-content/files/en-us/web/api/oscillatornode/`  
  - `mdn-content/files/en-us/web/api/gainnode/`
  - `mdn-content/files/en-us/web/api/audioparam/`

### ✅ Web Audio Examples (`webaudio-examples/`)
**Working Web Audio code samples from MDN**
- Location: `webaudio-examples/`
- Key examples for timeline work:
  - `webaudio-examples/step-sequencer/` - Scheduling patterns
  - `webaudio-examples/audiocontext-states/` - Context management
  - `webaudio-examples/oscillator/` - Oscillator patterns

### ✅ Official Web Audio Spec (`webaudio-spec/`)
**W3C Web Audio API specification**
- Location: `webaudio-spec/`
- Official specification document
- Timing and scheduling requirements

### ⏳ Tone.js Reference (`tonejs-reference/`)
**Tone.js timeline implementation study**
- Status: Clone in progress
- Key files to study:
  - `Tone/core/clock/Transport.ts` - Master timeline
  - `Tone/core/clock/Clock.ts` - Scheduling engine
  - `Tone/core/context/ToneAudioContext.ts` - Web Audio wrapper

## 🎯 IMMEDIATE REFERENCE NEEDS

### Timeline Scheduling Issues
Current problem: Smooth Hz transitions during timeline segments

**Key documentation to review**:
1. **AudioParam automation** (`mdn-content/files/en-us/web/api/audioparam/`)
   - `linearRampToValueAtTime()` - For smooth frequency changes
   - `setValueAtTime()` - For immediate changes
   - `cancelScheduledValues()` - Prevent automation conflicts

2. **Oscillator frequency control** (`mdn-content/files/en-us/web/api/oscillatornode/`)
   - `frequency` AudioParam automation
   - Sample-accurate scheduling patterns

3. **Working examples** (`webaudio-examples/`)
   - Step sequencer timing patterns
   - Smooth parameter automation examples

## 🔍 SEARCH PATTERNS

```bash
# Search MDN content for specific topics
grep -r "linearRampToValueAtTime" mdn-content/files/en-us/web/api/
grep -r "scheduling" webaudio-examples/
grep -r "frequency" mdn-content/files/en-us/web/api/oscillatornode/

# Find timeline-related Tone.js code (when available)
find tonejs-reference/ -name "*.ts" -exec grep -l "timeline\|transport\|schedule" {} \;
```

## 🚨 CURRENT FOCUS

**Problem**: Timeline Hz flash stops during transitions, indicating broken scheduling
**Solution path**: Study Web Audio AudioParam automation for smooth frequency ramps
**Key concept**: Replace `setInterval()` with Web Audio's native `linearRampToValueAtTime()`

The Web Audio API has **built-in smooth parameter automation** - we shouldn't be using JavaScript intervals for frequency changes during transitions.

---

**Next**: Study `mdn-content/files/en-us/web/api/audioparam/linearramptovalueattime/` for proper smooth transition implementation.