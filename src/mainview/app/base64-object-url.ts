import { useEffect, useState } from "react";

export type ObjectUrlApi = {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
};

export function base64ToBlob(data: string, mimeType: string): Blob {
  const binary = atob(data);
  const chunkSize = 8192;
  const chunks: ArrayBuffer[] = [];

  for (let offset = 0; offset < binary.length; offset += chunkSize) {
    const chunk = binary.slice(offset, offset + chunkSize);
    const buffer = new ArrayBuffer(chunk.length);
    const bytes = new Uint8Array(buffer);
    for (let index = 0; index < chunk.length; index += 1) {
      bytes[index] = chunk.charCodeAt(index);
    }
    chunks.push(buffer);
  }

  return new Blob(chunks, { type: mimeType });
}

export function createBase64ObjectUrl(
  data: string,
  mimeType: string,
  urlApi: ObjectUrlApi = URL,
): string {
  if (!data) {
    return "";
  }
  return urlApi.createObjectURL(base64ToBlob(data, mimeType));
}

export function useBase64ObjectUrl(data: string, mimeType: string): string {
  const [objectUrl, setObjectUrl] = useState("");

  useEffect(() => {
    if (!data) {
      setObjectUrl("");
      return;
    }

    const nextObjectUrl = createBase64ObjectUrl(data, mimeType);
    setObjectUrl(nextObjectUrl);
    return () => {
      URL.revokeObjectURL(nextObjectUrl);
    };
  }, [data, mimeType]);

  return objectUrl;
}
