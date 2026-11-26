import { describe, expect, it } from 'vitest';
import { CameraError, cameraProblem, meanLuma } from './pushupCamera';

describe('pushup camera', () => {
  it('names why the camera did not start', () => {
    expect(cameraProblem(new CameraError('insecure'))).toBe('insecure');
    expect(cameraProblem(new DOMException('no', 'NotAllowedError'))).toBe('denied');
    expect(cameraProblem(new DOMException('no', 'NotFoundError'))).toBe('none');
    expect(cameraProblem(new DOMException('no', 'NotReadableError'))).toBe('busy');
    expect(cameraProblem(new Error('x'))).toBe('other');
  });
  it('averages the brightness of the pixels', () => {
    expect(meanLuma([255, 255, 255, 255, 0, 0, 0, 255])).toBeCloseTo(127.5, 1);
    expect(meanLuma([])).toBe(0);
  });
});
