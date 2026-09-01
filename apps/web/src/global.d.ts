interface KotikGatewayConfig {
  baseUrl: string
  accessToken: string
}

interface Window {
  kotik?: {
    getGatewayConfig(): KotikGatewayConfig
  }
}

declare module '*.css'
