import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync } from 'node:fs';
// @ts-expect-error plain JS helper
import sprites from './scripts/sprites-plugin.mjs';
// `./start.sh` (https unless HTTPS=0) makes a self-signed certificate in .certs/: a phone only lets a page use the camera over https (or on localhost)
const https = process.env.HTTPS && existsSync('.certs/key.pem') ? { key: readFileSync('.certs/key.pem'), cert: readFileSync('.certs/cert.pem') } : undefined;
export default defineConfig({ plugins: [react(), sprites()], server: https ? { https } : undefined, test: { environment: 'node' } });
