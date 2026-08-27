export const MAX_GP8_FILE_BYTES = 50 * 1024 * 1024;

type Gp8FileCandidate = Pick<File, 'name' | 'size'>;

export function getGp8FileError(file: Gp8FileCandidate): string | null {
  if (!file.name.toLowerCase().endsWith('.gp')) {
    return '请选择 Guitar Pro 8 的 .gp 文件。';
  }

  if (file.size === 0) {
    return '这个文件是空的，无法读取。';
  }

  if (file.size > MAX_GP8_FILE_BYTES) {
    return '文件超过 50 MB，当前原型暂不读取。';
  }

  return null;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
