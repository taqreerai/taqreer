// Renders a single schema.org JSON-LD <script>. Server component (no client JS).
// Accepts one object or an array of objects. The `<` escape prevents a `</script>`
// sequence in any string field from breaking out of the tag — the data is ours,
// but this keeps it safe if a dictionary string ever contains markup.

export function JsonLd({ data }: { data: object | object[] }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
