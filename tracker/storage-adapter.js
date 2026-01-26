/**
 * Unified storage adapter that works in both Flask and Chrome extension contexts.
 * Auto-detects environment and provides consistent load/save interface.
 */

class StorageAdapter {
  constructor() {
    // Auto-detect environment
    this.isExtension = typeof chrome !== 'undefined' && chrome.storage;
    console.log(`[StorageAdapter] Environment: ${this.isExtension ? 'Chrome Extension' : 'Flask API'}`);
  }

  /**
   * Load tracker data from storage.
   * @returns {Promise<Object>} Tracker data with settings and jobs
   */
  async load() {
    if (this.isExtension) {
      return new Promise((resolve) => {
        chrome.storage.local.get(['tracker_data'], (result) => {
          const data = result.tracker_data || this._getDefaultData();
          console.log(`[StorageAdapter] Loaded ${data.jobs?.length || 0} jobs from Chrome storage`);
          resolve(data);
        });
      });
    } else {
      // Flask API with cache-busting
      const url = '/api/jobs?_=' + Date.now();
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();
        console.log(`[StorageAdapter] Loaded ${data.jobs?.length || 0} jobs from Flask API`);
        return data;
      } catch (error) {
        console.error('[StorageAdapter] Load failed:', error);
        throw error;
      }
    }
  }

  /**
   * Save tracker data to storage.
   * @param {Object} data - Tracker data with settings and jobs
   * @returns {Promise<void>}
   */
  async save(data) {
    if (this.isExtension) {
      return new Promise((resolve, reject) => {
        chrome.storage.local.set({ tracker_data: data }, () => {
          if (chrome.runtime.lastError) {
            console.error('[StorageAdapter] Save failed:', chrome.runtime.lastError);
            reject(chrome.runtime.lastError);
          } else {
            console.log(`[StorageAdapter] Saved ${data.jobs?.length || 0} jobs to Chrome storage`);
            resolve();
          }
        });
      });
    } else {
      // Flask API
      try {
        const response = await fetch('/api/jobs', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(data)
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        console.log(`[StorageAdapter] Saved ${data.jobs?.length || 0} jobs to Flask API`);
      } catch (error) {
        console.error('[StorageAdapter] Save failed:', error);
        throw error;
      }
    }
  }

  /**
   * Get default data structure.
   * @private
   * @returns {Object} Default tracker data
   */
  _getDefaultData() {
    return {
      settings: {
        followUpDays: 2,
        active_tasks: {}
      },
      jobs: []
    };
  }
}

// Single global instance
const storage = new StorageAdapter();
