import * as net from 'net';

import { logger } from './logger';
import * as utils from './utils';

export class JDWP {
    private socket: net.Socket;

    private port: number;
    private host: string;

    constructor(port: number, host: string) {
        this.port = port;
        this.host = host;

        this.socket = new net.Socket();
    }

    async connect() {
        await new Promise<void>((resolve, reject) => {
            this.socket.on("error", reject);
            this.socket.connect(this.port, this.host, () =>  {
                this.socket.off("error", reject);
                resolve();
            });
        });
        try {
            await this.handshake();
        }
        catch (e: any) {
            logger.log(`Error in JDWP handshake: ${e}`);
            throw new Error("Could not successfully complete JDWP handshake");
        }
    }

    async disconnect() {
        this.socket.end();
    }

    private async read(size: number, timeout?: number) {
        if (this.socket.readableLength >= size) {
            return this.socket.read(size) as Buffer;
        }

        return new Promise<Buffer>((resolve, reject) => {
            let timeoutId: NodeJS.Timeout|undefined;
            let readAndResolve = () => {
                let buffer = this.socket.read(size);

                if (timeoutId) {
                    clearTimeout(timeoutId);
                }

                this.socket.off("readable", readableListener);
                this.socket.off("end", readAndResolve);

                if (buffer === null) {
                    return reject(new Error("Could not read data in specified time"));
                }

                return resolve(buffer);
            };

            let readableListener = () => {
                if (this.socket.readableLength >= size) {
                    readAndResolve();
                }
            };

            this.socket.on("readable", readableListener);
            this.socket.on("end", readAndResolve);

            if (timeout) {
                timeoutId = setTimeout(readAndResolve, timeout);
            }
        });
    }

    private async write(data: Buffer|string) {
        return new Promise<void>((resolve, reject) => {
            const flushed = this.socket.write(data, () => {
                flushed ? resolve() : this.socket.once('drain', resolve);
            });
        });
    }

    private async handshake() {
        const handshake = 'JDWP-Handshake';
        await this.write(handshake);

        const reply = (await this.read(handshake.length, 3000)).toString('latin1');
        if (reply !== handshake) {
            throw new Error("JDWP Handshake failed");
        }
    }

    async resume() {
        const commandId = 0;

        const buf = Buffer.allocUnsafe(11);
        buf.writeUInt32BE(11, 0);   // length
        buf.writeUInt32BE(commandId, 4);    // id
        buf[8] = 0;     // flags
        buf[9] = 1;     // command set
        buf[10] = 9;    // command

        await this.write(buf);
        await this.waitForResumeReply(commandId);

        this.socket.on('data', console.log);
    }

    private async waitForResumeReply(commandId: number) {
        let length = (await this.read(4)).readUInt32BE(0);  // 4 bytes
        let id = (await this.read(4)).readUInt32BE(0);      // 4 bytes
        let flags = (await this.read(1))[0];                // 1 byte
        let errorcode = (await this.read(2)).readUInt16BE(0);   // 2 bytes
        let data = (length > 11) ? (await this.read(length - 11)) : Buffer.allocUnsafe(0); // variable length

        if (id !== commandId) {
            // Ignore
            return;
        }

        console.assert((flags & 0x80) !== 0, `JDWP: Was expecting the reply flag. Got ${flags}`);

        if (errorcode !== 0) {
            throw new Error(`Java resume failed with error ${errorcode}`);
        }
    }
}