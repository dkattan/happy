import { io, Socket } from 'socket.io-client';
import { TokenStorage } from '@/auth/tokenStorage';
import { Encryption } from './encryption/encryption';

//
// Types
//

export interface SyncSocketConfig {
    endpoint: string;
    token: string;
}

export interface SyncSocketState {
    isConnected: boolean;
    connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
    lastError: Error | null;
}

export interface SyncSocketDebugInfo {
    endpoint: string | null;
    status: 'disconnected' | 'connecting' | 'connected' | 'error';
    socketId: string | null;
    transport: string | null;
    connected: boolean;
}

export type SyncSocketListener = (state: SyncSocketState) => void;

//
// Main Class
//

class ApiSocket {

    // State
    private socket: Socket | null = null;
    private config: SyncSocketConfig | null = null;
    private encryption: Encryption | null = null;
    private messageHandlers: Map<string, (data: any) => void> = new Map();
    private reconnectedListeners: Set<() => void> = new Set();
    private statusListeners: Set<(status: 'disconnected' | 'connecting' | 'connected' | 'error') => void> = new Set();
    private currentStatus: 'disconnected' | 'connecting' | 'connected' | 'error' = 'disconnected';

    //
    // Initialization
    //

    initialize(config: SyncSocketConfig, encryption: Encryption) {
        this.config = config;
        this.encryption = encryption;
        this.connect();
    }

    //
    // Connection Management
    //

    connect() {
        if (!this.config || this.socket) {
            return;
        }

        this.updateStatus('connecting');

        this.socket = io(this.config.endpoint, {
            path: '/v1/updates',
            auth: {
                token: this.config.token,
                clientType: 'user-scoped' as const
            },
            transports: ['websocket'],
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            reconnectionAttempts: Infinity
        });

        this.setupEventHandlers();
    }

    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        this.updateStatus('disconnected');
    }

    //
    // Listener Management
    //

    onReconnected = (listener: () => void) => {
        this.reconnectedListeners.add(listener);
        return () => this.reconnectedListeners.delete(listener);
    };

    onStatusChange = (listener: (status: 'disconnected' | 'connecting' | 'connected' | 'error') => void) => {
        this.statusListeners.add(listener);
        // Immediately notify with current status
        listener(this.currentStatus);
        return () => this.statusListeners.delete(listener);
    };

    getDebugInfo(): SyncSocketDebugInfo {
        return {
            endpoint: this.config?.endpoint ?? null,
            status: this.currentStatus,
            socketId: this.socket?.id ?? null,
            transport: this.socket?.io?.engine?.transport?.name ?? null,
            connected: this.socket?.connected ?? false,
        };
    }

    //
    // Message Handling
    //

    onMessage(event: string, handler: (data: any) => void) {
        this.messageHandlers.set(event, handler);
        return () => this.messageHandlers.delete(event);
    }

    offMessage(event: string, handler: (data: any) => void) {
        this.messageHandlers.delete(event);
    }

    /**
     * RPC call for sessions - uses session-specific encryption
     */
    async sessionRPC<R, A>(sessionId: string, method: string, params: A): Promise<R> {
        if (!this.socket) {
            throw new Error('Socket not connected');
        }

        const sessionEncryption = this.encryption!.getSessionEncryption(sessionId);
        if (!sessionEncryption) {
            throw new Error(`Session encryption not found for ${sessionId}`);
        }

        const result = await this.callRpcWithRetry(
            `${sessionId}:${method}`,
            await sessionEncryption.encryptRaw(params)
        );
        
        if (result.ok) {
            return await sessionEncryption.decryptRaw(result.result) as R;
        }

        throw new Error(this.getRpcErrorMessage(result));
    }

    /**
     * RPC call for machines - uses legacy/global encryption (for now)
     */
    async machineRPC<R, A>(machineId: string, method: string, params: A): Promise<R> {
        if (!this.socket) {
            throw new Error('Socket not connected');
        }

        const machineEncryption = this.encryption!.getMachineEncryption(machineId);
        if (!machineEncryption) {
            throw new Error(`Machine encryption not found for ${machineId}`);
        }

        const result = await this.callRpcWithRetry(
            `${machineId}:${method}`,
            await machineEncryption.encryptRaw(params)
        );

        if (result.ok) {
            return await machineEncryption.decryptRaw(result.result) as R;
        }

        throw new Error(this.getRpcErrorMessage(result));
    }

    send(event: string, data: any) {
        this.socket!.emit(event, data);
        return true;
    }

    async emitWithAck<T = any>(event: string, data: any): Promise<T> {
        if (!this.socket) {
            throw new Error('Socket not connected');
        }
        return await this.socket.emitWithAck(event, data);
    }

    //
    // HTTP Requests
    //

    async request(path: string, options?: RequestInit): Promise<Response> {
        if (!this.config) {
            throw new Error('SyncSocket not initialized');
        }

        const credentials = await TokenStorage.getCredentials();
        if (!credentials) {
            throw new Error('No authentication credentials');
        }

        const url = `${this.config.endpoint}${path}`;
        const headers = {
            'Authorization': `Bearer ${credentials.token}`,
            ...options?.headers
        };

        return fetch(url, {
            ...options,
            headers
        });
    }

    //
    // Token Management
    //

    updateToken(newToken: string) {
        if (this.config && this.config.token !== newToken) {
            this.config.token = newToken;

            if (this.socket) {
                this.disconnect();
                this.connect();
            }
        }
    }

    //
    // Private Methods
    //

    private updateStatus(status: 'disconnected' | 'connecting' | 'connected' | 'error') {
        if (this.currentStatus !== status) {
            this.currentStatus = status;
            this.statusListeners.forEach(listener => listener(status));
        }
    }

    private setupEventHandlers() {
        if (!this.socket) return;

        // Connection events
        this.socket.on('connect', () => {
            // console.log('🔌 SyncSocket: Connected, recovered: ' + this.socket?.recovered);
            // console.log('🔌 SyncSocket: Socket ID:', this.socket?.id);
            this.updateStatus('connected');
            if (!this.socket?.recovered) {
                this.reconnectedListeners.forEach(listener => listener());
            }
        });

        this.socket.on('disconnect', (reason) => {
            // console.log('🔌 SyncSocket: Disconnected', reason);
            this.updateStatus('disconnected');
        });

        // Error events
        this.socket.on('connect_error', (error) => {
            // console.error('🔌 SyncSocket: Connection error', error);
            // Connection can fail transiently during startup; keep reconnecting state.
            this.updateStatus('connecting');
        });

        this.socket.on('error', (error) => {
            // console.error('🔌 SyncSocket: Error', error);
            this.updateStatus('error');
        });

        // Message handling
        this.socket.onAny((event, data) => {
            // console.log(`📥 SyncSocket: Received event '${event}':`, JSON.stringify(data).substring(0, 200));
            const handler = this.messageHandlers.get(event);
            if (handler) {
                // console.log(`📥 SyncSocket: Calling handler for '${event}'`);
                handler(data);
            } else {
                // console.log(`📥 SyncSocket: No handler registered for '${event}'`);
            }
        });
    }

    private async callRpcWithRetry(method: string, params: string): Promise<any> {
        if (!this.socket) {
            throw new Error('Socket not connected');
        }

        const firstAttempt = await this.socket.emitWithAck('rpc-call', { method, params });
        if (firstAttempt?.ok || !this.isRpcMethodUnavailable(firstAttempt)) {
            return firstAttempt;
        }

        // Give daemon reconnection/handler registration a brief window, then retry once.
        await new Promise((resolve) => setTimeout(resolve, 250));

        if (!this.socket) {
            throw new Error('Socket not connected');
        }

        return await this.socket.emitWithAck('rpc-call', { method, params });
    }

    private getRpcErrorMessage(result: unknown): string {
        if (result && typeof result === 'object') {
            const maybeError = (result as { error?: unknown }).error;
            if (typeof maybeError === 'string' && maybeError.trim().length > 0) {
                return maybeError;
            }
        }
        return 'RPC call failed';
    }

    private isRpcMethodUnavailable(result: unknown): boolean {
        return this.getRpcErrorMessage(result).toLowerCase().includes('rpc method not available');
    }
}

//
// Singleton Export
//

export const apiSocket = new ApiSocket();
