import type { Hex } from "viem";

export type CommitmentWorkerRequest = {
  id: string;
  file: File;
  contentSalt: Uint8Array;
};

export type CommitmentWorkerResponse =
  | {
      id: string;
      type: "status";
      status: "reading" | "hashing";
    }
  | {
      id: string;
      type: "result";
      fileSize: number;
      contentCommitment: Hex;
    }
  | {
      id: string;
      type: "error";
      message: string;
    };

export type CommitmentStatus = "reading" | "hashing";

export function calculateFileCommitment(
  file: File,
  contentSalt: Uint8Array,
  onStatus?: (status: CommitmentStatus) => void
): Promise<{ fileSize: number; contentCommitment: Hex }> {
  const worker = new Worker(
    new URL("../workers/commitment.worker.ts", import.meta.url),
    { type: "module", name: "basestamp-commitment" }
  );
  const id = globalThis.crypto.randomUUID();

  return new Promise((resolve, reject) => {
    const finish = (): void => {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    };

    worker.onerror = () => {
      finish();
      reject(new Error("The local file worker failed."));
    };

    worker.onmessage = (
      event: MessageEvent<CommitmentWorkerResponse>
    ): void => {
      const response = event.data;
      if (response.id !== id) return;
      if (response.type === "status") {
        onStatus?.(response.status);
        return;
      }
      finish();
      if (response.type === "error") {
        reject(new Error(response.message));
      } else {
        resolve({
          fileSize: response.fileSize,
          contentCommitment: response.contentCommitment
        });
      }
    };

    const request: CommitmentWorkerRequest = { id, file, contentSalt };
    worker.postMessage(request);
  });
}
