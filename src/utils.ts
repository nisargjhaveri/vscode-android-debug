import * as crypto from 'crypto';

export function randomString(size: number): string {
    let random;

    try {
        random = crypto.randomBytes(size);
    } catch (e) {
        random = crypto.pseudoRandomBytes(size);
    }

    return random.toString('hex');
}