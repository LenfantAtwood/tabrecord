import { describe, expect, it } from 'vitest';

import { MAX_GP8_FILE_BYTES, formatFileSize, getGp8FileError } from './gp8File';

describe('getGp8FileError', () => {
  it('accepts GP files case-insensitively', () => {
    expect(getGp8FileError({ name: 'idea.GP', size: 1024 })).toBeNull();
  });

  it('rejects legacy Guitar Pro extensions', () => {
    expect(getGp8FileError({ name: 'legacy.gp5', size: 1024 })).toContain('.gp');
  });

  it('rejects empty and oversized files', () => {
    expect(getGp8FileError({ name: 'empty.gp', size: 0 })).toContain('空');
    expect(
      getGp8FileError({ name: 'huge.gp', size: MAX_GP8_FILE_BYTES + 1 }),
    ).toContain('50 MB');
  });
});

describe('formatFileSize', () => {
  it('formats bytes, kilobytes and megabytes', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(2 * 1024 * 1024)).toBe('2.0 MB');
  });
});
