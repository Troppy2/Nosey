// Coding questions generated before the sectioned prompt arrive as one run-on
// paragraph: "Problem: ... Input Format: ... Output Format: ... Example 1:
// safe_div 10 2 returns Some 5 Example 2: ...". This lays such a blob out as
// sections (task, Input, Output, Constraints, one block per example) for
// display only. Anything already structured, or that does not look like a
// coding problem, comes back unchanged.

const MARKER_RE = /\b(Input\s+Format|Output\s+Format|Input|Output|Constraints?|Example\s*\d+|Explanation)\s*:/gi;
const RESULT_RE = /^(.*?)\s+(?:returns|should\s+return|outputs|evaluates\s+to|gives|=>|->)\s+(.+)$/i;

type Section = { marker: string; body: string };

function normalizeMarker(marker: string): string {
  return marker.replace(/\s+/g, " ").trim().toLowerCase();
}

function code(text: string): string {
  return "`" + text.replace(/`/g, "").replace(/[.;,]\s*$/, "").trim() + "`";
}

function block(text: string): string {
  return "```\n" + text.replace(/[.;]\s*$/, "").trim() + "\n```";
}

// One example's body: "safe_div 10 2 returns Some 5", or "Input: [1, 2]
// Output: 3 Explanation: ...", already split into its own sections.
function formatExample(title: string, parts: Section[]): string {
  const lines = [`**${title}**`];
  const head = parts[0]?.marker === "" ? parts.shift()!.body : "";
  const input = parts.find((p) => p.marker === "input")?.body;
  const output = parts.find((p) => p.marker === "output")?.body;
  const explanation = parts.find((p) => p.marker === "explanation")?.body;
  if (input || output) {
    if (input) lines.push(block(input));
    if (output) lines.push(`Output: ${code(output)}`);
  } else if (head) {
    const result = RESULT_RE.exec(head);
    if (result) {
      lines.push(block(result[1]), `Returns ${code(result[2])}`);
    } else {
      lines.push(head);
    }
  }
  if (explanation) lines.push(`Explanation: ${explanation}`);
  return lines.join("\n\n");
}

export function formatCodingProblem(text: string): string {
  if (!text || text.includes("```") || /\*\*(Input|Output|Example)/i.test(text) || /\n\s*\n/.test(text)) {
    return text;
  }
  const matches = [...text.matchAll(MARKER_RE)];
  const kinds = new Set(matches.map((m) => normalizeMarker(m[1]).replace(/\s*\d+$/, "")));
  // A coding problem names at least two of these; prose that merely says
  // "output" once is left alone.
  const signals = ["input format", "output format", "example", "constraints", "constraint"].filter((k) => kinds.has(k));
  if (signals.length < 2) return text;

  const statement = text.slice(0, matches[0].index).replace(/^\s*Problem\s*:\s*/i, "").trim();
  const sections: Section[] = matches.map((match, i) => ({
    marker: normalizeMarker(match[1]),
    body: text.slice(match.index! + match[0].length, i + 1 < matches.length ? matches[i + 1].index : text.length).trim(),
  }));

  const out: string[] = [];
  if (statement) out.push(statement);
  let example: { title: string; parts: Section[] } | null = null;
  const flush = () => {
    if (example) out.push(formatExample(example.title, example.parts));
    example = null;
  };
  for (const section of sections) {
    const exampleNumber = /^example\s*(\d+)$/.exec(section.marker);
    if (exampleNumber) {
      flush();
      example = { title: `Example ${exampleNumber[1]}`, parts: [{ marker: "", body: section.body }] };
      continue;
    }
    if (example) {
      // Inside an example, Input / Output / Explanation belong to it.
      (example as { parts: Section[] }).parts.push(section);
      continue;
    }
    const label =
      section.marker.startsWith("input") ? "Input"
        : section.marker.startsWith("output") ? "Output"
          : section.marker.startsWith("constraint") ? "Constraints"
            : "Explanation";
    out.push(`**${label}:** ${section.body}`);
  }
  flush();
  return out.join("\n\n");
}
