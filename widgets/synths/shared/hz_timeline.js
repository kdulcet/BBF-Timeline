/**
 * Hz Timeline - Core Web Audio Timeline Apparatus
 * Replaces Tone.js Transport with sample-accurate Web Audio scheduling
 * 
 * PHASE 1: Visual feedback + event dispatch (NO AUDIO)
 * API Spec compliant for seamless integration
 */

// Dynamic validation ranges - adjustable per project needs
const CARRIER_HZ_MIN = 20;      // 20Hz minimum carrier frequency
const CARRIER_HZ_MAX = 1320;    // 1320Hz maximum carrier frequency  
const BINAURAL_HZ_MIN = 0.5;    // 0.5Hz minimum binaural beat (API spec)
const BINAURAL_HZ_MAX = 25;     // 25Hz maximum binaural beat (API spec)

/**
 * Brainwave band classification (API spec compliance)
 * Used for visual feedback and synth behavior
 */
function getWaveType(hz) {
  if (hz >= 0.5 && hz <= 4)   return "DELTA";   // Deep sleep
  if (hz > 4 && hz <= 8)      return "THETA";   // Meditation
  if (hz > 8 && hz <= 12)     return "ALPHA";   // Relaxed awareness
  if (hz > 12 && hz <= 15)    return "SMR";     // Sensorimotor rhythm
  if (hz > 15 && hz <= 25)    return "BETA";    // Active focus
  return "UNKNOWN";
}

/**
 * Core BPM calculation (IMMUTABLE - DO NOT CHANGE)
 * This is THE fundamental mechanism of AuraMatrix
 */
function calculateTimelineBPM(hz) {
  // Formula: BPM = (Hz × 60) / 8
  return (hz * 60) / 8; // NO ROUNDING - maintain precision
}

/**
 * Validate and clamp Hz value to acceptable range
 */
function validateAndClampHz(hz, type = 'binaural') {
  if (isNaN(hz)) return type === 'binaural' ? 5.0 : 440.0; // Sensible defaults
  
  if (type === 'binaural') {
    return Math.max(BINAURAL_HZ_MIN, Math.min(BINAURAL_HZ_MAX, hz));
  } else if (type === 'carrier') {
    return Math.max(CARRIER_HZ_MIN, Math.min(CARRIER_HZ_MAX, hz));
  }
  
  return hz; // Pass through if unknown type
}

/**
 * Sample-accurate Web Audio Timeline
 * Manages journey segments with precise timing and event dispatch
 */
class HzTimeline {
  constructor() {
    this.audioContext = new AudioContext();
    this.segments = [];
    this.compiledTimeline = [];
    this.isRunning = false;
    this.startTime = null;
    this.currentSegmentIndex = 0;
    this.scheduledEvents = [];
    this.updateInterval = null;
    this.totalDuration = 0;
    
    // Visual feedback elements (will be set by UI)
    this.statusDisplay = null;
    this.flashElement = null;
    
    // Initialize with default journey from type-ins
    this.initializeFromTypeIns();
    
    console.log('🎵 HzTimeline initialized - Web Audio timeline ready');
  }

  /**
   * Initialize timeline from current type-in values
   * Reads from index.html form inputs
   */
  initializeFromTypeIns() {
    try {
      this.segments = [
        {
          type: "plateau",
          hz: parseFloat(document.getElementById('plateau1_hz')?.value) || 5,
          duration_min: parseFloat(document.getElementById('plateau1_time')?.value) / 60 || 0.5
        },
        {
          type: "transition", 
          duration_min: parseFloat(document.getElementById('transition1_time')?.value) / 60 || 0.25
        },
        {
          type: "plateau",
          hz: parseFloat(document.getElementById('plateau2_hz')?.value) || 15,
          duration_min: parseFloat(document.getElementById('plateau2_time')?.value) / 60 || 0.25
        },
        {
          type: "transition",
          duration_min: parseFloat(document.getElementById('transition2_time')?.value) / 60 || 0.25
        },
        {
          type: "plateau",
          hz: parseFloat(document.getElementById('plateau3_hz')?.value) || 10,
          duration_min: parseFloat(document.getElementById('plateau3_time')?.value) / 60 || 0.33
        }
      ];
      
      // Validate and clamp Hz values
      this.segments.forEach(segment => {
        if (segment.hz) {
          segment.hz = validateAndClampHz(segment.hz, 'binaural');
        }
      });
      
      this.compile();
      console.log('📊 Timeline segments compiled:', this.segments);
      
    } catch (error) {
      console.error('❌ Failed to initialize from type-ins:', error);
      this.useDefaultSegments();
    }
  }
  
  /**
   * Fallback to safe default segments
   */
  useDefaultSegments() {
    this.segments = [
      { type: "plateau", hz: 5, duration_min: 0.5 },
      { type: "transition", duration_min: 0.25 },
      { type: "plateau", hz: 15, duration_min: 0.25 },
      { type: "transition", duration_min: 0.25 },
      { type: "plateau", hz: 10, duration_min: 0.33 }
    ];
    this.compile();
  }

  /**
   * Compile segments into executable timeline with precise timing
   */
  compile() {
    this.compiledTimeline = [];
    let cursor = 0;
    
    for (let i = 0; i < this.segments.length; i++) {
      const segment = this.segments[i];
      const duration_sec = segment.duration_min * 60;
      
      this.compiledTimeline.push({
        segmentIndex: i,
        time_sec: cursor,
        hz: segment.hz || null,
        duration_sec: duration_sec,
        type: segment.type
      });
      
      cursor += duration_sec;
    }
    
    this.totalDuration = cursor;
    console.log(`⏱️  Timeline compiled: ${this.totalDuration.toFixed(2)}s total duration`);
    console.log('📋 Compiled timeline:', this.compiledTimeline);
  }

  /**
   * Set visual feedback elements
   */
  setVisualElements(statusDisplay, flashElement) {
    this.statusDisplay = statusDisplay;
    this.flashElement = flashElement;
    console.log('👁️  Visual feedback elements connected');
  }

  /**
   * Start timeline playback with sample-accurate scheduling
   */
  async start() {
    if (this.isRunning) {
      console.log('⚠️  Timeline already running');
      return;
    }

    // Resume AudioContext if suspended
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    this.isRunning = true;
    this.startTime = this.audioContext.currentTime;
    this.currentSegmentIndex = 0;
    
    // Schedule all timeline events
    this.scheduleAllEvents();
    
    // Start visual update loop
    this.startVisualUpdates();
    
    // Dispatch timeline started event
    this.dispatchEvent('timeline.started', {
      startTime: this.startTime,
      totalDuration: this.totalDuration
    });

    console.log(`🚀 Timeline started at ${this.startTime.toFixed(3)}s`);
  }

  /**
   * Stop timeline playback
   */
  stop() {
    if (!this.isRunning) {
      console.log('⚠️  Timeline already stopped');
      return;
    }

    this.isRunning = false;
    this.cancelAllScheduledEvents();
    
    // Clean up all intervals and timers
    this.cleanup();

    // Dispatch timeline stopped event  
    this.dispatchEvent('timeline.stopped', {
      stopTime: this.audioContext.currentTime,
      position: this.getCurrentPosition()
    });

    console.log('⏹️  Timeline stopped');
    
    // Update visual display
    if (this.statusDisplay) {
      this.statusDisplay.textContent = 'Timeline Stopped';
    }
  }

  /**
   * Schedule all timeline events with sample-accurate timing
   */
  scheduleAllEvents() {
    this.scheduledEvents = [];
    
    for (const event of this.compiledTimeline) {
      const eventTime = this.startTime + event.time_sec;
      
      if (event.type === 'plateau') {
        this.scheduleSegmentStart(event, eventTime);
      } else if (event.type === 'transition') {
        this.scheduleTransitionStart(event, eventTime);
      }
    }
    
    // Schedule auto-restart at end
    const restartTime = this.startTime + this.totalDuration;
    this.scheduleAutoRestart(restartTime);
    
    console.log(`📅 Scheduled ${this.scheduledEvents.length} timeline events`);
  }

  /**
   * Schedule plateau segment start
   */
  scheduleSegmentStart(event, eventTime) {
    const scheduledEvent = {
      type: 'segment_start',
      time: eventTime,
      segmentIndex: event.segmentIndex,
      callback: () => {
        this.currentSegmentIndex = event.segmentIndex;
        
        // Dispatch Hz changed event (API spec compliant)
        this.dispatchEvent('timeline.hz.changed', {
          hz: event.hz,
          time: this.audioContext.currentTime,
          segment: event.type,
          segmentIndex: event.segmentIndex,
          wave_type: getWaveType(event.hz)
        });
        
        console.log(`🎯 Plateau ${event.segmentIndex + 1}: ${event.hz}Hz (${getWaveType(event.hz)})`);
        
        // Start Hz flash for this segment
        if (this.flashElement && event.hz) {
          this.startHzFlash(event.hz);
        }
      }
    };
    
    this.scheduledEvents.push(scheduledEvent);
    this.scheduleCallback(scheduledEvent);
  }

  /**
   * Schedule transition start with smooth Hz interpolation
   */
  scheduleTransitionStart(event, eventTime) {
    const scheduledEvent = {
      type: 'transition_start',
      time: eventTime,
      segmentIndex: event.segmentIndex,
      callback: () => {
        this.currentSegmentIndex = event.segmentIndex;
        
        // Find previous and next plateau for smooth transition
        const prevPlateau = this.compiledTimeline[event.segmentIndex - 1];
        const nextPlateau = this.compiledTimeline.find((seg, idx) => 
          idx > event.segmentIndex && seg.type === 'plateau'
        );
        
        if (prevPlateau && nextPlateau && prevPlateau.hz && nextPlateau.hz) {
          // Start smooth transition with linear interpolation
          this.startSmoothTransition(
            prevPlateau.hz,
            nextPlateau.hz,
            event.duration_sec,
            this.audioContext.currentTime
          );
          
          console.log(`🔄 Transition ${event.segmentIndex + 1}: ${prevPlateau.hz}Hz → ${nextPlateau.hz}Hz over ${event.duration_sec}s (SMOOTH LINEAR)`);
        } else {
          // Fallback: stop flash during transition
          if (this.flashElement) {
            this.stopHzFlash();
          }
        }
      }
    };
    
    this.scheduledEvents.push(scheduledEvent);
    this.scheduleCallback(scheduledEvent);
  }

  /**
   * Create smooth linear Hz transition with continuous updates
   * This is the CORE of smooth transitions - no snapping!
   */
  startSmoothTransition(fromHz, toHz, duration, startTime) {
    // Stop any existing Hz flash
    this.stopHzFlash();
    
    // Dispatch transition start event
    this.dispatchEvent('timeline.transition.start', {
      fromHz: fromHz,
      toHz: toHz,
      duration: duration,
      startTime: startTime
    });
    
    // Calculate interpolation parameters
    const hzDelta = toHz - fromHz;
    const updateRate = 50; // 50ms updates for smooth visual feedback
    const totalSteps = Math.floor((duration * 1000) / updateRate);
    let currentStep = 0;
    
    // Clear any existing transition interval
    if (this.transitionInterval) {
      clearInterval(this.transitionInterval);
    }
    
    // Start linear interpolation
    this.transitionInterval = setInterval(() => {
      if (!this.isRunning) {
        clearInterval(this.transitionInterval);
        return;
      }
      
      currentStep++;
      const progress = currentStep / totalSteps;
      
      if (progress >= 1.0) {
        // Transition complete - snap to exact target
        const finalHz = toHz;
        
        // Dispatch final Hz change
        this.dispatchEvent('timeline.hz.changed', {
          hz: finalHz,
          time: this.audioContext.currentTime,
          segment: 'transition',
          segmentIndex: this.currentSegmentIndex,
          wave_type: getWaveType(finalHz)
        });
        
        // Start target Hz flash
        this.startHzFlash(finalHz);
        
        // Clean up
        clearInterval(this.transitionInterval);
        this.transitionInterval = null;
        
        console.log(`✅ Transition complete: reached ${finalHz}Hz`);
        
      } else {
        // Linear interpolation: currentHz = fromHz + (progress * hzDelta)
        const currentHz = fromHz + (progress * hzDelta);
        
        // Dispatch interpolated Hz change
        this.dispatchEvent('timeline.hz.changed', {
          hz: currentHz,
          time: this.audioContext.currentTime,
          segment: 'transition',
          segmentIndex: this.currentSegmentIndex,
          wave_type: getWaveType(currentHz),
          transitionProgress: progress
        });
        
        // Update visual flash rate to match current Hz
        this.startHzFlash(currentHz);
        
        // Debug log every 10 steps
        if (currentStep % 10 === 0) {
          console.log(`🔄 Transition progress: ${(progress * 100).toFixed(1)}% - ${currentHz.toFixed(2)}Hz`);
        }
      }
      
    }, updateRate);
  }

  /**
   * Schedule auto-restart for seamless looping
   */
  scheduleAutoRestart(restartTime) {
    const restartEvent = {
      type: 'auto_restart',
      time: restartTime,
      callback: () => {
        if (this.isRunning) {
          console.log('🔄 Auto-restart: Timeline looping seamlessly');
          this.stop();
          // Small delay to prevent timing conflicts
          setTimeout(() => {
            if (!this.isRunning) { // Only restart if not manually started
              this.start();
            }
          }, 10);
        }
      }
    };
    
    this.scheduledEvents.push(restartEvent);
    this.scheduleCallback(restartEvent);
  }

  /**
   * Schedule callback with Web Audio precision
   */
  scheduleCallback(event) {
    const timeUntilEvent = event.time - this.audioContext.currentTime;
    
    if (timeUntilEvent > 0) {
      setTimeout(() => {
        if (this.isRunning) { // Only execute if still running
          event.callback();
        }
      }, timeUntilEvent * 1000);
    } else {
      // Event is in the past, execute immediately
      event.callback();
    }
  }

  /**
   * Cancel all scheduled events
   */
  cancelAllScheduledEvents() {
    this.scheduledEvents = [];
    // Note: setTimeout callbacks can't be cancelled, but callback checks this.isRunning
  }

  /**
   * Start visual updates for diagnostic display
   */
  startVisualUpdates() {
    this.updateInterval = setInterval(() => {
      this.updateVisualFeedback();
    }, 100); // 100ms update rate for smooth visual feedback
  }

  /**
   * Update visual diagnostic display
   */
  updateVisualFeedback() {
    if (!this.isRunning || !this.statusDisplay) return;
    
    const position = this.getCurrentPosition();
    const currentSegment = this.getCurrentSegment();
    const remaining = currentSegment ? (currentSegment.time_sec + currentSegment.duration_sec - position) : 0;
    
    if (currentSegment) {
      const segmentNum = currentSegment.segmentIndex + 1;
      const segmentType = currentSegment.type.charAt(0).toUpperCase() + currentSegment.type.slice(1);
      
      if (currentSegment.hz) {
        // Plateau segment - show fixed Hz
        const waveType = getWaveType(currentSegment.hz);
        this.statusDisplay.innerHTML = `
          <strong>${segmentType} ${segmentNum}:</strong> ${currentSegment.hz}Hz (${waveType})<br>
          <span style="color: #666;">⏱️ ${remaining.toFixed(1)}s remaining</span>
        `;
      } else {
        // Transition segment - show interpolated Hz if available
        const prevPlateau = this.compiledTimeline[currentSegment.segmentIndex - 1];
        const nextPlateau = this.compiledTimeline.find((seg, idx) => 
          idx > currentSegment.segmentIndex && seg.type === 'plateau'
        );
        
        if (prevPlateau && nextPlateau && prevPlateau.hz && nextPlateau.hz) {
          // Calculate current interpolated Hz
          const transitionProgress = (position - currentSegment.time_sec) / currentSegment.duration_sec;
          const currentHz = prevPlateau.hz + (transitionProgress * (nextPlateau.hz - prevPlateau.hz));
          const waveType = getWaveType(currentHz);
          
          this.statusDisplay.innerHTML = `
            <strong>${segmentType} ${segmentNum}:</strong> ${currentHz.toFixed(2)}Hz (${waveType}) 
            <span style="color: #ff6600;">TRANSITIONING</span><br>
            <span style="color: #666;">⏱️ ${remaining.toFixed(1)}s remaining | ${prevPlateau.hz}Hz → ${nextPlateau.hz}Hz</span>
          `;
        } else {
          // Fallback for transition without clear endpoints
          this.statusDisplay.innerHTML = `
            <strong>${segmentType} ${segmentNum}:</strong> Transitioning<br>
            <span style="color: #666;">⏱️ ${remaining.toFixed(1)}s remaining</span>
          `;
        }
      }
    }
  }

  /**
   * Get current timeline position in seconds
   */
  getCurrentPosition() {
    if (!this.isRunning) return 0;
    return this.audioContext.currentTime - this.startTime;
  }

  /**
   * Get current active segment
   */
  getCurrentSegment() {
    const position = this.getCurrentPosition();
    
    for (const segment of this.compiledTimeline) {
      const segmentEnd = segment.time_sec + segment.duration_sec;
      if (position >= segment.time_sec && position < segmentEnd) {
        return segment;
      }
    }
    
    return null; // Past end of timeline
  }

  /**
   * Start Hz-rate visual flash for timing validation
   */
  startHzFlash(hz) {
    if (!this.flashElement) return;
    
    this.stopHzFlash(); // Clear any existing flash
    
    const interval = 1000 / hz; // Convert Hz to milliseconds
    let isFlashing = true;
    
    this.flashInterval = setInterval(() => {
      if (!this.isRunning) {
        this.stopHzFlash();
        return;
      }
      
      // Toggle flash
      if (isFlashing) {
        this.flashElement.style.backgroundColor = '#ff4444';
        this.flashElement.style.transform = 'scale(1.1)';
      } else {
        this.flashElement.style.backgroundColor = '#666';
        this.flashElement.style.transform = 'scale(1.0)';
      }
      isFlashing = !isFlashing;
      
    }, interval / 2); // Flash twice per Hz cycle
    
    console.log(`⚡ Hz flash started: ${hz}Hz (${interval.toFixed(1)}ms interval)`);
  }

  /**
   * Stop Hz-rate visual flash
   */
  stopHzFlash() {
    if (this.flashInterval) {
      clearInterval(this.flashInterval);
      this.flashInterval = null;
    }
    
    if (this.flashElement) {
      this.flashElement.style.backgroundColor = '#666';
      this.flashElement.style.transform = 'scale(1.0)';
    }
  }

  /**
   * Clean up all intervals and timers
   */
  cleanup() {
    this.stopHzFlash();
    
    if (this.transitionInterval) {
      clearInterval(this.transitionInterval);
      this.transitionInterval = null;
    }
    
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  /**
   * Dispatch timeline events (API spec compliant)
   */
  dispatchEvent(eventType, payload) {
    const event = new CustomEvent(eventType, { 
      detail: payload 
    });
    
    document.dispatchEvent(event);
    console.log(`📡 Event dispatched: ${eventType}`, payload);
  }

  /**
   * Refresh timeline from current type-in values
   * Used by UI layer to update timeline
   */
  refreshFromTypeIns() {
    const wasRunning = this.isRunning;
    
    if (wasRunning) {
      this.stop();
    }
    
    this.initializeFromTypeIns();
    
    if (wasRunning) {
      // Restart after brief delay
      setTimeout(() => {
        this.start();
      }, 50);
    }
    
    console.log('🔄 Timeline refreshed from type-ins');
  }
}

// Create global timeline instance
window.hzTimeline = new HzTimeline();

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('🎵 Hz Timeline system ready');
  });
} else {
  console.log('🎵 Hz Timeline system ready');
}

export { HzTimeline, getWaveType, calculateTimelineBPM, validateAndClampHz };