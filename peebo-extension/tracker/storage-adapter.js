/**
 * Storage adapter for Chrome extension tracker.
 * Uses chrome.storage.local exclusively.
 */

class StorageAdapter {
  constructor() {
    console.log('[StorageAdapter] Chrome Extension mode');
  }

  /**
   * Load tracker data from chrome.storage.local.
   * @returns {Promise<Object>} Tracker data with settings and jobs
   */
  async load() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['tracker_data'], (result) => {
        const data = result.tracker_data || this._getDefaultData();
        console.log(`[StorageAdapter] Loaded ${data.jobs?.length || 0} jobs from Chrome storage`);
        resolve(data);
      });
    });
  }

  /**
   * Save tracker data to chrome.storage.local.
   * @param {Object} data - Tracker data with settings and jobs
   * @returns {Promise<void>}
   */
  async save(data) {
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

/**
 * Trigger email sync via service worker.
 * @returns {Promise<Object>} Sync result
 */
async function triggerEmailSync() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'SYNC_AGENTMAIL' }, (response) => {
      resolve(response || { success: false, error: 'No response from service worker' });
    });
  });
}

/**
 * Get sync status from service worker.
 * @returns {Promise<Object>} Sync status
 */
async function getSyncStatus() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_SYNC_STATUS' }, (response) => {
      resolve(response || { isConfigured: false, lastSyncAt: null });
    });
  });
}

/**
 * Start a job application via service worker.
 * @param {string} jobUrl - URL of the job to apply to
 * @returns {Promise<Object>} Application result
 */
async function startApplication(jobUrl) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'START_APPLICATION', jobUrl }, (response) => {
      resolve(response || { success: false, error: 'No response from service worker' });
    });
  });
}

/**
 * Get active tasks from service worker.
 * @returns {Promise<Object>} Active tasks
 */
async function getActiveTasks() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_ACTIVE_TASKS' }, (response) => {
      resolve(response?.tasks || {});
    });
  });
}
