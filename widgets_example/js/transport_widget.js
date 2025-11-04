// widgets/transport_widget.js — transport UI widget (moved from transport_controls.js)
// Responsible for the transport UI and installing the transport bridge that
// allows other widgets (journeymap) to request binaural renders.
// Also handles Transport.start/stop coordination for timeline playback.

console.log('🚨 TRANSPORT WIDGET: Script loading...');

import binauralRenderer from '../../src/binaural_render.js';
import { getToneEventCount, disposeAllSynths } from '../../src/audio_cleanup.js';
import { 
  stop as stopBinauralSynth,
  setMoodSemitones
} from '../synths/binaural_synth.js';
import { 
  scheduleJourneyTimeline, 
  stopJourneyTimeline 
} from '../presets/journeymap_presets.js';
import * as noiseSynth from '../synths/noise_synth.js';

console.log('🚨 TRANSPORT WIDGET: Binaural renderer imported:', !!binauralRenderer);
console.log('🚨 TRANSPORT WIDGET: DOM ready state:', document.readyState);
console.log('🚨 TRANSPORT WIDGET: Tone.js check:', !!window.Tone);
console.log('🚨 TRANSPORT WIDGET: Looking for render button...');

// Wait for Tone.js to be available before allowing transport operations
async function waitForTone(maxWaitMs = 5000) {
  const startTime = Date.now();
  console.log('⏳ TRANSPORT: Waiting for Tone.js...');
  while (!window.Tone || !window.Tone.Transport) {
    if (Date.now() - startTime > maxWaitMs) {
      console.error('⏱️ TRANSPORT: Tone.js failed to load within timeout');
      console.error('⏱️ TRANSPORT: window.Tone:', window.Tone);
      console.error('⏱️ TRANSPORT: All window globals:', Object.keys(window).filter(k => k.toLowerCase().includes('tone')));
      return false;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  console.log('✅ TRANSPORT: Tone.js loaded and ready');
  return true;
}

// Immediate check for render button
const immediateCheck = () => {
  const btn = document.getElementById('transport-render');
  // console.log('🚨 TRANSPORT WIDGET: Immediate render button check:', !!btn);
  if (btn) {
    // console.log('🚨 TRANSPORT WIDGET: Button found immediately, classes:', btn.className);
  } else {
    console.log('🚨 TRANSPORT WIDGET: Available transport elements:', 
      document.querySelectorAll('[id*="transport"]'));
  }
};

// Check now
immediateCheck();

// Check again after a delay
setTimeout(immediateCheck, 100);

// Function to connect transport buttons (play/stop/render)
const connectTransportButtons = () => {
  const playBtn = document.getElementById('transport-play');
  const renderBtn = document.getElementById('transport-render');
  
  console.log('🔧 TRANSPORT WIDGET: Elements found:', {
    playBtn: !!playBtn,
    renderBtn: !!renderBtn
  });

  // PLAY BUTTON HANDLER
  if (playBtn) {
    let isPlaying = false;
    
    playBtn.addEventListener('click', async () => {
      if (isPlaying) {
        // STOP
        await handleStop();
        isPlaying = false;
        playBtn.classList.remove('playing');
        console.log('🛑 TRANSPORT: Stopped via play button');
      } else {
        // PLAY
        const success = await handlePlay();
        if (success) {
          isPlaying = true;
          playBtn.classList.add('playing');
          console.log('▶️ TRANSPORT: Playing via play button');
        }
      }
    });
    console.log('🔧 TRANSPORT WIDGET: Play button handler attached');
  }

  // RENDER BUTTON HANDLER
  if (renderBtn) {
    console.log('🔧 TRANSPORT WIDGET: Attaching render button click handler');
    renderBtn.addEventListener('click', async (e) => {
      console.log('🚨 RENDER CLICK: Event fired!', e);
      console.log('🚨 RENDER CLICK: Target:', e.target);
      console.log('🚨 RENDER CLICK: Button ID:', e.target.id);
      
      // Call the render function
      await handleRenderClick();
    });
    console.log('🔧 TRANSPORT WIDGET: Render button handler attached successfully');
  }
  
  return !!(playBtn || renderBtn); // Success if any button was found
};

// Listen for panels loaded event
document.addEventListener('allPanelsLoaded', () => {
  console.log('🔧 TRANSPORT WIDGET: allPanelsLoaded event received');
  connectTransportButtons();
});

// Also try on DOMContentLoaded as fallback
document.addEventListener('DOMContentLoaded', () => {
  console.log('🔧 TRANSPORT WIDGET: DOMContentLoaded event fired');
  
  // Try to connect immediately
  if (!connectTransportButtons()) {
    console.log('🔧 TRANSPORT WIDGET: Initial connection failed, waiting for allPanelsLoaded event...');
  }
});

// =============================================================================
// TRANSPORT PLAYBACK CONTROL - Handles Transport.start/stop coordination
// =============================================================================

/**
 * Handle play button click - just starts Transport
 * Timeline should already be scheduled before this is called
 * @returns {Promise<boolean>} - True if play succeeded
 */
export async function handlePlay() {
  try {
    console.log('🎵 TRANSPORT: Starting playback');
    
    // Wait for Tone.js if not ready yet
    const toneReady = await waitForTone();
    if (!toneReady) {
      console.error('🚨 TRANSPORT: Tone.Transport not available');
      return false;
    }
    
    // RE-SCHEDULE from current DOM values (isResume behavior for journeymap)
    // This ensures any Hz changes made via drag are reflected in playback
    console.log('🔄 TRANSPORT: Re-scheduling timeline from current DOM values');
    window.dispatchEvent(new CustomEvent('journeymapRestart', {
      detail: { timeline: null, preset: null } // Scheduler will read from DOM
    }));
    
    // Small delay to let scheduler complete
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Initialize audio nodes if they were disposed (e.g., after stop)
    const { initializeNodes: initBinauralNodes } = await import('../synths/binaural_synth.js');
    const binauralReady = await initBinauralNodes();
    if (!binauralReady) {
      console.error('🚨 TRANSPORT: Failed to initialize binaural audio nodes');
      return false;
    }
    
    // Initialize noise synth nodes
    const { initializeNodes: initNoiseNodes } = await import('../synths/noise_synth.js');
    const noiseReady = await initNoiseNodes();
    if (!noiseReady) {
      console.warn('⚠️ TRANSPORT: Failed to initialize noise audio nodes (continuing anyway)');
      // Don't fail playback if noise fails - binaural still works
    }
    
    // START the Transport (executes all scheduled events)
    window.Tone.Transport.start();
    console.log('✅ TRANSPORT: Transport.start() called');
    console.log('✅ TRANSPORT: Transport state:', window.Tone.Transport.state);
    console.log('✅ TRANSPORT: Transport BPM:', window.Tone.Transport.bpm.value);
    console.log('✅ TRANSPORT: Transport seconds:', window.Tone.Transport.seconds);
    
    // Log Transport state every 2 seconds to verify it's running
    const stateLogger = setInterval(() => {
      if (window.Tone.Transport.state !== 'started') {
        clearInterval(stateLogger);
        return;
      }
      console.log(`⏱️ TRANSPORT: t=${window.Tone.Transport.seconds.toFixed(1)}s BPM=${window.Tone.Transport.bpm.value.toFixed(1)}`);
    }, 2000);
    
    // Fire transportPlay event for synths (noise, etc.)
    window.dispatchEvent(new Event('transportPlay'));
    
    return true;
  } catch (error) {
    console.error('🚨 TRANSPORT: Play failed:', error);
    return false;
  }
}

/**
 * Handle stop button click - stops Transport and cleans up synths
 * @returns {Promise<void>}
 */
export async function handleStop() {
  try {
    console.log('🛑 TRANSPORT: Stopping playback');
    
    // STEP 1: STOP the Transport (but keep schedule intact for next play)
    if (window.Tone && window.Tone.Transport) {
      window.Tone.Transport.stop();
      // NOTE: NOT calling .cancel() - we want to keep the schedule for next play
      // Next play will start from 0 by default since Transport rewinds on stop
      console.log('✅ TRANSPORT: Transport.stop() called (schedule preserved)');
    }
    
    // STEP 2: Stop and clean up synths
    // NOTE: stopJourneyTimeline calls stopBinauralSynth internally
    stopJourneyTimeline();
    
    // Stop noise synth
    try {
      const { stop: stopNoiseSynth } = await import('../synths/noise_synth.js');
      stopNoiseSynth();
      console.log('✅ TRANSPORT: Noise synth stopped');
    } catch (e) {
      console.warn('⚠️ TRANSPORT: Failed to stop noise synth:', e);
    }
    
    // Rewind Transport to start (0 seconds) for next play
    if (window.Tone && window.Tone.Transport) {
      window.Tone.Transport.seconds = 0;
      console.log('✅ TRANSPORT: Rewound to start (0s)');
    }
    
    // STEP 3: Check for memory accumulation and clean up if needed
    const eventCount = getToneEventCount();
    const CLEANUP_THRESHOLD = 300; // Clean up if more than 300 events
    
    if (eventCount > CLEANUP_THRESHOLD) {
      console.warn(`⚠️ TRANSPORT: ${eventCount} events detected (threshold: ${CLEANUP_THRESHOLD})`);
      console.log('🧹 TRANSPORT: Auto-cleanup triggered - disposing synths to free AudioParams...');
      
      try {
        disposeAllSynths();
        console.log('✅ TRANSPORT: Memory cleanup complete');
        console.log('ℹ️  TRANSPORT: Press Play to reinitialize synths');
      } catch (cleanupError) {
        console.error('🚨 TRANSPORT: Cleanup failed:', cleanupError);
      }
    } else {
      console.log(`✅ TRANSPORT: Memory healthy (${eventCount} events)`);
    }
    
    console.log('✅ TRANSPORT: Playback stopped, ready to restart from beginning');
    
    // Fire transportStop event for synths (noise, etc.)
    window.dispatchEvent(new Event('transportStop'));
    
  } catch (error) {
    console.error('🚨 TRANSPORT: Stop failed:', error);
  }
}

// Install transport bridge so other widgets can request renders from the binaural renderer
export function installTransportAPI() {
  // console.log('🔧 DEBUG: installTransportAPI called');
  // console.log('🔧 DEBUG: binauralRenderer available:', !!binauralRenderer);
  // console.log('🔧 DEBUG: binauralRenderer.renderBinauralTimelineToWav:', typeof (binauralRenderer && binauralRenderer.renderBinauralTimelineToWav));
  
  if (!window.TransportAPI) window.TransportAPI = {};
  if (window.TransportAPI.renderBinauralTimelineToWav) {
    // console.log('🔧 DEBUG: TransportAPI.renderBinauralTimelineToWav already exists');
    return;
  }
  if (binauralRenderer && typeof binauralRenderer.renderBinauralTimelineToWav === 'function') {
    window.TransportAPI.renderBinauralTimelineToWav = async (timeline, opts) => {
      return binauralRenderer.renderBinauralTimelineToWav(timeline, opts || {});
    };
    // console.log('✅ transport_widget: TransportAPI.renderBinauralTimelineToWav installed successfully');
  } else {
    console.warn('❌ transport_widget: binauralRenderer not available; transport bridge not installed');
    // console.log('🔧 DEBUG: binauralRenderer:', binauralRenderer);
  }
}

// Also expose setRootKey so UI controls (root key selector) can affect the renderer
export function installTransportSetters() {
  if (!window.TransportAPI) window.TransportAPI = {};
  
  // Install setRootKey
  if (!window.TransportAPI.setRootKey) {
    if (binauralRenderer && typeof binauralRenderer.setRootKey === 'function') {
      window.TransportAPI.setRootKey = (k) => {
        try { binauralRenderer.setRootKey(k); } catch (e) { console.error('setRootKey failed', e); }
      };
      // console.log('transport_widget: TransportAPI.setRootKey installed');
    } else {
      console.warn('transport_widget: binauralRenderer.setRootKey not available; setRootKey not installed');
    }
  }
  
  // Install setPreset - loads journeymap preset and plays timeline
  if (!window.TransportAPI.setPreset) {
    window.TransportAPI.setPreset = async (presetName) => {
      try {
        console.log(`🎵 TRANSPORT: Loading preset "${presetName}"`);
        
        // TODO: Binaural preset loading removed - will be handled via event system
        // First, load binaural preset data (volumes, etc.)
        // Event 'binauralPresetChanged' should be fired by preset controller
        
        // Load preset data via JourneyMapAPI if available
        const jm = window.JourneyMapAPI || {};
        if (jm.renderPreset && typeof jm.renderPreset === 'function') {
          await jm.renderPreset(presetName);
          console.log(`✅ TRANSPORT: Preset "${presetName}" loaded via JourneyMapAPI`);
        } else {
          console.warn('JourneyMapAPI.renderPreset not available');
        }
        
        // Get current timeline and play it
        if (jm.getCurrentPresetData && typeof jm.getCurrentPresetData === 'function') {
          const timeline = jm.getCurrentPresetData();
          if (timeline && timeline.segments) {
            console.log(`🎵 TRANSPORT: Playing timeline with ${timeline.segments.length} segments`);
            // TODO: This shouldn't be here - presets should load BEFORE play, not during
            // await playTimeline(timeline);  // REMOVED - playTimeline() deleted from binaural_synth
          }
        }
      } catch (e) { 
        console.error('setPreset failed', e); 
      }
    };
    console.log('✅ transport_widget: TransportAPI.setPreset installed');
  }
  
  // Install setMood - updates binaural synth mood semitones
  if (!window.TransportAPI.setMood) {
    window.TransportAPI.setMood = (mood) => {
      try {
        console.log(`🎵 TRANSPORT: Setting mood to "${mood}"`);
        
        // Map mood to semitones (same as widget)
        const semitoneMap = {
          'Radiance': [1, 4, 7, 11, 14],
          'Depth': [1, 3, 7, 10, 14], 
          'Stillness': [1, 4, 12, 14, 17]
        };
        
        const semitones = semitoneMap[mood] || semitoneMap['Radiance'];
        setMoodSemitones(semitones);
        console.log(`✅ TRANSPORT: Mood "${mood}" set with semitones [${semitones.join(', ')}]`);
      } catch (e) { 
        console.error('setMood failed', e); 
      }
    };
    console.log('✅ transport_widget: TransportAPI.setMood installed');
  }

  // Install setPosition - moves transport to specific timeline position (in minutes)
  if (!window.TransportAPI.setPosition) {
    window.TransportAPI.setPosition = (minutes) => {
      try {
        console.log(`🎵 TRANSPORT: Setting position to ${minutes} minutes`);
        
        // Convert minutes to seconds for Tone.js transport
        const seconds = minutes * 60;
        
        // Set Tone.js transport position if available
        if (window.Tone && window.Tone.Transport) {
          window.Tone.Transport.seconds = seconds;
          console.log(`✅ TRANSPORT: Position set to ${minutes}m (${seconds}s)`);
        } else {
          console.log(`⚠️ TRANSPORT: Tone.js not available, position request stored`);
        }
      } catch (e) { 
        console.error('setPosition failed', e); 
      }
    };
    console.log('✅ transport_widget: TransportAPI.setPosition installed');
  }
}

// RENDER FUNCTIONALITY - Properly placed in transport widget
async function handleRenderClick() {
  // Test console bridge immediately
  console.log('🧪 CONSOLE BRIDGE TEST: This should appear in col3!');
  
  const renderBtn = document.getElementById('transport-render');
  if (!renderBtn) {
    console.log('🚨 RENDER DEBUG: Render button not found in DOM!');
    return;
  }
  
  // Also try to output directly to col3 debug area
  const col3Output = document.getElementById('col3debug-output') || document.getElementById('debug-output');
  if (col3Output) {
    const testMsg = document.createElement('div');
    testMsg.textContent = '🎵 RENDER: Button clicked, starting render...';
    testMsg.style.color = '#00ff00';
    col3Output.appendChild(testMsg);
    console.log('🧪 COL3 TEST: Added direct message to col3 output');
  } else {
    console.log('🚨 COL3 DEBUG: Could not find col3 debug output element');
    console.log('🚨 COL3 DEBUG: Available elements:', document.querySelectorAll('[id*="debug"], [id*="col3"]'));
  }
  
  console.log('🎵 RENDER: === STARTING RENDER PROCESS ===');
  console.log('🎵 RENDER: Button found:', renderBtn);
  console.log('🎵 RENDER: Button classes before:', renderBtn.className);
  
  // Immediate visual feedback - button stays pressed during render
  renderBtn.disabled = true;
  renderBtn.classList.add('inverted');
  // Don't change text - let it show original "Render" text
  
  console.log('🎵 RENDER: Button disabled and inverted');
  console.log('🎵 RENDER: Button classes after:', renderBtn.className);
  
  const dbg = document.getElementById('debug-output');
  console.log('🎵 RENDER: Debug output element:', dbg);
  
  try {
    // Get current preset from journey map API
    console.log('🎵 RENDER: Checking JourneyMapAPI...');
    console.log('🎵 RENDER: window.JourneyMapAPI:', window.JourneyMapAPI);
    console.log('🎵 RENDER: getCurrentPreset function:', window.JourneyMapAPI?.getCurrentPreset);
    
    const currentPreset = window.JourneyMapAPI?.getCurrentPreset?.();
    console.log('🎵 RENDER: Raw preset from API:', currentPreset);
    
    if (!currentPreset) {
      console.log('🚨 RENDER: No preset available from JourneyMapAPI');
      alert('No preset loaded to render.');
      return;
    }
    
    console.log('🎵 RENDER: Preset available - name:', currentPreset.name);
    console.log('🎵 RENDER: Preset payload:', currentPreset.payload);
    console.log('🎵 RENDER: Preset segments:', currentPreset.payload?.segments || currentPreset.segments);
    
    // Convert journey map preset to timeline format for renderer
    console.log('🎵 RENDER: Converting preset to timeline format...');
    const timeline = convertPresetToTimeline(currentPreset);
    console.log('🎵 RENDER: Timeline conversion result:', timeline);
    
    if (!timeline) {
      console.log('🚨 RENDER: Timeline conversion returned null/undefined');
      console.log('🚨 RENDER: Preset structure debug:', JSON.stringify(currentPreset, null, 2));
      alert('Invalid preset format for rendering.');
      return;
    }
    
    console.log('🎵 RENDER: Timeline segments count:', timeline.segments?.length);
    console.log('🎵 RENDER: First few segments:', timeline.segments?.slice(0, 3));
    
    if (dbg) {
      dbg.textContent = `Starting binaural render... (${timeline.segments.length} segments)`;
      console.log('🎵 RENDER: Debug output updated');
    }
    
    // Use the TransportAPI bridge for rendering
    const transport = window.TransportAPI || {};
    console.log('🎵 RENDER: TransportAPI object:', transport);
    console.log('🎵 RENDER: Available TransportAPI methods:', Object.keys(transport));
    console.log('🎵 RENDER: renderBinauralTimelineToWav function:', transport.renderBinauralTimelineToWav);
    console.log('🎵 RENDER: Function type:', typeof transport.renderBinauralTimelineToWav);
    
    if (transport.renderBinauralTimelineToWav && typeof transport.renderBinauralTimelineToWav === 'function') {
      console.log('🎵 RENDER: === STARTING BINAURAL RENDER ===');
      console.log('🎵 RENDER: Timeline being passed to renderer:', JSON.stringify(timeline, null, 2));
      
      const startTime = performance.now();
      
      const res = await transport.renderBinauralTimelineToWav(timeline, {
        sampleRate: 44100,
        onProgress: ({ chunk, total }) => {
          const progress = `Rendering ${chunk} / ${total}...`;
          const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
          
          if (dbg) dbg.textContent = `${progress} (${elapsed}s)`;
          console.log(`🎵 RENDER PROGRESS: ${progress} - Elapsed: ${elapsed}s`);
          
          // Don't update button text - keep it as "Render"
        }
      });
      
      const totalTime = ((performance.now() - startTime) / 1000).toFixed(1);
      console.log('🎵 RENDER: === RENDER COMPLETED ===');
      console.log('🎵 RENDER: Total render time:', totalTime + 's');
      console.log('🎵 RENDER: Result object:', res);
      console.log('🎵 RENDER: Result blob:', res?.blob);
      console.log('🎵 RENDER: Result total seconds:', res?.totalSeconds);
      console.log('🎵 RENDER: Result sample rate:', res?.sampleRate);
      
      const message = `Render complete: ${Math.round(res.totalSeconds)}s audio in ${totalTime}s. Preparing download...`;
      if (dbg) dbg.textContent = message;
      console.log('🎵 RENDER: ' + message);
      
      // Trigger native "Save As" dialog
      console.log('🎵 RENDER: Creating download blob...');
      const url = URL.createObjectURL(res.blob);
      const filename = `${(currentPreset.name || 'auramatrix-render')}.wav`;
      
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      
      console.log('🎵 RENDER: Download link created:', filename);
      console.log('🎵 RENDER: Blob URL:', url);
      console.log('🎵 RENDER: Triggering download...');
      
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      
      const finalMessage = `Download started: ${filename}`;
      if (dbg) dbg.textContent = finalMessage;
      console.log('🎵 RENDER: ' + finalMessage);
      console.log('🎵 RENDER: === RENDER PROCESS COMPLETE ===');
      
    } else {
      console.log('🚨 RENDER: TransportAPI.renderBinauralTimelineToWav not available!');
      console.log('🚨 RENDER: TransportAPI keys:', Object.keys(transport));
      console.log('🚨 RENDER: Checking if transport widget is loaded...');
      
      // Check if transport widget was properly initialized
      const transportWidgetScript = document.querySelector('script[src*="transport_widget"]');
      console.log('🚨 RENDER: Transport widget script element:', transportWidgetScript);
      
      console.warn('❌ TransportAPI.renderBinauralTimelineToWav not available');
      alert('Rendering unavailable: transport subsystem not initialized.');
    }
    
  } catch (err) {
    console.error('🚨 RENDER: === RENDER FAILED ===');
    console.error('🚨 RENDER: Error object:', err);
    console.error('🚨 RENDER: Error message:', err?.message);
    console.error('🚨 RENDER: Error stack:', err?.stack);
    
    const errorMsg = 'Render failed: ' + (err?.message || 'Unknown error');
    if (dbg) dbg.textContent = errorMsg;
    alert(errorMsg);
  } finally {
    console.log('🎵 RENDER: === CLEANUP ===');
    console.log('🎵 RENDER: Resetting button state...');
    
    // Reset button state after render completes
    renderBtn.disabled = false;
    // Don't reset text - keep it as original "Render"
    
    setTimeout(() => {
      renderBtn.classList.remove('inverted');
      console.log('🎵 RENDER: Inverted class removed, button classes now:', renderBtn.className);
    }, 160);
    
    console.log('🎵 RENDER: === END RENDER PROCESS ===');
  }
}

// Convert journey map preset to timeline format expected by binaural renderer
function convertPresetToTimeline(preset) {
  console.log('🔄 CONVERT: === STARTING PRESET CONVERSION ===');
  console.log('🔄 CONVERT: Input preset:', preset);
  
  if (!preset) {
    console.log('🚨 CONVERT: Preset is null/undefined');
    return null;
  }
  
  const payload = preset.payload || preset;
  console.log('🔄 CONVERT: Extracted payload:', payload);
  console.log('🔄 CONVERT: Payload segments:', payload.segments);
  
  const timeline = { segments: [] };
  
  const segments = payload.segments || [];
  console.log('🔄 CONVERT: Segments array length:', segments.length);
  
  if (segments.length === 0) {
    console.log('🚨 CONVERT: No segments found in preset');
    return null;
  }
  
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    console.log(`🔄 CONVERT: Processing segment ${i}:`, segment);
    
    const convertedSegment = {
      duration_seconds: (segment.duration_min || 0) * 60,
      hz: segment.hz,
      hz_range: segment.hz_range,
      envelope_type: segment.envelope_type
    };
    
    console.log(`🔄 CONVERT: Converted segment ${i}:`, convertedSegment);
    timeline.segments.push(convertedSegment);
  }
  
  console.log('🔄 CONVERT: Final timeline:', timeline);
  console.log('🔄 CONVERT: Timeline segments count:', timeline.segments.length);
  console.log('🔄 CONVERT: === CONVERSION COMPLETE ===');
  
  return timeline.segments.length > 0 ? timeline : null;
}
