/**
 * @typedef {Object} DownloadEvent
 * @property {string} id
 * @property {'progress'|'paused'|'resumed'|'done'|'error'} type
 * @property {number} [bytesDone]
 * @property {number} [bytesTotal]
 * @property {string} [error]
 */

/**
 * @typedef {Object} DownloadManager
 * @property {(task:{id:string,url:string,localPath:string})=>void} start
 * @property {(id:string)=>void} pause
 * @property {(id:string)=>void} resume
 * @property {(id:string)=>void} cancel
 * @property {(handler:(e:DownloadEvent)=>void)=>()=>void} subscribe
 * @property {()=>Promise<void>} reattach
 * @property {()=>Promise<number>} freeBytes
 */
export {};
