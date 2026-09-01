import { contextBridge, ipcRenderer } from 'electron'

interface GatewayConfig {
  baseUrl: string
  accessToken: string
}

const gatewayConfig = ipcRenderer.sendSync('kotik:get-gateway-config') as GatewayConfig

contextBridge.exposeInMainWorld('kotik', {
  getGatewayConfig: (): GatewayConfig => ({ ...gatewayConfig }),
})
