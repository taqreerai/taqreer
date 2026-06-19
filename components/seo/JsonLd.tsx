// Renders schema.org JSON-LD in a <script>. Server component (no client JS).
// Accepts one object, or an array of entities which is emitted as a single
// @graph under ONE top-level "@context" (the schema.org-recommended shape for
// multiple related entities). We deliberately do NOT emit a bare top-level
// ARRAY: an array has no "@context", so naive JSON-LD consumers that read
// `parsed["@context"]` throw on it (a browser SEO extension was doing exactly
// that against our page -> "undefined is not an object (r['@context']...)" in
// Sentry). @graph is also cleaner and de-duplicates the repeated context.
// The `<` escape prevents a `</script>` sequence in any string field from
// breaking out of the tag - the data is ours, but this keeps it safe if a
// dictionary string ever contains markup.

export function JsonLd({ data }: { data: object | object[] }) {
  const payload = Array.isArray(data)
    ? {
        "@context": "https://schema.org",
        // Children inherit the top-level context, so drop their own to avoid
        // a redundant "@context" on every entity.
        "@graph": (data as Array<Record<string, unknown>>).map((entity) => {
          const copy = { ...entity };
          delete copy["@context"];
          return copy;
        }),
      }
    : data;
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
