/**
 * Timeline Base Class
 * Adapted from Tone.js Timeline for JourneyMap Timeline System
 * 
 * A Timeline class for scheduling and maintaining state along a timeline.
 * All events must have a "time" property. Internally, events are stored
 * in time order for fast retrieval using binary search.
 */

/**
 * Timeline event interface - all events must have time property
 */
class TimelineEvent {
  constructor(time) {
    this.time = time;
  }
}

/**
 * Timeline class for efficient time-ordered event storage and retrieval
 */
class Timeline {
  constructor(options = {}) {
    this.name = "Timeline";
    
    // Memory management - how many past events to retain
    this.memory = options.memory || 1000;
    
    // If true, events must be added in increasing time order (optimization)
    this.increasing = options.increasing || false;
    
    // Internal array of timeline events, kept in time order
    this._timeline = [];
  }

  /**
   * Number of events currently in timeline
   */
  get length() {
    return this._timeline.length;
  }

  /**
   * Add event to timeline. Events must have a "time" property.
   * @param {TimelineEvent} event - Event to add
   * @returns {Timeline} this
   */
  add(event) {
    // Ensure event has time property
    if (typeof event.time === 'undefined') {
      throw new Error('Timeline: events must have a time property');
    }
    
    // Convert time to number if needed
    event.time = Number(event.time);
    
    if (this.increasing && this.length > 0) {
      // Optimization: if events are added in order, just push
      const lastTime = this._timeline[this.length - 1].time;
      if (event.time >= lastTime) {
        this._timeline.push(event);
      } else {
        throw new Error('Timeline: time must be >= last scheduled time when increasing=true');
      }
    } else {
      // Find correct insertion point using binary search
      const index = this._search(event.time);
      this._timeline.splice(index + 1, 0, event);
    }
    
    // Enforce memory limit
    if (this.length > this.memory) {
      const excess = this.length - this.memory;
      this._timeline.splice(0, excess);
    }
    
    return this;
  }

  /**
   * Remove event from timeline
   * @param {TimelineEvent} event - Event to remove
   * @returns {Timeline} this
   */
  remove(event) {
    const index = this._timeline.indexOf(event);
    if (index !== -1) {
      this._timeline.splice(index, 1);
    }
    return this;
  }

  /**
   * Get event at or before given time
   * @param {number} time - Time to query
   * @returns {TimelineEvent|null} Event or null if none found
   */
  get(time) {
    const index = this._search(time);
    return (index !== -1) ? this._timeline[index] : null;
  }

  /**
   * Get event scheduled after given time
   * @param {number} time - Time to query
   * @returns {TimelineEvent|null} Event or null if none found
   */
  getAfter(time) {
    const index = this._search(time);
    return (index + 1 < this._timeline.length) ? this._timeline[index + 1] : null;
  }

  /**
   * Get event scheduled before given time
   * @param {number} time - Time to query  
   * @returns {TimelineEvent|null} Event or null if none found
   */
  getBefore(time) {
    const length = this._timeline.length;
    
    // If time is after last event, return last event
    if (length > 0 && this._timeline[length - 1].time < time) {
      return this._timeline[length - 1];
    }
    
    const index = this._search(time);
    return (index - 1 >= 0) ? this._timeline[index - 1] : null;
  }

  /**
   * Cancel events at and after given time
   * @param {number} after - Time threshold
   * @returns {Timeline} this
   */
  cancel(after) {
    if (this._timeline.length > 1) {
      let index = this._search(after);
      if (index >= 0) {
        // Check if event at index has exact time match
        if (this._isEqual(this._timeline[index].time, after)) {
          // Find first event with this time
          for (let i = index; i >= 0; i--) {
            if (this._isEqual(this._timeline[i].time, after)) {
              index = i;
            } else {
              break;
            }
          }
          this._timeline = this._timeline.slice(0, index);
        } else {
          this._timeline = this._timeline.slice(0, index + 1);
        }
      } else {
        this._timeline = [];
      }
    } else if (this._timeline.length === 1) {
      if (this._timeline[0].time >= after) {
        this._timeline = [];
      }
    }
    return this;
  }

  /**
   * Cancel events before or at given time
   * @param {number} time - Time threshold
   * @returns {Timeline} this
   */
  cancelBefore(time) {
    const index = this._search(time);
    if (index >= 0) {
      this._timeline = this._timeline.slice(index + 1);
    }
    return this;
  }

  /**
   * Iterate over events in time range [startTime, endTime)
   * @param {number} startTime - Start time (inclusive)
   * @param {number} endTime - End time (exclusive)
   * @param {Function} callback - Function to call for each event
   * @returns {Timeline} this
   */
  forEachBetween(startTime, endTime, callback) {
    let lowerBound = this._search(startTime);
    let upperBound = this._search(endTime);
    
    if (lowerBound !== -1 && upperBound !== -1) {
      // Adjust bounds for inclusive start, exclusive end
      if (this._timeline[lowerBound].time !== startTime) {
        lowerBound += 1;
      }
      if (this._timeline[upperBound].time === endTime) {
        upperBound -= 1;
      }
      this._iterate(callback, lowerBound, upperBound);
    } else if (lowerBound === -1) {
      this._iterate(callback, 0, upperBound);
    }
    return this;
  }

  /**
   * Iterate over all events
   * @param {Function} callback - Function to call for each event
   * @returns {Timeline} this
   */
  forEach(callback) {
    this._iterate(callback);
    return this;
  }

  /**
   * Binary search for event index at or before given time
   * @param {number} time - Time to search for
   * @returns {number} Index of event, or -1 if none found
   */
  _search(time) {
    if (this._timeline.length === 0) {
      return -1;
    }
    
    let beginning = 0;
    const length = this._timeline.length;
    let end = length;
    
    // Optimization: if time is after last event, return last index
    if (length > 0 && this._timeline[length - 1].time <= time) {
      return length - 1;
    }
    
    // Binary search
    while (beginning < end) {
      const midPoint = Math.floor(beginning + (end - beginning) / 2);
      const event = this._timeline[midPoint];
      const nextEvent = this._timeline[midPoint + 1];
      
      if (this._isEqual(event.time, time)) {
        // Find last event with same time
        let lastIndex = midPoint;
        for (let i = midPoint; i < this._timeline.length; i++) {
          if (this._isEqual(this._timeline[i].time, time)) {
            lastIndex = i;
          } else {
            break;
          }
        }
        return lastIndex;
      } else if (event.time < time && nextEvent.time > time) {
        return midPoint;
      } else if (event.time > time) {
        end = midPoint;
      } else {
        beginning = midPoint + 1;
      }
    }
    
    return -1;
  }

  /**
   * Safely iterate over timeline events in range
   * @param {Function} callback - Function to call for each event
   * @param {number} lowerBound - Start index (default: 0)
   * @param {number} upperBound - End index (default: length - 1)
   */
  _iterate(callback, lowerBound = 0, upperBound = this._timeline.length - 1) {
    // Use slice to avoid issues if timeline is modified during iteration
    this._timeline.slice(lowerBound, upperBound + 1).forEach(callback);
  }

  /**
   * Test if two time values are equal (handles floating point precision)
   * @param {number} a - First time value
   * @param {number} b - Second time value
   * @returns {boolean} True if equal within tolerance
   */
  _isEqual(a, b) {
    const tolerance = 1e-6; // Microsecond precision
    return Math.abs(a - b) < tolerance;
  }

  /**
   * Clear all events and clean up
   * @returns {Timeline} this
   */
  dispose() {
    this._timeline = [];
    return this;
  }

  /**
   * Get timeline events (for debugging)
   * @returns {Array} Copy of timeline events
   */
  getEvents() {
    return [...this._timeline];
  }
}

// Export for use by other timeline classes
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Timeline, TimelineEvent };
} else if (typeof window !== 'undefined') {
  window.Timeline = Timeline;
  window.TimelineEvent = TimelineEvent;
}