/// Entry of the world generator's preview worker (a Vite module worker, see planetClient.ts): just wires `PlanetHost` to the worker's own scope.
import { PlanetHost, type PlanetFrom, type PlanetTo } from './planetHost';

const scope = self as unknown as { postMessage(m: PlanetFrom, transfer: Transferable[]): void; onmessage: ((e: { data: PlanetTo }) => void) | null };
const host = new PlanetHost((m, transfer) => scope.postMessage(m, transfer));
scope.onmessage = e => host.message(e.data);
scope.postMessage({ t: 'ready' }, []);
