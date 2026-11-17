import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// @ts-expect-error plain JS helper
import sprites from './scripts/sprites-plugin.mjs';
export default defineConfig({ plugins: [react(), sprites()], test: { environment: 'node' } });
