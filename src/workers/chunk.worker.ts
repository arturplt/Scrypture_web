/// Entry of the chunk worker (a Vite module worker, see chunkclient.ts): just wires `ChunkHost` to the worker's own scope.
import { ChunkHost, type FromWorker, type ToWorker } from './chunkHost';

// (the project compiles with the DOM library, whose `self` is a Window: only what is used here is stated)
const scope = self as unknown as { postMessage(m: FromWorker, transfer: Transferable[]): void; onmessage: ((e: { data: ToWorker }) => void) | null };
const host = new ChunkHost((m, transfer) => scope.postMessage(m, transfer));
scope.onmessage = e => host.message(e.data);
