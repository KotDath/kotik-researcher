import { contextBridge } from 'electron'

const api = {
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
