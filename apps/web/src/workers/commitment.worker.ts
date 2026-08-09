/// <reference lib="webworker" />

import {
  computeContentCommitment,
  MAX_FILE_SIZE_BYTES
} from "../lib/crypto";
import type {
  CommitmentWorkerRequest,
  CommitmentWorkerResponse
} from "../lib/commitment-worker";

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

function respond(response: CommitmentWorkerResponse): void {
  workerScope.postMessage(response);
}

workerScope.onmessage = async (
  event: MessageEvent<CommitmentWorkerRequest>
): Promise<void> => {
  const { id, file, contentSalt } = event.data;
  try {
    if (!(file instanceof File)) {
      throw new Error("A browser File is required.");
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new Error("File exceeds the 25 MiB limit.");
    }

    respond({ id, type: "status", status: "reading" });
    let fileBytes: Uint8Array | undefined = new Uint8Array(
      await file.arrayBuffer()
    );
    respond({ id, type: "status", status: "hashing" });
    const contentCommitment = await computeContentCommitment(
      fileBytes,
      contentSalt
    );
    const fileSize = fileBytes.byteLength;
    fileBytes = undefined;

    respond({
      id,
      type: "result",
      fileSize,
      contentCommitment
    });
  } catch (error) {
    respond({
      id,
      type: "error",
      message:
        error instanceof Error
          ? error.message
          : "The file could not be processed locally."
    });
  }
};

export {};
