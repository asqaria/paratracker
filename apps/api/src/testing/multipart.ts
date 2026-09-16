/** Сборка multipart/form-data без внешних зависимостей — для тестов загрузки. */

export interface MultipartFile {
  field: string;
  filename: string;
  content: Uint8Array | string;
  contentType?: string;
}

export interface MultipartPayload {
  payload: Buffer;
  headers: Record<string, string>;
}

const BOUNDARY = 'skylineTestBoundary';

export function multipartBody(files: readonly MultipartFile[]): MultipartPayload {
  const parts: Buffer[] = [];
  for (const file of files) {
    const type = file.contentType ?? 'application/octet-stream';
    parts.push(
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\n` +
          `Content-Type: ${type}\r\n\r\n`,
      ),
      Buffer.from(file.content),
      Buffer.from('\r\n'),
    );
  }
  parts.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  const payload = Buffer.concat(parts);

  return {
    payload,
    headers: {
      'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
      'content-length': String(payload.byteLength),
    },
  };
}
