// ============================================================================
// JOURNEYMAP CLICK-TO-LOOP MODULE - BBF "Fidget Toy" Feature
// ============================================================================
// EXTRACTION: Click-to-loop functionality separated from main widget
// PATTERN: Event handlers for plateau looping (instant gratification)
// DEPENDENCIES: Fires journeymapRestart event, Transport widget handles loop setup
//
// RESPONSIBILITIES:
// - Handle clicks on plateau boxes (loop that segment)
// - Clear existing loop states (.looping class management)
// - Communicate with transport via custom events
//
// BBF PHILOSOPHY:
// - "Crazily soothing" instant gratification
// - Fidget with plateaus without editing timeline
// - Perfect for exploring Hz ranges before committing
// - Different from Hz drag (which DOES set IsResumeJM)
//
// ISRESUME FLAG:
// - Does NOT set IsResumeJM flag (temporary playback mode)
// - Not a permanent edit to timeline
// - Just temporary exploration
//
// CALLED BY:
// - journeymap_widget.js (event handler attachment)
// ============================================================================

// ==============================================
// CLICK-TO-LOOP - BBF "Fidget Toy" Feature
// ==============================================
// PURPOSE: Instant plateau looping for exploration
// USER EXPERIENCE: Click plateau → immediate loop of that segment
// ISRESUME: Does NOT set IsResumeJM flag (temporary playback, not permanent edit)
// TRANSPORT: Fires 'journeymapRestart' event → transport_widget handles loop setup
//
// PATTERN: Click handler → Clear previous loops → Mark new loop → Fire event
// CSS STATE: .looping class applied to active box (visual feedback)
// AUDIO FLOW: Event → Transport → journeymap_presets.scheduleTimelineToSynths()
//
// WHY THIS MATTERS (BBF Philosophy):
// - "Crazily soothing" instant gratification
// - Fidget with plateaus without editing timeline
// - Perfect for exploring Hz ranges before committing
// - Different from Hz drag (which DOES set IsResumeJM)

// Handle click on journey map box (plateau or transition)
// PLATEAUS ONLY: Transitions are not loopable (they're ramps, not sustained)
export function handleBoxClick(box, segment, segmentIndex) {
  console.log(`🖱️ Box clicked:`, { type: segment.type, index: segmentIndex, segment });
  
  // ONLY allow plateau clicks (sustained Hz segments)
  if (segment.type !== 'plateau') {
    console.log('⏭️ Ignoring transition click (plateaus only)');
    return;
  }
  
  // If clicking the same box that's already looping, ignore (already active)
  if (box.classList.contains('looping')) {
    console.log('📍 Box already looping, ignoring click');
    return;
  }
  
  // Clear any existing loop state (only one plateau loops at a time)
  clearAllLoops();
  
  // Mark this box as looping (CSS feedback + state tracking)
  box.classList.add('looping');
  console.log(`🔄 Set box ${segmentIndex} to looping mode`);
  
  // Fire journeymapRestart event to trigger audio looping
  // Transport widget listens for this and sets up Tone.Transport loop
  console.log(`🔄 Triggering journeymapRestart for plateau Hz=${segment.hz}`);
  window.dispatchEvent(new CustomEvent('journeymapRestart', {
    detail: { 
      timeline: null, // Scheduler will read from .looping class (dynamic lookup)
      preset: null    // Not a preset load, just temporary loop
    }
  }));
}

// Clear all loop states (remove .looping class from all boxes)
// Called before setting new loop OR when stopping playback
export function clearAllLoops() {
  const loopingBoxes = document.querySelectorAll('.jm-box.looping');
  loopingBoxes.forEach(box => {
    box.classList.remove('looping');
  });
  console.log(`🧹 Cleared ${loopingBoxes.length} looping boxes`);
}

// Export for external use (transport_widget, binaural_widget, etc.)
// Allows other widgets to clear loops or trigger loop mode
export function initClickToLoopAPI() {
  window.JourneymapLoopControls = {
    clearAllLoops,
    handleBoxClick
  };
}
