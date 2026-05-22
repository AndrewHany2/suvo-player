const { contextBridge, ipcRenderer } = require("electron");

/**
 * Expose Electron APIs to the renderer process
 * Uses contextBridge for secure communication between main and renderer processes
 */
contextBridge.exposeInMainWorld("electron", {
  /**
   * Open a stream in VLC Media Player
   * @param {string} streamUrl - The URL of the stream to play
   * @param {Object} options - Playback options
   * @param {string} options.name - Display name for the stream
   * @param {number} options.startTime - Start time in seconds (for resume playback)
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  openInVLC: (streamUrl, options) =>
    ipcRenderer.invoke("open-in-vlc", streamUrl, options),

  /**
   * Open file dialog to select an M3U playlist
   * @returns {Promise<{success: boolean, content?: string, path?: string, error?: string}>}
   */
  selectPlaylist: () => ipcRenderer.invoke("select-playlist"),

  /**
   * Save playlist content to a file
   * @param {string} content - M3U playlist content
   * @returns {Promise<{success: boolean, path?: string, error?: string}>}
   */
  savePlaylist: (content) => ipcRenderer.invoke("save-playlist", content),
});
