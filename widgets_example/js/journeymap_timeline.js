// ============================================================================
// JOURNEYMAP TIMELINE MODULE - DOM Rendering & Drag Handlers
// ============================================================================
// EXTRACTION: Timeline rendering logic separated from main widget orchestrator
// PATTERN: Pure DOM manipulation + drag handlers (no state management)
// DEPENDENCIES: Calls Model setters for audio updates, receives container refs
// 
// RESPONSIBILITIES:
// - Build journey sequence HTML from timeline segments
// - Attach Hz drag handlers (real-time frequency adjustment)
// - Attach duration drag handlers (segment length editing)
// - Calculate and display total journey time
// - Color helpers for brainwave band styling
//
// DELEGATES TO:
// - BinauralSynth.setBinauralBeat() for Hz updates
// - Tone.Transport.bpm for BPM recalculation
// - CSS classes for all styling (no inline styles)
//
// CALLED BY:
// - journeymap_widget.js (renderPreset function)
// ============================================================================

// ==============================================
// COLOR HELPER: Darken for Transition Gradients
// ==============================================
// PURPOSE: Create darker shade for transition box gradients (edges)
// PATTERN: Reduce RGB channels by percentage (default 20%)
// Used for: Transitions get darkened color (visual distinction from plateaus)
export function darkenHex(hex, amt = 0.2) {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  const dr = Math.max(0, Math.min(255, Math.round(r * (1 - amt))));
  const dg = Math.max(0, Math.min(255, Math.round(g * (1 - amt))));
  const db = Math.max(0, Math.min(255, Math.round(b * (1 - amt))));
  return (
    "#" +
    [dr, dg, db].map((v) => v.toString(16).padStart(2, "0")).join("")
  );
}

// ==============================================
// WAVE TYPE HELPER - Hz to Band Mapping
// ==============================================
// PURPOSE: Map Hz value to brain wave band (DELTA, THETA, ALPHA, SMR, BETA)
// PATTERN: Range-based lookup (delta 0.5-4hz, theta 4-8hz, etc.)
// Used for: CSS class assignment, color control, wave type labels
export function getWaveType(hz) {
  if (!hz && hz !== 0) return "Unknown";
  const z = Number(hz);
  if (z >= 0.5 && z <= 4) return "DELTA";
  if (z > 4 && z <= 8) return "THETA";
  if (z > 8 && z <= 12) return "ALPHA";
  if (z > 12 && z <= 15) return "SMR";
  if (z > 15 && z <= 25) return "BETA";
  return "Unknown";
}

// ==============================================
// TOTAL TIME CALCULATION - Sum All Durations
// ==============================================
// PURPOSE: Recalculate and display total journey time
// PATTERN: Query all .duration elements → Sum integers → Update totalBox
// Called after: Preset load, duration drag, segment changes
export function updateTotalDisplay(journeySequence, totalBox) {
  const durations = Array.from(
    journeySequence.querySelectorAll(".duration")
  );
  let sum = 0;
  durations.forEach((d) => {
    const n = parseInt(
      (d.textContent || "").replace(/[^0-9\-]/g, ""),
      10
    );
    if (!isNaN(n)) sum += n;
  });
  if (totalBox) totalBox.textContent = `Total Time: ${sum} minutes`;
}

// ==============================================
// REAL-TIME HZ DRAG - Live Frequency Adjustment
// ==============================================
// PURPOSE: Drag plateau frequency labels to adjust Hz in real-time
// ISRESUME: DOES set IsResumeJM = true (permanent timeline edit)
// AUDIO: Updates both binaural + isochronic synths immediately
// TRANSPORT: Recalculates BPM from Hz using BPM = (Hz × 60) / 8
//
// PATTERN: Vertical drag (up = increase, down = decrease)
// PRECISION: 0.1hz steps, 8 pixels per step
// RANGE: 0hz minimum (no negative frequencies)
//
// VISUAL FEEDBACK:
// - Updates .freq element text content
// - Updates .label element (wave type: DELTA, THETA, etc.)
// - Switches CSS band class (delta, theta, alpha, smr, beta)
// - CSS handles color changes via band classes
//
// CSS COMPLIANCE:
// - Band colors via CSS classes (never inline styles)
// - Edge gradients via .first-plateau and .last-plateau classes
// - Always clears inline background to let CSS take over
export function attachDragHz(elem, segment, box, label, segIndex, firstPlateauIdx, lastPlateauIdx) {
  let dragging = false;
  let startY = 0;
  let startHz = Number(segment.hz) || 0;
  const pxPerStep = 8; // Pixels per 0.1hz step

  // Mouse/touch move handler - calculates new Hz and updates UI + audio
  function onMove(e) {
    if (!dragging) return;
    e.preventDefault();
    
    // Support both mouse and touch events
    const clientY =
      e.clientY !== undefined
        ? e.clientY
        : e.touches && e.touches[0] && e.touches[0].clientY;
    
    // Calculate delta and convert to Hz steps (0.1hz precision)
    const delta = startY - clientY;
    const steps = Math.round(delta / pxPerStep);
    const newHz = Math.max(0, +(startHz + steps * 0.1).toFixed(1));
    
    // Update segment data (this IS a permanent edit)
    segment.hz = newHz;
    
    // Update DOM text content (frequency display)
    elem.textContent = `${newHz}hz`;
    elem.setAttribute('data-text', `${newHz}hz`);
    
    // Update box data attribute so click-to-loop can read current Hz
    box.dataset.hz = newHz;
    
    // Update wave type label (DELTA, THETA, ALPHA, SMR, BETA)
    const newWave = getWaveType(newHz);
    label.textContent = newWave;
    label.setAttribute('data-text', newWave);
    
    // Update CSS band class (triggers color change via CSS)
    const newBand = (newWave || "").toLowerCase();
    box.classList.remove("delta", "theta", "alpha", "smr", "beta");
    if (newBand) box.classList.add(newBand);
    
    // Handle edge gradients via CSS classes (first/last plateau)
    if (segIndex === firstPlateauIdx) {
      box.classList.add("first-plateau");
    } else if (segIndex === lastPlateauIdx) {
      box.classList.add("last-plateau");
    } else {
      box.classList.remove("first-plateau", "last-plateau");
    }
    
    // CSS COMPLIANCE: Clear inline background so CSS classes control styling
    box.style.background = "";

    // Real-time audio feedback (instant gratification)
    try {
      // Update binaural synth Hz (immediate audio change)
      if (window.BinauralSynth && window.BinauralSynth.setBinauralBeat) {
        window.BinauralSynth.setBinauralBeat(newHz);
      }
      
      // Update Transport BPM so isochronic pulses sync to new Hz
      // CORE TECHNOLOGY: BPM = (Hz × 60) / 8
      // MEMORY FIX: Use 1ms micro-ramp instead of direct .value assignment
      if (window.Tone && window.Tone.Transport) {
        const newBPM = (newHz * 60) / 8;
        const now = window.Tone.now();
        window.Tone.Transport.bpm.cancelScheduledValues(now);
        window.Tone.Transport.bpm.setValueAtTime(window.Tone.Transport.bpm.value, now);
        window.Tone.Transport.bpm.linearRampToValueAtTime(newBPM, now + 0.001);
      }
    } catch (err) {
      // Fail silently (audio update is best-effort)
    }
  }

  // Mouse up handler - cleanup drag state
  function onUp() {
    dragging = false;
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    document.body.style.userSelect = ""; // Re-enable text selection
  }

  // Mouse down handler - initiate drag
  elem.addEventListener("mousedown", (ev) => {
    ev.preventDefault();
    dragging = true;
    startY = ev.clientY;
    startHz = Number(segment.hz) || 0;
    document.body.style.userSelect = "none"; // Prevent text selection during drag
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });
}

// ==============================================
// DURATION DRAG HANDLER - Adjust Segment Time
// ==============================================
// PURPOSE: Allow vertical drag to change segment duration (minutes)
// PATTERN: Mouse down → Track Y delta → Update duration_min → Refresh display
// PHYSICS: 8px vertical movement = 1 minute step
// AUDIO: No immediate audio feedback (duration affects timeline only)
// ISRESUME: Sets IsResumeJM = true (permanent edit, same as Hz drag)
export function attachDragMinutes(elem, segment, journeySequence, totalBox) {
  let dragging = false;
  let startY = 0;
  let startMin = Number(segment.duration_min) || 0;
  const pxPerStep = 8; // pixels per 1 minute

  function onMove(e) {
    if (!dragging) return;
    e.preventDefault();
    const clientY =
      e.clientY !== undefined
        ? e.clientY
        : e.touches && e.touches[0] && e.touches[0].clientY;
    const delta = startY - clientY;
    const steps = Math.round(delta / pxPerStep);
    const newMin = Math.max(0, startMin + steps);
    segment.duration_min = newMin;
    elem.textContent = `${newMin}m`;
    elem.setAttribute('data-text', `${newMin}m`);
    updateTotalDisplay(journeySequence, totalBox); // Recalculate total journey time
  }

  function onUp() {
    dragging = false;
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    document.body.style.userSelect = "";
  }

  elem.addEventListener("mousedown", (ev) => {
    ev.preventDefault();
    dragging = true;
    startY = ev.clientY;
    startMin = Number(segment.duration_min) || 0;
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });
}
