# JMTimeline Refactoring Analysis & Plan

**File:** `timeline_jm.js` (1060 lines)  
**Date:** November 3, 2025  
**Status:** Documentation Review - No Changes Yet

## Executive Summary

The JMTimeline engine is well-structured but could benefit from extracting 3 focused subsystems into separate modules. Current architecture mixes concerns: segment compilation, audio scheduling, visual feedback, and event dispatch all live in one class.

**Recommendation:** Extract subsystems but keep core engine intact. The current structure works - we're improving organization, not fixing bugs.

---

## Current Architecture Analysis

### What Works Well ✅

1. **Tone.js Integration Patterns**
   - TickParam trapezoidal integration for pulse timing (lines 425-449)
   - Transport._processTick scheduling approach (lines 732-780)
   - StateTimeline for transport control (line 139)
   - Timeline binary search with memory management (lines 149-169)

2. **Two-Band System**
   - Wave Band: Web Audio native `linearRampToValueAtTime()` for Hz automation (lines 260-288, 305-346)
   - 32n Band: Dynamic pulse scheduling with transition-aware calculations (lines 732-812)
   - Clean separation of continuous (Wave) vs discrete (Pulse) events

3. **Sample-Accurate Scheduling**
   - Virtual Hz parameter using `ConstantSourceNode.offset` (lines 210-221)
   - 100ms lookahead window (line 43)
   - 32ms ticker loop matching Tone.js (line 664)
   - Immediate event dispatch with future scheduled times (lines 780-796)

### Documentation Issues Found 🔍

1. **Redundant Tone.js References** (MAJOR)
   - Every method has "TONE.JS PATTERN" comments explaining integration
   - 40+ references to Tone.js scattered throughout
   - Should consolidate to Architecture section at top

2. **Confusing Method Names**
   - `_scheduleNativeHzRamps()` - "Native" is ambiguous (Web Audio? Browser?)
   - `_scheduleDynamicPulses()` - What makes them "dynamic"?
   - `_ensureVisualContinuity()` - Vague, doesn't explain what it ensures

3. **Over-Explanation in Comments**
   - Line 305: "WAVE BAND AUTOMATION (THIS WORKS CORRECTLY)" - defensive tone
   - Line 349: "32n BAND SCHEDULING (FIXED - TRANSITION-AWARE)" - past tense bug references
   - Line 720: "REFACTORED: Ticker-based scheduling with immediate event dispatch" - implementation history not needed

4. **Mixed Responsibilities**
   - Timeline compilation logic (lines 289-303)
   - Audio scheduling (lines 649-812)
   - Visual feedback (lines 915-992)
   - Event dispatch utilities (lines 994-998)
   - All in one 1060-line class

---

## Proposed Refactoring Structure

### Option A: Extract Subsystems (Recommended)

**Keep:** Core JMTimeline class (400-500 lines)  
**Extract:** 3 focused subsystems

```
timeline_jm.js (500 lines)
  └── JMTimeline class
       • Segment compilation
       • Transport control (start/stop/pause)
       • Public API methods
       • Event coordination

timeline_audio_scheduler.js (NEW - 300 lines)
  └── AudioScheduler class
       • Wave Band Hz automation scheduling
       • 32n Band pulse scheduling
       • Lookahead window management
       • Ticker loop (32ms)
       • Transition-aware calculations

timeline_visual_system.js (NEW - 200 lines)
  └── VisualFeedbackSystem class
       • requestAnimationFrame loop
       • Visual Hz updates (60fps)
       • Metronome flash calculations
       • Wave type change detection

timeline_utils.js (NEW - 100 lines)
  └── Utility functions
       • calculateTimelineBPM()
       • calculate32nInterval()
       • getWaveType()
       • validateHz()
       • Event dispatch helpers
```

**Benefits:**
- Each file has single responsibility
- AudioScheduler can be tested independently
- VisualFeedbackSystem optional for headless mode
- Easier to understand each subsystem
- JMTimeline becomes coordination layer

**Risks:**
- More files to maintain
- Potential circular dependencies
- May complicate synth integration if not careful

### Option B: Keep Monolithic with Better Documentation (Conservative)

**Approach:** Improve existing structure without extraction

**Changes:**
1. Consolidate all Tone.js references to single ARCHITECTURE section (lines 5-20)
2. Remove defensive/historical comments ("THIS WORKS", "FIXED", "REFACTORED")
3. Rename methods for clarity:
   - `_scheduleNativeHzRamps()` → `_scheduleWaveBandAutomation()`
   - `_scheduleDynamicPulses()` → `_initializePulseBandScheduling()`
   - `_ensureVisualContinuity()` → `_startVisualAnimationLoop()`
4. Add section dividers with clear responsibility blocks
5. Improve JSDoc for all public methods

**Benefits:**
- No structural changes (lower risk)
- Faster to implement
- Maintains current working system
- Better documentation immediately

**Risks:**
- Still a large file (1060 lines)
- Mixed responsibilities remain
- Harder to test subsystems independently

---

## Specific Documentation Improvements

### 1. Header Section (Lines 1-20)

**Current Issues:**
- Mixed architecture explanation with integration notes
- Should be clearer about two-band system purpose

**Improved Structure:**
```javascript
/**
 * JMTimeline - JourneyMap Timeline Engine
 * 
 * PURPOSE:
 * Dual-band scheduling system for binaural beat synthesis:
 * • Wave Band: Continuous Hz automation for carrier frequency modulation
 * • Pulse Band: Discrete 32n pulses for rhythmic synthesis triggers
 * 
 * ARCHITECTURE:
 * Based on Tone.js Transport/TickParam patterns with Web Audio native ramping:
 * • Virtual Hz parameter (ConstantSourceNode.offset) for sample-accurate automation
 * • 32ms ticker loop with 100ms lookahead window (Transport._processTick pattern)
 * • Trapezoidal integration for transition-aware pulse timing (TickParam pattern)
 * • StateTimeline for transport control, Timeline for event storage with binary search
 * 
 * TWO-BAND SYSTEM:
 * Wave Band  → linearRampToValueAtTime() → Continuous Hz changes → Binaural carriers
 * Pulse Band → Immediate event dispatch → Discrete 32n triggers → ISO synth pulses
 * 
 * See: Tone.js Transport.ts (scheduling), TickParam.ts (ramping), Timeline.ts (storage)
 */
```

### 2. Method Name Changes

| Current Name | Improved Name | Reason |
|--------------|---------------|--------|
| `_scheduleNativeHzRamps()` | `_scheduleWaveBandAutomation()` | Clearer band association |
| `_scheduleDynamicPulses()` | `_initializePulseBandScheduling()` | Explains initialization purpose |
| `_ensureVisualContinuity()` | `_startVisualAnimationLoop()` | Describes what it actually does |
| `_processSegmentTransitions()` | `_updateCurrentSegment()` | Simpler, more direct |

### 3. Remove Historical/Defensive Comments

**Lines to Clean:**
- Line 305: "WAVE BAND AUTOMATION (THIS WORKS CORRECTLY)" → Remove, just document purpose
- Line 349: "32n BAND SCHEDULING (FIXED - TRANSITION-AWARE)" → Remove "FIXED", keep technical explanation
- Line 720: "REFACTORED: Ticker-based scheduling" → Remove implementation history
- Line 156: "currently NOT transition-aware (this is the bug to fix)" → REMOVE, bug is fixed

### 4. Consolidate Tone.js References

**Current:** 40+ scattered "TONE.JS PATTERN" comments throughout methods

**Proposed:** Single INTEGRATION NOTES section after header:
```javascript
/**
 * TONE.JS INTEGRATION NOTES:
 * 
 * Transport._processTick Pattern:
 * - Lines 732-780: Dynamic pulse scheduling with lookahead window
 * - 32ms ticker loop checks audio scheduling every frame
 * 
 * TickParam._getTicksUntilEvent Pattern:
 * - Lines 425-449: Trapezoidal integration for transition-aware pulse timing
 * - Averages Hz over small intervals during ramps (0.5 * (val0 + val1))
 * 
 * StateTimeline Pattern:
 * - Line 139: Transport state tracking (STARTED/PAUSED/STOPPED)
 * - setStateAtTime() for sample-accurate state changes
 * 
 * Timeline Binary Search:
 * - Lines 149-169: Event storage with memory management
 * - forEachAtTime() for efficient event lookups
 * 
 * Signal/Param Pattern:
 * - Lines 210-221: ConstantSourceNode.offset as virtual Hz parameter
 * - Sample-accurate automation with setValueAtTime/linearRampToValueAtTime
 */
```

Then remove individual Tone.js comments from methods.

---

## Implementation Recommendations

### Phase 1: Documentation Cleanup (This Commit)

**Scope:** Improve existing documentation without structural changes

1. **Header Improvements**
   - Rewrite lines 1-20 with clearer PURPOSE/ARCHITECTURE/TWO-BAND sections
   - Add consolidated TONE.JS INTEGRATION NOTES section

2. **Method Renaming**
   - `_scheduleNativeHzRamps()` → `_scheduleWaveBandAutomation()`
   - `_scheduleDynamicPulses()` → `_initializePulseBandScheduling()`
   - `_ensureVisualContinuity()` → `_startVisualAnimationLoop()`
   - `_processSegmentTransitions()` → `_updateCurrentSegment()`

3. **Comment Cleanup**
   - Remove "THIS WORKS CORRECTLY", "FIXED", "REFACTORED" defensive language
   - Remove bug references that are already fixed (line 156)
   - Remove scattered Tone.js explanations (covered in header)
   - Add JSDoc @private markers to internal methods

4. **Section Dividers**
   ```javascript
   // ============================================================================
   // WAVE BAND SCHEDULING
   // ============================================================================
   
   // ============================================================================
   // PULSE BAND SCHEDULING  
   // ============================================================================
   
   // ============================================================================
   // VISUAL FEEDBACK SYSTEM
   // ============================================================================
   ```

**Estimated Changes:** ~30 replace operations  
**Risk:** LOW - documentation only, no logic changes  
**Benefit:** Clearer architecture understanding, professional tone

### Phase 2: Subsystem Extraction (Future Work)

**Scope:** Extract AudioScheduler and VisualFeedbackSystem (if needed)

**When to do this:**
- Adding more synth types that need scheduling customization
- Testing audio scheduling logic independently
- Supporting headless mode (no visual feedback)
- Performance optimization requires scheduler isolation

**Not needed if:**
- Current synth integration works for all use cases
- No performance issues with monolithic structure
- Team prefers simpler file structure

---

## Testing Strategy

**Before Refactoring:**
1. Document current behavior with test cases
2. Verify pulse timing accuracy at 2Hz, 10Hz, 15Hz
3. Check transition smoothness during Hz ramps
4. Confirm memory usage stays 6-7MB during playback

**After Documentation Changes:**
1. Verify timeline still generates pulses correctly
2. Check ISO synth still receives events
3. Confirm no regression in pulse timing
4. Memory usage unchanged

**After Subsystem Extraction (if done):**
1. AudioScheduler unit tests (pulse timing, lookahead)
2. VisualFeedbackSystem unit tests (60fps throttling)
3. Integration tests (JMTimeline + subsystems)
4. Performance comparison (before/after)

---

## Decision Matrix

| Factor | Monolithic + Docs | Extract Subsystems |
|--------|-------------------|-------------------|
| **Clarity** | Good (better docs) | Excellent (focused files) |
| **Maintainability** | Good (single file) | Better (separation of concerns) |
| **Testing** | Moderate (mock everything) | Excellent (unit test subsystems) |
| **Risk** | LOW | MEDIUM |
| **Time to Implement** | 1-2 hours | 4-6 hours |
| **File Count** | 1 file | 4 files |
| **Current Need** | Sufficient | Overkill? |

---

## Recommendation: Phase 1 Only (This Commit)

**Rationale:**
1. System is working correctly (pulses tested, Hz automation working)
2. No performance issues (6-7MB memory, clean audio)
3. Documentation improvements give 80% of benefit with 20% of risk
4. Subsystem extraction can wait until concrete need arises

**This Commit Should Include:**
- Header rewrite with consolidated Tone.js references
- Method renaming (4 methods)
- Remove defensive/historical comments (~15 locations)
- Add section dividers (3 sections)
- JSDoc improvements for public methods
- Professional, factual tone throughout

**Future Work (When Needed):**
- Extract AudioScheduler if adding new scheduling algorithms
- Extract VisualFeedbackSystem if supporting headless mode
- Add unit tests for scheduling calculations
- Performance profiling and optimization

---

## Files Changed This Session

1. ✅ `timeline_listeners.js` - Documentation cleanup complete
2. 🔄 `timeline_jm.js` - This plan document (no changes yet)
3. ⏸️ `timeline_main.js` - Pending review
4. ⏸️ `timeline_transport.js` - Pending review

---

## Conclusion

The JMTimeline engine is well-designed and functional. The main issue is documentation clarity, not architecture. We should improve documentation first (low risk, high value), then consider subsystem extraction only if future requirements demand it.

**Next Steps:**
1. Review this plan with user
2. Implement Phase 1 documentation improvements
3. Commit changes with clear message
4. Move on to timeline_main.js and timeline_transport.js reviews
5. Defer subsystem extraction until concrete need arises

**Estimated Time:** 30-45 minutes for Phase 1 implementation
