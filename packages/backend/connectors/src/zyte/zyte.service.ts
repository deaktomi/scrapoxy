import { Logger } from '@nestjs/common';
import { Agents } from '@scrapoxy/backend-sdk';
import {
    CONNECTOR_ZYTE_TYPE,
    EProxyStatus,
} from '@scrapoxy/common';
import { ZyteApi } from './api';
import { TRANSPORT_ZYTE_TYPE } from './transport/zyte.constants';
import type { IConnectorZyteCredential } from './zyte.interface';
import type { IConnectorService } from '@scrapoxy/backend-sdk';
import type {
    IConnectorProxyRefreshed,
    IProxyKeyToRemove,
} from '@scrapoxy/common';


function convertToProxy(session: string): IConnectorProxyRefreshed {
    const proxy: IConnectorProxyRefreshed = {
        type: CONNECTOR_ZYTE_TYPE,
        transportType: TRANSPORT_ZYTE_TYPE,
        key: session,
        name: session,
        status: EProxyStatus.STARTED,
        config: {},
    };

    return proxy;
}


export class ConnectorZyteService implements IConnectorService {
    private readonly logger = new Logger(ConnectorZyteService.name);

    private readonly api: ZyteApi;

    constructor(
        credentialConfig: IConnectorZyteCredential,
        agents: Agents
    ) {
        this.api = new ZyteApi(
            credentialConfig.token,
            agents
        );
    }

    async getProxies(keys: string[]): Promise<IConnectorProxyRefreshed[]> {
        this.logger.debug('getProxies()');

        const sessions = await this.api.getAllSessions();

        return sessions
            .filter((s) => keys.includes(s))
            .map(convertToProxy);
    }

    async createProxies(count: number): Promise<IConnectorProxyRefreshed[]> {
        this.logger.debug(`createProxies(): count=${count}`);

        const sessions: string[] = [];
        for (let i = 0; i < count; ++i) {
            const session = await this.api.createSession();
            sessions.push(session);
        }

        return sessions.map(convertToProxy);
    }

    async startProxies(): Promise<void> {
        // Not used
    }

    async removeProxies(keys: IProxyKeyToRemove[]): Promise<string[]> {
        this.logger.debug(`removeProxies(): keys.length=${keys.length}`);

        await Promise.all(keys.map((p) => this.api.removeSession(p.key)));

        return [];
    }
}
