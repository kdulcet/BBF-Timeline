/**
 * StateTimeline Class
 * Direct adaptation from Tone.js StateTimeline for transport state management
 * 
 * CORE FUNCTIONALITY (identical to Tone.js StateTimeline):
 * • Timeline subclass specialized for state tracking (started/stopped/paused)
 * • State interpolation: getValueAtTime() returns state active at given time
 * • State history: getLastState() finds previous occurrences of specific states
 * • State duration: getDurationInState() calculates time spent in states
 * 
 * TONE.JS SOURCE: Based on Tone.js/core/util/StateTimeline.ts
 * Used by Transport for tracking play/pause/stop states with sample accuracy
 * 
 * USAGE: JMTimeline uses this to track transport state changes for proper
 * pause/resume behavior and synth lifecycle management (auto start/stop)
 */

// Import Timeline base class (assumes timeline.js is loaded)
// const { Timeline, TimelineEvent } = require('./timeline.js'); // Node.js
// or Timeline/TimelineEvent available globally

/**
 * Playback state types
 */
const PlaybackState = {
  STOPPED: 'stopped',
  STARTED: 'started', 
  PAUSED: 'paused'
};

/**
 * State timeline event - extends TimelineEvent with state property
 */
class StateTimelineEvent extends TimelineEvent {
  constructor(time, state, options = {}) {
    super(time);
    this.state = state;
    
    // Allow additional properties for extended functionality
    Object.assign(this, options);
  }
}

/**
 * StateTimeline - Timeline subclass for transport state management
 * 
 * TRANSPORT STATE TRACKING (like Tone.js Transport state management):
 * • Maintains started/stopped/paused state history with sample-accurate timing
 * • Enables proper pause/resume behavior by tracking state timeline
 * • Allows synths to query "was transport running at time X?" 
 * 
 * TONE.JS PATTERN: Similar to how Tone.js Transport tracks its own state
 * for determining oscillator start times, automation scheduling, etc.
 * See: Tone.js Transport._state property and state management methods
 */
class StateTimeline extends Timeline {
  constructor(initialState = PlaybackState.STOPPED, options = {}) {
    super(options);
    
    this.name = "StateTimeline";
    this._initial = initialState;
    
    // Initialize with starting state (like Tone.js Transport constructor)
    this.setStateAtTime(this._initial, 0);
  }

  /**
   * Get the current state at given time
   * @param {number} time - Time to query
   * @returns {string} State at that time
   */
  getValueAtTime(time) {
    const event = this.get(time);
    return event ? event.state : this._initial;
  }

  /**
   * Set state at specific time
   * @param {string} state - State to set ('started', 'stopped', 'paused')
   * @param {number} time - Time when state should change
   * @param {Object} options - Additional properties for the event
   * @returns {StateTimeline} this
   */
  setStateAtTime(state, time, options = {}) {
    // Validate time is not negative
    if (time < 0) {
      throw new Error('StateTimeline: time must be >= 0');
    }
    
    // Validate state
    const validStates = Object.values(PlaybackState);
    if (!validStates.includes(state)) {
      throw new Error(`StateTimeline: invalid state "${state}". Valid states: ${validStates.join(', ')}`);
    }
    
    // Create and add state event
    const stateEvent = new StateTimelineEvent(time, state, options);
    this.add(stateEvent);
    
    return this;
  }

  /**
   * Find the last occurrence of a specific state before given time
   * @param {string} state - State to search for
   * @param {number} time - Time to search before
   * @returns {StateTimelineEvent|undefined} Event with that state, or undefined
   */
  getLastState(state, time) {
    const index = this._search(time);
    
    // Search backwards from index
    for (let i = index; i >= 0; i--) {
      const event = this._timeline[i];
      if (event.state === state) {
        return event;
      }
    }
    
    return undefined;
  }

  /**
   * Find the next occurrence of a specific state after given time
   * @param {string} state - State to search for  
   * @param {number} time - Time to search after
   * @returns {StateTimelineEvent|undefined} Event with that state, or undefined
   */
  getNextState(state, time) {
    const index = this._search(time);
    
    // Search forwards from index + 1
    for (let i = index + 1; i < this._timeline.length; i++) {
      const event = this._timeline[i];
      if (event.state === state) {
        return event;
      }
    }
    
    return undefined;
  }

  /**
   * Get all state changes between two times
   * @param {number} startTime - Start time (inclusive)
   * @param {number} endTime - End time (exclusive) 
   * @param {Function} callback - Function called for each state change
   * @returns {StateTimeline} this
   */
  forEachBetween(startTime, endTime, callback) {
    // Use parent class forEachBetween, but ensure callback gets state events
    super.forEachBetween(startTime, endTime, (event) => {
      if (event instanceof StateTimelineEvent || event.state) {
        callback(event);
      }
    });
    return this;
  }

  /**
   * Check if timeline is in a specific state at given time
   * @param {string} state - State to check for
   * @param {number} time - Time to check
   * @returns {boolean} True if timeline is in that state
   */
  isStateAtTime(state, time) {
    return this.getValueAtTime(time) === state;
  }

  /**
   * Get duration timeline has been in specific state up to given time
   * @param {string} state - State to measure
   * @param {number} time - End time for measurement
   * @returns {number} Total seconds in that state
   */
  getDurationInState(state, time) {
    let totalDuration = 0;
    let currentStateStart = null;
    
    // Iterate through all events up to time
    this.forEachBetween(0, time, (event) => {
      if (event.state === state) {
        currentStateStart = event.time;
      } else if (currentStateStart !== null) {
        // State ended, add to total duration
        totalDuration += event.time - currentStateStart;
        currentStateStart = null;
      }
    });
    
    // If still in state at end time, add remaining duration
    if (currentStateStart !== null && this.getValueAtTime(time) === state) {
      totalDuration += time - currentStateStart;
    }
    
    return totalDuration;
  }

  /**
   * Get current state (shorthand for getValueAtTime with current time)
   * Requires audioContext to be passed in since StateTimeline doesn't have one
   * @param {AudioContext} audioContext - Audio context for currentTime
   * @returns {string} Current state
   */
  getCurrentState(audioContext) {
    if (!audioContext) {
      throw new Error('StateTimeline: audioContext required to get current state');
    }
    return this.getValueAtTime(audioContext.currentTime);
  }

  /**
   * Schedule state change relative to current time
   * @param {string} state - State to set
   * @param {number} deltaTime - Seconds from now
   * @param {AudioContext} audioContext - Audio context for currentTime
   * @param {Object} options - Additional properties
   * @returns {StateTimeline} this
   */
  setStateIn(state, deltaTime, audioContext, options = {}) {
    if (!audioContext) {
      throw new Error('StateTimeline: audioContext required for relative scheduling');
    }
    
    const absoluteTime = audioContext.currentTime + deltaTime;
    return this.setStateAtTime(state, absoluteTime, options);
  }

  /**
   * Clear all state changes after given time and set new state
   * @param {string} state - State to set
   * @param {number} time - Time to clear after and set state
   * @returns {StateTimeline} this
   */
  setStateAtTimeAndCancel(state, time) {
    this.cancel(time);
    return this.setStateAtTime(state, time);
  }

  /**
   * Debug helper - get timeline as readable array
   * @returns {Array} Array of {time, state} objects
   */
  getStateTimeline() {
    return this._timeline.map(event => ({
      time: event.time,
      state: event.state,
      ...(event.options || {})
    }));
  }
}

// Export PlaybackState constants and StateTimeline class
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { StateTimeline, StateTimelineEvent, PlaybackState };
} else if (typeof window !== 'undefined') {
  window.StateTimeline = StateTimeline;
  window.StateTimelineEvent = StateTimelineEvent;
  window.PlaybackState = PlaybackState;
}