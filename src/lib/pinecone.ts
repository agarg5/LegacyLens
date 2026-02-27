import { Pinecone } from "@pinecone-database/pinecone";

export const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY!,
});

export const INDEX_NAME = process.env.PINECONE_INDEX || "legacylens";

export function getIndex() {
  return pinecone.index(INDEX_NAME);
}
