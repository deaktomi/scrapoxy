import {
    IncomingMessage,
    request,
} from 'http';
import { ONE_SECOND_IN_MS } from '@scrapoxy/common';
import {
    parseError,
    Sockets,
} from '@scrapoxy/proxy-sdk';
import { urlToHttpOptions } from '../helpers';
import type { ITransportService } from '../transports';
import type {
    IFingerprint,
    IFingerprintOptions,
    IFingerprintRequest,
    IProxyToRefresh,
} from '@scrapoxy/common';
import type { ClientRequestArgs } from 'http';


class RedirectError extends Error {
    constructor(public readonly location: string) {
        super();
    }
}


function fingerprintRequest(
    args: ClientRequestArgs,
    payload: IFingerprintRequest
) {
    return new Promise<IFingerprint>((
        resolve, reject
    ) => {
        let timeout: NodeJS.Timeout | undefined = void 0;
        const req = request(
            args,
            (response: IncomingMessage) => {
                if (response.statusCode &&
                    response.statusCode > 300 &&
                    response.statusCode < 400) {
                    const locationHeader = response.headers.location;

                    if (locationHeader && locationHeader.length > 0) {
                        reject(new RedirectError(locationHeader));

                        return;
                    }
                }

                const buffers: Buffer[] = [];
                response.on(
                    'error',
                    (err: any) => {
                        err = parseError(err);

                        if (timeout) {
                            clearTimeout(timeout);
                        }

                        reject(err);
                    }
                );

                response.on(
                    'end',
                    () => {
                        if (timeout) {
                            clearTimeout(timeout);
                            timeout = void 0;
                        }

                        const rawData = Buffer.concat(buffers)
                            .toString();

                        if (response.statusCode === 200) {
                            try {
                                const data = JSON.parse(rawData) as IFingerprint;

                                resolve(data);
                            } catch (err: any) {
                                reject(err);
                            }
                        } else {
                            reject(new Error(`Get ${response.statusCode} status code: ${rawData}`));
                        }
                    }
                );

                response.on(
                    'data',
                    (buffer: Buffer) => {
                        buffers.push(buffer);
                    }
                );
            }
        );

        req.on(
            'error',
            (err: any) => {
                err = parseError(err);

                if (timeout) {
                    clearTimeout(timeout);
                    timeout = void 0;
                }

                reject(err);
            }
        );

        if (args.timeout && args.timeout > 0) {
            timeout = setTimeout(
                () => {
                    timeout = void 0;
                    req.emit(
                        'error',
                        new Error('Request timeout')
                    );
                },
                args.timeout as number
            );
        }

        const payloadRaw = JSON.stringify(payload);

        req.end(payloadRaw);
    });
}


function fingerprintImpl(
    url: string,
    transport: ITransportService,
    proxy: IProxyToRefresh,
    payload: IFingerprintRequest,
    sockets: Sockets,
    timeout: number,
    followRedirectCount: number,
    retry: number
): Promise<IFingerprint> {
    const urlOpts = urlToHttpOptions(url);

    if (!urlOpts) {
        throw new Error('Invalid url');
    }

    const reqArgs = transport.buildFingerprintRequestArgs(
        'POST',
        urlOpts,
        {
            Host: urlOpts.hostname,
            'Content-Type': 'application/json',
        },
        {
            Host: `${urlOpts.hostname}:${urlOpts.port}`,
        },
        proxy,
        sockets,
        timeout
    );

    return fingerprintRequest(
        reqArgs,
        payload
    )
        .catch((err: any) => {
            if (err instanceof RedirectError) {
                const location = (err as RedirectError).location;

                if (location === url) {
                    throw new Error('Cannot redirect to same location');
                }

                if (followRedirectCount <= 0) {
                    throw new Error('Too many redirects');
                }

                return fingerprintImpl(
                    location,
                    transport,
                    proxy,
                    payload,
                    sockets,
                    timeout,
                    followRedirectCount - 1,
                    retry
                );
            }

            if (retry > 0) {
                return fingerprintImpl(
                    url,
                    transport,
                    proxy,
                    payload,
                    sockets,
                    timeout,
                    followRedirectCount,
                    retry - 1
                );
            }

            throw err;
        });
}


export function fingerprint(
    transport: ITransportService,
    proxy: IProxyToRefresh,
    options: IFingerprintOptions,
    payload: IFingerprintRequest,
    sockets: Sockets
): Promise<IFingerprint> {
    return fingerprintImpl(
        options.url,
        transport,
        proxy,
        payload,
        sockets,
        options.timeout,
        options.followRedirectMax,
        options.retryMax
    );
}


export function getEnvFingerprintConfig(
    url?: string,
    timeout?: number
): IFingerprintOptions {
    return {
        url: url && url.length > 0 ? url : process.env.FINGERPRINT_URL ?? 'https://fingerprint.scrapoxy.io/api/json',
        timeout: timeout ?? timeout === 0 ? timeout : parseInt(
            process.env.FINGERPRINT_TIMEOUT ?? (5 * ONE_SECOND_IN_MS).toString(),
            10
        ),
        followRedirectMax: parseInt(
            process.env.FINGERPRINT_FOLLOW_REDIRECT_MAX ?? '3',
            10
        ),
        retryMax: parseInt(
            process.env.FINGERPRINT_RETRY_MAX ?? '2',
            10
        ),
    };
}