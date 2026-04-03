import type { Plugin } from "unified";

const ABSOLUTE_PATH_REGEX =
  /(?<=^|[^\w.:\\])(?:(?:\/[a-zA-Z0-9_.-]+)+\/[a-zA-Z0-9_.-]+(?:\.[a-zA-Z0-9]+)?|[a-zA-Z]:[\\/](?:[a-zA-Z0-9_.-]+[\\/])*[a-zA-Z0-9_.-]+(?:\.[a-zA-Z0-9]+)?)/g;

export const remarkFilePath: Plugin = () => {
  return (tree: any) => {
    function traverse(node: any) {
      if (!node) return;
      if (node.children) {
        for (let i = node.children.length - 1; i >= 0; i--) {
          const child = node.children[i];
          if (child.type === "code" || child.type === "inlineCode" || child.type === "link") {
            continue;
          }
          if (child.type === "text" && child.value) {
            const matches = [...child.value.matchAll(ABSOLUTE_PATH_REGEX)];
            const validMatches = matches.filter((m) => m[0].length >= 3 && m[0] !== "/");

            if (validMatches.length > 0) {
              const newChildren: any[] = [];
              let lastIndex = 0;
              for (const match of validMatches) {
                const index = match.index!;
                const path = match[0];

                if (index > lastIndex) {
                  newChildren.push({ type: "text", value: child.value.slice(lastIndex, index) });
                }

                newChildren.push({
                  type: "link",
                  url: `reveal://${path}`,
                  title: path,
                  children: [{ type: "text", value: path.split(/[/\\]/).pop() || path }],
                });
                lastIndex = index + path.length;
              }

              if (lastIndex < child.value.length) {
                newChildren.push({ type: "text", value: child.value.slice(lastIndex) });
              }

              node.children.splice(i, 1, ...newChildren);
            }
          } else {
            traverse(child);
          }
        }
      }
    }
    traverse(tree);
  };
};
