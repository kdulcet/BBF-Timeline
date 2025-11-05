import { listRecipeFiles, processAllRecipes } from "../../src/interpreter.js";
import { collectPresetFromDOM, savePresetFile, importPresetObject, savePreset, getPreset } from "../../src/preset_resources.js";
import { 
  stop as stopBinauralSynth,
  scheduleVoiceFrequencies,
  getMoodSemitones,
  getCarrierFrequency,
  getVoiceOctaveOffsets,
  setBinauralBeat,
  initializeNodes
} from "../synths/binaural_synth.js";
import { convertJourneyToBinauralTimeline } from "./binaural_presets.js";

// Calculate BPM from binaural frequency using corrected formula
function calculateTimelineBPM(binauralHz) {
  // Corrected formula: BPM = (Hz * 60) / 8
  // For 25Hz: (25 * 60) / 8 = 187.5 BPM
  // NO ROUNDING - maintain full precision
  return (binauralHz * 60) / 8;
}

// Update transport BPM in real-time from binaural frequency  
function updateTransportBPM(binauralHz) {
  if (!window.Tone || !window.Tone.Transport) return;
  
  // Validate frequency range (0.5hz to 25hz)
  if (binauralHz < 0.5 || binauralHz > 25) {
    console.warn(`Binaural frequency ${binauralHz}Hz outside valid range (0.5-25Hz)`);
    return;
  }
  
  // Calculate precise BPM - NO ROUNDING
  const preciseBPM = calculateTimelineBPM(binauralHz);
  
  try {
    // Update transport BPM with full precision
    window.Tone.Transport.bpm.value = preciseBPM;
    console.log(`🎵 Timeline BPM updated to ${preciseBPM} from ${binauralHz}Hz binaural frequency`);
  } catch (e) {
    console.warn('Failed to update transport BPM:', e);
  }
}

// Schedule transport BPM ramp with linear transitions - NO ROUNDING
function scheduleTransportBPMRamp(startHz, endHz, time, duration) {
  if (!window.Tone || !window.Tone.Transport) return;
  
  // Validate frequency ranges
  if (startHz < 0.5 || startHz > 25 || endHz < 0.5 || endHz > 25) {
    console.warn(`Binaural frequencies outside valid range: ${startHz}Hz → ${endHz}Hz (valid: 0.5-25Hz)`);
    return;
  }
  
  try {
    const startBPM = calculateTimelineBPM(startHz);
    const endBPM = calculateTimelineBPM(endHz);
    
    // CRITICAL: Cancel pending automation to prevent timeline event accumulation
    window.Tone.Transport.bpm.cancelScheduledValues(time);
    
    // Set initial BPM value at start time - NO ROUNDING
    window.Tone.Transport.bpm.setValueAtTime(startBPM, time);
    
    // Linear ramp to end BPM over duration - NO ROUNDING  
    window.Tone.Transport.bpm.linearRampToValueAtTime(endBPM, time + duration);
    
    console.log(`🎵 Transport BPM ramping: ${startBPM} → ${endBPM} over ${duration}s (${startHz}Hz → ${endHz}Hz)`);
  } catch (e) {
    console.warn('Failed to schedule transport BPM ramp:', e);
  }
}

// Timeline scheduling functions (moved from binaural_synth.js)
async function scheduleTimelineToSynths(timeline, playbackFactor = 1) {
  if (!timeline || !Array.isArray(timeline.segments)) return false;
  
  // Clear any existing scheduled events
  // Clear Tone.Transport schedule (journeymap speaks to transport directly)
  if (window.Tone && window.Tone.Transport) {
    window.Tone.Transport.cancel(0);
    window.Tone.Transport.loop = false;
    window.Tone.Transport.loopEnd = 0;
  }
  
  // Set initial BPM from first segment (but DON'T set Hz yet - let schedule handle it)
  if (timeline.segments.length > 0) {
    const firstSegment = timeline.segments[0];
    let firstHz = 0;
    
    if (typeof firstSegment.hz === 'number') {
      firstHz = firstSegment.hz;
    } else if (Array.isArray(firstSegment.hz)) {
      firstHz = typeof firstSegment.hz[0] === 'number' ? firstSegment.hz[0] : 0;
    } else if (firstSegment.hz_range) {
      firstHz = typeof firstSegment.hz_range[0] === 'number' ? firstSegment.hz_range[0] : 0;
    }
    
    if (firstHz > 0) {
      // Set initial Transport BPM from Hz (Transport needs this before play)
      updateTransportBPM(firstHz);
      console.log(`🎼 Initial Transport BPM: ${calculateTimelineBPM(firstHz)} from ${firstHz}Hz`);
    }
  }
  
  // PRECALCULATE all Hz values for the entire journey (looking at surrounding segments)
  const calculatedSegments = [];
  
  for (let i = 0; i < timeline.segments.length; i++) {
    const segment = timeline.segments[i];
    const duration = segment.duration_seconds || 0;
    const scaledDuration = Math.max(0.001, duration / playbackFactor);
    
    let startHz = 0;
    let endHz = 0;
    
    if (segment.type === 'plateau') {
      // Plateau: start and end at the same Hz
      startHz = endHz = segment.hz || 0;
    } else if (segment.type === 'transition') {
      // Transition: find previous and next plateau Hz values
      let prevHz = 0;
      let nextHz = 0;
      
      // Look backward for previous plateau
      for (let j = i - 1; j >= 0; j--) {
        if (timeline.segments[j].type === 'plateau' && timeline.segments[j].hz) {
          prevHz = timeline.segments[j].hz;
          break;
        }
      }
      
      // Look forward for next plateau
      for (let j = i + 1; j < timeline.segments.length; j++) {
        if (timeline.segments[j].type === 'plateau' && timeline.segments[j].hz) {
          nextHz = timeline.segments[j].hz;
          break;
        }
      }
      
      startHz = prevHz;
      endHz = nextHz;
    } else {
      // Fallback for unknown types
      if (typeof segment.hz === 'number') {
        startHz = endHz = segment.hz;
      } else if (Array.isArray(segment.hz)) {
        startHz = typeof segment.hz[0] === 'number' ? segment.hz[0] : 0;
        endHz = typeof segment.hz[1] === 'number' ? segment.hz[1] : startHz;
      } else if (segment.hz_range) {
        startHz = typeof segment.hz_range[0] === 'number' ? segment.hz_range[0] : 0;
        endHz = typeof segment.hz_range[1] === 'number' ? segment.hz_range[1] : startHz;
      }
    }
    
    calculatedSegments.push({
      startHz,
      endHz,
      duration: scaledDuration,
      envelopeType: segment.envelope_type || 'linear',
      isFirst: i === 0
    });
    
    console.log(`📊 Segment ${i} (${segment.type}): ${startHz}Hz → ${endHz}Hz over ${scaledDuration.toFixed(1)}s`);
  }
  
  // Now schedule all segments with precalculated Hz values
  let currentTime = 0;
  
  for (let i = 0; i < calculatedSegments.length; i++) {
    const { startHz, endHz, duration, envelopeType, isFirst } = calculatedSegments[i];
    
    // PRE-SCHEDULE Hz automation for synths IMMEDIATELY (not in realtime callback)
    // This schedules all Tone.js automation BEFORE Transport.start() for sample-accurate timing
    scheduleBinauralSegment(startHz, endHz, currentTime, duration, envelopeType, isFirst);
    
    // PRE-SCHEDULE BPM automation for Transport IMMEDIATELY
    if (startHz > 0 && endHz > 0 && window.Tone && window.Tone.Transport) {
      try {
        const startBPM = calculateTimelineBPM(startHz);
        const endBPM = calculateTimelineBPM(endHz);
        
        // CRITICAL: Cancel pending automation to prevent timeline event accumulation
        window.Tone.Transport.bpm.cancelScheduledValues(currentTime);
        
        // Set BPM at segment start
        window.Tone.Transport.bpm.setValueAtTime(startBPM, currentTime);
        
        // If Hz changes, ramp BPM
        if (startHz !== endHz) {
          window.Tone.Transport.bpm.linearRampToValueAtTime(endBPM, currentTime + duration);
        }
      } catch (bpmError) {
        console.error('BPM scheduling error at segment', i, ':', bpmError);
        throw bpmError; // Re-throw with context
      }
    }
    
    currentTime += duration;
  }
  
  console.log(`🎼 Timeline scheduled: ${calculatedSegments.length} segments over ${currentTime.toFixed(1)}s`);
  return true;
}

function scheduleBinauralSegment(startHz, endHz, time, duration, envelopeType = 'linear', isFirstSegment = false) {
  const carrierFreq = getCarrierFrequency() || 196.0;
  const moodSemitones = getMoodSemitones() || [1, 4, 7, 11, 14];
  
  console.log(`🎵 scheduleBinauralSegment: ${startHz}Hz → ${endHz}Hz at t=${time.toFixed(2)}s, duration=${duration.toFixed(2)}s, isFirst=${isFirstSegment}`);
  
  // Calculate center frequency (carrier without binaural beat)
  const baseFreqStart = carrierFreq;
  const baseFreqEnd = carrierFreq;
  const binauralBeatStart = startHz;  // This is the journeymap hz value
  const binauralBeatEnd = endHz;      // This is the journeymap hz value
  
  // Calculate frequencies for all 5 voices using mood semitones and octave offsets
  const voiceFrequencies = [];
  
  // Get scales system for interval calculations
  const scalesSystem = window.Scales ? new window.Scales() : null;
  if (scalesSystem) {
    scalesSystem.setScale('just');
    scalesSystem.setBaseFrequency(carrierFreq);
  }
  
  moodSemitones.forEach((semitone, index) => {
    if (index < 5) {
      let voiceFreqStart = baseFreqStart;
      let voiceFreqEnd = baseFreqEnd;
      
      // Apply mood semitone interval if scales available
      if (scalesSystem) {
        const intervalRatio = scalesSystem.getFrequency(semitone - 1, 0) / scalesSystem.getFrequency(0, 0);
        voiceFreqStart *= intervalRatio;
        voiceFreqEnd *= intervalRatio;
      }
      
      // Apply octave offset from binaural synth current state
      const octaveOffsets = getVoiceOctaveOffsets();
      const octaveOffset = octaveOffsets[index] || 0;
      const octaveMultiplier = Math.pow(2, octaveOffset);
      voiceFreqStart *= octaveMultiplier;
      voiceFreqEnd *= octaveMultiplier;
      
      // Use FIXED Hz binaural beat distance across ALL octaves
      const leftStart = voiceFreqStart - binauralBeatStart / 2;
      const rightStart = voiceFreqStart + binauralBeatStart / 2;
      const leftEnd = voiceFreqEnd - binauralBeatEnd / 2;  
      const rightEnd = voiceFreqEnd + binauralBeatEnd / 2;
      
      voiceFrequencies.push({
        voiceIndex: index,
        leftFreq: leftStart,
        rightFreq: rightStart,
        leftEnd: leftEnd,
        rightEnd: rightEnd
      });
    }
  });
  
  // Send to binaural synth with isFirstSegment flag
  scheduleVoiceFrequencies(voiceFrequencies, time, duration, envelopeType, isFirstSegment);
  
  // REMOVED: Isochronic pulse system no longer used
  // scheduleIsochronicFrequencyRamp(binauralBeatStart, binauralBeatEnd, time, duration, envelopeType);
}

// Load corresponding binaural preset when journey preset is loaded
export async function loadBinauralPresetForJourney(journeyPresetName) {
  if (!journeyPresetName) return;
  
  // REMOVED: Preset loading should happen BEFORE play button is pressed, not during playback
  // The transport should assume all synths are already initialized with correct values
  // If preset loading happens here, it clears IsResume flags and resets user adjustments
}

// PUBLIC API: Schedule timeline by reading CURRENT DOM values
export async function scheduleJourneyTimeline(timeline, playbackFactor = 1) {
  try {
    console.log('📍 scheduleJourneyTimeline START');
    
    // STEP 1: Initialize audio nodes (without starting oscillators)
    console.log('📍 Step 1: Initializing nodes...');
    const initialized = await initializeNodes();
    if (!initialized) {
      console.error('Failed to initialize audio nodes');
      return false;
    }
    console.log('✅ Step 1: Nodes initialized');
    
    // RESET TRANSPORT: Critical for restarting timeline from beginning
    if (window.Tone && window.Tone.Transport) {
      window.Tone.Transport.seconds = 0;
      console.log('⏮️ Transport reset to 0 seconds');
    }
    
    // STEP 2: Pull CURRENT journeymap values from DOM (via widget's DOM reader)
    console.log('📍 Step 2: Getting journeymap data...');
    const currentJourneyData = window.JourneymapWidget?.collectJourneyDataFromDOM() || null;
    console.log('✅ Step 2: Got journeymap data:', currentJourneyData ? 'YES' : 'NO');
    
    // STEP 3: Check if we're in edit mode (any plateau has .looping class)
    const loopingPlateau = document.querySelector('.jm-box.plateau.looping');
    let timelineToPlay = currentJourneyData ? 
      convertJourneyToBinauralTimeline(currentJourneyData) : timeline;
    
    if (loopingPlateau && timelineToPlay && timelineToPlay.segments && timelineToPlay.segments.length > 0) {
      // Edit mode: Loop the segment that's marked as looping
      // Get Hz and duration directly from the DOM box (more reliable than index matching)
      const loopHz = parseFloat(loopingPlateau.dataset.hz);
      const loopDuration = parseFloat(loopingPlateau.dataset.duration) * 60; // Convert minutes to seconds
      
      if (loopHz && loopDuration) {
        console.log(`🔄 EDIT MODE: Looping plateau (${loopHz}Hz, ${loopDuration}s)`);
        
        // Create a new timeline with just this segment repeated
        timelineToPlay = {
          segments: [{
            hz: loopHz,
            duration_seconds: loopDuration,
            type: 'plateau'
          }]
        };
      }
    }
    
    // STEP 4: Pull CURRENT binaural preset values 
    const currentBinauralData = null; // Binaural synth uses its current state
    
    // STEP 5: Schedule the timeline with CURRENT data (this sets all Hz via Transport)
    // NOTE: Does NOT start oscillators - synth will listen for Transport play event
    console.log('📍 Step 5: Converting timeline...');
    console.log('✅ Step 5: Timeline converted:', timelineToPlay ? `${timelineToPlay.segments?.length} segments` : 'NULL');
    
    console.log('📍 Step 6: Scheduling to synths...');
    const scheduled = await scheduleTimelineToSynths(timelineToPlay, playbackFactor);
    if (!scheduled) {
      console.error('Failed to schedule timeline');
      return false;
    }
    console.log('✅ Step 6: Scheduled successfully');
    
    // STEP 7: If looping a specific plateau, immediately set that Hz (don't wait for Transport)
    if (loopingPlateau) {
      const loopHz = parseFloat(loopingPlateau.dataset.hz);
      if (loopHz) {
        console.log(`🎯 Setting immediate Hz to ${loopHz} for looping plateau`);
        const { setBinauralBeat } = await import('../synths/binaural_synth.js');
        setBinauralBeat(loopHz);
      }
    }
    
    // REMOVED: Transport start/stop is handled by transport_widget, not journeymap
    // Journeymap only schedules BPM and Hz maps to the timeline
    
    console.log('✅ scheduleJourneyTimeline COMPLETE');
    return true;
  } catch (e) {
    console.error('❌ Error in scheduleJourneyTimeline:', e);
    console.error('❌ Error type:', typeof e);
    console.error('❌ Error constructor:', e?.constructor?.name);
    console.error('❌ Error stack:', e?.stack);
    return false;
  }
}

// Apply current journeymap Hz values to binaural synth immediately (for manual changes)
export function applyCurrentJourneymapHz(journeyData) {
  // Handle both payload format and direct segments format
  const segments = journeyData?.segments || journeyData?.payload?.segments || journeyData;
  if (!segments || !Array.isArray(segments)) return;
  
  // Find the first plateau with Hz data
  let currentHz = null;
  for (const segment of segments) {
    if (segment.type === 'plateau' && segment.hz && segment.hz > 0) {
      currentHz = segment.hz;
      break;
    }
  }
  
  if (currentHz) {
    console.log(`🎵 Applying journeymap Hz: ${currentHz}Hz to binaural synth`);
    setBinauralBeat(currentHz);
    
    // Update all voice frequencies immediately with the new Hz
    const carrierFreq = getCarrierFrequency() || 196.0;
    const moodSemitones = getMoodSemitones() || [1, 4, 7, 11, 14];
    const octaveOffsets = getVoiceOctaveOffsets();
    
    // Calculate and apply new frequencies for all voices
    const scalesSystem = window.Scales ? new window.Scales() : null;
    if (scalesSystem) {
      scalesSystem.setScale('just');
      scalesSystem.setBaseFrequency(carrierFreq);
    }
    
    const voiceFrequencies = [];
    moodSemitones.forEach((semitone, index) => {
      if (index < 5) {
        let voiceFreq = carrierFreq;
        
        // Apply mood semitone interval
        if (scalesSystem) {
          const intervalRatio = scalesSystem.getFrequency(semitone - 1, 0) / scalesSystem.getFrequency(0, 0);
          voiceFreq *= intervalRatio;
        }
        
        // Apply octave offset
        const octaveOffset = octaveOffsets[index] || 0;
        voiceFreq *= Math.pow(2, octaveOffset);
        
        // Apply binaural beat
        const leftFreq = voiceFreq - currentHz / 2;
        const rightFreq = voiceFreq + currentHz / 2;
        
        voiceFrequencies.push({
          voiceIndex: index,
          leftFreq: leftFreq,
          rightFreq: rightFreq
        });
      }
    });
    
    // Apply immediately with no duration (instant change)
    const now = window.Tone ? window.Tone.now() : 0;
    scheduleVoiceFrequencies(voiceFrequencies, now, 0);
  }
}

export function stopJourneyTimeline() {
  stopBinauralSynth();
  
  // REMOVED: Transport stop is handled by transport_widget, not journeymap
  // Journeymap only manages the BPM/Hz scheduling, not transport playback control
  
  console.log('Journey timeline stopped');
}