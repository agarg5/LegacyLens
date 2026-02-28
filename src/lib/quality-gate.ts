const NO_RESULTS_MESSAGE =
  "No relevant code found for this query. Try being more specific or using terms from the codebase (e.g., file names, COBOL keywords, or program identifiers).";

export function noRelevantResultsResponse(): Response {
  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "sources", results: [] })}\n\n`),
      );
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "token", content: NO_RESULTS_MESSAGE })}\n\n`),
      );
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
      controller.close();
    },
  });
  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
