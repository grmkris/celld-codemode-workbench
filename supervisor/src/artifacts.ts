import { createHash } from "node:crypto";
import type { CelldClient } from "./client.js";

const CHUNK_SIZE = 48_000;

export async function exportAndUploadArtifact(input: {
  tarBuffer: Buffer;
  artifactId: string;
  teamId: string;
  conversationId: string;
  lease: string;
  generation: number;
  client: CelldClient;
}): Promise<{ contentHash: string; chunks: number }> {
  const contentHash = createHash("sha256").update(input.tarBuffer).digest("hex");
  const b64 = input.tarBuffer.toString("base64");
  let chunks = 0;
  for (let offset = 0; offset < b64.length; offset += CHUNK_SIZE) {
    const slice = b64.slice(offset, offset + CHUNK_SIZE);
    const url = input.client.artifactChunkUrl(input.teamId, input.conversationId, input.artifactId);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...input.client.authHeaders(),
      },
      body: JSON.stringify({
        lease: input.lease,
        generation: input.generation,
        chunkIndex: chunks,
        dataB64: slice,
      }),
    });
    if (!res.ok) {
      throw new Error(`artifact chunk upload failed: ${res.status} ${await res.text()}`);
    }
    chunks += 1;
  }
  return { contentHash, chunks };
}
