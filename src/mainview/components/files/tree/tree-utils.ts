import type { TreeNode } from "./types";

/** 在指定目录下插入一个临时节点（新建文件 / 文件夹时占位）。 */
export function insertTemp(tree: TreeNode[], parentId: string, node: TreeNode): TreeNode[] {
  return tree.map((n) => {
    if (n.id === parentId) return { ...n, children: [node, ...(n.children ?? [])] };
    if (n.children) return { ...n, children: insertTemp(n.children, parentId, node) };
    return n;
  });
}

/** 按相对路径 id 深度优先查找节点；找不到返回 null。 */
export function findNode(node: TreeNode, id: string): TreeNode | null {
  if (node.id === id) return node;
  if (node.children) {
    for (const child of node.children) {
      const found = findNode(child, id);
      if (found) return found;
    }
  }
  return null;
}

/** 相对路径的最后一段（文件名 / 文件夹名）。 */
export function basename(relativePath: string): string {
  const slash = relativePath.lastIndexOf("/");
  return slash === -1 ? relativePath : relativePath.slice(slash + 1);
}

/** 相对路径的父目录；根目录下返回空串。 */
export function dirname(relativePath: string): string {
  const slash = relativePath.lastIndexOf("/");
  return slash === -1 ? "" : relativePath.slice(0, slash);
}

export function joinRelativePath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

/**
 * 拖拽到 destDir 时真正需要移动的项：剔除目标目录自身、目标的子目录，
 * 以及本来就在目标目录里的项（落在文件行上时很容易命中这种情况）。
 */
export function movableIntoDir(ids: string[], destDir: string): string[] {
  return ids.filter((id) => {
    if (id === destDir) return false;
    if (destDir.startsWith(`${id}/`)) return false;
    return joinRelativePath(destDir, basename(id)) !== id;
  });
}
