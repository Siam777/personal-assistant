/**
 * Wrapping tag chip row: fetches `listTags()`, renders nothing when the
 * vault has zero tags (rather than an empty row), wraps chips onto
 * multiple lines with a "Show more"/"Show less" toggle past eight visible
 * chips, and fails soft (renders nothing) on a fetch failure — entries
 * stay fully browsable without this control per the UI-SPEC's
 * non-critical-feature posture for this row.
 */

import { useEffect, useState } from "react";
import { listTags, type Tag } from "../../lib/api";

const VISIBLE_LIMIT = 8;

interface TagFilterProps {
  activeTag: string | null;
  onSelect: (tag: string | null) => void;
}

export default function TagFilter({ activeTag, onSelect }: TagFilterProps) {
  const [tags, setTags] = useState<Tag[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    listTags()
      .then((result) => {
        if (!cancelled) setTags(result);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (failed || tags === null || tags.length === 0) return null;

  const visibleTags = expanded ? tags : tags.slice(0, VISIBLE_LIMIT);
  const hasMore = tags.length > VISIBLE_LIMIT;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {visibleTags.map((tag) => {
        const isActive = tag.name === activeTag;
        return (
          <button
            key={tag.id}
            type="button"
            onClick={() => onSelect(isActive ? null : tag.name)}
            className={`rounded-full px-3 py-1 text-sm font-semibold transition-colors ${
              isActive
                ? "bg-primary text-primary-foreground"
                : "bg-card text-foreground ring-1 ring-foreground/10 hover:bg-muted"
            }`}
          >
            {tag.name}
          </button>
        );
      })}
      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
