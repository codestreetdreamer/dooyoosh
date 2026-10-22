import type { ReactNode } from "react";
import type { TipTapNode } from "@/contracts/journal";

/** Renders TipTap JSON to React elements. No raw HTML is ever injected (spec: never raw HTML from DB). */
function renderText(node: TipTapNode, key: number): ReactNode {
  let el: ReactNode = node.text ?? "";
  for (const mark of node.marks ?? []) {
    if (mark.type === "bold") el = <strong>{el}</strong>;
    else if (mark.type === "italic") el = <em>{el}</em>;
    else if (mark.type === "link") {
      const href = String(mark.attrs?.href ?? "");
      const safe = /^(https?:|mailto:|\/)/.test(href) ? href : "#";
      el = <a href={safe} className="underline underline-offset-4" rel="noopener noreferrer">{el}</a>;
    }
  }
  return <span key={key}>{el}</span>;
}

function render(nodes: TipTapNode[] | undefined): ReactNode[] {
  return (nodes ?? []).map((n, i) => {
    switch (n.type) {
      case "text": return renderText(n, i);
      case "paragraph": return <p key={i}>{render(n.content)}</p>;
      case "heading": {
        const level = Number(n.attrs?.level ?? 2);
        return level <= 2 ? <h2 key={i}>{render(n.content)}</h2> : <h3 key={i}>{render(n.content)}</h3>;
      }
      case "blockquote": return <blockquote key={i}>{render(n.content)}</blockquote>;
      case "bulletList": return <ul key={i} className="mb-6 list-disc pl-6">{render(n.content)}</ul>;
      case "orderedList": return <ol key={i} className="mb-6 list-decimal pl-6">{render(n.content)}</ol>;
      case "listItem": return <li key={i}>{render(n.content)}</li>;
      case "hardBreak": return <br key={i} />;
      default: return null;
    }
  });
}

export function TipTapRenderer({ doc }: { doc: { content: TipTapNode[] } }) {
  return <div className="prose-journal">{render(doc.content)}</div>;
}
