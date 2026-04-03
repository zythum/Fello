import { memo } from "react";
import { request } from "../../backend";

interface PathLinkProps {
  path: string;
  children: React.ReactNode;
}

export const PathLink = memo(function PathLink({ path, children }: PathLinkProps) {
  return (
    <button
      type="button"
      title={`Reveal in Finder: ${path}`}
      className="cursor-pointer rounded bg-muted/50 mx-1 px-1 text-muted-foreground hover:bg-muted ring-1 ring-border"
      onClick={(e) => {
        e.preventDefault();
        request.revealInFinder(path);
      }}
    >
      #{children}
    </button>
  );
});
